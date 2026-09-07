package signal

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"

	"github.com/corvidhq/raven/services/sfu/internal/config"
	"github.com/corvidhq/raven/services/sfu/internal/room"
)

// These tests exercise the node link — the SFU's entire external contract
// — over a real WebSocket, driving real Pion clients.
//
// The room package's own tests call the room API directly. These go one
// layer out: everything here travels as JSON frames over the wire, exactly
// as the control plane sends them. That is what catches a protocol drift
// between the Go and TypeScript sides, which a direct-call test cannot
// see.

const (
	linkSecret  = "node-link-test-secret"
	frameWait   = 15 * time.Second
	connectWait = 20 * time.Second
)

// fakeControlPlane is the API's half of the node link.
type fakeControlPlane struct {
	t    *testing.T
	conn *websocket.Conn

	mu       sync.Mutex
	received []Frame
	waiters  []chan Frame
}

func dialLink(t *testing.T, serverURL, secret string) (*fakeControlPlane, error) {
	t.Helper()

	wsURL := strings.Replace(serverURL, "http://", "ws://", 1) + "/internal/link"
	ctx, cancel := context.WithTimeout(context.Background(), connectWait)
	defer cancel()

	conn, resp, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + secret}},
	})
	if err != nil {
		if resp != nil {
			return nil, err
		}
		return nil, err
	}

	plane := &fakeControlPlane{t: t, conn: conn}
	go plane.read()
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "test over") })
	return plane, nil
}

func (p *fakeControlPlane) read() {
	for {
		_, data, err := p.conn.Read(context.Background())
		if err != nil {
			return
		}
		var frame Frame
		if err := json.Unmarshal(data, &frame); err != nil {
			continue
		}

		p.mu.Lock()
		p.received = append(p.received, frame)
		waiters := p.waiters
		p.waiters = nil
		p.mu.Unlock()

		for _, waiter := range waiters {
			waiter <- frame
		}
	}
}

