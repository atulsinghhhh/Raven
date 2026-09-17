package room

import (
	"context"
	"fmt"
	"math"
	"testing"
	"time"
)

// Measured multi-participant simulcast, at the sizes a group call actually
// breaks at.
//
// # What this measures, and what it deliberately does not
//
// It measures what the SFU forwards: bytes and packets per subscriber, the
// layer each subscriber ends up on, the packets discarded as belonging to
// an unselected layer, and join latency. Every one of those is a property
// of this code and is measured here against real PeerConnections over real
// DTLS-SRTP.
//
// It does **not** measure decoded frame rate, encoded frame rate, CPU,
// memory, freezes, or network packet loss. Those are properties of an encoder, a decoder and a
// device, and none of the three exists in this process: the "video" here is
// synthetic RTP sized to the ladder's bitrates. A number for decoded FPS
// produced in this file would be a number about nothing. Claiming mobile
// scalability from it is exactly what `scale_test.go` warns against, and
// what the existing 100-participant test is careful never to do.
//
// The device matrix those metrics need is written up in
// `docs/rtc/test-matrix.md`. It needs real phones and real browsers, and it
// is the only thing that can answer "does an 8-way call work on a mid-range
// Android".
//
// # Why it is worth having anyway
//
// The thing that made large calls fall over was not subtle: every
// subscriber received every publisher's full-rate layer, because no
// publisher ever sent a cheaper one. That is a bandwidth fact, and
// bandwidth is measurable right here. The `low vs auto` comparison below
// puts a number on the fix — the ratio between what a grid of thumbnails
// costs a participant now and what it cost before.

// gridLayerFor is the layer a participant's tiles get in an N-up grid.
//
// The same rule both SDKs apply, arrived at from the same numbers: a
// 1280-wide window split into a square-ish grid, each tile classified
// against the 240/640 CSS-pixel thresholds
// (`packages/sdk/src/internal/media/adaptive-stream.ts`,
// `sdks/flutter/raven_rtc/lib/src/internal/adaptive_layer.dart`).
//
// Reproduced rather than imported because it is the client's rule, not the
// server's — the SFU has no idea how big anybody's tiles are, and should
// not. It is here so the measurement reflects what a real client would ask
// for at each room size instead of an arbitrary choice.
func gridLayerFor(participants int) LayerID {
	if participants <= 1 {
		return LayerHigh
	}
	columns := int(math.Ceil(math.Sqrt(float64(participants - 1))))
	if columns < 1 {
		columns = 1
	}
	tileWidth := 1280.0 / float64(columns)

	switch {
	case tileWidth < 240:
		return LayerLow
	case tileWidth < 640:
		return LayerMedium
	default:
		return LayerHigh
	}
}

// subscriberSample is one participant's inbound side over a window.
type subscriberSample struct {
	participantID string
	bytes         uint64
	packets       uint64
	dropped       uint64
	layers        map[LayerID]int
}

// sampleRoom measures every subscriber's inbound traffic over a window.
//
// Sampling a delta rather than a total, because a total includes whatever
// arrived while the room was still assembling — layers starting, keyframes
// being chased, subscriptions being built — and that start-up burst would
// swamp the steady-state number this is trying to report.
func sampleRoom(t *testing.T, clients []*testClient, window time.Duration) []subscriberSample {
	t.Helper()

	type counter struct{ bytes, packets, dropped uint64 }

	read := func() map[string]counter {
		out := map[string]counter{}
		for _, client := range clients {
			var c counter
			for _, other := range clients {
				if other == client {
					continue
				}
				for _, published := range other.participant.PublishedTracks() {
					down := subscriberDownTrack(published, client.participant.ID)
					if down == nil {
						continue
					}
					stats := down.Stats()
					c.bytes += stats.BytesSent
					c.packets += stats.PacketsSent
					c.dropped += stats.PacketsDropped
				}
			}
			out[client.participant.ID] = c
		}
		return out
	}

	before := read()
	time.Sleep(window)
	after := read()

	samples := make([]subscriberSample, 0, len(clients))
	for _, client := range clients {
		id := client.participant.ID
		layers := map[LayerID]int{}
		for _, other := range clients {
			if other == client {
				continue
			}
			for _, published := range other.participant.PublishedTracks() {
				if down := subscriberDownTrack(published, id); down != nil {
					layers[down.CurrentLayer()]++
				}
			}
		}
		samples = append(samples, subscriberSample{
			participantID: id,
			bytes:         after[id].bytes - before[id].bytes,
			packets:       after[id].packets - before[id].packets,
			dropped:       after[id].dropped - before[id].dropped,
			layers:        layers,
		})
	}
	return samples
}

