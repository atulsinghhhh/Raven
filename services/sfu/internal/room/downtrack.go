package room

import (
	"sync"
	"sync/atomic"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// LayerID names a simulcast spatial layer.
//
// Livqeno's own vocabulary, not whatever RIDs a browser feels like sending.
// Chrome says "f"/"h"/"q", other stacks say "high"/"low", and the SDK's
// public API shouldn't change shape because a browser did. layerFromRID
// handles the translation.
type LayerID string

const (
	LayerLow    LayerID = "low"
	LayerMedium LayerID = "medium"
	LayerHigh   LayerID = "high"
	// LayerAuto lets the SFU choose, and is the default. What a subscriber
	// usually wants is "the best layer my connection can carry", not some
	// specific one.
	LayerAuto LayerID = "auto"
	// LayerNone is a non-simulcast track's one and only layer. Kept apart
	// from LayerAuto so "there's nothing to choose between" and "choose for
	// me" don't collapse into the same state.
	LayerNone LayerID = ""
)

// layerFromRID maps a publisher's RID onto Livqeno's layer names.
//
// An empty RID means no simulcast at all. That's the common case for audio,
// and for video from a client that turned it off.
func layerFromRID(rid string) LayerID {
	switch rid {
	case "":
		return LayerNone
	case "q", "low", "l":
		return LayerLow
	case "h", "medium", "m":
		return LayerMedium
	case "f", "high":
		return LayerHigh
	default:
		// An RID we don't recognise is still a real layer carrying real
		// media. Call it the lowest and a subscriber gets *something* while
		// somebody gets round to fixing the mapping.
		return LayerLow
	}
}

// layerRank orders layers for "pick the best one available".
func layerRank(layer LayerID) int {
	switch layer {
	case LayerHigh:
		return 3
	case LayerMedium:
		return 2
	case LayerLow:
		return 1
	default:
		return 0
	}
}

// DownTrack is one subscriber's copy of one published track.
//
// # Why one per subscriber, not one shared output
//
// Share a single output track across subscribers and you can't give them
// different simulcast layers, which is the entire reason simulcast exists.
// Someone on a phone over 4G and someone on a desktop staring at a
// full-screen tile should not be getting the same bitrate. So every
// subscriber gets its own DownTrack, its own layer choice, its own
// sequence-number space. The price is writing every packet once per
// subscriber, and that's just what selective forwarding costs.
//
// # Sequence rewriting
//
// Every simulcast layer is a separate RTP stream with its own sequence
// numbers and timestamps, so switching layers hands the subscriber a
// discontinuity their jitter buffer reads as catastrophic packet loss.
// DownTrack keeps a monotonic sequence counter and a timestamp offset of
// its own. As far as the subscriber can tell they're receiving one
// continuous stream that occasionally changes resolution at a keyframe.
type DownTrack struct {
	// SubscriberID is the participant receiving this copy.
	SubscriberID string
	// local is what the subscriber's PeerConnection is actually sending.
	local  *webrtc.TrackLocalStaticRTP
	sender *webrtc.RTPSender

	mimeType string
	kind     webrtc.RTPCodecType

	mu sync.Mutex
	// currentLayer is the layer being forwarded right now.
	currentLayer LayerID
	// targetLayer is where we want to be. The two differ while we're
	// waiting on a keyframe from the target.
	targetLayer LayerID
	// requestedLayer is what the subscriber asked for, which may well be
	// more than their connection can carry. Kept separately so we know what
	// to climb back to when conditions improve, instead of being stuck at
	// whatever congestion control last let us have.
	requestedLayer LayerID

	// Sequence/timestamp rewriting state.
	started         bool
	outboundSeq     uint16
	inboundSeqBase  uint16
	seqOffset       uint16
	timestampOffset uint32
	lastTimestamp   uint32
	// switching: true from asking for a layer until its keyframe shows up.
	switching bool

	// muted drops packets without tearing anything down, so un-muting
	// doesn't cost a renegotiation.
	muted atomic.Bool

	// Telemetry counters. Atomic, not mutex-guarded: stats collection must
	// never contend with the forwarding path.
	packetsSent atomic.Uint64
	bytesSent   atomic.Uint64
	packetsDrop atomic.Uint64

	closed atomic.Bool
}

func newDownTrack(subscriberID string, local *webrtc.TrackLocalStaticRTP, sender *webrtc.RTPSender, mimeType string, kind webrtc.RTPCodecType, initialLayer LayerID) *DownTrack {
	return &DownTrack{
		SubscriberID:   subscriberID,
		local:          local,
		sender:         sender,
		mimeType:       mimeType,
		kind:           kind,
		currentLayer:   initialLayer,
		targetLayer:    initialLayer,
		requestedLayer: LayerAuto,
	}
}

// SetMuted stops or resumes forwarding without touching the negotiated
// track set. Subscribers of a muted publisher keep their transceivers, so
// unmuting is instant instead of another offer/answer round trip.
func (d *DownTrack) SetMuted(muted bool) {
	d.muted.Store(muted)
}

// RequestLayer records the subscriber's preference and starts switching to
// that layer, if it exists.
//
// The switch isn't immediate. WriteRTP finishes it at the next keyframe on
// the target layer. Callers get no confirmation here because there's
// nothing honest to confirm yet; CurrentLayer reports what's really in
// use.
func (d *DownTrack) RequestLayer(layer LayerID, available []LayerID) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.requestedLayer = layer
	resolved := resolveLayer(layer, available)
	if resolved == d.currentLayer || resolved == LayerNone {
		return
	}
	d.targetLayer = resolved
	d.switching = true
}

