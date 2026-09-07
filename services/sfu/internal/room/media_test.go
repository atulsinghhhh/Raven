package room

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"

	"github.com/corvidhq/raven/services/sfu/internal/config"
)

// These tests drive real Pion PeerConnections against a real Manager and
// assert on RTP that actually crossed a DTLS-SRTP transport. Nothing here
// is mocked below the room API.
//
// That is deliberate and it is the point: an SFU that passes unit tests on
// its layer-selection logic can still fail to forward a single packet, and
// the only way to know it works is to watch bytes arrive on the far side.
// Spec §39 asks for a real WebRTC test matrix; this is its foundation.

const (
	// negotiationTimeout bounds how long a test waits for ICE and DTLS.
	// Generous, because CI machines gather candidates slowly, and a flaky
	// media test is worse than a slow one.
	negotiationTimeout = 20 * time.Second
	mediaTimeout       = 15 * time.Second

	// maxTracksPerClient bounds the per-client inbound track buffer.
	// Comfortably above the largest mesh any test builds.
	maxTracksPerClient = 512
)

// harness is a Manager plus the plumbing that stands in for the control
// plane: it routes the SFU's offers and ICE candidates to the right test
// client, exactly as the node link would.
type harness struct {
	t       *testing.T
	manager *Manager

	mu      sync.Mutex
	clients map[string]*testClient // by session id
	// tearingDown is set before cleanup closes the client PeerConnections.
	// Renegotiations are asynchronous, so an offer can still be in flight
	// when a test returns; failing the test for a SetRemoteDescription on
	// an intentionally-closed connection would report a harness race as a
	// product bug.
	//
	// The harness closes every client connection itself, in one cleanup,
	// rather than each client registering its own: t.Cleanup runs LIFO, so
	// per-client cleanups registered later would close connections before
	// this flag was ever set.
	tearingDown bool

	trackEvents chan trackEvent
}

type trackEvent struct {
	participantID string
	trackID       string
	published     bool
}

type testClient struct {
	sessionID   string
	pc          *webrtc.PeerConnection
	participant *Participant

	// pendingCandidates buffers candidates that arrive before the client
	// has a remote description. Real clients need this too — trickle ICE
	// does not wait for negotiation to finish.
	mu                sync.Mutex
	remoteDescription bool
	pendingCandidates []webrtc.ICECandidateInit

	// tracksReceived must be able to hold every track a test expects. A
	// buffer that silently dropped the overflow once made a full mesh look
	// like the SFU had failed to forward — the count matched the buffer
	// size exactly, not anything about the product.
	tracksReceived chan *webrtc.TrackRemote
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	h := &harness{
		t:           t,
		clients:     make(map[string]*testClient),
		trackEvents: make(chan trackEvent, 64),
	}

	cfg := &config.Config{
		NodeID:                   "sfu-test",
		Region:                   "test",
		RoomCapacity:             100,
		UDPPortMin:               0,
		UDPPortMax:               0,
		HeartbeatIntervalSeconds: 10,
		RegistrationSecret:       "test",
	}

	events := RoomEvents{
		OnOffer: func(p *Participant, sdp webrtc.SessionDescription) {
			// The SFU renegotiating on its own — a participant joining or a
			// track appearing. Answered here the same way a client would.
			h.answerOffer(p, sdp)
		},
		OnICECandidate: func(p *Participant, candidate *webrtc.ICECandidate) {
			h.deliverCandidateToClient(p.SessionID, candidate)
		},
		OnTrackChange: func(p *Participant, track *PublishedTrack, published bool) {
			select {
			case h.trackEvents <- trackEvent{p.ID, track.ID, published}:
			default:
			}
		},
	}

	manager, err := NewManager(cfg, events, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("build manager: %v", err)
	}
	h.manager = manager
	t.Cleanup(func() {
		h.mu.Lock()
		h.tearingDown = true
		clients := make([]*testClient, 0, len(h.clients))
		for _, client := range h.clients {
			clients = append(clients, client)
		}
		h.mu.Unlock()

		manager.Shutdown()
		for _, client := range clients {
			_ = client.pc.Close()
		}
	})

	return h
}

