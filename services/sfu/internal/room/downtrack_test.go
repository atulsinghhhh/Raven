package room

import (
	"testing"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

func newTestDownTrack(t *testing.T, mimeType string) *DownTrack {
	t.Helper()
	local, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: mimeType},
		"track-1", "stream-1",
	)
	if err != nil {
		t.Fatalf("create local track: %v", err)
	}
	return newDownTrack("sub-1", local, nil, mimeType, webrtc.RTPCodecTypeVideo, LayerNone)
}

func vp8Packet(seq uint16, timestamp uint32, keyframe bool) *rtp.Packet {
	frameHeader := byte(0x01) // interframe
	if keyframe {
		frameHeader = 0x00
	}
	return &rtp.Packet{
		Header:  rtp.Header{SequenceNumber: seq, Timestamp: timestamp, SSRC: 1234},
		Payload: []byte{0x10, frameHeader, 0x00, 0x00},
	}
}

func TestLayerFromRID(t *testing.T) {
	// Browsers do not agree on RID naming — Chrome sends f/h/q, other
	// stacks send words. The SDK's public layer names must not change
	// shape because of which browser is publishing.
	cases := map[string]LayerID{
		"":       LayerNone,
		"q":      LayerLow,
		"low":    LayerLow,
		"l":      LayerLow,
		"h":      LayerMedium,
		"medium": LayerMedium,
		"m":      LayerMedium,
		"f":      LayerHigh,
		"high":   LayerHigh,
	}
	for rid, want := range cases {
		if got := layerFromRID(rid); got != want {
			t.Errorf("layerFromRID(%q) = %q, want %q", rid, got, want)
		}
	}

	// An unrecognised RID still carries real media; treating it as the
	// lowest layer means the subscriber gets something.
	if got := layerFromRID("bizarre"); got != LayerLow {
		t.Errorf("unknown RID = %q, want %q", got, LayerLow)
	}
}

func TestResolveLayer(t *testing.T) {
	all := []LayerID{LayerLow, LayerMedium, LayerHigh}

	t.Run("auto picks the highest available", func(t *testing.T) {
		// The right default for a desktop subscriber; congestion control
		// corrects downward, rather than starting low and never recovering.
		if got := resolveLayer(LayerAuto, all); got != LayerHigh {
			t.Errorf("got %q, want %q", got, LayerHigh)
		}
	})

	t.Run("auto respects a reduced layer set", func(t *testing.T) {
		if got := resolveLayer(LayerAuto, []LayerID{LayerLow, LayerMedium}); got != LayerMedium {
			t.Errorf("got %q, want %q", got, LayerMedium)
		}
	})

	t.Run("an available layer is honoured exactly", func(t *testing.T) {
		if got := resolveLayer(LayerLow, all); got != LayerLow {
			t.Errorf("got %q, want %q", got, LayerLow)
		}
	})

	t.Run("falls back below an unavailable request", func(t *testing.T) {
		// Asking for high from a publisher sending only low/medium should
		// yield medium, not silence.
		if got := resolveLayer(LayerHigh, []LayerID{LayerLow, LayerMedium}); got != LayerMedium {
			t.Errorf("got %q, want %q", got, LayerMedium)
		}
	})

	t.Run("falls back upward when nothing lower exists", func(t *testing.T) {
		if got := resolveLayer(LayerLow, []LayerID{LayerHigh}); got != LayerHigh {
			t.Errorf("got %q, want %q", got, LayerHigh)
		}
	})

	t.Run("no layers means nothing to forward", func(t *testing.T) {
		if got := resolveLayer(LayerAuto, nil); got != LayerNone {
			t.Errorf("got %q, want %q", got, LayerNone)
		}
	})
}

