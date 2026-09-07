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
// A single negotiated channel rather than one per peer pair: this is an
// SFU, so the node is the only peer any client has, and room-wide delivery
// is the node fanning out on the clients' behalf. That also means data
// messages get the same "works behind any NAT" property as media, which a
// peer-to-peer data mesh would not.
const dataChannelLabel = "raven-data"

// ParticipantEvents is how a participant tells the room and the control
// plane what its PeerConnection is doing.
//
// Callbacks rather than a channel because every one of these has exactly
// one consumer and must be handled in order relative to the others — an
// OnTrackPublished that raced ahead of the OnNegotiationNeeded that
// carries it would produce a subscriber offer for a track the room does
// not know about yet.
type ParticipantEvents struct {
	// OnNegotiationNeeded fires when the SFU must send a new offer, which
	// happens whenever this participant's subscribed track set changes.
	OnNegotiationNeeded func(p *Participant)
	OnICECandidate      func(p *Participant, candidate *webrtc.ICECandidate)
	OnTrackPublished    func(p *Participant, track *PublishedTrack)
	OnTrackUnpublished  func(p *Participant, track *PublishedTrack)
	OnStateChange       func(p *Participant, iceState, peerState string)
	// OnClosed fires once, when the participant is gone for good.
	OnClosed func(p *Participant)
	// OnData carries a data-channel message for the room to fan out.
	OnData func(p *Participant, payload []byte)
}

// Participant is one client's connection to this node.
//
// # One PeerConnection, both directions
//
// Some SFUs give each client two PeerConnections, one for publishing and
// one for subscribing, to keep renegotiation on the subscriber side from
// disturbing the publisher side. Raven uses one, because a single
// connection means one ICE negotiation, one DTLS handshake, one set of
// candidates to get through a firewall, and one thing to reconnect — and
// the renegotiation problem it avoids is handled instead by the
// negotiation serialisation below.
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
	// published is keyed by track id — the tracks this participant sends.
	published map[string]*PublishedTrack
	// subscriptions is keyed by "publisherID/trackID" — this
	// participant's copies of other people's tracks.
	subscriptions map[string]*DownTrack
	// declaredSources holds what the client said each track it is about to
	// publish is *of*, keyed by track id. Populated before the media
	// arrives (see TypeTrackSource) and consulted when it does.
	declaredSources map[string]TrackSource

	dataChannel atomic.Pointer[webrtc.DataChannel]

	// Negotiation state. Guarded by negMu, and held across the whole
	// offer→answer round trip rather than just offer creation.
	//
	// Covering only creation is not enough: two participants joining at
	// once each change everyone else's subscribed track set, so two
	// renegotiations start moments apart. If the second creates an offer
	// while the first is still awaiting its answer, the PeerConnection's
	// local description is replaced and the first answer no longer
	// applies. This is the "perfect negotiation" rule — never a second
	// offer while one is outstanding — and the SFU resolves the glare it
	// cannot avoid by being the impolite peer (see AcceptOffer).
	negMu sync.Mutex
	// offerInFlight is true from creating an offer until its answer is
	// applied (or the round trip is abandoned).
	offerInFlight bool
	// pendingRenegotiation records that the track set changed while an
	// offer was already in flight, so the change is not silently lost.
	pendingRenegotiation bool
	// negotiationDeadline abandons a round trip whose answer never
	// arrives. Without it, a client that vanishes mid-negotiation would
	// leave this participant unable to ever renegotiate again.
	negotiationTimer *time.Timer

	closed atomic.Bool
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
		// A nil candidate is end-of-gathering. Not forwarded: the SDK
		// treats the absence of further candidates the same way, and an
		// explicit end-of-candidates frame would be one more thing for
		// three client implementations to agree on.
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
			// Failed is terminal for this PeerConnection. The client's
			// reconnect logic establishes a new session rather than trying
			// to revive this one — ICE restart on a failed connection is
			// less reliable than starting clean, and the client has to be
			// able to handle a fresh session anyway (it might have moved
			// networks).
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
			// The token did not grant data. Closing the channel rather
			// than silently dropping messages means the client gets a
			// clear signal instead of wondering why nothing arrives.
			p.logger.Warn("data channel rejected — token does not grant publishData")
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