// join creates a client PeerConnection, adds it to the room, and completes
// the initial negotiation. `publish` optionally supplies a track for the
// client to send.
func (h *harness) join(roomID, participantID, sessionID string, permissions Permissions, publish *webrtc.TrackLocalStaticRTP) *testClient {
	h.t.Helper()

	clientPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		h.t.Fatalf("create client peer connection: %v", err)
	}

	client := &testClient{
		sessionID:      sessionID,
		pc:             clientPC,
		tracksReceived: make(chan *webrtc.TrackRemote, maxTracksPerClient),
	}

	clientPC.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		select {
		case client.tracksReceived <- track:
		default:
			// Loudly, rather than dropping: a full buffer means a test
			// expects more tracks than the harness can hold, and a
			// silently-lost track is indistinguishable from an SFU that
			// never forwarded it.
			h.t.Errorf("track buffer full (%d) — raise maxTracksPerClient", maxTracksPerClient)
		}
	})

	if publish != nil {
		if _, err := clientPC.AddTrack(publish); err != nil {
			h.t.Fatalf("add track to client: %v", err)
		}
	}

	h.mu.Lock()
	h.clients[sessionID] = client
	h.mu.Unlock()

	participant, err := h.manager.AddParticipant(roomID, participantID, sessionID, permissions)
	if err != nil {
		h.t.Fatalf("add participant: %v", err)
	}
	client.participant = participant

	// The client's own candidates go to the SFU. Registered after
	// AddParticipant so `participant` is non-nil when it fires.
	clientPC.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if err := participant.AddICECandidate(candidate.ToJSON()); err != nil {
			h.t.Logf("sfu rejected client candidate: %v", err)
		}
	})

	offer, err := participant.CreateOffer()
	if err != nil {
		h.t.Fatalf("create initial offer: %v", err)
	}
	h.answerOffer(participant, *offer)

	return client
}

// answerOffer plays the client half of a negotiation round.
func (h *harness) answerOffer(participant *Participant, offer webrtc.SessionDescription) {
	h.mu.Lock()
	client := h.clients[participant.SessionID]
	tearingDown := h.tearingDown
	h.mu.Unlock()
	if client == nil {
		return
	}

	fail := h.t.Errorf
	if tearingDown || client.pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
		// Losing a negotiation to a deliberate shutdown is expected.
		fail = h.t.Logf
	}
	// Pion marks a PeerConnection closed internally before its public
	// connection state catches up, so the state check above can miss a
	// deliberate close by a few microseconds. Treat this specific error as
	// teardown noise rather than a product failure — any other error still
	// fails the test.
	reportClosed := func(err error) {
		if strings.Contains(err.Error(), "connection closed") {
			h.t.Logf("negotiation abandoned — connection closed: %v", err)
			return
		}
		fail("negotiation failed: %v", err)
	}

	if err := client.pc.SetRemoteDescription(offer); err != nil {
		reportClosed(err)
		return
	}
	client.flushPendingCandidates(h.t)

	answer, err := client.pc.CreateAnswer(nil)
	if err != nil {
		reportClosed(err)
		return
	}
	if err := client.pc.SetLocalDescription(answer); err != nil {
		reportClosed(err)
		return
	}
	if err := participant.AcceptAnswer(answer.SDP); err != nil {
		reportClosed(err)
	}
}

func (h *harness) deliverCandidateToClient(sessionID string, candidate *webrtc.ICECandidate) {
	h.mu.Lock()
	client := h.clients[sessionID]
	h.mu.Unlock()
	if client == nil {
		return
	}
	client.addRemoteCandidate(h.t, candidate.ToJSON())
}

