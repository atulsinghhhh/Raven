package room

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

// End-to-end simulcast: a real Pion publisher sending three RID-tagged RTP
// streams over DTLS-SRTP, through a real Manager, to real subscribers that
// each pick their own layer.
//
// # Why this file exists
//
// Both client SDKs shipped for months believing they published simulcast.
// They did not: each called `addTrack()` and then tried to bolt three
// encodings on with `setParameters()`, which the WebRTC spec requires
// implementations to reject — the encoding *count* is fixed once a sender
// exists, and RIDs only reach the SDP through `addTransceiver`'s
// `sendEncodings`. Both swallowed the resulting error, so every publisher
// sent exactly one full-rate layer and every subscriber received it,
// whatever size it was being rendered at.
//
// Nothing caught it. The SFU's own tests all publish with `AddTrack` and a
// bare `TrackLocalStaticRTP`, which produces no RID at all, so they
// exercised `layerFromRID("") == LayerNone` — the non-simulcast path —
// exclusively. The layer-selection code below `RequestLayer` was tested
// only against hand-built DownTracks in `downtrack_test.go`, never against
// RTP that had actually crossed a transport.
//
// So these tests deliberately start one level further out than the rest of
// the package: at a publisher that negotiates simulcast the way a fixed
// client does, offering its own m-section with `a=simulcast:send` and three
// `a=rid:` lines. That is the part no unit test can fake, and it is the part
// that was broken.
//
// What they prove: the SFU parses the RIDs, maps them onto low/medium/high,
// starts a forwarding layer for each, and hands each subscriber the layer
// that subscriber asked for — independently, at the same time, off one
// publisher.
//
// What they do not prove: anything about encoders, decoders, real bitrates,
// or a phone's concurrent-codec budget. The payloads here are four-byte
// synthetic VP8 keyframes. See scale_simulcast_test.go for the measured
// subset, and docs/rtc/test-matrix.md for what still needs real devices.

// simulcastRIDs is the ladder both SDKs publish, in ascending quality.
var simulcastRIDs = []string{"low", "medium", "high"}

// newSimulcastTracks builds one TrackLocalStaticRTP per RID, all sharing a
// track id and stream id.
//
// Sharing the id is what makes them one publication rather than three: the
// SFU keys PublishedTrack on TrackRemote.ID(), and every layer of a
// simulcast track reports the same one. The RID is the only thing that
// tells them apart, which is exactly why losing it collapses simulcast into
// a single layer without any error anywhere.
func newSimulcastTracks(t *testing.T, id, streamID string) []*webrtc.TrackLocalStaticRTP {
	t.Helper()

	tracks := make([]*webrtc.TrackLocalStaticRTP, 0, len(simulcastRIDs))
	for _, rid := range simulcastRIDs {
		track, err := webrtc.NewTrackLocalStaticRTP(
			webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
			id, streamID,
			webrtc.WithRTPStreamID(rid),
		)
		if err != nil {
			t.Fatalf("create %s layer: %v", rid, err)
		}
		tracks = append(tracks, track)
	}
	return tracks
}

