package signal

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"

	"github.com/corvidhq/raven/services/sfu/internal/room"
)

const (
	// writeTimeout bounds a single frame write. A control plane that has
	// stopped reading must not be able to block the SFU's event loop
	// indefinitely — better to drop the link and let it reconnect, since a
	// half-dead link silently loses negotiation frames.
	writeTimeout = 5 * time.Second

	// orphanGrace is how long a session survives after the link that owned
	// it goes away.
	//
	// Not zero, and not forever. Zero would mean a brief network blip
	// between the API and this node drops every call on it — the client's
	// own WebSocket may be perfectly healthy, since that runs over a
	// different path. Forever would leak PeerConnections for an API
	// instance that genuinely died. The window is long enough for a
	// reconnecting instance to re-claim its sessions (any frame naming a
	// session re-binds it) and short enough that a dead instance's
	// participants do not linger through a whole call.
	orphanGrace = 45 * time.Second

	// orphanSweepInterval is how often orphaned sessions are checked.
	orphanSweepInterval = 10 * time.Second
)

// link is one control-plane connection.
type link struct {
	conn *websocket.Conn
	// writeMu serialises frame writes. Concurrent writes to one WebSocket
	// interleave frames and corrupt the stream.
	writeMu sync.Mutex
}

func (l *link) write(ctx context.Context, payload []byte) error {
	l.writeMu.Lock()
	defer l.writeMu.Unlock()
	return l.conn.Write(ctx, websocket.MessageText, payload)
}

// Server serves the node link.
//
// # Why several links, each owning its own sessions
//
// The API scales horizontally, and a client's signaling WebSocket lands on
// one instance. Whichever instance holds that socket is the only one that
// can deliver an offer to that client — so it is the instance that must
// hold the link carrying that session's frames.
//
// Accepting one link and replacing it would mean the SFU's frames
// routinely arrive at an instance with no socket to deliver them on,
// forcing every SDP and ICE message through Redis to find the right one.
// Instead each instance keeps its own link, a session belongs to the link
// that created it, and no cross-instance routing is needed at all.
//
// Ownership is re-bound by any inbound frame naming a session, which is
// what lets an instance re-claim its sessions after a link reconnects
// without a dedicated handshake for it.
type Server struct {
	manager *room.Manager
	secret  string
	logger  *slog.Logger

	mu sync.RWMutex
	// links is every attached control plane.
	links map[*link]struct{}
	// owners maps a session to the link that carries its frames.
	owners map[string]*link
	// orphanedAt records when a session lost its owner, for the sweep.
	orphanedAt map[string]time.Time

	sweepStop chan struct{}
	sweepOnce sync.Once
}

func NewServer(manager *room.Manager, secret string, logger *slog.Logger) *Server {
	return &Server{
		manager:    manager,
		secret:     secret,
		logger:     logger.With("component", "node-link"),
		links:      make(map[*link]struct{}),
		owners:     make(map[string]*link),
		orphanedAt: make(map[string]time.Time),
		sweepStop:  make(chan struct{}),
	}
}

// Start begins the orphaned-session sweep.
func (s *Server) Start() {
	s.sweepOnce.Do(func() {
		go s.sweepOrphans()
	})
}

// Stop ends the sweep. Does not close links or rooms — the manager owns
// those.
func (s *Server) Stop() {
	select {
	case <-s.sweepStop:
	default:
		close(s.sweepStop)
	}
}

// Handler is the HTTP handler for the node-link upgrade.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authenticate(r) {
			s.logger.Warn("node link rejected", "remote", r.RemoteAddr)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			// The control plane is not a browser and sends no Origin, so
			// origin checking would only ever reject legitimate links. The
			// bearer secret above is the actual authentication.
			InsecureSkipVerify: true,
		})
		if err != nil {
			s.logger.Warn("node link upgrade failed", "err", err)
			return
		}

		s.serve(r.Context(), conn)
	})
}

func (s *Server) authenticate(r *http.Request) bool {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(header) <= len(prefix) || header[:len(prefix)] != prefix {
		return false
	}
	provided := header[len(prefix):]

	// Hashed before comparing so the compare is over fixed-length inputs —
	// otherwise the length check itself is an oracle.
	providedHash := sha256.Sum256([]byte(provided))
	expectedHash := sha256.Sum256([]byte(s.secret))
	return subtle.ConstantTimeCompare(providedHash[:], expectedHash[:]) == 1
}