func (p *fakeControlPlane) send(frame Frame) {
	p.t.Helper()
	encoded, err := json.Marshal(frame)
	if err != nil {
		p.t.Fatalf("encode frame: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), frameWait)
	defer cancel()
	if err := p.conn.Write(ctx, websocket.MessageText, encoded); err != nil {
		p.t.Fatalf("write frame: %v", err)
	}
}

// await blocks until a frame matching the predicate arrives, including
// frames that arrived before this call.
func (p *fakeControlPlane) await(match func(Frame) bool) Frame {
	p.t.Helper()
	deadline := time.After(frameWait)

	for {
		p.mu.Lock()
		for _, frame := range p.received {
			if match(frame) {
				p.mu.Unlock()
				return frame
			}
		}
		waiter := make(chan Frame, 1)
		p.waiters = append(p.waiters, waiter)
		p.mu.Unlock()

		select {
		case <-waiter:
			// Loop and re-scan: the frame that woke us may not be the one
			// we want, and another may have arrived alongside it.
		case <-deadline:
			p.mu.Lock()
			types := make([]string, 0, len(p.received))
			for _, frame := range p.received {
				types = append(types, string(frame.Type))
			}
			p.mu.Unlock()
			p.t.Fatalf("timed out waiting for a frame; saw: %v", types)
		}
	}
}

func (p *fakeControlPlane) awaitType(t MessageType, sessionID string) Frame {
	p.t.Helper()
	return p.await(func(frame Frame) bool {
		return frame.Type == t && (sessionID == "" || frame.SessionID == sessionID)
	})
}

func payloadOf[T any](t *testing.T, frame Frame) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(frame.Payload, &value); err != nil {
		t.Fatalf("decode %s payload: %v", frame.Type, err)
	}
	return value
}

// newLinkServer starts an SFU with its node link exposed over HTTP.
func newLinkServer(t *testing.T) (*Server, *room.Manager, string) {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := &config.Config{
		NodeID:                   "sfu-link-test",
		Region:                   "test",
		RoomCapacity:             50,
		HeartbeatIntervalSeconds: 10,
		RegistrationSecret:       linkSecret,
	}

	var link *Server
	events := room.RoomEvents{
		OnOffer: func(p *room.Participant, sdp webrtc.SessionDescription) {
			link.SendOffer(p, sdp)
		},
		OnICECandidate: func(p *room.Participant, candidate *webrtc.ICECandidate) {
			link.SendICECandidate(p, candidate)
		},
		OnTrackChange: func(p *room.Participant, track *room.PublishedTrack, published bool) {
			link.SendTrackChange(p, track, published)
		},
		OnStateChange: func(p *room.Participant, iceState, peerState string) {
			link.SendConnectionState(p, iceState, peerState)
		},
	}

	manager, err := room.NewManager(cfg, events, logger)
	if err != nil {
		t.Fatalf("build manager: %v", err)
	}
	t.Cleanup(manager.Shutdown)

	link = NewServer(manager, linkSecret, logger)
	link.Start()
	t.Cleanup(link.Stop)

	mux := http.NewServeMux()
	mux.Handle("/internal/link", link.Handler())
	httpServer := httptest.NewServer(mux)
	t.Cleanup(httpServer.Close)

	return link, manager, httpServer.URL
}

// linkClient is a browser-side participant driven through the node link.
type linkClient struct {
	t         *testing.T
	plane     *fakeControlPlane
	sessionID string
	roomID    string
	pc        *webrtc.PeerConnection

	mu             sync.Mutex
	tracksReceived []*webrtc.TrackRemote
	trackWaiters   []chan *webrtc.TrackRemote
}

// joinViaLink performs the whole join exactly as the control plane would:
// participant.add, then answer whatever the SFU offers, trickling ICE both
// ways over the link.
func joinViaLink(
	t *testing.T,
	plane *fakeControlPlane,
	roomID, participantID, sessionID string,
	permissions Permissions,
	publish *webrtc.TrackLocalStaticRTP,
) *linkClient {
	t.Helper()

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create client peer connection: %v", err)
	}
	t.Cleanup(func() { _ = pc.Close() })

	client := &linkClient{t: t, plane: plane, sessionID: sessionID, roomID: roomID, pc: pc}

	pc.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		client.mu.Lock()
		client.tracksReceived = append(client.tracksReceived, track)
		waiters := client.trackWaiters
		client.trackWaiters = nil
		client.mu.Unlock()
		for _, waiter := range waiters {
			waiter <- track
		}
	})

	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		init := candidate.ToJSON()
		plane.send(mustFrame(t, TypeICECandidate, sessionID, roomID, ICECandidatePayload{
			Candidate:     init.Candidate,
			SDPMid:        init.SDPMid,
			SDPMLineIndex: init.SDPMLineIndex,
			UsernameFrag:  init.UsernameFragment,
		}))
	})

	if publish != nil {
		if _, err := pc.AddTrack(publish); err != nil {
			t.Fatalf("add track: %v", err)
		}
	}

	plane.send(mustFrame(t, TypeParticipantAdd, sessionID, roomID, ParticipantAddPayload{
		ParticipantID: participantID,
		Permissions:   permissions,
	}))

	// The SFU offers first — it owns the subscriber side.
	offerFrame := plane.awaitType(TypeSDPOffer, sessionID)
	client.answer(payloadOf[SDPPayload](t, offerFrame).SDP)

	// Relay the SFU's candidates in.
	go client.relayServerCandidates()

	return client
}

func (c *linkClient) answer(offerSDP string) {
	c.t.Helper()

	if err := c.pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  offerSDP,
	}); err != nil {
		c.t.Fatalf("set remote offer: %v", err)
	}
	answer, err := c.pc.CreateAnswer(nil)
	if err != nil {
		c.t.Fatalf("create answer: %v", err)
	}
	if err := c.pc.SetLocalDescription(answer); err != nil {
		c.t.Fatalf("set local answer: %v", err)
	}

	c.plane.send(mustFrame(c.t, TypeSDPAnswer, c.sessionID, c.roomID, SDPPayload{
		SDP:  answer.SDP,
		Type: "answer",
	}))
}

// relayServerCandidates feeds the SFU's ICE candidates into this client.
func (c *linkClient) relayServerCandidates() {
	seen := 0
	deadline := time.After(connectWait)
	for {
		select {
		case <-deadline:
			return
		case <-time.After(20 * time.Millisecond):
		}

		c.plane.mu.Lock()
		frames := append([]Frame(nil), c.plane.received...)
		c.plane.mu.Unlock()

		for i := seen; i < len(frames); i++ {
			seen = i + 1
			frame := frames[i]
			if frame.Type != TypeICECandidate || frame.SessionID != c.sessionID {
				continue
			}
			var payload ICECandidatePayload
			if err := json.Unmarshal(frame.Payload, &payload); err != nil {
				continue
			}
			_ = c.pc.AddICECandidate(webrtc.ICECandidateInit{
				Candidate:        payload.Candidate,
				SDPMid:           payload.SDPMid,
				SDPMLineIndex:    payload.SDPMLineIndex,
				UsernameFragment: payload.UsernameFrag,
			})
		}

		if c.pc.ConnectionState() == webrtc.PeerConnectionStateConnected {
			return
		}
	}
}