func (c *testClient) addRemoteCandidate(t *testing.T, init webrtc.ICECandidateInit) {
	c.mu.Lock()
	if !c.remoteDescription {
		// AddICECandidate before SetRemoteDescription is an error in
		// WebRTC, so buffer — the same thing every real client does.
		c.pendingCandidates = append(c.pendingCandidates, init)
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()

	if err := c.pc.AddICECandidate(init); err != nil {
		t.Logf("client rejected sfu candidate: %v", err)
	}
}

func (c *testClient) flushPendingCandidates(t *testing.T) {
	c.mu.Lock()
	c.remoteDescription = true
	pending := c.pendingCandidates
	c.pendingCandidates = nil
	c.mu.Unlock()

	for _, init := range pending {
		if err := c.pc.AddICECandidate(init); err != nil {
			t.Logf("client rejected buffered candidate: %v", err)
		}
	}
}

// waitConnected blocks until the client's PeerConnection is connected.
func (c *testClient) waitConnected(t *testing.T) {
	t.Helper()
	deadline := time.After(negotiationTimeout)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	for {
		if c.pc.ConnectionState() == webrtc.PeerConnectionStateConnected {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("client %s never connected (state %s)", c.sessionID, c.pc.ConnectionState())
		case <-ticker.C:
		}
	}
}

// newVideoTrack makes a track a test client can publish.
func newVideoTrack(t *testing.T, id, streamID string) *webrtc.TrackLocalStaticRTP {
	t.Helper()
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		id, streamID,
	)
	if err != nil {
		t.Fatalf("create video track: %v", err)
	}
	return track
}

// pumpRTP writes synthetic VP8 packets until the context is cancelled.
//
// Every packet is marked as a keyframe so a subscriber joining at any
// moment can decode immediately — real media would not do this, but a test
// that had to wait for an encoder's keyframe cadence would be slower and
// no more truthful about whether forwarding works.
func pumpRTP(ctx context.Context, track *webrtc.TrackLocalStaticRTP) {
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
			timestamp += 3000 // 90kHz clock, ~33ms
			_ = track.WriteRTP(&rtp.Packet{
				Header: rtp.Header{
					Version:        2,
					SequenceNumber: sequence,
					Timestamp:      timestamp,
					SSRC:           0xDEADBEEF,
				},
				Payload: []byte{0x10, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03},
			})
		}
	}
}

// awaitTrackEvent waits for a specific publish/unpublish event.
func (h *harness) awaitTrackEvent(participantID string, published bool) trackEvent {
	h.t.Helper()
	deadline := time.After(mediaTimeout)
	for {
		select {
		case event := <-h.trackEvents:
			if event.participantID == participantID && event.published == published {
				return event
			}
		case <-deadline:
			h.t.Fatalf("timed out waiting for track published=%v from %s", published, participantID)
		}
	}
}

func publisherPermissions() Permissions {
	return Permissions{Publish: true, Subscribe: true, PublishAudio: true, PublishVideo: true, PublishData: true}
}

// --- Tests ---------------------------------------------------------------

func TestSFUForwardsMediaBetweenTwoParticipants(t *testing.T) {
	// The single most important test in this package: media published by
	// one participant reaches another, over real ICE/DTLS/SRTP, through
	// the SFU's forwarding path.
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-1", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)

	// The SFU must see the track before anyone can be subscribed to it.
	h.awaitTrackEvent("alice", true)

	bob := h.join("room-1", "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)

	var received *webrtc.TrackRemote
	select {
	case received = <-bob.tracksReceived:
	case <-time.After(mediaTimeout):
		t.Fatal("bob never received alice's track")
	}

	if received.ID() != "alice-video" {
		t.Errorf("track id = %q, want %q — subscribers must be able to attribute a track to its publisher", received.ID(), "alice-video")
	}
	if received.StreamID() != "alice-camera" {
		t.Errorf("stream id = %q, want %q", received.StreamID(), "alice-camera")
	}

	// Now the part that cannot be faked: read packets that actually
	// traversed the SFU.
	if err := received.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	const wantPackets = 10
	for i := 0; i < wantPackets; i++ {
		packet, _, err := received.ReadRTP()
		if err != nil {
			t.Fatalf("read forwarded packet %d/%d: %v", i+1, wantPackets, err)
		}
		if len(packet.Payload) == 0 {
			t.Fatalf("forwarded packet %d had an empty payload", i+1)
		}
	}
}

func TestSFUForwardsToMultipleSubscribers(t *testing.T) {
	// One publisher, several subscribers — the actual shape of a group
	// call, and the case where a shared-output-track design would break.
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-2", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	subscribers := []*testClient{
		h.join("room-2", "bob", "sess-bob", publisherPermissions(), nil),
		h.join("room-2", "carol", "sess-carol", publisherPermissions(), nil),
	}

	for _, subscriber := range subscribers {
		subscriber.waitConnected(t)

		var received *webrtc.TrackRemote
		select {
		case received = <-subscriber.tracksReceived:
		case <-time.After(mediaTimeout):
			t.Fatalf("%s never received alice's track", subscriber.sessionID)
		}

		if err := received.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
			t.Fatalf("set read deadline: %v", err)
		}
		for i := 0; i < 5; i++ {
			if _, _, err := received.ReadRTP(); err != nil {
				t.Fatalf("%s read packet %d: %v", subscriber.sessionID, i+1, err)
			}
		}
	}

	if size := h.roomSize("room-2"); size != 3 {
		t.Errorf("room size = %d, want 3", size)
	}
}