// resolveLayer turns a preference into a layer that actually exists.
//
// "auto" means highest available. That's the right default for a desktop
// subscriber, and congestion control walks it back down as needed. Guessing
// low instead leaves you stuck there with nothing to walk you back up.
func resolveLayer(requested LayerID, available []LayerID) LayerID {
	if len(available) == 0 {
		return LayerNone
	}
	if requested == LayerAuto {
		best := available[0]
		for _, candidate := range available[1:] {
			if layerRank(candidate) > layerRank(best) {
				best = candidate
			}
		}
		return best
	}
	for _, candidate := range available {
		if candidate == requested {
			return requested
		}
	}
	// They asked for a layer the publisher isn't sending. Drop to the
	// closest one below it, so asking for "high" from a publisher sending
	// only low/medium gets you medium instead of silence.
	best := LayerNone
	for _, candidate := range available {
		if layerRank(candidate) <= layerRank(requested) && layerRank(candidate) > layerRank(best) {
			best = candidate
		}
	}
	if best == LayerNone {
		return available[0]
	}
	return best
}

// CurrentLayer is the layer being forwarded right now, which is not
// necessarily the one that was asked for. Goes to telemetry so a quality
// readout reflects what the subscriber is genuinely receiving.
func (d *DownTrack) CurrentLayer() LayerID {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.currentLayer
}

// RequestedLayer is what the subscriber asked for. Not necessarily what
// they're getting.
func (d *DownTrack) RequestedLayer() LayerID {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.requestedLayer
}

// WriteRTP forwards one packet from one layer, provided that layer is the
// one this subscriber ought to be receiving.
//
// Returns whether a keyframe is needed: true when we're waiting to switch
// layers and haven't seen a keyframe on the target yet. The caller turns
// that into a PLI aimed at the publisher, which is the difference between a
// layer switch taking milliseconds and it taking however long the encoder
// feels like waiting before its next scheduled keyframe.
func (d *DownTrack) WriteRTP(packet *rtp.Packet, layer LayerID) (needsKeyframe bool, err error) {
	if d.closed.Load() {
		return false, nil
	}
	if d.muted.Load() {
		d.packetsDrop.Add(1)
		return false, nil
	}

	d.mu.Lock()

	// Not this subscriber's layer. If we're trying to switch *to* it, a
	// keyframe is exactly what we're waiting on.
	if layer != d.currentLayer {
		if d.switching && layer == d.targetLayer {
			if !isKeyframe(d.mimeType, packet.Payload) {
				d.mu.Unlock()
				d.packetsDrop.Add(1)
				return true, nil
			}
			// Keyframe on the target layer, so commit the switch. The new
			// layer's sequence numbers and timestamps have nothing to do
			// with the old one's, so re-anchor both and keep the
			// subscriber's stream looking continuous.
			d.currentLayer = layer
			d.switching = false
			d.inboundSeqBase = packet.SequenceNumber
			d.seqOffset = d.outboundSeq + 1 - packet.SequenceNumber
			d.timestampOffset = d.lastTimestamp + 1 - packet.Timestamp
		} else {
			d.mu.Unlock()
			d.packetsDrop.Add(1)
			return false, nil
		}
	}

	if !d.started {
		d.started = true
		d.inboundSeqBase = packet.SequenceNumber
		d.seqOffset = 0
		d.timestampOffset = 0
	}

	// Rewrite in place on a shallow copy. This packet is shared by every
	// subscriber of the layer, so mutating the original corrupts it for
	// whoever writes after us.
	outbound := *packet
	outbound.SequenceNumber = packet.SequenceNumber + d.seqOffset
	outbound.Timestamp = packet.Timestamp + d.timestampOffset
	d.outboundSeq = outbound.SequenceNumber
	d.lastTimestamp = outbound.Timestamp

	d.mu.Unlock()

	if err := d.local.WriteRTP(&outbound); err != nil {
		return false, err
	}
	d.packetsSent.Add(1)
	d.bytesSent.Add(uint64(len(outbound.Payload)))
	return false, nil
}

// Stats snapshots what this DownTrack has forwarded so far.
type DownTrackStats struct {
	SubscriberID   string
	PacketsSent    uint64
	BytesSent      uint64
	PacketsDropped uint64
	CurrentLayer   LayerID
	RequestedLayer LayerID
}

func (d *DownTrack) Stats() DownTrackStats {
	return DownTrackStats{
		SubscriberID:   d.SubscriberID,
		PacketsSent:    d.packetsSent.Load(),
		BytesSent:      d.bytesSent.Load(),
		PacketsDropped: d.packetsDrop.Load(),
		CurrentLayer:   d.CurrentLayer(),
		RequestedLayer: d.RequestedLayer(),
	}
}

func (d *DownTrack) Close() {
	d.closed.Store(true)
}

func (d *DownTrack) Sender() *webrtc.RTPSender {
	return d.sender
}
