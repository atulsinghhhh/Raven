package room

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// dataChannelLabel is the one channel Raven's `room.sendData()` rides on.
//
// One negotiated channel, not one per peer pair. This is an SFU: the node
// is the only peer any client ever has, and "room-wide delivery" is really
// just the node fanning out on their behalf. Nice side effect is that data
// gets the same works-behind-any-NAT property media does, which a
// peer-to-peer data mesh never would.
const dataChannelLabel = "raven-data"

// ParticipantEvents is how a participant tells the room and the control
// plane what its PeerConnection is up to.
//
// Callbacks, not a channel. Each of these has exactly one consumer, and
// the ordering between them matters: let an OnTrackPublished race ahead of
// the OnNegotiationNeeded carrying it and you get a subscriber offer for a
// track the room has never heard of.
type ParticipantEvents struct {
	// OnNegotiationNeeded fires when the SFU owes the client a new offer.
	// Happens any time this participant's subscribed track set changes.
	OnNegotiationNeeded func(p *Participant)
	OnICECandidate      func(p *Participant, candidate *webrtc.ICECandidate)
	OnTrackPublished    func(p *Participant, track *PublishedTrack)
	OnTrackUnpublished  func(p *Participant, track *PublishedTrack)
	OnStateChange       func(p *Participant, iceState, peerState string)
	// OnClosed fires exactly once, when the participant is gone for good.
	OnClosed func(p *Participant)
	// OnData carries a data-channel message for the room to fan out.
	OnData func(p *Participant, payload []byte)
}

// Participant is one client's connection to this node.
//
// # One PeerConnection, both directions
//
// Plenty of SFUs hand each client two PeerConnections, one to publish on
// and one to subscribe on, so subscriber-side renegotiation can't disturb
// the publisher side. Raven uses one. That buys a single ICE negotiation,
// a single DTLS handshake, one set of candidates to shove through a
// firewall, and one thing to reconnect when it all falls over. The
// renegotiation mess two connections would have dodged gets handled by the
// negotiation serialisation further down instead.
type Participant struct {
	ID        string
	SessionID string
	RoomID    string

	permissions Permissions

	pc     *webrtc.PeerConnection
	events ParticipantEvents
	logger *slog.Logger

	joinedAt time.Time

	mu sync.RWMutex
	// published is keyed by track id: the tracks this participant sends.
	published map[string]*PublishedTrack
	// subscriptions is keyed by "publisherID/trackID". This participant's
	// copies of everyone else's tracks.
	subscriptions map[string]*DownTrack
	// declaredSources is what the client claims each track it's about to
	// publish is *of*, keyed by track id. Filled in before the media shows
	// up (see TypeTrackSource) and read back when it does.
	declaredSources map[string]TrackSource

	dataChannel atomic.Pointer[webrtc.DataChannel]

	// Negotiation state, guarded by negMu. The lock is held across the
	// whole offer→answer round trip, not just offer creation.
	//
	// Covering creation alone isn't enough. Two participants joining at the
	// same moment both change everyone else's subscribed track set, so two
	// renegotiations kick off seconds apart. If the second builds an offer
	// while the first is still waiting on its answer, the PeerConnection's
	// local description gets replaced and that first answer no longer
	// applies to anything. This is the "perfect negotiation" rule: never a
	// second offer while one is outstanding. The glare we can't dodge gets
	// settled by the SFU playing the impolite peer (see AcceptOffer).
	negMu sync.Mutex
	// offerInFlight: true from the moment we create an offer until its
	// answer is applied, or until we give up on the round trip.
	offerInFlight bool
	// pendingRenegotiation remembers that the track set moved while an
	// offer was already out, so the change doesn't just vanish.
	pendingRenegotiation bool
	// negotiationTimer abandons a round trip whose answer never turns up.
	// Without it, one client disappearing mid-negotiation leaves this
	// participant unable to renegotiate ever again.
	negotiationTimer *time.Timer

	closed atomic.Bool

	// ICE candidate buffering, guarded by iceMu.
	//
	// iceMu is held across SetRemoteDescription-and-flush so a candidate
	// cannot slip in between the description landing and the buffer
	// draining, which would leave it queued behind a description that has
	// already been applied.
	iceMu sync.Mutex
	// pendingRemoteCandidates holds candidates that turned up before there
	// was a remote description to attach them to.
	pendingRemoteCandidates []webrtc.ICECandidateInit
}