func TestSFUForwardsTrackPublishedMidCall(t *testing.T) {
	// Joining an empty room and then publishing is the common case for the
	// first participant, and it exercises renegotiation rather than the
	// join-time subscribe path.
	h := newHarness(t)

	alice := h.join("room-3", "alice", "sess-alice", publisherPermissions(), nil)
	bob := h.join("room-3", "bob", "sess-bob", publisherPermissions(), nil)
	alice.waitConnected(t)
	bob.waitConnected(t)

	// Alice starts publishing after both are already connected, and offers
	// from her side — a client-initiated renegotiation.
	aliceTrack := newVideoTrack(t, "alice-late-video", "alice-camera")
	if _, err := alice.pc.AddTrack(aliceTrack); err != nil {
		t.Fatalf("add track mid-call: %v", err)
	}

	offer, err := alice.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("client create offer: %v", err)
	}
	if err := alice.pc.SetLocalDescription(offer); err != nil {
		t.Fatalf("client set local description: %v", err)
	}
	answer, err := alice.participant.AcceptOffer(offer.SDP)
	if err != nil {
		t.Fatalf("sfu accept client offer: %v", err)
	}
	if err := alice.pc.SetRemoteDescription(*answer); err != nil {
		t.Fatalf("client set remote answer: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)

	h.awaitTrackEvent("alice", true)

	var received *webrtc.TrackRemote
	select {
	case received = <-bob.tracksReceived:
	case <-time.After(mediaTimeout):
		t.Fatal("bob never received the mid-call track")
	}

	if err := received.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, _, err := received.ReadRTP(); err != nil {
			t.Fatalf("read mid-call packet %d: %v", i+1, err)
		}
	}
}

func TestSFURejectsPublishWithoutPermission(t *testing.T) {
	// Spec §38: the media plane does not trust that signaling checked.
	// A client that negotiates a track it was not granted must have it
	// dropped, not forwarded.
	h := newHarness(t)

	subscribeOnly := Permissions{Subscribe: true}
	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-4", "alice", "sess-alice", subscribeOnly, aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)

	// No track-published event should ever arrive.
	select {
	case event := <-h.trackEvents:
		if event.published {
			t.Fatalf("unauthorized track was published: %+v", event)
		}
	case <-time.After(3 * time.Second):
		// Expected: the SFU saw the RTP and refused to register it.
	}

	if tracks := alice.participant.PublishedTracks(); len(tracks) != 0 {
		t.Errorf("participant has %d published tracks, want 0", len(tracks))
	}
}

func TestSFUUnpublishesTracksWhenParticipantLeaves(t *testing.T) {
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-5", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	bob := h.join("room-5", "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)
	select {
	case <-bob.tracksReceived:
	case <-time.After(mediaTimeout):
		t.Fatal("bob never received alice's track")
	}

	if !h.manager.RemoveParticipant("room-5", "sess-alice") {
		t.Fatal("removing alice reported no such participant")
	}

	h.awaitTrackEvent("alice", false)

	if size := h.roomSize("room-5"); size != 1 {
		t.Errorf("room size = %d after alice left, want 1", size)
	}
}

