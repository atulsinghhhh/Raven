package room

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// broadcastData fans a message out to every other participant the instant
// it arrives, and every participant in a room starts negotiating its own
// data channel at roughly the same moment (see RavenEngine.ensureDataChannel
// on the client). Without buffering, a message that arrives for a
// recipient whose channel hasn't finished negotiating yet was silently
// dropped — SendData's old behavior — which is exactly the race
// flutter-rtc-datachannel-pubdev.e2e-spec.ts caught: two real Flutter Web
// clients joining and exchanging data immediately, flaky roughly half the
// time depending on which of the two negotiations won.
//
// These tests drive two real Pion PeerConnections and a real Participant,
// nothing mocked, same posture as media_test.go: the client offers a data
// channel (mirroring the client-initiated SDP offer handleSdpOffer
// accepts), the Participant's own pc answers it, exactly like the SFU
// really negotiates one.

// connectOffererAndAnswerer runs a full non-trickle offer/answer exchange:
// gather completes before each SetLocalDescription is handed to the other
// side, so no OnICECandidate wiring is needed for a same-process test.
func connectOffererAndAnswerer(t *testing.T, offerer, answerer *webrtc.PeerConnection) {
	t.Helper()

	offer, err := offerer.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}
	offerGatherComplete := webrtc.GatheringCompletePromise(offerer)
	if err := offerer.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local description (offerer): %v", err)
	}
	<-offerGatherComplete

	if err := answerer.SetRemoteDescription(*offerer.LocalDescription()); err != nil {
		t.Fatalf("set remote description (answerer): %v", err)
	}
	answer, err := answerer.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("create answer: %v", err)
	}
	answerGatherComplete := webrtc.GatheringCompletePromise(answerer)
	if err := answerer.SetLocalDescription(answer); err != nil {
		t.Fatalf("set local description (answerer): %v", err)
	}
	<-answerGatherComplete

	if err := offerer.SetRemoteDescription(*answerer.LocalDescription()); err != nil {
		t.Fatalf("set remote description (offerer): %v", err)
	}
}

// newTestParticipant builds a Participant around a real PeerConnection,
// with no Room/Manager involved — SendData and the OnDataChannel wiring in
// newParticipant are all this needs.
func newTestParticipant(t *testing.T, permissions Permissions) (*Participant, *webrtc.PeerConnection) {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create participant peer connection: %v", err)
	}
	t.Cleanup(func() { _ = pc.Close() })

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	participant := newParticipant("alice", "sess-1", "room-1", permissions, pc, ParticipantEvents{}, logger)
	return participant, pc
}

func recvString(t *testing.T, ch <-chan string, want string) {
	t.Helper()
	select {
	case got := <-ch:
		if got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
	case <-time.After(negotiationTimeout):
		t.Fatalf("timed out waiting to receive %q", want)
	}
}

func expectNothingReceived(t *testing.T, ch <-chan string) {
	t.Helper()
	select {
	case got := <-ch:
		t.Fatalf("expected no further message, got %q", got)
	case <-time.After(200 * time.Millisecond):
	}
}

// Test 1 — the exact race the e2e suite caught: SendData called before the
// participant's data channel exists at all must not lose the message.
func TestSendDataBeforeChannelOpensIsBufferedAndFlushedOnOpen(t *testing.T) {
	participant, participantPC := newTestParticipant(t, Permissions{PublishData: true})

	// Nothing has negotiated yet — dataChannel is definitely nil here, the
	// same state a just-joined participant's Participant is in the instant
	// the client's ensureDataChannel() call races the SFU's own answer.
	if err := participant.SendData([]byte("hello-before-open")); err != nil {
		t.Fatalf("SendData before negotiation: %v", err)
	}

	clientPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create client peer connection: %v", err)
	}
	t.Cleanup(func() { _ = clientPC.Close() })

	received := make(chan string, 8)
	dc, err := clientPC.CreateDataChannel(dataChannelLabel, nil)
	if err != nil {
		t.Fatalf("create data channel: %v", err)
	}
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		received <- string(msg.Data)
	})

	// Client offers (as raven_rtc's ensureDataChannel does), the
	// participant's own pc answers — the same shape handleSdpOffer accepts.
	connectOffererAndAnswerer(t, clientPC, participantPC)

	recvString(t, received, "hello-before-open")

	// Once genuinely open, a further send goes straight through too.
	if err := participant.SendData([]byte("hello-after-open")); err != nil {
		t.Fatalf("SendData after negotiation: %v", err)
	}
	recvString(t, received, "hello-after-open")
}