func newParticipant(id, sessionID, roomID string, permissions Permissions, pc *webrtc.PeerConnection, events ParticipantEvents, logger *slog.Logger) *Participant {
	p := &Participant{
		ID:              id,
		SessionID:       sessionID,
		RoomID:          roomID,
		permissions:     permissions,
		pc:              pc,
		events:          events,
		logger:          logger.With("participantId", id, "sessionId", sessionID, "roomId", roomID),
		joinedAt:        time.Now(),
		published:       make(map[string]*PublishedTrack),
		subscriptions:   make(map[string]*DownTrack),
		declaredSources: make(map[string]TrackSource),
	}
	p.wire()
	return p
}

func (p *Participant) wire() {
	p.pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		// A nil candidate means gathering finished. We don't forward it.
		// The SDK reads "no more candidates" the same way, and an explicit
		// end-of-candidates frame is one more thing three client
		// implementations would have to agree on.
		if candidate == nil {
			return
		}
		if p.events.OnICECandidate != nil {
			p.events.OnICECandidate(p, candidate)
		}
	})

	p.pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		p.logger.Info("peer connection state", "state", state.String())
		if p.events.OnStateChange != nil {
			p.events.OnStateChange(p, p.pc.ICEConnectionState().String(), state.String())
		}
		switch state {
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			// Failed is the end of the road for this PeerConnection. The
			// client's reconnect logic builds a whole new session instead
			// of trying to resuscitate this one. ICE restart on a failed
			// connection is flakier than starting clean, and the client has
			// to cope with a fresh session anyway (it may well have changed
			// networks in the meantime).
			p.Close()
		}
	})

	p.pc.OnTrack(func(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		p.handleIncomingTrack(remote, receiver)
	})

	p.pc.OnDataChannel(func(channel *webrtc.DataChannel) {
		if channel.Label() != dataChannelLabel {
			p.logger.Warn("ignoring unexpected data channel", "label", channel.Label())
			return
		}
		if !p.permissions.PublishData {
			// Token didn't grant data. Close the channel instead of
			// quietly binning messages, so the client gets a real signal
			// rather than wondering why nothing ever arrives.
			p.logger.Warn("data channel rejected: token does not grant publishData")
			_ = channel.Close()
			return
		}
		p.dataChannel.Store(channel)
		channel.OnMessage(func(msg webrtc.DataChannelMessage) {
			if p.events.OnData != nil {
				p.events.OnData(p, msg.Data)
			}
		})
		p.logger.Info("data channel open")
	})
}

// handleIncomingTrack takes a track the publisher has started sending.
//
// Fires once per simulcast layer, and every layer of a track shares one
// track id. So the first arrival builds the PublishedTrack and announces
// it; later ones just bolt on another layer. Announcing once is what stops
// subscribers being told about the same camera three times over.
func (p *Participant) handleIncomingTrack(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
	if !p.canPublishKind(remote.Kind()) {
		p.logger.Warn("track rejected: token does not grant this kind",
			"kind", remote.Kind().String(), "trackId", remote.ID())
		return
	}

	p.mu.Lock()
	track, existing := p.published[remote.ID()]
	if !existing {
		declared := p.declaredSources[remote.ID()]
		track = newPublishedTrack(p.ID, remote, declared, p.pc.WriteRTCP, p.logger)
		p.published[remote.ID()] = track
	}
	p.mu.Unlock()

	track.addLayer(remote)

	if !existing {
		p.logger.Info("track published", "trackId", track.ID, "kind", track.Kind.String(), "source", track.Source())
		if p.events.OnTrackPublished != nil {
			p.events.OnTrackPublished(p, track)
		}
	}

	// Drain RTCP from the publisher's sender-side reports. Pion needs these
	// read for its interceptors (NACK, TWCC, receiver reports) to work at
	// all. Leave the stream unread and congestion feedback stalls.
	go p.drainRTCP(receiver)
}

func (p *Participant) drainRTCP(receiver *webrtc.RTPReceiver) {
	buf := make([]byte, 1500)
	for {
		if _, _, err := receiver.Read(buf); err != nil {
			if !errors.Is(err, io.EOF) && !p.closed.Load() {
				p.logger.Debug("receiver RTCP read ended", "err", err)
			}
			return
		}
	}
}