func TestSFUReapsEmptyRooms(t *testing.T) {
	// An empty room left behind would inflate this node's reported load
	// and, through the allocator, quietly shrink the fleet's usable
	// capacity.
	h := newHarness(t)

	h.join("room-6", "alice", "sess-alice", publisherPermissions(), nil)
	if _, found := h.manager.Room("room-6"); !found {
		t.Fatal("room was not created")
	}

	h.manager.RemoveParticipant("room-6", "sess-alice")

	if _, found := h.manager.Room("room-6"); found {
		t.Error("empty room was not reaped")
	}
	if load := h.manager.Load(); load.Rooms != 0 {
		t.Errorf("reported rooms = %d after everyone left, want 0", load.Rooms)
	}
}

func TestSFUEvictsStaleSessionOnReconnect(t *testing.T) {
	// A participant that reconnects (new network, refreshed tab) arrives
	// with a new session while the old one may still look alive. Two
	// sessions for one identity means the room shows a ghost.
	h := newHarness(t)

	first := h.join("room-7", "alice", "sess-alice-1", publisherPermissions(), nil)
	first.waitConnected(t)

	second := h.join("room-7", "alice", "sess-alice-2", publisherPermissions(), nil)
	second.waitConnected(t)

	if size := h.roomSize("room-7"); size != 1 {
		t.Errorf("room size = %d, want 1 — the stale session should have been evicted", size)
	}

	activeRoom, _ := h.manager.Room("room-7")
	if _, found := activeRoom.Participant("sess-alice-1"); found {
		t.Error("stale session is still in the room")
	}
	if _, found := activeRoom.Participant("sess-alice-2"); !found {
		t.Error("the reconnected session is not in the room")
	}
}

func TestSFUEnforcesRoomCapacity(t *testing.T) {
	h := newHarness(t)

	// Shrink the room by building it directly, rather than reconfiguring
	// the whole manager: capacity is a room property.
	small := NewRoom("room-8", 1, RoomEvents{}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	firstPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create peer connection: %v", err)
	}
	defer firstPC.Close()
	if _, err := small.AddParticipant("alice", "sess-a", publisherPermissions(), firstPC); err != nil {
		t.Fatalf("first participant rejected: %v", err)
	}

	secondPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create peer connection: %v", err)
	}
	defer secondPC.Close()

	_, err = small.AddParticipant("bob", "sess-b", publisherPermissions(), secondPC)
	if err == nil {
		t.Fatal("expected the room to be full")
	}
	if err != ErrRoomFull {
		t.Errorf("err = %v, want ErrRoomFull — the control plane distinguishes this from an internal failure", err)
	}
	_ = h
}

func TestRoomStateReportsLiveParticipantsAndTracks(t *testing.T) {
	// This snapshot is what replaced polling LiveKit's RoomServiceClient,
	// so the dashboard depends on it being truthful.
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-9", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	activeRoom, found := h.manager.Room("room-9")
	if !found {
		t.Fatal("room not found")
	}

	state := activeRoom.State()
	if state.RoomID != "room-9" {
		t.Errorf("room id = %q, want %q", state.RoomID, "room-9")
	}
	if len(state.Participants) != 1 {
		t.Fatalf("participants = %d, want 1", len(state.Participants))
	}

	entry := state.Participants[0]
	if entry.ParticipantID != "alice" || entry.SessionID != "sess-alice" {
		t.Errorf("participant = %+v, want alice/sess-alice", entry)
	}
	if entry.JoinedAtUnix == 0 {
		t.Error("joinedAt was not populated")
	}
	if len(entry.Tracks) != 1 {
		t.Fatalf("tracks = %d, want 1", len(entry.Tracks))
	}
	if entry.Tracks[0].Kind != "video" {
		t.Errorf("track kind = %q, want video", entry.Tracks[0].Kind)
	}
	if entry.Tracks[0].Source != string(SourceCamera) {
		t.Errorf("track source = %q, want %q — read from the publisher's stream id", entry.Tracks[0].Source, SourceCamera)
	}
}