func TestDownTrackDropsPacketsFromOtherLayers(t *testing.T) {
	down := newTestDownTrack(t, "video/VP8")
	down.RequestLayer(LayerLow, []LayerID{LayerLow, LayerHigh})

	// A packet from the layer this subscriber is not on must not be
	// forwarded — that is the whole point of selective forwarding.
	needsKeyframe, err := down.WriteRTP(vp8Packet(1, 1000, false), LayerHigh)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if needsKeyframe {
		t.Error("no switch was requested, so no keyframe should be needed")
	}
	if sent := down.Stats().PacketsSent; sent != 0 {
		t.Errorf("packets sent = %d, want 0", sent)
	}
	if dropped := down.Stats().PacketsDropped; dropped != 1 {
		t.Errorf("packets dropped = %d, want 1", dropped)
	}
}

func TestDownTrackWaitsForKeyframeBeforeSwitching(t *testing.T) {
	down := newTestDownTrack(t, "video/VP8")
	available := []LayerID{LayerLow, LayerHigh}
	down.RequestLayer(LayerLow, available)

	// Establish the low layer as current.
	if _, err := down.WriteRTP(vp8Packet(1, 1000, true), LayerLow); err != nil {
		t.Fatalf("write on current layer: %v", err)
	}
	if down.CurrentLayer() != LayerLow {
		t.Fatalf("current layer = %q, want %q", down.CurrentLayer(), LayerLow)
	}

	down.RequestLayer(LayerHigh, available)

	// An interframe on the target layer must not commit the switch —
	// handing the decoder a picture that references frames it never got is
	// what produces seconds of green smear.
	needsKeyframe, err := down.WriteRTP(vp8Packet(500, 90000, false), LayerHigh)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !needsKeyframe {
		t.Error("expected a keyframe request while waiting to switch")
	}
	if down.CurrentLayer() != LayerLow {
		t.Errorf("switched on an interframe; current layer = %q", down.CurrentLayer())
	}

	// A keyframe commits it.
	if _, err := down.WriteRTP(vp8Packet(501, 93000, true), LayerHigh); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if down.CurrentLayer() != LayerHigh {
		t.Errorf("current layer = %q, want %q after keyframe", down.CurrentLayer(), LayerHigh)
	}
}