func (p *Participant) canPublishKind(kind webrtc.RTPCodecType) bool {
	if !p.permissions.Publish {
		return false
	}
	switch kind {
	case webrtc.RTPCodecTypeAudio:
		return p.permissions.PublishAudio
	case webrtc.RTPCodecTypeVideo:
		return p.permissions.PublishVideo
	default:
		return false
	}
}

func (p *Participant) CanSubscribe() bool   { return p.permissions.Subscribe }
func (p *Participant) CanPublishData() bool { return p.permissions.PublishData }

// Subscribe attaches one of someone else's tracks to this participant.
//
// Doesn't renegotiate. The caller batches subscriptions and renegotiates
// once at the end, because somebody joining a busy room subscribes to a
// dozen tracks at once, and a dozen offer/answer round trips would turn
// "join" into a multi-second wait.
func (p *Participant) Subscribe(track *PublishedTrack) error {
	if p.closed.Load() {
		return errors.New("participant is closed")
	}
	if !p.permissions.Subscribe {
		return errors.New("token does not grant subscribe")
	}
	if track.ParticipantID == p.ID {
		// Subscribing to your own track echoes your microphone back at you.
		// Callers already filter this out; belt and braces.
		return nil
	}

	key := subscriptionKey(track.ParticipantID, track.ID)
	p.mu.RLock()
	_, already := p.subscriptions[key]
	p.mu.RUnlock()
	if already {
		return nil
	}

	// The subscriber's copy keeps the *publisher's* track and stream ids,
	// so the client can work out which participant an incoming track
	// belongs to without a side-channel lookup.
	local, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: track.MimeType},
		track.ID,
		track.StreamID,
	)
	if err != nil {
		return fmt.Errorf("create local track: %w", err)
	}

	sender, err := p.pc.AddTrack(local)
	if err != nil {
		return fmt.Errorf("add track to peer connection: %w", err)
	}

	down := newDownTrack(p.ID, local, sender, track.MimeType, track.Kind, LayerNone)

	p.mu.Lock()
	p.subscriptions[key] = down
	p.mu.Unlock()

	track.AddSubscriber(down)

	// Read this sender's RTCP so subscriber feedback actually reaches the
	// publisher's encoder. Skip it and a subscriber's PLI (its decoder
	// asking for a keyframe after loss) goes unseen, leaving the picture
	// broken until the next scheduled keyframe wanders past.
	go p.forwardSubscriberFeedback(sender, track)

	p.logger.Debug("subscribed", "publisher", track.ParticipantID, "trackId", track.ID)
	return nil
}

// forwardSubscriberFeedback relays a subscriber's keyframe requests up to
// the publisher.
//
// This is the RTCP path that makes recovery work end to end. Subscriber's
// decoder gives up, fires a PLI at the SFU, SFU asks the publisher for a
// keyframe. Dropping these on the floor is a classic SFU bug, and the
// symptom is always "video sometimes just never comes back after a blip".
func (p *Participant) forwardSubscriberFeedback(sender *webrtc.RTPSender, track *PublishedTrack) {
	for {
		packets, _, err := sender.ReadRTCP()
		if err != nil {
			if !errors.Is(err, io.EOF) && !p.closed.Load() {
				p.logger.Debug("sender RTCP read ended", "err", err)
			}
			return
		}
		for _, packet := range packets {
			switch packet.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				track.RequestKeyframeNow()
			}
			// NACK is Pion's own interceptor's job, worked against its send
			// buffer. It can retransmit the exact packet, which beats
			// anything we could manage now we've let go of it.
		}
	}
}

// Unsubscribe detaches a track. Same as Subscribe: no renegotiation.
func (p *Participant) Unsubscribe(publisherID, trackID string) bool {
	key := subscriptionKey(publisherID, trackID)

	p.mu.Lock()
	down, found := p.subscriptions[key]
	delete(p.subscriptions, key)
	p.mu.Unlock()
	if !found {
		return false
	}

	down.Close()
	if err := p.pc.RemoveTrack(down.Sender()); err != nil {
		// Already gone, usually because the PeerConnection is closing.
		p.logger.Debug("remove track failed", "err", err)
	}
	return true
}