func (c *linkClient) waitConnected() {
	c.t.Helper()
	deadline := time.After(connectWait)
	for {
		if c.pc.ConnectionState() == webrtc.PeerConnectionStateConnected {
			return
		}
		select {
		case <-deadline:
			c.t.Fatalf("client %s never connected (state %s)", c.sessionID, c.pc.ConnectionState())
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func (c *linkClient) awaitTrack() *webrtc.TrackRemote {
	c.t.Helper()

	c.mu.Lock()
	if len(c.tracksReceived) > 0 {
		track := c.tracksReceived[0]
		c.tracksReceived = c.tracksReceived[1:]
		c.mu.Unlock()
		return track
	}
	waiter := make(chan *webrtc.TrackRemote, 1)
	c.trackWaiters = append(c.trackWaiters, waiter)
	c.mu.Unlock()

	select {
	case track := <-waiter:
		return track
	case <-time.After(frameWait):
		c.t.Fatal("no track arrived")
		return nil
	}
}

func mustFrame(t *testing.T, messageType MessageType, sessionID, roomID string, payload any) Frame {
	t.Helper()
	frame, err := NewFrame(messageType, sessionID, roomID, payload)
	if err != nil {
		t.Fatalf("build frame: %v", err)
	}
	return frame
}

func testVideoTrack(t *testing.T, id, streamID string) *webrtc.TrackLocalStaticRTP {
	t.Helper()
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		id, streamID,
	)
	if err != nil {
		t.Fatalf("create track: %v", err)
	}
	return track
}

func pumpTestRTP(ctx context.Context, track *webrtc.TrackLocalStaticRTP) {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	var sequence uint16
	var timestamp uint32
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sequence++
			timestamp += 3000
			_ = track.WriteRTP(&rtp.Packet{
				Header:  rtp.Header{Version: 2, SequenceNumber: sequence, Timestamp: timestamp, SSRC: 0xC0FFEE},
				Payload: []byte{0x10, 0x00, 0x00, 0x00, 0x01},
			})
		}
	}
}

func fullPermissions() Permissions {
	return Permissions{Publish: true, Subscribe: true, PublishAudio: true, PublishVideo: true, PublishData: true}
}

// --- Tests ---------------------------------------------------------------

func TestNodeLinkRejectsAnUnauthenticatedControlPlane(t *testing.T) {
	// Spec §38: without this, any host that can reach the node can create
	// PeerConnections on it.
	_, _, serverURL := newLinkServer(t)

	if _, err := dialLink(t, serverURL, "the-wrong-secret"); err == nil {
		t.Fatal("a link with the wrong secret was accepted")
	}
	if _, err := dialLink(t, serverURL, ""); err == nil {
		t.Fatal("a link with no secret was accepted")
	}
}

