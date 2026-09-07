package room

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// Scale tests for spec §39, which requires measured results at 2, 10, 50
// and 100 participants — and forbids claiming a capacity that has not been
// measured.
//
// # What these do and do not prove
//
// They prove that N real PeerConnections can join one room on this node,
// that the SFU builds the full N×(N-1) forwarding mesh, and that media
// actually arrives at subscribers at that size. That is the thing most
// likely to be quietly broken by a design mistake (a per-room lock held
// across a network write, say), and it is worth knowing.
//
// They do not prove production capacity. Every participant here runs in
// the same process as the SFU, on loopback, with a synthetic 100-packet-
// per-second stream and no encoder, no jitter, no loss, and no NAT. Real
// capacity depends on codec bitrates, CPU, and the network, and belongs
// to a load test against a deployed node — see docs/rtc/scaling.md. The
// numbers these tests print are wall-clock join times on loopback,
// nothing more.
//
// Skipped under `-short` because the 50- and 100-participant cases take
// long enough to be annoying in a normal run.

func TestScaleParticipants(t *testing.T) {
	if testing.Short() {
		t.Skip("scale tests are slow; run without -short")
	}

	for _, size := range []int{2, 10, 50} {
		t.Run(fmt.Sprintf("%d participants", size), func(t *testing.T) {
			runScaleTest(t, size)
		})
	}
}

// TestScale100Participants is separate so it can be run (or skipped) on its
// own: it is the slowest case by a wide margin, since the forwarding mesh
// it builds has ~9,900 downtracks.
func TestScale100Participants(t *testing.T) {
	if testing.Short() {
		t.Skip("scale tests are slow; run without -short")
	}
	runScaleTest(t, 100)
}

func runScaleTest(t *testing.T, size int) {
	t.Helper()

	h := newHarness(t)
	roomID := fmt.Sprintf("scale-%d", size)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// One publisher, N-1 subscribers. This is the shape that stresses
	// forwarding hardest per unit of inbound media: every subscriber needs
	// its own downtrack, so the node does N-1 writes per received packet.
	publisherTrack := newVideoTrack(t, "publisher-video", "publisher-camera")

	joinStart := time.Now()
	publisher := h.join(roomID, "publisher", "sess-publisher", publisherPermissions(), publisherTrack)
	publisher.waitConnected(t)
	go pumpRTP(ctx, publisherTrack)
	h.awaitTrackEvent("publisher", true)

	subscribers := make([]*testClient, 0, size-1)
	for i := 1; i < size; i++ {
		client := h.join(
			roomID,
			fmt.Sprintf("subscriber-%d", i),
			fmt.Sprintf("sess-subscriber-%d", i),
			Permissions{Subscribe: true},
			nil,
		)
		subscribers = append(subscribers, client)
	}

	for _, subscriber := range subscribers {
		subscriber.waitConnected(t)
	}
	joinDuration := time.Since(joinStart)

	if got := h.roomSize(roomID); got != size {
		t.Fatalf("room size = %d, want %d", got, size)
	}

	// Every subscriber must actually receive media, not merely connect.
	// A design that broke under fan-out would still pass a connection-only
	// check.
	mediaStart := time.Now()
	for i, subscriber := range subscribers {
		var received *webrtc.TrackRemote
		select {
		case received = <-subscriber.tracksReceived:
		case <-time.After(mediaTimeout):
			t.Fatalf("subscriber %d never received the publisher's track", i+1)
		}

		if err := received.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
			t.Fatalf("set read deadline: %v", err)
		}
		if _, _, err := received.ReadRTP(); err != nil {
			t.Fatalf("subscriber %d received no forwarded packets: %v", i+1, err)
		}
	}
	mediaDuration := time.Since(mediaStart)

	load := h.manager.Load()
	if load.Participants != size {
		t.Errorf("reported participants = %d, want %d", load.Participants, size)
	}
	if load.VideoTracks != 1 {
		t.Errorf("reported video tracks = %d, want 1", load.VideoTracks)
	}

	// One downtrack per subscriber — the forwarding mesh was built in full.
	stats := publisher.participant.Stats()
	if len(stats.PublishedTracks) != 1 {
		t.Fatalf("publisher tracks = %d, want 1", len(stats.PublishedTracks))
	}
	if got := len(stats.PublishedTracks[0].DownTracks); got != size-1 {
		t.Errorf("downtracks = %d, want %d (one per subscriber)", got, size-1)
	}

	t.Logf("size=%d join=%s firstMedia=%s downtracks=%d — loopback, synthetic stream; not a capacity measurement",
		size, joinDuration.Round(time.Millisecond), mediaDuration.Round(time.Millisecond),
		len(stats.PublishedTracks[0].DownTracks))
}

