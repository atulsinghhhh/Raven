package room

import (
	"errors"
	"log/slog"
	"sync"

	"github.com/pion/webrtc/v4"
)

var (
	ErrRoomFull            = errors.New("room is full")
	ErrParticipantNotFound = errors.New("participant not found")
)

// RoomEvents is how a room reports to the control plane.
//
// The room has no idea what a WebSocket is. The node link supplies these
// and turns them into frames. That separation is what makes a room
// testable with no control plane in sight; see room_test.go, which drives
// real PeerConnections against a room with all of these stubbed out.
type RoomEvents struct {
	OnOffer           func(p *Participant, sdp webrtc.SessionDescription)
	OnICECandidate    func(p *Participant, candidate *webrtc.ICECandidate)
	OnTrackChange     func(p *Participant, track *PublishedTrack, published bool)
	OnStateChange     func(p *Participant, iceState, peerState string)
	OnParticipantGone func(p *Participant)
}

// Room is one live media session on this node.
//
// Everyone in a room is on the same node, guaranteed by allocation, so a
// room needs no cross-node coordination whatsoever. That's not an accident.
// Forwarding media between SFU nodes to serve a single room would double
// the bandwidth and add a hop of latency to every packet. The control plane
// sidesteps the whole problem by assigning a room exactly once.
type Room struct {
	ID              string
	maxParticipants int

	mu           sync.RWMutex
	participants map[string]*Participant // keyed by session id
	// bySessionForParticipant maps participant id → session id, so we can
	// find and evict a reconnecting participant's stale session.
	sessionByParticipant map[string]string

	events RoomEvents
	logger *slog.Logger

	closed bool
}

func NewRoom(id string, maxParticipants int, events RoomEvents, logger *slog.Logger) *Room {
	return &Room{
		ID:                   id,
		maxParticipants:      maxParticipants,
		participants:         make(map[string]*Participant),
		sessionByParticipant: make(map[string]string),
		events:               events,
		logger:               logger.With("roomId", id),
	}
}

// AddParticipant creates a participant, subscribes them to everything
// already being published, and hands back the offer they should answer.
//
// That first offer carries every existing track. Someone joining a call
// already in progress sees and hears the room the moment their connection
// completes, instead of arriving to silence and then being renegotiated at
// once per person already there.
func (r *Room) AddParticipant(participantID, sessionID string, permissions Permissions, pc *webrtc.PeerConnection) (*Participant, error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil, errors.New("room is closed")
	}
	if len(r.participants) >= r.maxParticipants {
		r.mu.Unlock()
		return nil, ErrRoomFull
	}

	r.mu.Unlock()

	participant := newParticipant(participantID, sessionID, r.ID, permissions, pc, ParticipantEvents{
		OnNegotiationNeeded: r.renegotiate,
		OnICECandidate:      r.events.OnICECandidate,
		OnTrackPublished:    r.handleTrackPublished,
		OnTrackUnpublished:  r.handleTrackUnpublished,
		OnStateChange:       r.events.OnStateChange,
		OnClosed:            r.handleParticipantClosed,
		OnData:              r.broadcastData,
	}, r.logger)

	// Someone reconnecting (new network, refreshed tab) turns up with a new
	// session id while the old one may still look perfectly alive to us.
	// Evict the old one; don't let the two coexist. Two sessions for one
	// identity puts a ghost in the room, and that ghost is sitting on a
	// PeerConnection quietly forwarding media into the void.
	//
	// Handing the identity over is one critical section, because it used to
	// be three: read the stale session, unlock, evict it, lock again,
	// insert. Two joins for the same identity arriving together — which is
	// exactly what a control plane does while its link to us is flapping —
	// both read the same stale session, both evicted it, and both inserted.
	// The room was then left with a reverse mapping pointing at one session
	// and a live PeerConnection belonging to another, and the follow-up
	// cleanup closed both. The identity vanished from the room while its
	// publisher was still sending, so every later subscriber was offered a
	// room with nothing in it and correctly negotiated `inactive`. A viewer
	// joining after a control-plane restart got a connection that came up
	// perfectly and carried no media.
	//
	// So the read, the hand-over and the insert happen together, under one
	// hold of r.mu: whoever gets the lock last is the authoritative session,
	// and every displaced one is taken out of `participants` by the same
	// goroutine that replaced it. Closing them is deliberately left until
	// after the unlock — it fans out unsubscribes and renegotiates every
	// remaining subscriber, which is far too much work to hold a room lock
	// through.
	r.mu.Lock()
	superseded := make([]*Participant, 0, 2)
	if staleSession, hasStale := r.sessionByParticipant[participantID]; hasStale && staleSession != sessionID {
		// A mapping can outlive its participant (the session was already
		// removed and only the reverse entry is left). Overwriting it below
		// is all that case needs.
		if stale := r.participants[staleSession]; stale != nil {
			delete(r.participants, staleSession)
			superseded = append(superseded, stale)
		}
	}
	// The same session id being added twice would otherwise orphan the
	// first object: still wired to the PeerConnection, no longer reachable.
	if previous := r.participants[sessionID]; previous != nil {
		superseded = append(superseded, previous)
	}
	r.participants[sessionID] = participant
	r.sessionByParticipant[participantID] = sessionID
	// Snapshotted after the displaced sessions are out, so a new arrival
	// never subscribes to a publisher that is on its way out of the room.
	existing := r.otherParticipantsLocked(sessionID)
	r.mu.Unlock()

	for _, stale := range superseded {
		r.logger.Info("evicting stale session for reconnecting participant",
			"participantId", participantID, "staleSession", stale.SessionID, "newSession", sessionID)
		// Close, not RemoveParticipant: this session is already out of the
		// room, and RemoveParticipant would look it up and find nothing.
		// handleParticipantClosed still runs the unsubscribe fan-out, and
		// its `r.participants[sessionID] == participant` guard means it
		// cannot delete the reverse mapping this call just installed.
		stale.Close()
	}

	// Subscribe to everything already in the room before we offer, so it
	// all lands in the first SDP.
	if permissions.Subscribe {
		for _, other := range existing {
			for _, track := range other.PublishedTracks() {
				if err := participant.Subscribe(track); err != nil {
					r.logger.Warn("initial subscribe failed",
						"subscriber", participantID, "publisher", other.ID, "trackId", track.ID, "err", err)
				}
			}
		}
	}

	r.logger.Info("participant added", "participantId", participantID, "sessionId", sessionID,
		"roomSize", r.Size(), "subscribedTo", len(existing))
	return participant, nil
}