func TestNodeLinkAcceptsSeveralControlPlanes(t *testing.T) {
	// The API scales horizontally and each instance keeps its own link;
	// accepting one and replacing it would strand sessions on an instance
	// with no socket to deliver to.
	link, _, serverURL := newLinkServer(t)

	first, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("first link: %v", err)
	}
	second, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("second link: %v", err)
	}
	_, _ = first, second

	deadline := time.After(5 * time.Second)
	for link.LinkCount() < 2 {
		select {
		case <-deadline:
			t.Fatalf("link count = %d, want 2", link.LinkCount())
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestNodeLinkFullJoinAndMediaFlow(t *testing.T) {
	// The whole contract, over the wire: participant.add → the SFU's
	// offer → the client's answer → trickled ICE → real forwarded RTP.
	_, manager, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	aliceTrack := testVideoTrack(t, "alice-video", "alice-stream")
	alice := joinViaLink(t, plane, "room-1", "alice", "sess-alice", fullPermissions(), aliceTrack)
	alice.waitConnected()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpTestRTP(ctx, aliceTrack)

	// The node reports the track it actually sees on the wire.
	publishedFrame := plane.awaitType(TypeTrackPublished, "")
	published := payloadOf[TrackPublishedPayload](t, publishedFrame)
	if published.ParticipantID != "alice" || published.TrackID != "alice-video" {
		t.Errorf("track.published = %+v, want alice/alice-video", published)
	}
	if published.Kind != "video" {
		t.Errorf("kind = %q, want video", published.Kind)
	}

	bob := joinViaLink(t, plane, "room-1", "bob", "sess-bob", fullPermissions(), nil)
	bob.waitConnected()

	received := bob.awaitTrack()
	if received.ID() != "alice-video" {
		t.Errorf("track id = %q, want alice-video — subscribers must be able to attribute a track", received.ID())
	}

	if err := received.SetReadDeadline(time.Now().Add(frameWait)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, _, err := received.ReadRTP(); err != nil {
			t.Fatalf("read forwarded packet %d: %v", i+1, err)
		}
	}

	if size := roomSizeOf(manager, "room-1"); size != 2 {
		t.Errorf("room size = %d, want 2", size)
	}
}

func TestNodeLinkDeclaredTrackSourceReachesTheRoomState(t *testing.T) {
	// The declaration exists because a page cannot choose the stream or
	// track id in the SDP, so codec kind is all the node could otherwise
	// infer from — and that cannot tell a screen share from a camera.
	_, _, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	track := testVideoTrack(t, "alice-screen", "some-stream")
	alice := joinViaLink(t, plane, "room-2", "alice", "sess-alice", fullPermissions(), track)

	plane.send(mustFrame(t, TypeTrackSource, "sess-alice", "room-2", TrackSourcePayload{
		TrackID: "alice-screen",
		Source:  "screenShare",
	}))

	alice.waitConnected()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpTestRTP(ctx, track)

	plane.awaitType(TypeTrackPublished, "")

	// Asked for over the link, exactly as the dashboard does: a room
	// query carries a correlation id rather than a session id.
	plane.send(Frame{Type: TypeRoomState, RoomID: "room-2", RequestID: "req-1"})
	stateFrame := plane.await(func(frame Frame) bool {
		return frame.Type == TypeRoomStateResult && frame.RequestID == "req-1"
	})
	state := payloadOf[RoomStateResultPayload](t, stateFrame)

	if len(state.Participants) != 1 || len(state.Participants[0].Tracks) != 1 {
		t.Fatalf("room state = %+v, want one participant with one track", state)
	}
	if got := state.Participants[0].Tracks[0].Source; got != "screenShare" {
		t.Errorf("source = %q, want screenShare", got)
	}
}

func TestNodeLinkRoomStateForAnEmptyRoom(t *testing.T) {
	// A room row exists in the control plane long before anyone joins.
	// The honest answer is "nobody is here", not an error.
	_, _, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	plane.send(Frame{
		Type:      TypeRoomState,
		RoomID:    "room-nobody-joined",
		RequestID: "req-empty",
	})
	stateFrame := plane.await(func(frame Frame) bool {
		return frame.Type == TypeRoomStateResult && frame.RequestID == "req-empty"
	})
	state := payloadOf[RoomStateResultPayload](t, stateFrame)

	if state.RoomID != "room-nobody-joined" {
		t.Errorf("roomId = %q", state.RoomID)
	}
	if len(state.Participants) != 0 {
		t.Errorf("participants = %d, want 0", len(state.Participants))
	}
}

func TestNodeLinkReportsRoomFullDistinctly(t *testing.T) {
	// The control plane needs to tell "this room is full" from "the node
	// broke", because only one of them is worth retrying elsewhere.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := &config.Config{
		NodeID:                   "sfu-full",
		Region:                   "test",
		RoomCapacity:             1,
		HeartbeatIntervalSeconds: 10,
		RegistrationSecret:       linkSecret,
	}
	var link *Server
	manager, err := room.NewManager(cfg, room.RoomEvents{
		OnOffer: func(p *room.Participant, sdp webrtc.SessionDescription) { link.SendOffer(p, sdp) },
	}, logger)
	if err != nil {
		t.Fatalf("build manager: %v", err)
	}
	t.Cleanup(manager.Shutdown)

	link = NewServer(manager, linkSecret, logger)
	link.Start()
	t.Cleanup(link.Stop)

	mux := http.NewServeMux()
	mux.Handle("/internal/link", link.Handler())
	httpServer := httptest.NewServer(mux)
	t.Cleanup(httpServer.Close)

	plane, err := dialLink(t, httpServer.URL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	plane.send(mustFrame(t, TypeParticipantAdd, "sess-1", "room-full", ParticipantAddPayload{
		ParticipantID: "alice",
		Permissions:   fullPermissions(),
	}))
	plane.awaitType(TypeSDPOffer, "sess-1")

	plane.send(mustFrame(t, TypeParticipantAdd, "sess-2", "room-full", ParticipantAddPayload{
		ParticipantID: "bob",
		Permissions:   fullPermissions(),
	}))

	errorFrame := plane.awaitType(TypeError, "sess-2")
	errorPayload := payloadOf[ErrorPayload](t, errorFrame)
	if errorPayload.Code != ErrCodeRoomFull {
		t.Errorf("code = %q, want %q", errorPayload.Code, ErrCodeRoomFull)
	}
}

func TestNodeLinkRejectsAnUnknownSession(t *testing.T) {
	_, _, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	plane.send(mustFrame(t, TypeSDPAnswer, "sess-nobody", "room-1", SDPPayload{
		SDP:  "v=0 nonsense",
		Type: "answer",
	}))

	errorPayload := payloadOf[ErrorPayload](t, plane.awaitType(TypeError, "sess-nobody"))
	if errorPayload.Code != ErrCodeUnknownSession {
		t.Errorf("code = %q, want %q", errorPayload.Code, ErrCodeUnknownSession)
	}
}

func TestNodeLinkParticipantRemoveTearsDownTheSession(t *testing.T) {
	_, manager, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	alice := joinViaLink(t, plane, "room-3", "alice", "sess-alice", fullPermissions(), nil)
	alice.waitConnected()

	plane.send(mustFrame(t, TypeParticipantRemove, "sess-alice", "room-3", nil))

	deadline := time.After(frameWait)
	for {
		if _, found := manager.Room("room-3"); !found {
			return // room reaped once empty
		}
		select {
		case <-deadline:
			t.Fatal("session was not torn down")
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func TestNodeLinkReportsConnectionStateFromTheMediaPlane(t *testing.T) {
	// The client's own view can disagree with the node's, and knowing
	// that is often the whole diagnosis.
	_, _, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	alice := joinViaLink(t, plane, "room-4", "alice", "sess-alice", fullPermissions(), nil)
	alice.waitConnected()

	stateFrame := plane.await(func(frame Frame) bool {
		if frame.Type != TypeConnectionState || frame.SessionID != "sess-alice" {
			return false
		}
		var payload ConnectionStatePayload
		if err := json.Unmarshal(frame.Payload, &payload); err != nil {
			return false
		}
		return payload.PeerState == webrtc.PeerConnectionStateConnected.String()
	})

	state := payloadOf[ConnectionStatePayload](t, stateFrame)
	if state.ICEState == "" {
		t.Error("ice state was not reported")
	}
}

func TestNodeLinkIgnoresAnUnknownFrameType(t *testing.T) {
	// Forward compatibility: a newer control plane sending a frame this
	// node does not know must not take the link down and with it every
	// call on the node.
	_, manager, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	plane.send(Frame{Type: MessageType("something.from.the.future"), SessionID: "sess-x"})

	// The link still works afterwards.
	alice := joinViaLink(t, plane, "room-5", "alice", "sess-alice", fullPermissions(), nil)
	alice.waitConnected()

	if size := roomSizeOf(manager, "room-5"); size != 1 {
		t.Errorf("room size = %d, want 1 — the link should have survived", size)
	}
}

func roomSizeOf(manager *room.Manager, roomID string) int {
	target, found := manager.Room(roomID)
	if !found {
		return 0
	}
	return target.Size()
}

func TestNodeLinkQueryDoesNotRegisterASession(t *testing.T) {
	// A room query is about a room, not a participant. Claiming a session
	// for one would register a session that does not exist and then have
	// it swept as an orphan — which is why queries carry a correlation id
	// instead of a session id.
	link, _, serverURL := newLinkServer(t)
	plane, err := dialLink(t, serverURL, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}

	alice := joinViaLink(t, plane, "room-q", "alice", "sess-alice", fullPermissions(), nil)
	alice.waitConnected()

	plane.send(Frame{Type: TypeRoomState, RoomID: "room-q", RequestID: "req-q"})
	plane.await(func(frame Frame) bool {
		return frame.Type == TypeRoomStateResult && frame.RequestID == "req-q"
	})

	// Same package, so the ownership map can be inspected directly —
	// which is the only way to assert the absence of a phantom entry.
	link.mu.RLock()
	owners := len(link.owners)
	_, aliceOwned := link.owners["sess-alice"]
	link.mu.RUnlock()

	if !aliceOwned {
		t.Error("the real session lost its owner")
	}
	if owners != 1 {
		t.Errorf("owners = %d, want 1 — a query must not register a session", owners)
	}
}