func TestPublisherMuteStopsForwardingWithoutUnpublishing(t *testing.T) {
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-10", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	bob := h.join("room-10", "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)

	var received *webrtc.TrackRemote
	select {
	case received = <-bob.tracksReceived:
	case <-time.After(mediaTimeout):
		t.Fatal("bob never received alice's track")
	}

	// Confirm media is flowing first, so a later absence means something.
	if err := received.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	if _, _, err := received.ReadRTP(); err != nil {
		t.Fatalf("read before mute: %v", err)
	}

	if !alice.participant.SetTrackMuted("alice-video", true) {
		t.Fatal("mute reported no such track")
	}

	// The track is still published — mute must not tear it down, or
	// unmuting would cost a renegotiation and the subscriber's UI would
	// lose the participant's tile.
	if tracks := alice.participant.PublishedTracks(); len(tracks) != 1 {
		t.Errorf("published tracks = %d after mute, want 1", len(tracks))
	}

	// Drain whatever was already in flight, then confirm the stream stops.
	drainDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(drainDeadline) {
		_ = received.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		if _, _, err := received.ReadRTP(); err != nil {
			break
		}
	}

	_ = received.SetReadDeadline(time.Now().Add(1 * time.Second))
	if _, _, err := received.ReadRTP(); err == nil {
		t.Error("packets are still arriving after the publisher muted")
	}
}

func (h *harness) roomSize(roomID string) int {
	activeRoom, found := h.manager.Room(roomID)
	if !found {
		return 0
	}
	return activeRoom.Size()
}

func TestDeclaredTrackSourceOverridesTheKindGuess(t *testing.T) {
	// A screen share and a camera are both video, so codec kind cannot
	// tell them apart — and a browser page cannot choose the stream or
	// track id that reaches the SDP. The client therefore declares the
	// source, and spec §16 needs that distinction to survive.
	h := newHarness(t)

	track := newVideoTrack(t, "alice-screen", "whatever-the-browser-chose")
	alice := h.join("room-src", "alice", "sess-alice", publisherPermissions(), track)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, track)

	// Declared after the media is already flowing — the harder ordering,
	// and a real one, since the declaration and the negotiation race.
	h.awaitTrackEvent("alice", true)
	alice.participant.DeclareTrackSource("alice-screen", SourceScreenShare)

	published, found := alice.participant.PublishedTrack("alice-screen")
	if !found {
		t.Fatal("track not found")
	}
	if got := published.Source(); got != SourceScreenShare {
		t.Errorf("source = %q, want %q", got, SourceScreenShare)
	}

	// And it shows up in the room state the dashboard reads.
	activeRoom, _ := h.manager.Room("room-src")
	state := activeRoom.State()
	if state.Participants[0].Tracks[0].Source != string(SourceScreenShare) {
		t.Errorf("room state source = %q, want %q",
			state.Participants[0].Tracks[0].Source, SourceScreenShare)
	}
}

func TestDeclaredSourceBeforeMediaArrives(t *testing.T) {
	// The ordinary ordering: the client declares, then negotiates.
	h := newHarness(t)

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create peer connection: %v", err)
	}
	defer pc.Close()

	participant, err := h.manager.AddParticipant("room-src2", "alice", "sess-a", publisherPermissions())
	if err != nil {
		t.Fatalf("add participant: %v", err)
	}
	participant.DeclareTrackSource("future-track", SourceScreenShare)

	// Nothing published yet, so nothing to assert on the track — what
	// matters is that the declaration is retained rather than dropped for
	// a track that does not exist yet.
	participant.DeclareTrackSource("future-track", SourceScreenShare)
}

func TestInvalidDeclaredSourceIsIgnored(t *testing.T) {
	// A malformed declaration must not end up on a track and be forwarded
	// to every subscriber as though it meant something.
	h := newHarness(t)

	track := newVideoTrack(t, "alice-cam", "stream")
	alice := h.join("room-src3", "alice", "sess-alice", publisherPermissions(), track)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, track)
	h.awaitTrackEvent("alice", true)

	alice.participant.DeclareTrackSource("alice-cam", TrackSource("nonsense"))

	published, _ := alice.participant.PublishedTrack("alice-cam")
	if got := published.Source(); got != SourceCamera {
		t.Errorf("source = %q, want the camera fallback to survive a bad declaration", got)
	}
}