// handleIncomingTrack takes a track the publisher started sending.
//
// Called once per simulcast layer, and the layers of one track share a
// track id — so the first arrival creates the PublishedTrack and announces
// it, and subsequent ones only add a layer. Announcing once is what keeps
// subscribers from being told about the same camera three times.
func (p *Participant) handleIncomingTrack(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
	if !p.canPublishKind(remote.Kind()) {
		p.logger.Warn("track rejected — token does not grant this kind",
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

	// Drain RTCP from the publisher's sender-side reports. Pion needs
	// these read for its interceptors (NACK, TWCC, receiver reports) to
	// function; an unread RTCP stream stalls congestion feedback.
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
// Does not renegotiate: the caller batches subscriptions and renegotiates
// once, because a participant joining a busy room subscribes to a dozen
// tracks at once and a dozen offer/answer round trips would make joining
// take seconds.
func (p *Participant) Subscribe(track *PublishedTrack) error {
	if p.closed.Load() {
		return errors.New("participant is closed")
	}
	if !p.permissions.Subscribe {
		return errors.New("token does not grant subscribe")
	}
	if track.ParticipantID == p.ID {
		// Subscribing to your own track would echo your microphone back at
		// you. Callers filter this, but it is cheap to be certain.
		return nil
	}

	key := subscriptionKey(track.ParticipantID, track.ID)
	p.mu.RLock()
	_, already := p.subscriptions[key]
	p.mu.RUnlock()
	if already {
		return nil
	}

	// The subscriber's copy carries the *publisher's* track and stream ids,
	// so the client can match an incoming track to the participant it
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

	// Read this sender's RTCP so subscriber feedback reaches the
	// publisher's encoder. Without it, a subscriber's PLI (its decoder
	// asking for a keyframe after loss) is never seen and the picture
	// stays broken until the next scheduled keyframe.
	go p.forwardSubscriberFeedback(sender, track)

	p.logger.Debug("subscribed", "publisher", track.ParticipantID, "trackId", track.ID)
	return nil
}

// forwardSubscriberFeedback relays a subscriber's keyframe requests to the
// publisher.
//
// This is the RTCP path that makes recovery work end to end: the
// subscriber's decoder notices it cannot decode, sends a PLI to the SFU,
// and the SFU asks the publisher for a keyframe. Dropping these on the
// floor is a common SFU bug whose symptom is "video sometimes never
// recovers after a network blip".
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
			// NACK is handled by Pion's own interceptor against its send
			// buffer, which can retransmit the exact packet — better than
			// anything this layer could do, since we no longer hold it.
		}
	}
}

// Unsubscribe detaches a track. Like Subscribe, it does not renegotiate.
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

// PublishedTracks is what this participant is sending.
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
// Applied to an already-published track too, because the declaration and
// the media race: both are handled on their own goroutines, and the media
// arriving first is entirely normal.
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

// SendData delivers a payload over this participant's data channel.
//
// Best-effort by design: a participant whose channel is not open yet (or
// who never opened one) is skipped rather than failing the whole broadcast
// for everyone else.
func (p *Participant) SendData(payload []byte) error {
	channel := p.dataChannel.Load()
	if channel == nil || channel.ReadyState() != webrtc.DataChannelStateOpen {
		return nil
	}
	return channel.Send(payload)
}

// answerTimeout abandons a negotiation whose answer never arrives.
//
// Long enough that a slow client on a bad network still completes, short
// enough that a vanished client does not block this participant's
// renegotiations for the rest of the call. When it fires, the round trip
// is abandoned and another is started if anything changed meanwhile.
const answerTimeout = 15 * time.Second

