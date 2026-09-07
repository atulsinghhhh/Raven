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
// The room does not know what a WebSocket is; the node link supplies these
// and translates them into frames. That separation is what makes the room
// testable without a control plane at all — see room_test.go, which drives
// real PeerConnections against a room with these stubbed.
type RoomEvents struct {
	OnOffer           func(p *Participant, sdp webrtc.SessionDescription)
	OnICECandidate    func(p *Participant, candidate *webrtc.ICECandidate)
	OnTrackChange     func(p *Participant, track *PublishedTrack, published bool)
	OnStateChange     func(p *Participant, iceState, peerState string)
	OnParticipantGone func(p *Participant)
}

// Room is one live media session on this node.
//
// Every participant of a room is on the same node — allocation guarantees
// it — so a room needs no cross-node coordination. That is deliberate:
// forwarding media between SFU nodes to serve one room would double the
// bandwidth and add a hop of latency for every packet, and the control
// plane avoids the situation entirely by assigning a room once.
type Room struct {
	ID              string
	maxParticipants int

	mu           sync.RWMutex
	participants map[string]*Participant // keyed by session id
	// bySessionForParticipant maps participant id → session id, so a
	// reconnecting participant's stale session can be found and evicted.
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
// already being published, and returns the offer they should answer.
//
// The initial offer includes every existing track, so a participant
// joining a call in progress sees and hears everyone as soon as the
// connection completes — rather than connecting to silence and then
// receiving a renegotiation per existing participant.
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

	// A participant reconnecting (new network, refreshed tab) arrives with
	// a new session id while the old one may still look alive to us. The
	// old session is evicted rather than allowed to coexist: two sessions
	// for one identity means the room shows a ghost, and the ghost holds a
	// PeerConnection that is quietly forwarding media nowhere.
	staleSession, hasStale := r.sessionByParticipant[participantID]
	r.mu.Unlock()

	if hasStale && staleSession != sessionID {
		r.logger.Info("evicting stale session for reconnecting participant",
			"participantId", participantID, "staleSession", staleSession, "newSession", sessionID)
		r.RemoveParticipant(staleSession)
	}

	participant := newParticipant(participantID, sessionID, r.ID, permissions, pc, ParticipantEvents{
		OnNegotiationNeeded: r.renegotiate,
		OnICECandidate:      r.events.OnICECandidate,
		OnTrackPublished:    r.handleTrackPublished,
		OnTrackUnpublished:  r.handleTrackUnpublished,
		OnStateChange:       r.events.OnStateChange,
		OnClosed:            r.handleParticipantClosed,
		OnData:              r.broadcastData,
	}, r.logger)

	r.mu.Lock()
	r.participants[sessionID] = participant
	r.sessionByParticipant[participantID] = sessionID
	existing := r.otherParticipantsLocked(sessionID)
	r.mu.Unlock()

	// Subscribe to everything already in the room before offering, so it
	// is all in the first SDP.
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
	// Only clear the reverse mapping if it still points at this session —
	// a reconnect may already have claimed it.
	if r.sessionByParticipant[participant.ID] == sessionID {
		delete(r.sessionByParticipant, participant.ID)
	}
	r.mu.Unlock()

	// Close triggers OnClosed → handleParticipantClosed, which does the
	// unsubscribe fan-out.
	participant.Close()
	return true
}

// handleParticipantClosed removes a departed participant's tracks from
// everyone else and renegotiates them.
//
// Reached both from an explicit removal and from a PeerConnection failing
// on its own, which is why it is idempotent at every step.
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
// Silently does nothing when a negotiation is already in flight —
// `CreateOffer` has recorded that another round is needed, and the answer
// handler will start it. That is the whole glare-avoidance strategy: never
// two offers on one PeerConnection, never a lost change.
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

// Renegotiate is the exported entry point for the node link, used after an
// answer completes a round that had a pending change.
func (r *Room) Renegotiate(participant *Participant) { r.renegotiate(participant) }

// broadcastData fans a data-channel message to the rest of the room.
//
// Sent over each recipient's own data channel rather than the WebSocket:
// spec §18 is explicit that room data should ride the transport it was
// designed for. It arrives with the same NAT traversal and encryption as
// media, and does not compete with signaling for the control connection.
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

// TrackCount counts published tracks across the room, for metrics.
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

// State is the snapshot that replaced polling LiveKit's RoomServiceClient.
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

// Close evicts everyone. Used for an admin room close and for node
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