// SetSubscriptionLayer applies a per-subscriber simulcast preference.
func (p *Participant) SetSubscriptionLayer(publisherID, trackID string, layer LayerID, track *PublishedTrack) bool {
	return track.SetSubscriberLayer(p.ID, layer)
}

// PublishedTracks is everything this participant is currently sending.
func (p *Participant) PublishedTracks() []*PublishedTrack {
	p.mu.RLock()
	defer p.mu.RUnlock()
	tracks := make([]*PublishedTrack, 0, len(p.published))
	for _, track := range p.published {
		tracks = append(tracks, track)
	}
	return tracks
}

func (p *Participant) PublishedTrack(trackID string) (*PublishedTrack, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	track, found := p.published[trackID]
	return track, found
}

// DeclareTrackSource records what a track the client is about to publish
// is *of*.
//
// Applied to already-published tracks as well, because the declaration and
// the media race each other. They land on separate goroutines and the
// media getting there first is completely normal.
func (p *Participant) DeclareTrackSource(trackID string, source TrackSource) {
	if !source.valid() {
		p.logger.Warn("ignoring unknown declared track source", "trackId", trackID, "source", source)
		return
	}

	p.mu.Lock()
	p.declaredSources[trackID] = source
	track := p.published[trackID]
	p.mu.Unlock()

	if track != nil {
		track.setSource(source)
	}
	p.logger.Debug("track source declared", "trackId", trackID, "source", source)
}

// SetTrackMuted mutes one of this participant's published tracks.
func (p *Participant) SetTrackMuted(trackID string, muted bool) bool {
	track, found := p.PublishedTrack(trackID)
	if !found {
		return false
	}
	track.SetMuted(muted)
	p.logger.Info("track mute changed", "trackId", trackID, "muted", muted)
	return true
}

// SendData pushes a payload down this participant's data channel.
//
// Best-effort on purpose. Someone whose channel isn't open yet, or who
// never opened one at all, gets skipped instead of failing the broadcast
// for everybody else.
func (p *Participant) SendData(payload []byte) error {
	channel := p.dataChannel.Load()
	if channel == nil || channel.ReadyState() != webrtc.DataChannelStateOpen {
		return nil
	}
	return channel.Send(payload)
}

// answerTimeout gives up on a negotiation whose answer never shows.
//
// Long enough for a slow client on a rough network to finish, short enough
// that a client which simply vanished won't block this participant's
// renegotiations for the rest of the call. On expiry we drop the round
// trip, then start another if anything changed in the meantime.
const answerTimeout = 15 * time.Second

// ErrNegotiationInProgress means an offer is already out there.
//
// On a renegotiation the caller should do nothing at all. The change is
// recorded, and whoever finishes the current round kicks off another. On a
// client-initiated offer it's genuine glare, and the client should retry
// once it has answered the offer already heading its way.
var ErrNegotiationInProgress = errors.New("negotiation already in progress")

// beginNegotiation claims the offer/answer round trip.
//
// False means one is already in flight; we've noted that another round is
// needed. A burst of track changes therefore collapses into a single
// follow-up offer instead of a backlog of stale ones.
func (p *Participant) beginNegotiation() bool {
	p.negMu.Lock()
	defer p.negMu.Unlock()

	if p.offerInFlight {
		p.pendingRenegotiation = true
		return false
	}
	p.offerInFlight = true
	p.negotiationTimer = time.AfterFunc(answerTimeout, p.abandonNegotiation)
	return true
}

// endNegotiation releases the round trip and says whether the track set
// moved while it was in flight.
func (p *Participant) endNegotiation() (needsAnotherRound bool) {
	p.negMu.Lock()
	defer p.negMu.Unlock()

	if !p.offerInFlight {
		return false
	}
	p.offerInFlight = false
	if p.negotiationTimer != nil {
		p.negotiationTimer.Stop()
		p.negotiationTimer = nil
	}
	if p.pendingRenegotiation {
		p.pendingRenegotiation = false
		return true
	}
	return false
}

// abandonNegotiation gives up on an offer nobody answered.
func (p *Participant) abandonNegotiation() {
	if p.closed.Load() {
		return
	}
	p.logger.Warn("negotiation abandoned: no answer within timeout", "timeout", answerTimeout)
	if p.endNegotiation() && p.events.OnNegotiationNeeded != nil {
		go p.events.OnNegotiationNeeded(p)
	}
}