// Test 2 — multiple messages sent before the channel opens must arrive in
// the order they were sent, not just individually.
func TestSendDataBufferPreservesOrder(t *testing.T) {
	participant, participantPC := newTestParticipant(t, Permissions{PublishData: true})

	messages := []string{"one", "two", "three", "four"}
	for _, msg := range messages {
		if err := participant.SendData([]byte(msg)); err != nil {
			t.Fatalf("SendData(%q): %v", msg, err)
		}
	}

	clientPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create client peer connection: %v", err)
	}
	t.Cleanup(func() { _ = clientPC.Close() })

	received := make(chan string, 8)
	dc, err := clientPC.CreateDataChannel(dataChannelLabel, nil)
	if err != nil {
		t.Fatalf("create data channel: %v", err)
	}
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		received <- string(msg.Data)
	})

	connectOffererAndAnswerer(t, clientPC, participantPC)

	for _, want := range messages {
		recvString(t, received, want)
	}
}

// Test 3 — the buffer is bounded: a recipient that never opens a channel
// at all (no publishData grant, or one who simply never negotiates one)
// must not accumulate memory for the life of a long call.
func TestSendDataBufferDropsOldestBeyondLimit(t *testing.T) {
	participant, participantPC := newTestParticipant(t, Permissions{PublishData: true})

	total := pendingOutboundDataLimit + 5
	messages := make([]string, total)
	for i := range messages {
		messages[i] = string(rune('a' + (i % 26)))
	}
	for _, msg := range messages {
		if err := participant.SendData([]byte(msg)); err != nil {
			t.Fatalf("SendData(%q): %v", msg, err)
		}
	}

	participant.dataMu.Lock()
	bufferedLen := len(participant.pendingOutboundData)
	participant.dataMu.Unlock()
	if bufferedLen != pendingOutboundDataLimit {
		t.Fatalf("expected buffer capped at %d, got %d", pendingOutboundDataLimit, bufferedLen)
	}

	clientPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create client peer connection: %v", err)
	}
	t.Cleanup(func() { _ = clientPC.Close() })

	received := make(chan string, total)
	dc, err := clientPC.CreateDataChannel(dataChannelLabel, nil)
	if err != nil {
		t.Fatalf("create data channel: %v", err)
	}
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		received <- string(msg.Data)
	})

	connectOffererAndAnswerer(t, clientPC, participantPC)

	// Only the most recent pendingOutboundDataLimit messages should have
	// survived — the oldest 5 were dropped to keep the buffer bounded.
	want := messages[len(messages)-pendingOutboundDataLimit:]
	for _, w := range want {
		recvString(t, received, w)
	}
	expectNothingReceived(t, received)
}

// Test 4 — a participant without publishData never gets a data channel at
// all (the SFU closes it instead), so SendData against it must keep
// returning nil rather than ever finding something to flush.
func TestSendDataWithoutPublishDataPermissionNeverOpens(t *testing.T) {
	participant, participantPC := newTestParticipant(t, Permissions{PublishData: false})

	if err := participant.SendData([]byte("never-delivered")); err != nil {
		t.Fatalf("SendData: %v", err)
	}

	clientPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create client peer connection: %v", err)
	}
	t.Cleanup(func() { _ = clientPC.Close() })

	closed := make(chan struct{})
	dc, err := clientPC.CreateDataChannel(dataChannelLabel, nil)
	if err != nil {
		t.Fatalf("create data channel: %v", err)
	}
	dc.OnClose(func() { close(closed) })

	connectOffererAndAnswerer(t, clientPC, participantPC)

	select {
	case <-closed:
	case <-time.After(negotiationTimeout):
		t.Fatalf("expected the SFU to close a data channel opened without publishData permission")
	}
}