// ErrNegotiationInProgress means an offer is already in flight.
//
// For a renegotiation the caller should do nothing: the change was
// recorded, and whoever completes the current round will start another.
// For a client-initiated offer it means genuine glare, and the client
// should retry once it has answered the offer already on its way.
var ErrNegotiationInProgress = errors.New("negotiation already in progress")

// beginNegotiation claims the offer/answer round trip.
//
// Returns false when one is already in flight, having recorded that
// another round is needed — so a burst of track changes collapses into one
// follow-up offer rather than a backlog of stale ones.
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

// endNegotiation releases the round trip and reports whether the track set
// changed while it was in flight.
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

// abandonNegotiation gives up on an unanswered offer.
func (p *Participant) abandonNegotiation() {
	if p.closed.Load() {
		return
	}
	p.logger.Warn("negotiation abandoned — no answer within timeout", "timeout", answerTimeout)
	if p.endNegotiation() && p.events.OnNegotiationNeeded != nil {
		go p.events.OnNegotiationNeeded(p)
	}
}

// CreateOffer produces an offer for this participant and sets it locally.
//
// The round trip stays claimed until `AcceptAnswer` applies the answer —
// see the note on `negMu` for why covering only offer creation is not
// enough.
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

// releaseAfterFailure hands the round trip back when an offer could not be
// produced, so one failure does not wedge negotiation permanently.
func (p *Participant) releaseAfterFailure() {
	if p.endNegotiation() && p.events.OnNegotiationNeeded != nil {
		go p.events.OnNegotiationNeeded(p)
	}
}

// AcceptAnswer applies the client's answer to our offer, and runs another
// negotiation round if the track set changed while we were waiting.
func (p *Participant) AcceptAnswer(sdp string) error {
	err := p.pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	})

	// The round trip is over either way. Holding it after a failed answer
	// would leave this participant permanently unable to renegotiate,
	// which is a worse outcome than retrying against a bad answer.
	needsAnother := p.endNegotiation()

	if err != nil {
		return fmt.Errorf("set remote answer: %w", err)
	}

	if needsAnother && p.events.OnNegotiationNeeded != nil {
		// Deferred to a goroutine so the frame handler that delivered this
		// answer is not the thing that also builds the next offer — that
		// path holds the node link's read loop.
		go p.events.OnNegotiationNeeded(p)
	}
	return nil
}

// AcceptOffer handles a client-initiated offer — what a client sends when
// it starts publishing — and returns the answer.
//
// Rejected with ErrNegotiationInProgress if one of our own offers is
// already in flight. That is real glare, and the SFU resolves it by being
// the impolite peer: its offer stands, and the client retries after
// answering it. Rolling back our own offer instead would be more polite
// and considerably harder to get right, since our offer may already have
// added tracks the client is about to be told about.
func (p *Participant) AcceptOffer(sdp string) (*webrtc.SessionDescription, error) {
	if p.closed.Load() {
		return nil, errors.New("participant is closed")
	}

	if !p.beginNegotiation() {
		return nil, ErrNegotiationInProgress
	}
	// A client-initiated round trip completes here, synchronously, rather
	// than awaiting a separate frame — so it releases before returning.
	defer p.releaseAfterFailure()

	if err := p.pc.SetRemoteDescription(webrtc.SessionDescription{
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

func (p *Participant) AddICECandidate(candidate webrtc.ICECandidateInit) error {
	return p.pc.AddICECandidate(candidate)
}

func (p *Participant) ConnectionState() (iceState, peerState string) {
	return p.pc.ICEConnectionState().String(), p.pc.ConnectionState().String()
}

func (p *Participant) JoinedAt() time.Time { return p.joinedAt }

// Stats reports what this node has measured about this participant.
//
// Only what is measured. `Stats` deliberately has no "quality" verdict:
// deriving one belongs to whoever has both this and the client's own
// numbers, and inventing one here would be the fabricated metric spec §19
// forbids.
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

// Close tears the participant down. Idempotent — the connection-state
// handler and an explicit removal both call it, and either may be first.
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