func (s *Server) serve(ctx context.Context, conn *websocket.Conn) {
	current := &link{conn: conn}

	s.mu.Lock()
	s.links[current] = struct{}{}
	linkCount := len(s.links)
	s.mu.Unlock()

	s.logger.Info("node link established", "links", linkCount)
	defer s.detach(current)

	for {
		messageType, data, err := conn.Read(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				s.logger.Info("node link read ended", "err", err)
			}
			return
		}
		if messageType != websocket.MessageText {
			continue
		}

		var frame Frame
		if err := json.Unmarshal(data, &frame); err != nil {
			s.logger.Warn("unparseable node-link frame", "err", err)
			continue
		}

		// Any frame naming a session binds (or re-binds) that session to
		// the link it arrived on. This is what lets a reconnecting API
		// instance re-claim its sessions without a dedicated handshake.
		//
		// Query frames are excluded: they are about a room, not a
		// participant, and claiming a session for one would register a
		// session that does not exist and then have it swept as an
		// orphan.
		if frame.SessionID != "" && !isQuery(frame.Type) {
			s.claim(frame.SessionID, current)
		}

		// A query is answered on the link it arrived on, since that is the
		// instance waiting for it.
		if isQuery(frame.Type) {
			go s.handleQuery(current, frame)
			continue
		}

		// Handled on its own goroutine: creating a PeerConnection and
		// gathering ICE takes long enough that doing it inline would stall
		// every other participant's frames behind it.
		go s.handle(frame)
	}
}

// isQuery reports whether a frame expects a correlated reply rather than
// concerning one participant's session.
func isQuery(t MessageType) bool {
	return t == TypeRoomState
}

// handleQuery answers a room-scoped query on the link that asked.
func (s *Server) handleQuery(asker *link, frame Frame) {
	defer func() {
		if recovered := recover(); recovered != nil {
			s.logger.Error("panic handling node-link query",
				"type", frame.Type, "requestId", frame.RequestID, "panic", recovered)
		}
	}()

	if frame.Type != TypeRoomState {
		return
	}

	payload := RoomStateResultPayload{
		RoomID:       frame.RoomID,
		Participants: []RoomStateParticipant{},
	}
	// An empty room is not an error: a room row exists in the control
	// plane long before anyone joins, and after everyone leaves. The
	// honest answer is "nobody is here".
	if target, found := s.manager.Room(frame.RoomID); found {
		payload = RoomStateFromDomain(target.State())
	}

	reply, err := NewReply(TypeRoomStateResult, frame.RequestID, frame.RoomID, payload)
	if err != nil {
		s.logger.Error("could not encode room-state reply", "err", err)
		return
	}
	encoded, err := json.Marshal(reply)
	if err != nil {
		s.logger.Error("could not encode room-state reply envelope", "err", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	defer cancel()
	if err := asker.write(ctx, encoded); err != nil {
		s.logger.Warn("room-state reply write failed", "requestId", frame.RequestID, "err", err)
	}
}

// claim binds a session to a link, clearing any orphan timer.
func (s *Server) claim(sessionID string, owner *link) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.owners[sessionID] = owner
	delete(s.orphanedAt, sessionID)
}

// detach removes a link and orphans the sessions it owned.
//
// The sessions are not closed here: see `orphanGrace`.
func (s *Server) detach(departing *link) {
	s.mu.Lock()
	delete(s.links, departing)
	orphaned := 0
	now := time.Now()
	for sessionID, owner := range s.owners {
		if owner == departing {
			delete(s.owners, sessionID)
			s.orphanedAt[sessionID] = now
			orphaned++
		}
	}
	linkCount := len(s.links)
	s.mu.Unlock()

	s.logger.Info("node link closed", "links", linkCount, "sessionsOrphaned", orphaned,
		"grace", orphanGrace)
}

// sweepOrphans closes sessions nobody re-claimed.
func (s *Server) sweepOrphans() {
	ticker := time.NewTicker(orphanSweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.sweepStop:
			return
		case <-ticker.C:
			s.closeExpiredOrphans()
		}
	}
}