// publishSimulcast negotiates a simulcast send from the client side.
//
// This mirrors what the fixed SDKs do, and it matters that it is the client
// offering. A browser will not send simulcast as the *answerer*: the
// encodings have to exist on the transceiver before the SDP is generated,
// and only the peer that creates the transceiver can put them there. The
// SFU pre-creates a recvonly video transceiver (manager.go) so an ordinary
// first publish costs no renegotiation, but that transceiver can never
// carry simulcast for the same reason — hence a client-initiated offer that
// adds an m-section, which Participant.AcceptOffer handles.
func publishSimulcast(t *testing.T, client *testClient, tracks []*webrtc.TrackLocalStaticRTP) *simulcastPublication {
	t.Helper()

	transceiver, err := client.pc.AddTransceiverFromTrack(tracks[0], webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendonly,
	})
	if err != nil {
		t.Fatalf("add simulcast transceiver: %v", err)
	}
	for _, track := range tracks[1:] {
		if err := transceiver.Sender().AddEncoding(track); err != nil {
			t.Fatalf("add %s encoding: %v", track.RID(), err)
		}
	}

	offer, err := client.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("client create offer: %v", err)
	}
	if err := client.pc.SetLocalDescription(offer); err != nil {
		t.Fatalf("client set local description: %v", err)
	}

	local := client.pc.LocalDescription()
	assertSimulcastSDP(t, local.SDP)

	answer, err := client.participant.AcceptOffer(local.SDP)
	if err != nil {
		t.Fatalf("sfu refused the simulcast offer: %v", err)
	}
	assertSimulcastAnswer(t, answer.SDP)

	if err := client.pc.SetRemoteDescription(*answer); err != nil {
		t.Fatalf("client set remote answer: %v", err)
	}

	publication := &simulcastPublication{
		tracks: tracks,
		mid:    transceiver.Mid(),
	}
	for _, extension := range transceiver.Sender().GetParameters().HeaderExtensions {
		switch extension.URI {
		case sdp.SDESMidURI:
			publication.midExtensionID = extension.ID
		case sdp.SDESRTPStreamIDURI:
			publication.ridExtensionID = extension.ID
		}
	}
	if publication.midExtensionID == 0 || publication.ridExtensionID == 0 {
		t.Fatalf("mid/rid header extensions were not negotiated (mid=%d rid=%d); "+
			"without them the receiver cannot tell one layer from another",
			publication.midExtensionID, publication.ridExtensionID)
	}
	if publication.mid == "" {
		t.Fatal("transceiver has no mid after negotiation")
	}
	return publication
}

// simulcastPublication is everything needed to put RID-tagged RTP on the
// wire: the per-layer tracks, the m-section's mid, and the header-extension
// ids the two peers agreed on.
//
// The ids have to be read back from the negotiated parameters rather than
// assumed. They are assigned during negotiation and nothing guarantees the
// numbering — hard-coding 1 and 2 would pass here and break the moment
// another extension is registered ahead of them.
type simulcastPublication struct {
	tracks         []*webrtc.TrackLocalStaticRTP
	mid            string
	midExtensionID int
	ridExtensionID int
}

// assertSimulcastSDP fails unless the offer genuinely negotiates simulcast.
//
// An encodings array living in process memory proves nothing — that is
// precisely the state both SDKs were in while publishing one layer. The
// SDP is the only place the claim is falsifiable, because it is the only
// part the far side ever sees.
func assertSimulcastSDP(t *testing.T, sdp string) {
	t.Helper()

	if !containsLinePrefix(sdp, "a=simulcast:send ") {
		t.Fatalf("offer has no a=simulcast:send attribute; simulcast was not negotiated.\nSDP:\n%s", sdp)
	}
	for _, rid := range simulcastRIDs {
		if !containsLinePrefix(sdp, fmt.Sprintf("a=rid:%s send", rid)) {
			t.Fatalf("offer declares no %q send layer.\nSDP:\n%s", rid, sdp)
		}
	}
}

// assertSimulcastAnswer fails unless the SFU agreed to receive every layer.
//
// An answer that dropped down to a single rid would still carry media, and
// the call would look fine — one layer, exactly the state this whole change
// exists to get out of. The agreement is only real if both halves name all
// three.
func assertSimulcastAnswer(t *testing.T, sdp string) {
	t.Helper()

	if !containsLinePrefix(sdp, "a=simulcast:recv ") {
		t.Fatalf("sfu answered without a=simulcast:recv; it is not accepting simulcast.\nSDP:\n%s", sdp)
	}
	for _, rid := range simulcastRIDs {
		if !containsLinePrefix(sdp, fmt.Sprintf("a=rid:%s recv", rid)) {
			t.Fatalf("sfu answer does not accept the %q layer.\nSDP:\n%s", rid, sdp)
		}
	}
}