// RemoveParticipant tears down a session and unsubscribes everyone from
// its tracks.
func (r *Room) RemoveParticipant(sessionID string) bool {
	r.mu.Lock()
	participant, found := r.participants[sessionID]
	if !found {
		r.mu.Unlock()
		return false
	}
	delete(r.participants, sessionID)
	// Only clear the reverse mapping if it still points at this session. A
	// reconnect may have claimed it already.
	if r.sessionByParticipant[participant.ID] == sessionID {
		delete(r.sessionByParticipant, participant.ID)
	}
	r.mu.Unlock()

	// Close fires OnClosed → handleParticipantClosed, which does the
	// unsubscribe fan-out for us.
	participant.Close()
	return true
}

// handleParticipantClosed strips a departed participant's tracks out of
// everyone else and renegotiates them.
//
// Gets here from an explicit removal *and* from a PeerConnection falling
// over by itself, which is why every step is idempotent.
func (r *Room) handleParticipantClosed(participant *Participant) {
	r.mu.Lock()
	if r.participants[participant.SessionID] == participant {
		delete(r.participants, participant.SessionID)
		if r.sessionByParticipant[participant.ID] == participant.SessionID {
			delete(r.sessionByParticipant, participant.ID)
		}
	}
	others := r.otherParticipantsLocked(participant.SessionID)
	r.mu.Unlock()

	changed := make([]*Participant, 0, len(others))
	for _, other := range others {
		removedAny := false
		for _, track := range participant.PublishedTracks() {
			if other.Unsubscribe(participant.ID, track.ID) {
				removedAny = true
			}
		}
		if removedAny {
			changed = append(changed, other)
		}
	}

	for _, other := range changed {
		r.renegotiate(other)
	}

	if r.events.OnParticipantGone != nil {
		r.events.OnParticipantGone(participant)
	}
	r.logger.Info("participant removed", "participantId", participant.ID, "roomSize", r.Size())
}

// handleTrackPublished fans a new track out to every subscriber and
// renegotiates each of them.
func (r *Room) handleTrackPublished(publisher *Participant, track *PublishedTrack) {
	if r.events.OnTrackChange != nil {
		r.events.OnTrackChange(publisher, track, true)
	}

	for _, other := range r.otherParticipants(publisher.SessionID) {
		if !other.CanSubscribe() {
			continue
		}
		if err := other.Subscribe(track); err != nil {
			r.logger.Warn("subscribe failed", "subscriber", other.ID, "trackId", track.ID, "err", err)
			continue
		}
		r.renegotiate(other)
	}
}

func (r *Room) handleTrackUnpublished(publisher *Participant, track *PublishedTrack) {
	if r.events.OnTrackChange != nil {
		r.events.OnTrackChange(publisher, track, false)
	}

	for _, other := range r.otherParticipants(publisher.SessionID) {
		if other.Unsubscribe(publisher.ID, track.ID) {
			r.renegotiate(other)
		}
	}
}