func (s *Server) closeExpiredOrphans() {
	deadline := time.Now().Add(-orphanGrace)

	s.mu.Lock()
	expired := make([]string, 0)
	for sessionID, orphanedAt := range s.orphanedAt {
		if orphanedAt.Before(deadline) {
			expired = append(expired, sessionID)
			delete(s.orphanedAt, sessionID)
		}
	}
	s.mu.Unlock()

	for _, sessionID := range expired {
		participant, owningRoom, found := s.manager.FindParticipant(sessionID)
		if !found {
			continue
		}
		s.logger.Warn("closing orphaned session — no control plane re-claimed it",
			"sessionId", sessionID, "roomId", owningRoom.ID, "participantId", participant.ID)
		s.manager.RemoveParticipant(owningRoom.ID, sessionID)
	}
}

func (s *Server) handle(frame Frame) {
	defer func() {
		// A panic in one frame handler must not take the node down and
		// disconnect every call on it.
		if recovered := recover(); recovered != nil {
			s.logger.Error("panic handling node-link frame",
				"type", frame.Type, "sessionId", frame.SessionID, "panic", recovered)
			s.sendError(frame.SessionID, frame.RoomID, ErrCodeInternal, "internal error handling frame")
		}
	}()

	switch frame.Type {
	case TypeParticipantAdd:
		s.handleParticipantAdd(frame)
	case TypeParticipantRemove:
		s.handleParticipantRemove(frame)
	case TypeSDPAnswer:
		s.handleAnswer(frame)
	case TypeSDPOfferFromClient:
		s.handleClientOffer(frame)
	case TypeICECandidate:
		s.handleICECandidate(frame)
	case TypeTrackMute:
		s.handleTrackMute(frame)
	case TypeTrackSource:
		s.handleTrackSource(frame)
	case TypeSubscriptionUpdate:
		s.handleSubscriptionUpdate(frame)
	case TypeRoomClose:
		s.handleRoomClose(frame)
	case TypeRoomState:
		// Queries are intercepted in the read loop and answered with a
		// correlation id; reaching here means a caller addressed a room
		// query by session, which the control plane no longer does.
		s.handleRoomState(frame)
	case TypeSessionKeepalive:
		// Ownership was already re-bound by the read loop; nothing else to
		// do. This frame exists purely so an idle session's ownership
		// survives a link reconnect.
	default:
		s.logger.Warn("unknown node-link frame type", "type", frame.Type)
	}
}

func (s *Server) handleParticipantAdd(frame Frame) {
	var payload ParticipantAddPayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeInternal, "malformed participant.add payload")
		return
	}

	participant, err := s.manager.AddParticipant(frame.RoomID, payload.ParticipantID, frame.SessionID, payload.Permissions.ToDomain())
	if err != nil {
		code := ErrCodeInternal
		if errors.Is(err, room.ErrRoomFull) {
			code = ErrCodeRoomFull
		}
		s.logger.Warn("participant add failed",
			"roomId", frame.RoomID, "participantId", payload.ParticipantID, "err", err)
		s.sendError(frame.SessionID, frame.RoomID, code, err.Error())
		return
	}

	// The SFU offers first. It has to: it owns the subscriber side of the
	// connection, and on join it already knows every track the participant
	// should receive.
	offer, err := participant.CreateOffer()
	if err != nil {
		s.logger.Error("initial offer failed", "sessionId", frame.SessionID, "err", err)
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeNegotiation, "could not create offer")
		s.manager.RemoveParticipant(frame.RoomID, frame.SessionID)
		return
	}
	s.SendOffer(participant, *offer)
}

func (s *Server) handleParticipantRemove(frame Frame) {
	if !s.manager.RemoveParticipant(frame.RoomID, frame.SessionID) {
		// Already gone — a client that dropped its socket and a control
		// plane that noticed both lead here, and neither is a problem.
		s.logger.Debug("participant already removed", "sessionId", frame.SessionID)
	}
	s.release(frame.SessionID)
}

// release forgets a session entirely, so a deliberate removal is not later
// swept as an orphan.
func (s *Server) release(sessionID string) {
	s.mu.Lock()
	delete(s.owners, sessionID)
	delete(s.orphanedAt, sessionID)
	s.mu.Unlock()
}