func containsLinePrefix(sdp, prefix string) bool {
	for _, line := range splitSDPLines(sdp) {
		if len(line) >= len(prefix) && line[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}

func splitSDPLines(sdp string) []string {
	lines := make([]string, 0, 64)
	start := 0
	for i := 0; i < len(sdp); i++ {
		if sdp[i] == '\n' {
			line := sdp[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(sdp) {
		lines = append(lines, sdp[start:])
	}
	return lines
}

// layerProfile is what one simulcast layer puts on the wire.
//
// Sized to the ladder both SDKs publish (150k/500k/1500k bits per second),
// so a measurement of forwarded bytes means something: payload × rate comes
// out at the target bitrate for each rung. 375B every 20ms is 150 kbps;
// 625B every 10ms is 500 kbps; 1125B every 6ms is 1.5 Mbps. All three stay
// under a normal MTU, so nothing fragments and the numbers are not an
// artefact of IP-layer splitting.
//
// It is still synthetic. A real encoder's output varies per frame, spikes
// on keyframes, and responds to congestion. What this reproduces faithfully
// is the *ratio* between layers, which is the thing a subscriber's choice
// of layer actually trades on.
type layerProfile struct {
	payloadBytes int
	interval     time.Duration
}

var simulcastProfiles = map[string]layerProfile{
	"low":    {payloadBytes: 375, interval: 20 * time.Millisecond},
	"medium": {payloadBytes: 625, interval: 10 * time.Millisecond},
	"high":   {payloadBytes: 1125, interval: 6 * time.Millisecond},
}

// pumpSimulcast writes keyframe-flagged VP8 packets on every layer.
//
// Each packet carries the MID and RID header extensions, because that is
// the only thing on the wire that says which layer it belongs to. Pion's
// TrackLocalStaticRTP.WriteRTP does not add them — it writes the header it
// is handed — so a test that skipped this would watch the receiver reject
// every SSRC with "failed Simulcast probing" and look exactly like an SFU
// that cannot do simulcast at all.
//
// Each layer gets its own SSRC and its own sequence/timestamp space, as a
// real encoder produces. Every packet is a keyframe so a layer switch
// completes on the next packet rather than waiting on a PLI round trip —
// the switch logic is what these tests are about, not keyframe cadence.
func pumpSimulcast(ctx context.Context, publication *simulcastPublication) {
	for index, track := range publication.tracks {
		profile, found := simulcastProfiles[track.RID()]
		if !found {
			profile = layerProfile{payloadBytes: 64, interval: 10 * time.Millisecond}
		}

		go func(index int, track *webrtc.TrackLocalStaticRTP, profile layerProfile) {
			ticker := time.NewTicker(profile.interval)
			defer ticker.Stop()

			// VP8 payload descriptor: start of partition 0, frame header
			// bit 0 clear. isVP8Keyframe (keyframe.go) reads exactly these
			// first bytes; the rest is ballast to reach the layer's size.
			payload := make([]byte, profile.payloadBytes)
			payload[0] = 0x10

			var sequence uint16
			var timestamp uint32
			ssrc := uint32(0xCAFE0000 + index)
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					sequence++
					timestamp += 3000

					packet := &rtp.Packet{
						Header: rtp.Header{
							Version:        2,
							SequenceNumber: sequence,
							Timestamp:      timestamp,
							SSRC:           ssrc,
						},
						Payload: payload,
					}
					_ = packet.Header.SetExtension(uint8(publication.midExtensionID), []byte(publication.mid))
					_ = packet.Header.SetExtension(uint8(publication.ridExtensionID), []byte(track.RID()))

					_ = track.WriteRTP(packet)
				}
			}
		}(index, track, profile)
	}
}

// awaitLayers waits until the publisher is sending every expected layer.
//
// Layers start independently — each is a separate RTP stream that Pion
// surfaces as its own OnTrack — so "the track exists" and "all three layers
// exist" are different moments, and asserting on the first is how a
// two-layer regression would slip through.
func awaitLayers(t *testing.T, track *PublishedTrack, want int) []LayerID {
	t.Helper()

	deadline := time.After(mediaTimeout)
	for {
		if layers := track.AvailableLayers(); len(layers) >= want {
			return layers
		}
		select {
		case <-deadline:
			t.Fatalf("only %v layers arrived, want %d", track.AvailableLayers(), want)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// subscriberDownTrack reaches for one subscriber's copy of a track.
//
// Test-local rather than a method on PublishedTrack: nothing in production
// needs to look a DownTrack up by subscriber, and widening the type's API
// for a test's convenience is how internals end up load-bearing.
func subscriberDownTrack(track *PublishedTrack, subscriberID string) *DownTrack {
	track.mu.RLock()
	defer track.mu.RUnlock()
	return track.downTracks[subscriberID]
}

// awaitCurrentLayer waits for a subscriber's DownTrack to actually be
// forwarding the layer it asked for.
//
// RequestLayer sets a *target*; the switch completes in WriteRTP when a
// keyframe arrives on that layer. Asserting on RequestedLayer instead would
// pass even if no packet ever moved, which is the same class of mistake as
// believing an encodings array proves simulcast.
func awaitCurrentLayer(t *testing.T, track *PublishedTrack, subscriberID string, want LayerID) {
	t.Helper()

	deadline := time.After(mediaTimeout)
	var last LayerID
	for {
		down := subscriberDownTrack(track, subscriberID)
		if down == nil {
			t.Fatalf("%s has no down track for %s", subscriberID, track.ID)
		}
		last = down.CurrentLayer()
		if last == want {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("%s is forwarding %q, want %q", subscriberID, last, want)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// TestSFUReceivesEverySimulcastRID is the base case: three RIDs in, three
// mapped layers out.
//
// This is the test that would have caught the SDK bug from the server side.
// With the broken `addTrack` + `setParameters` publisher, exactly one layer
// arrives and AvailableLayers reports [""] (LayerNone).
func TestSFUReceivesEverySimulcastRID(t *testing.T) {
	h := newHarness(t)

	publisher := h.join("room-simulcast", "alice", "sess-alice", publisherPermissions(), nil)
	publisher.waitConnected(t)

	tracks := newSimulcastTracks(t, "alice-video", "alice-camera")
	publication := publishSimulcast(t, publisher, tracks)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pumpSimulcast(ctx, publication)

	h.awaitTrackEvent("alice", true)
	published, found := publisher.participant.PublishedTrack("alice-video")
	if !found {
		t.Fatal("the simulcast track never reached the sfu")
	}

	layers := awaitLayers(t, published, len(simulcastRIDs))

	seen := map[LayerID]bool{}
	for _, layer := range layers {
		seen[layer] = true
	}
	for _, want := range []LayerID{LayerLow, LayerMedium, LayerHigh} {
		if !seen[want] {
			t.Errorf("layer %q missing; sfu mapped the rids to %v", want, layers)
		}
	}

	if !published.IsSimulcast() {
		t.Error("IsSimulcast() is false on a track carrying three rids")
	}
}

// TestSubscribersSelectLayersIndependently is the property the whole
// per-subscriber DownTrack design exists for: one publisher, three
// subscribers, three different layers, all at once.
//
// Sharing one output across subscribers would force them onto the same
// layer, which is the thing simulcast is for — the phone on 4G and the
// desktop at full screen should not be handed the same bitrate.
func TestSubscribersSelectLayersIndependently(t *testing.T) {
	h := newHarness(t)

	publisher := h.join("room-layers", "alice", "sess-alice", publisherPermissions(), nil)
	publisher.waitConnected(t)

	tracks := newSimulcastTracks(t, "alice-video", "alice-camera")
	publication := publishSimulcast(t, publisher, tracks)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pumpSimulcast(ctx, publication)

	h.awaitTrackEvent("alice", true)
	published, found := publisher.participant.PublishedTrack("alice-video")
	if !found {
		t.Fatal("the simulcast track never reached the sfu")
	}
	awaitLayers(t, published, len(simulcastRIDs))

	watchers := []struct {
		id    string
		layer LayerID
	}{
		{"bob", LayerLow},
		{"carol", LayerMedium},
		{"dave", LayerHigh},
	}

	for _, watcher := range watchers {
		client := h.join("room-layers", watcher.id, "sess-"+watcher.id, publisherPermissions(), nil)
		client.waitConnected(t)

		if !client.participant.SetSubscriptionLayer("alice", "alice-video", watcher.layer, published) {
			t.Fatalf("%s could not request %q", watcher.id, watcher.layer)
		}
	}

	// Asserted only after every request is in, so a subscriber settling on
	// its layer and then being disturbed by the next one's request would
	// still fail here.
	for _, watcher := range watchers {
		awaitCurrentLayer(t, published, watcher.id, watcher.layer)
	}

	for _, watcher := range watchers {
		down := subscriberDownTrack(published, watcher.id)
		if got := down.CurrentLayer(); got != watcher.layer {
			t.Errorf("%s ended on %q, want %q — a later request disturbed an earlier one",
				watcher.id, got, watcher.layer)
		}
	}
}

// TestSubscriberSwitchesBetweenLayers walks one subscriber up and down the
// ladder, which is what adaptiveStream does as a tile is resized.
//
// Both directions on purpose. Climbing back up is the half that breaks when
// a downgrade is recorded as the new ceiling rather than as the current
// state — the subscriber gets stuck on `low` for the rest of the call and
// nothing reports it.
func TestSubscriberSwitchesBetweenLayers(t *testing.T) {
	h := newHarness(t)

	publisher := h.join("room-switch", "alice", "sess-alice", publisherPermissions(), nil)
	publisher.waitConnected(t)

	tracks := newSimulcastTracks(t, "alice-video", "alice-camera")
	publication := publishSimulcast(t, publisher, tracks)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pumpSimulcast(ctx, publication)

	h.awaitTrackEvent("alice", true)
	published, found := publisher.participant.PublishedTrack("alice-video")
	if !found {
		t.Fatal("the simulcast track never reached the sfu")
	}
	awaitLayers(t, published, len(simulcastRIDs))

	bob := h.join("room-switch", "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)

	// auto resolves to the best layer available, so a fresh subscription
	// starts at high.
	awaitCurrentLayer(t, published, "bob", LayerHigh)

	for _, want := range []LayerID{LayerLow, LayerMedium, LayerHigh, LayerLow} {
		if !bob.participant.SetSubscriptionLayer("alice", "alice-video", want, published) {
			t.Fatalf("bob could not request %q", want)
		}
		awaitCurrentLayer(t, published, "bob", want)
	}
}

// TestNonSimulcastPublisherStillForwards guards the fallback.
//
// A publisher whose platform refuses the three-layer configuration sends
// one un-RIDed stream, and that has to keep working untouched: the fixed
// SDKs fall back to exactly this when `addTransceiver` rejects the
// encodings. LayerNone is a real layer, deliberately distinct from
// LayerAuto — "there is nothing to choose between" is not "choose for me".
func TestNonSimulcastPublisherStillForwards(t *testing.T) {
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-single", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	published, found := alice.participant.PublishedTrack("alice-video")
	if !found {
		t.Fatal("the track never reached the sfu")
	}
	awaitLayers(t, published, 1)

	if published.IsSimulcast() {
		t.Error("IsSimulcast() is true for a publisher sending one un-ridded stream")
	}
	if layers := published.AvailableLayers(); len(layers) != 1 || layers[0] != LayerNone {
		t.Errorf("AvailableLayers() = %v, want [%q]", layers, LayerNone)
	}

	bob := h.join("room-single", "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)

	// Asking for a layer this publisher does not send must not silence it.
	bob.participant.SetSubscriptionLayer("alice", "alice-video", LayerLow, published)
	awaitCurrentLayer(t, published, "bob", LayerNone)
}