// renegotiate offers a participant their updated track set.
//
// Does nothing at all, quietly, if a negotiation is already in flight.
// CreateOffer has already noted that another round is needed and the answer
// handler will kick it off. That's the entire glare-avoidance strategy:
// never two offers on one PeerConnection, never a lost change.
func (r *Room) renegotiate(participant *Participant) {
	if participant.Closed() {
		return
	}

	offer, err := participant.CreateOffer()
	if err != nil {
		if !errors.Is(err, ErrNegotiationInProgress) {
			r.logger.Warn("renegotiation failed", "participantId", participant.ID, "err", err)
		}
		return
	}
	if r.events.OnOffer != nil {
		r.events.OnOffer(participant, *offer)
	}
}

// Renegotiate is the exported entry point for the node link. Used after an
// answer finishes a round that had a change queued behind it.
func (r *Room) Renegotiate(participant *Participant) { r.renegotiate(participant) }

// broadcastData fans a data-channel message out to the rest of the room.
//
// Goes over each recipient's own data channel, not the WebSocket. Spec §18
// is explicit that room data should ride the transport built for it. It
// picks up the same NAT traversal and encryption media gets, and it isn't
// elbowing signaling out of the way on the control connection.
func (r *Room) broadcastData(sender *Participant, payload []byte) {
	for _, other := range r.otherParticipants(sender.SessionID) {
		if err := other.SendData(payload); err != nil {
			r.logger.Debug("data send failed", "recipient", other.ID, "err", err)
		}
	}
}

// SetSubscriptionLayer applies a subscriber's simulcast preference for one
// publisher's track.
func (r *Room) SetSubscriptionLayer(sessionID, publisherID, trackID string, layer LayerID) error {
	subscriber, found := r.Participant(sessionID)
	if !found {
		return ErrParticipantNotFound
	}

	publisher, found := r.ParticipantByID(publisherID)
	if !found {
		return ErrParticipantNotFound
	}
	track, found := publisher.PublishedTrack(trackID)
	if !found {
		return errors.New("track not found")
	}

	if !subscriber.SetSubscriptionLayer(publisherID, trackID, layer, track) {
		return errors.New("not subscribed to this track")
	}
	return nil
}

func (r *Room) Participant(sessionID string) (*Participant, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	participant, found := r.participants[sessionID]
	return participant, found
}

func (r *Room) ParticipantByID(participantID string) (*Participant, bool) {
	r.mu.RLock()
	sessionID, found := r.sessionByParticipant[participantID]
	if !found {
		r.mu.RUnlock()
		return nil, false
	}
	participant, found := r.participants[sessionID]
	r.mu.RUnlock()
	return participant, found
}

func (r *Room) Participants() []*Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()
	participants := make([]*Participant, 0, len(r.participants))
	for _, participant := range r.participants {
		participants = append(participants, participant)
	}
	return participants
}

func (r *Room) otherParticipants(exceptSessionID string) []*Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.otherParticipantsLocked(exceptSessionID)
}

func (r *Room) otherParticipantsLocked(exceptSessionID string) []*Participant {
	others := make([]*Participant, 0, len(r.participants))
	for sessionID, participant := range r.participants {
		if sessionID != exceptSessionID {
			others = append(others, participant)
		}
	}
	return others
}

func (r *Room) Size() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.participants)
}

// TrackCount totals published tracks across the room. Feeds the metrics.
func (r *Room) TrackCount() (audio, video int) {
	for _, participant := range r.Participants() {
		for _, track := range participant.PublishedTracks() {
			switch track.Kind {
			case webrtc.RTPCodecTypeAudio:
				audio++
			case webrtc.RTPCodecTypeVideo:
				video++
			}
		}
	}
	return audio, video
}

// State is the snapshot that put an end to polling LiveKit's
// RoomServiceClient.
func (r *Room) State() State {
	participants := r.Participants()
	result := State{
		RoomID:       r.ID,
		Participants: make([]ParticipantState, 0, len(participants)),
	}

	for _, participant := range participants {
		_, peerState := participant.ConnectionState()
		entry := ParticipantState{
			ParticipantID: participant.ID,
			SessionID:     participant.SessionID,
			JoinedAtUnix:  participant.JoinedAt().Unix(),
			PeerState:     peerState,
		}
		for _, track := range participant.PublishedTracks() {
			entry.Tracks = append(entry.Tracks, TrackState{
				TrackID:   track.ID,
				Kind:      track.Kind.String(),
				Source:    string(track.Source()),
				Muted:     track.Muted(),
				Simulcast: track.IsSimulcast(),
			})
		}
		result.Participants = append(result.Participants, entry)
	}
	return result
}

// Close evicts everyone. Used by an admin room close and by node
// shutdown.
func (r *Room) Close() {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed = true
	participants := r.participants
	r.participants = make(map[string]*Participant)
	r.sessionByParticipant = make(map[string]string)
	r.mu.Unlock()

	for _, participant := range participants {
		participant.Close()
	}
	r.logger.Info("room closed", "evicted", len(participants))
}

func (r *Room) Closed() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.closed
}