func (s *Server) handleAnswer(frame Frame) {
	participant, _, found := s.manager.FindParticipant(frame.SessionID)
	if !found {
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeUnknownSession, "no such session on this node")
		return
	}

	var payload SDPPayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeNegotiation, "malformed answer")
		return
	}
	if err := participant.AcceptAnswer(payload.SDP); err != nil {
		s.logger.Warn("answer rejected", "sessionId", frame.SessionID, "err", err)
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeNegotiation, "answer could not be applied")
	}
}

func (s *Server) handleClientOffer(frame Frame) {
	participant, _, found := s.manager.FindParticipant(frame.SessionID)
	if !found {
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeUnknownSession, "no such session on this node")
		return
	}

	var payload SDPPayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeNegotiation, "malformed offer")
		return
	}

	answer, err := participant.AcceptOffer(payload.SDP)
	if err != nil {
		if errors.Is(err, room.ErrNegotiationInProgress) {
			// Genuine glare: one of our offers is already on its way. The
			// client answers that, then retries — a distinct code so the
			// SDK retries rather than treating it as a hard failure.
			s.logger.Debug("client offer deferred — glare", "sessionId", frame.SessionID)
			s.sendError(frame.SessionID, frame.RoomID, ErrCodeGlare,
				"an offer from the server is already in flight — answer it, then retry")
			return
		}
		s.logger.Warn("client offer rejected", "sessionId", frame.SessionID, "err", err)
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeNegotiation, "offer could not be applied")
		return
	}

	s.send(TypeSDPAnswerToClient, frame.SessionID, frame.RoomID, SDPPayload{SDP: answer.SDP, Type: "answer"})
}

func (s *Server) handleICECandidate(frame Frame) {
	participant, _, found := s.manager.FindParticipant(frame.SessionID)
	if !found {
		// Candidates commonly arrive just after a participant left, or
		// just before the add was processed. Neither deserves an error
		// frame back — it would only add noise to the control plane's logs.
		s.logger.Debug("ICE candidate for unknown session", "sessionId", frame.SessionID)
		return
	}

	var payload ICECandidatePayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		s.logger.Warn("malformed ICE candidate", "sessionId", frame.SessionID)
		return
	}

	if err := participant.AddICECandidate(webrtc.ICECandidateInit{
		Candidate:        payload.Candidate,
		SDPMid:           payload.SDPMid,
		SDPMLineIndex:    payload.SDPMLineIndex,
		UsernameFragment: payload.UsernameFrag,
	}); err != nil {
		s.logger.Debug("ICE candidate rejected", "sessionId", frame.SessionID, "err", err)
	}
}

func (s *Server) handleTrackMute(frame Frame) {
	participant, _, found := s.manager.FindParticipant(frame.SessionID)
	if !found {
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeUnknownSession, "no such session on this node")
		return
	}

	var payload TrackMutePayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		return
	}
	participant.SetTrackMuted(payload.TrackID, payload.Muted)
}

func (s *Server) handleTrackSource(frame Frame) {
	participant, _, found := s.manager.FindParticipant(frame.SessionID)
	if !found {
		// The declaration can legitimately arrive before participant.add
		// has been processed, since both are handled on their own
		// goroutines. Dropping it costs a mislabelled source, not a
		// broken call, so this is a debug line rather than an error frame.
		s.logger.Debug("track source declared for unknown session", "sessionId", frame.SessionID)
		return
	}

	var payload TrackSourcePayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		return
	}
	participant.DeclareTrackSource(payload.TrackID, room.TrackSource(payload.Source))
}

func (s *Server) handleSubscriptionUpdate(frame Frame) {
	target, found := s.manager.Room(frame.RoomID)
	if !found {
		s.sendError(frame.SessionID, frame.RoomID, ErrCodeUnknownSession, "no such room on this node")
		return
	}

	var payload SubscriptionUpdatePayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		return
	}

	if err := target.SetSubscriptionLayer(frame.SessionID, payload.PublisherID, payload.TrackID, room.LayerID(payload.Layer)); err != nil {
		s.logger.Debug("subscription update failed",
			"sessionId", frame.SessionID, "publisher", payload.PublisherID, "err", err)
	}
}

func (s *Server) handleRoomClose(frame Frame) {
	if s.manager.CloseRoom(frame.RoomID) {
		s.logger.Info("room closed on request", "roomId", frame.RoomID)
	}
}