// CreateOffer builds an offer for this participant and sets it locally.
//
// The round trip stays claimed until AcceptAnswer applies the answer. See
// the note on negMu for why covering offer creation alone doesn't cut it.
func (p *Participant) CreateOffer() (*webrtc.SessionDescription, error) {
	if p.closed.Load() {
		return nil, errors.New("participant is closed")
	}

	if !p.beginNegotiation() {
		return nil, ErrNegotiationInProgress
	}

	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		p.releaseAfterFailure()
		return nil, fmt.Errorf("create offer: %w", err)
	}
	if err := p.pc.SetLocalDescription(offer); err != nil {
		p.releaseAfterFailure()
		return nil, fmt.Errorf("set local description: %w", err)
	}
	return &offer, nil
}

// releaseAfterFailure hands the round trip back when we couldn't produce
// an offer, so one failure doesn't wedge negotiation forever.
func (p *Participant) releaseAfterFailure() {
	if p.endNegotiation() && p.events.OnNegotiationNeeded != nil {
		go p.events.OnNegotiationNeeded(p)
	}
}

// AcceptAnswer applies the client's answer to our offer, then runs another
// negotiation round if the track set moved while we were waiting.
// setRemoteDescription applies a remote description and then drains any
// candidates that arrived before it.
//
// The drain is the whole point: a buffered candidate that is never applied
// is identical, from ICE's perspective, to the candidate having been
// dropped — which is the bug this buffering exists to fix.
func (p *Participant) setRemoteDescription(description webrtc.SessionDescription) error {
	p.iceMu.Lock()
	defer p.iceMu.Unlock()

	if err := p.pc.SetRemoteDescription(description); err != nil {
		return err
	}

	// Cleared before applying, so one rejected candidate cannot strand the
	// rest in the buffer.
	pending := p.pendingRemoteCandidates
	p.pendingRemoteCandidates = nil
	for _, candidate := range pending {
		if err := p.pc.AddICECandidate(candidate); err != nil {
			p.logger.Debug("buffered ICE candidate rejected", "err", err)
		}
	}
	if len(pending) > 0 {
		p.logger.Debug("applied buffered ICE candidates", "count", len(pending))
	}
	return nil
}

func (p *Participant) AcceptAnswer(sdp string) error {
	err := p.setRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	})

	// Round trip is over either way. Hanging on to it after a failed answer
	// leaves this participant permanently unable to renegotiate, which is a
	// good deal worse than retrying against a bad answer.
	needsAnother := p.endNegotiation()

	if err != nil {
		return fmt.Errorf("set remote answer: %w", err)
	}

	if needsAnother && p.events.OnNegotiationNeeded != nil {
		// Punted to a goroutine so the frame handler that just delivered
		// this answer isn't also the thing building the next offer. That
		// path is holding the node link's read loop.
		go p.events.OnNegotiationNeeded(p)
	}
	return nil
}

// AcceptOffer handles a client-initiated offer, which is what a client
// sends when it starts publishing, and returns the answer.
//
// Rejected with ErrNegotiationInProgress if one of our own offers is
// already in flight. That's real glare, and the SFU settles it by being
// the impolite peer: our offer stands, the client retries once it has
// answered it. Rolling our own offer back would be politer and a great
// deal harder to get right, since it may already have added tracks the
// client is about to be told about.
func (p *Participant) AcceptOffer(sdp string) (*webrtc.SessionDescription, error) {
	if p.closed.Load() {
		return nil, errors.New("participant is closed")
	}

	if !p.beginNegotiation() {
		return nil, ErrNegotiationInProgress
	}
	// A client-initiated round trip finishes right here, synchronously,
	// instead of waiting on a separate frame. So release before returning.
	defer p.releaseAfterFailure()

	if err := p.setRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdp,
	}); err != nil {
		return nil, fmt.Errorf("set remote offer: %w", err)
	}

	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return nil, fmt.Errorf("create answer: %w", err)
	}
	if err := p.pc.SetLocalDescription(answer); err != nil {
		return nil, fmt.Errorf("set local description: %w", err)
	}
	return &answer, nil
}