func TestDownTrackRewritesSequenceContinuouslyAcrossLayerSwitch(t *testing.T) {
	// Each simulcast layer has its own sequence space. Forwarding raw
	// numbers across a switch looks to the subscriber's jitter buffer like
	// tens of thousands of lost packets, which is worse than the switch
	// was ever going to be.
	down := newTestDownTrack(t, "video/VP8")
	available := []LayerID{LayerLow, LayerHigh}
	down.RequestLayer(LayerLow, available)

	for seq := uint16(100); seq < 105; seq++ {
		if _, err := down.WriteRTP(vp8Packet(seq, uint32(seq)*3000, seq == 100), LayerLow); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	down.mu.Lock()
	seqBeforeSwitch := down.outboundSeq
	timestampBeforeSwitch := down.lastTimestamp
	down.mu.Unlock()

	down.RequestLayer(LayerHigh, available)

	// The high layer's numbers are wildly different from the low layer's.
	if _, err := down.WriteRTP(vp8Packet(51000, 7_000_000, true), LayerHigh); err != nil {
		t.Fatalf("write keyframe: %v", err)
	}

	down.mu.Lock()
	seqAfterSwitch := down.outboundSeq
	timestampAfterSwitch := down.lastTimestamp
	down.mu.Unlock()

	if seqAfterSwitch != seqBeforeSwitch+1 {
		t.Errorf("outbound sequence jumped: %d → %d, want +1", seqBeforeSwitch, seqAfterSwitch)
	}
	if timestampAfterSwitch != timestampBeforeSwitch+1 {
		t.Errorf("outbound timestamp jumped: %d → %d, want +1", timestampBeforeSwitch, timestampAfterSwitch)
	}

	// And it stays continuous afterwards.
	if _, err := down.WriteRTP(vp8Packet(51001, 7_003_000, false), LayerHigh); err != nil {
		t.Fatalf("write: %v", err)
	}
	down.mu.Lock()
	next := down.outboundSeq
	down.mu.Unlock()
	if next != seqAfterSwitch+1 {
		t.Errorf("sequence not continuous after switch: %d → %d", seqAfterSwitch, next)
	}
}

func TestDownTrackDoesNotMutateTheSharedPacket(t *testing.T) {
	// One packet is forwarded to every subscriber of a layer. Rewriting it
	// in place would corrupt whatever writes after us — a bug that only
	// shows up with more than one subscriber, which is every real call.
	down := newTestDownTrack(t, "video/VP8")
	down.RequestLayer(LayerLow, []LayerID{LayerLow})

	packet := vp8Packet(7, 12345, true)
	// Force a non-zero offset so a mutation would be visible.
	down.mu.Lock()
	down.started = true
	down.seqOffset = 1000
	down.timestampOffset = 500
	down.currentLayer = LayerLow
	down.mu.Unlock()

	if _, err := down.WriteRTP(packet, LayerLow); err != nil {
		t.Fatalf("write: %v", err)
	}

	if packet.SequenceNumber != 7 {
		t.Errorf("shared packet sequence was mutated to %d", packet.SequenceNumber)
	}
	if packet.Timestamp != 12345 {
		t.Errorf("shared packet timestamp was mutated to %d", packet.Timestamp)
	}
}

func TestDownTrackMuteStopsForwardingWithoutTeardown(t *testing.T) {
	down := newTestDownTrack(t, "video/VP8")
	down.RequestLayer(LayerLow, []LayerID{LayerLow})
	if _, err := down.WriteRTP(vp8Packet(1, 1000, true), LayerLow); err != nil {
		t.Fatalf("write: %v", err)
	}

	down.SetMuted(true)
	if _, err := down.WriteRTP(vp8Packet(2, 4000, false), LayerLow); err != nil {
		t.Fatalf("write while muted: %v", err)
	}
	if sent := down.Stats().PacketsSent; sent != 1 {
		t.Errorf("packets sent = %d, want 1 (muted packet should be dropped)", sent)
	}

	// Unmuting resumes immediately — no renegotiation, because the
	// transceiver never went away.
	down.SetMuted(false)
	if _, err := down.WriteRTP(vp8Packet(3, 7000, false), LayerLow); err != nil {
		t.Fatalf("write after unmute: %v", err)
	}
	if sent := down.Stats().PacketsSent; sent != 2 {
		t.Errorf("packets sent = %d, want 2 after unmute", sent)
	}
}

func TestDownTrackClosedStopsForwarding(t *testing.T) {
	down := newTestDownTrack(t, "video/VP8")
	down.RequestLayer(LayerLow, []LayerID{LayerLow})
	down.Close()

	if _, err := down.WriteRTP(vp8Packet(1, 1000, true), LayerLow); err != nil {
		t.Fatalf("write after close should be a no-op, got %v", err)
	}
	if sent := down.Stats().PacketsSent; sent != 0 {
		t.Errorf("packets sent = %d after close, want 0", sent)
	}
}

func TestDownTrackReportsRequestedAndActualLayerSeparately(t *testing.T) {
	// A UI showing a quality badge must be able to tell "you asked for
	// high" from "you are receiving medium" — conflating them is how a
	// quality indicator ends up lying.
	down := newTestDownTrack(t, "video/VP8")
	down.RequestLayer(LayerHigh, []LayerID{LayerLow, LayerMedium})

	if got := down.RequestedLayer(); got != LayerHigh {
		t.Errorf("requested layer = %q, want %q", got, LayerHigh)
	}

	if _, err := down.WriteRTP(vp8Packet(1, 1000, true), LayerMedium); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := down.CurrentLayer(); got != LayerMedium {
		t.Errorf("current layer = %q, want %q", got, LayerMedium)
	}
}