// TestScaleMeshRoom exercises the harder shape: everyone publishes, so the
// node maintains N publishers × (N-1) subscribers of downtracks.
//
// Kept smaller than the fan-out test above because the mesh grows
// quadratically — at 20 participants this is already 380 downtracks and 20
// inbound streams, which is a realistic large meeting and enough to catch
// a locking mistake that only appears when many read loops contend.
func TestScaleMeshRoom(t *testing.T) {
	if testing.Short() {
		t.Skip("scale tests are slow; run without -short")
	}

	const size = 20
	h := newHarness(t)
	roomID := "scale-mesh"

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	clients := make([]*testClient, 0, size)
	start := time.Now()
	for i := 0; i < size; i++ {
		track := newVideoTrack(t, fmt.Sprintf("video-%d", i), fmt.Sprintf("camera-%d", i))
		client := h.join(
			roomID,
			fmt.Sprintf("participant-%d", i),
			fmt.Sprintf("sess-%d", i),
			publisherPermissions(),
			track,
		)
		go pumpRTP(ctx, track)
		clients = append(clients, client)
	}

	for i, client := range clients {
		client.waitConnected(t)
		_ = i
	}
	joinDuration := time.Since(start)

	if got := h.roomSize(roomID); got != size {
		t.Fatalf("room size = %d, want %d", got, size)
	}

	// Wait for the mesh to settle: every participant should end up with
	// N-1 subscriptions. Polled rather than asserted immediately, because
	// each publish triggers a renegotiation of every other participant and
	// those complete asynchronously.
	deadline := time.Now().Add(45 * time.Second)
	for {
		complete := true
		total := 0
		for _, client := range clients {
			subscribed := client.participant.Stats().SubscribedTracks
			total += subscribed
			if subscribed < size-1 {
				complete = false
			}
		}
		if complete {
			// Subscriptions existing is not the same as media arriving.
			// Under this much concurrent renegotiation Pion logs
			// "incoming SSRC failed Simulcast probing" for some streams,
			// so the question worth answering is whether every
			// participant actually ends up receiving forwarded packets.
			verifyMeshMediaFlows(t, clients, size)
			t.Logf("size=%d join=%s totalSubscriptions=%d — loopback, synthetic streams; not a capacity measurement",
				size, joinDuration.Round(time.Millisecond), total)
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("mesh never completed: %d/%d subscriptions after 45s", total, size*(size-1))
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// verifyMeshMediaFlows checks that every participant receives real RTP from
// every other one.
//
// Each client should see N-1 inbound tracks and be able to read a packet
// from each. Anything less means the SFU built a subscription it is not
// actually feeding, which a subscription count alone would hide.
func verifyMeshMediaFlows(t *testing.T, clients []*testClient, size int) {
	t.Helper()

	for i, client := range clients {
		received := make([]*webrtc.TrackRemote, 0, size-1)
		for len(received) < size-1 {
			select {
			case track := <-client.tracksReceived:
				received = append(received, track)
			case <-time.After(mediaTimeout):
				t.Fatalf("participant %d received %d/%d inbound tracks", i, len(received), size-1)
			}
		}

		for _, track := range received {
			if err := track.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
				t.Fatalf("set read deadline: %v", err)
			}
			if _, _, err := track.ReadRTP(); err != nil {
				t.Fatalf("participant %d received no packets on track %q: %v", i, track.ID(), err)
			}
		}
	}
}