// AddICECandidate hands the client's candidate to ICE, or holds on to it
// until there is a description to attach it to.
//
// Trickle ICE sends a candidate and the description it belongs to as
// separate signaling messages, and nothing orders the two. A client that
// gathers a host candidate quickly — on a LAN, essentially all of them —
// sends it the instant setLocalDescription returns, well before its answer
// has been serialised, queued and delivered to us.
//
// Pion rejects a candidate applied with no remote description
// ("InvalidStateError: remote description is not set"), and that rejection
// is terminal: clients do not resend. Every candidate lost there is a path
// ICE never gets to try, and on a network where only one path works it is
// the call not connecting.
func (p *Participant) AddICECandidate(candidate webrtc.ICECandidateInit) error {
	if p.closed.Load() {
		return errors.New("participant is closed")
	}

	p.iceMu.Lock()
	defer p.iceMu.Unlock()

	if p.pc.RemoteDescription() == nil {
		p.pendingRemoteCandidates = append(p.pendingRemoteCandidates, candidate)
		return nil
	}
	return p.pc.AddICECandidate(candidate)
}

func (p *Participant) ConnectionState() (iceState, peerState string) {
	return p.pc.ICEConnectionState().String(), p.pc.ConnectionState().String()
}

func (p *Participant) JoinedAt() time.Time { return p.joinedAt }

// ParticipantStats is what this node has actually measured about a
// participant.
//
// Measured, and nothing more. There's no "quality" verdict here on
// purpose. Working one out is the job of whoever holds both these numbers
// and the client's own, and inventing one at this layer would be exactly
// the fabricated metric spec §19 rules out.
type ParticipantStats struct {
	ParticipantID    string
	SessionID        string
	PeerState        string
	ICEState         string
	JoinedAt         time.Time
	PublishedTracks  []PublishedTrackStats
	SubscribedTracks int
	InboundBytes     uint64
	OutboundBytes    uint64
}

func (p *Participant) Stats() ParticipantStats {
	p.mu.RLock()
	published := make([]PublishedTrackStats, 0, len(p.published))
	var inbound uint64
	for _, track := range p.published {
		stats := track.Stats()
		inbound += stats.BytesReceived
		published = append(published, stats)
	}
	var outbound uint64
	for _, down := range p.subscriptions {
		outbound += down.Stats().BytesSent
	}
	subscribed := len(p.subscriptions)
	p.mu.RUnlock()

	ice, peer := p.ConnectionState()
	return ParticipantStats{
		ParticipantID:    p.ID,
		SessionID:        p.SessionID,
		PeerState:        peer,
		ICEState:         ice,
		JoinedAt:         p.joinedAt,
		PublishedTracks:  published,
		SubscribedTracks: subscribed,
		InboundBytes:     inbound,
		OutboundBytes:    outbound,
	}
}

// Close tears the participant down. Idempotent: the connection-state
// handler and an explicit removal both call it, and either can win.
func (p *Participant) Close() {
	if !p.closed.CompareAndSwap(false, true) {
		return
	}

	p.negMu.Lock()
	if p.negotiationTimer != nil {
		p.negotiationTimer.Stop()
		p.negotiationTimer = nil
	}
	p.offerInFlight = false
	p.pendingRenegotiation = false
	p.negMu.Unlock()

	p.mu.Lock()
	published := p.published
	subscriptions := p.subscriptions
	p.published = make(map[string]*PublishedTrack)
	p.subscriptions = make(map[string]*DownTrack)
	p.mu.Unlock()

	for _, track := range published {
		track.Close()
		if p.events.OnTrackUnpublished != nil {
			p.events.OnTrackUnpublished(p, track)
		}
	}
	for _, down := range subscriptions {
		down.Close()
	}

	if channel := p.dataChannel.Load(); channel != nil {
		_ = channel.Close()
	}
	if err := p.pc.Close(); err != nil {
		p.logger.Debug("peer connection close", "err", err)
	}

	p.logger.Info("participant closed")
	if p.events.OnClosed != nil {
		p.events.OnClosed(p)
	}
}

func (p *Participant) Closed() bool { return p.closed.Load() }

func subscriptionKey(publisherID, trackID string) string {
	return publisherID + "/" + trackID
}