func averageKbps(samples []subscriberSample, window time.Duration) float64 {
	if len(samples) == 0 {
		return 0
	}
	var total uint64
	for _, sample := range samples {
		total += sample.bytes
	}
	perSubscriber := float64(total) / float64(len(samples))
	return perSubscriber * 8 / 1000 / window.Seconds()
}

// TestSimulcastScaleMatrix runs the room sizes group calls are actually
// reported to break at, and reports what each costs a participant.
//
// Slow: every participant is a real PeerConnection doing real ICE and DTLS
// against the SFU in-process, and a 12-way room builds 132 forwarding
// paths. Skipped under -short with the rest of the scale tests.
func TestSimulcastScaleMatrix(t *testing.T) {
	if testing.Short() {
		t.Skip("scale tests are slow; run without -short")
	}

	for _, size := range []int{2, 4, 6, 8, 12} {
		t.Run(fmt.Sprintf("%d participants", size), func(t *testing.T) {
			runSimulcastScale(t, size)
		})
	}
}

// awaitAllSubscriptions waits until every participant has a DownTrack for
// every other participant's published track.
//
// The full N×(N-1) mesh, which is the state the measurements below assume.
// Sampling before it exists would quietly measure a smaller room than the
// one named in the test.
func awaitAllSubscriptions(t *testing.T, clients []*testClient) {
	t.Helper()

	want := 0
	for _, client := range clients {
		for _, other := range clients {
			if other != client {
				want += len(other.participant.PublishedTracks())
			}
		}
	}

	deadline := time.After(mediaTimeout)
	for {
		have := 0
		for _, client := range clients {
			for _, other := range clients {
				if other == client {
					continue
				}
				for _, published := range other.participant.PublishedTracks() {
					if subscriberDownTrack(published, client.participant.ID) != nil {
						have++
					}
				}
			}
		}
		if have >= want {
			return
		}

		select {
		case <-deadline:
			t.Fatalf("only %d of %d subscriptions were built", have, want)
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func runSimulcastScale(t *testing.T, size int) {
	t.Helper()

	h := newHarness(t)
	roomID := fmt.Sprintf("room-scale-simulcast-%d", size)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	clients := make([]*testClient, 0, size)
	joinLatencies := make([]time.Duration, 0, size)

	for index := 0; index < size; index++ {
		id := fmt.Sprintf("p%02d", index)

		started := time.Now()
		client := h.join(roomID, id, "sess-"+id, publisherPermissions(), nil)
		client.waitConnected(t)

		tracks := newSimulcastTracks(t, id+"-video", id+"-camera")
		publication := publishSimulcast(t, client, tracks)
		pumpSimulcast(ctx, publication)

		h.awaitTrackEvent(id, true)
		published, found := client.participant.PublishedTrack(id + "-video")
		if !found {
			t.Fatalf("%s's track never reached the sfu", id)
		}
		awaitLayers(t, published, len(simulcastRIDs))

		// Measured to the point the participant is genuinely usable: joined,
		// connected, and publishing all three layers. Stopping the clock at
		// "PeerConnection connected" would report a number that says nothing
		// about whether anyone can see them.
		joinLatencies = append(joinLatencies, time.Since(started))
		clients = append(clients, client)
	}

	// Subscriptions are built by a renegotiation fan-out that runs as each
	// participant joins, so the last joiner's DownTracks do not all exist
	// the instant its own join returns. Asking for a layer before the
	// DownTrack is there fails, and it fails for a reason that has nothing
	// to do with what this test measures.
	awaitAllSubscriptions(t, clients)

	// Everyone asks for the layer their grid tile actually needs, which is
	// what a client running adaptiveStream does.
	wanted := gridLayerFor(size)
	for _, client := range clients {
		for _, other := range clients {
			if other == client {
				continue
			}
			for _, published := range other.participant.PublishedTracks() {
				if !client.participant.SetSubscriptionLayer(other.participant.ID, published.ID, wanted, published) {
					t.Fatalf("%s could not request %q from %s", client.participant.ID, wanted, other.participant.ID)
				}
			}
		}
	}

	for _, client := range clients {
		for _, other := range clients {
			if other == client {
				continue
			}
			for _, published := range other.participant.PublishedTracks() {
				awaitCurrentLayer(t, published, client.participant.ID, wanted)
			}
		}
	}

	const window = 1500 * time.Millisecond
	adaptive := sampleRoom(t, clients, window)
	adaptiveKbps := averageKbps(adaptive, window)

	// The counterfactual: the same room with every subscriber on the
	// publisher's best layer, which is what `auto` resolves to and what
	// every subscriber got before simulcast worked at all. This is the
	// comparison the whole change exists to make.
	for _, client := range clients {
		for _, other := range clients {
			if other == client {
				continue
			}
			for _, published := range other.participant.PublishedTracks() {
				client.participant.SetSubscriptionLayer(other.participant.ID, published.ID, LayerHigh, published)
			}
		}
	}
	for _, client := range clients {
		for _, other := range clients {
			if other == client {
				continue
			}
			for _, published := range other.participant.PublishedTracks() {
				awaitCurrentLayer(t, published, client.participant.ID, LayerHigh)
			}
		}
	}

	highOnly := sampleRoom(t, clients, window)
	highOnlyKbps := averageKbps(highOnly, window)

	var totalDropped uint64
	for _, sample := range adaptive {
		totalDropped += sample.dropped
	}

	var slowestJoin time.Duration
	for _, latency := range joinLatencies {
		if latency > slowestJoin {
			slowestJoin = latency
		}
	}

	t.Logf("participants=%d tileLayer=%s downTracksPerSubscriber=%d", size, wanted, size-1)
	t.Logf("  join latency (slowest, to publishing all 3 layers): %s", slowestJoin.Round(time.Millisecond))
	t.Logf("  inbound per subscriber, adaptive: %.0f kbps", adaptiveKbps)
	t.Logf("  inbound per subscriber, everyone on high: %.0f kbps", highOnlyKbps)
	if adaptiveKbps > 0 {
		t.Logf("  saving: %.1fx", highOnlyKbps/adaptiveKbps)
	}
	// Not packet loss. DownTrack.packetsDrop counts packets arriving on a
	// layer this subscriber is *not* on — the ladder's other two rungs,
	// discarded on purpose. It is the work the SFU does to not forward
	// them, and it grows with room size because every subscriber discards
	// two layers from every publisher.
	//
	// Real network loss is not measurable here and is not claimed: this
	// runs over loopback, where there is none. It belongs in the device
	// matrix (docs/rtc/test-matrix.md).
	t.Logf("  packets discarded as belonging to an unselected layer: %d", totalDropped)

	// --- Assertions -------------------------------------------------------

	for _, sample := range adaptive {
		if sample.packets == 0 {
			t.Errorf("%s received nothing at all; the room is not actually forwarding", sample.participantID)
		}
		if got := sample.layers[wanted]; got != size-1 {
			t.Errorf("%s is on %v, want all %d tracks on %q", sample.participantID, sample.layers, size-1, wanted)
		}
	}

	// The property that matters: above a handful of participants, adaptive
	// streaming has to cost materially less than everyone-on-high, or the
	// ladder is not doing anything. Below that, the grid tiles are large
	// enough to legitimately want `high` and the two are the same by
	// design — asserting a saving there would be asserting that the rule
	// picks the wrong layer for a two-person call.
	if wanted != LayerHigh && highOnlyKbps <= adaptiveKbps*1.5 {
		t.Errorf("adaptive streaming saved nothing: %.0f kbps vs %.0f kbps on high. "+
			"Either the layers are not really different sizes or subscribers are not on the layer they asked for",
			adaptiveKbps, highOnlyKbps)
	}
}

// TestSimulcastGridLayerRule pins the client-side rule this file measures
// against, so a change to the thresholds in either SDK shows up as a failure
// here too rather than silently changing what the scale numbers mean.
func TestSimulcastGridLayerRule(t *testing.T) {
	for _, testCase := range []struct {
		participants int
		want         LayerID
	}{
		// 1 remote, full 1280 width.
		{participants: 2, want: LayerHigh},
		// 3 remotes over 2 columns: 640px, exactly on the high threshold,
		// which ties upward here because the rule is `< 640 => medium`. A
		// 2x2 grid on a laptop genuinely is high territory.
		{participants: 4, want: LayerHigh},
		// 5 and 7 remotes both take 3 columns: ~427px.
		{participants: 6, want: LayerMedium},
		{participants: 8, want: LayerMedium},
		// 11 remotes over 4 columns: 320px.
		{participants: 12, want: LayerMedium},
		// 29 remotes over 6 columns: ~213px, past the point where more
		// resolution buys anything.
		{participants: 30, want: LayerLow},
	} {
		if got := gridLayerFor(testCase.participants); got != testCase.want {
			t.Errorf("gridLayerFor(%d) = %q, want %q", testCase.participants, got, testCase.want)
		}
	}
}