func (s *Server) handleRoomState(frame Frame) {
	target, found := s.manager.Room(frame.RoomID)
	if !found {
		// An empty room is not an error: a room row exists in the control
		// plane long before anyone joins, and after everyone leaves. The
		// honest answer is "nobody is here", which is what an empty
		// participant list says.
		s.send(TypeRoomStateResult, frame.SessionID, frame.RoomID, RoomStateResultPayload{
			RoomID:       frame.RoomID,
			Participants: []RoomStateParticipant{},
		})
		return
	}
	s.send(TypeRoomStateResult, frame.SessionID, frame.RoomID, RoomStateFromDomain(target.State()))
}

// --- Outbound ------------------------------------------------------------

// SendOffer forwards an SFU-initiated offer to the control plane.
func (s *Server) SendOffer(participant *room.Participant, sdp webrtc.SessionDescription) {
	s.send(TypeSDPOffer, participant.SessionID, participant.RoomID, SDPPayload{SDP: sdp.SDP, Type: "offer"})
}

func (s *Server) SendICECandidate(participant *room.Participant, candidate *webrtc.ICECandidate) {
	init := candidate.ToJSON()
	s.send(TypeICECandidate, participant.SessionID, participant.RoomID, ICECandidatePayload{
		Candidate:     init.Candidate,
		SDPMid:        init.SDPMid,
		SDPMLineIndex: init.SDPMLineIndex,
		UsernameFrag:  init.UsernameFragment,
	})
}

func (s *Server) SendTrackChange(participant *room.Participant, track *room.PublishedTrack, published bool) {
	if published {
		layers := track.AvailableLayers()
		names := make([]string, 0, len(layers))
		for _, layer := range layers {
			names = append(names, string(layer))
		}
		s.send(TypeTrackPublished, participant.SessionID, participant.RoomID, TrackPublishedPayload{
			ParticipantID: participant.ID,
			TrackID:       track.ID,
			Kind:          track.Kind.String(),
			Source:        string(track.Source()),
			Simulcast:     track.IsSimulcast(),
			Layers:        names,
		})
		return
	}
	s.send(TypeTrackUnpublished, participant.SessionID, participant.RoomID, TrackUnpublishedPayload{
		ParticipantID: participant.ID,
		TrackID:       track.ID,
	})
}

func (s *Server) SendConnectionState(participant *room.Participant, iceState, peerState string) {
	s.send(TypeConnectionState, participant.SessionID, participant.RoomID, ConnectionStatePayload{
		ICEState:  iceState,
		PeerState: peerState,
	})
}

func (s *Server) sendError(sessionID, roomID, code, message string) {
	s.send(TypeError, sessionID, roomID, ErrorPayload{Code: code, Message: message})
}

// send writes one frame on the link that owns the session.
//
// Dropped, not buffered, if that link is gone: every frame here describes a
// moment in a negotiation, and replaying a stale offer after a link
// reconnects would be worse than never sending it. A control plane that
// reconnects re-establishes what it needs by asking for room state.
func (s *Server) send(t MessageType, sessionID, roomID string, payload any) {
	s.mu.RLock()
	owner := s.owners[sessionID]
	s.mu.RUnlock()

	if owner == nil {
		s.logger.Debug("dropping frame — session has no attached control plane",
			"type", t, "sessionId", sessionID)
		return
	}

	frame, err := NewFrame(t, sessionID, roomID, payload)
	if err != nil {
		s.logger.Error("could not encode frame", "type", t, "err", err)
		return
	}
	encoded, err := json.Marshal(frame)
	if err != nil {
		s.logger.Error("could not encode frame envelope", "type", t, "err", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	defer cancel()

	if err := owner.write(ctx, encoded); err != nil {
		s.logger.Warn("node-link write failed", "type", t, "sessionId", sessionID, "err", err)
	}
}

// Connected reports whether any control plane is attached. Surfaced on the
// readiness endpoint: a node with no link cannot be given new
// participants, so it is not ready even though its process is fine and its
// existing calls are unaffected.
func (s *Server) Connected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.links) > 0
}

// LinkCount is for the readiness payload and metrics.
func (s *Server) LinkCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.links)
}
