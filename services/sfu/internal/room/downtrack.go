package room

import (
	"sync"
	"sync/atomic"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// LayerID names a simulcast spatial layer.
//
// Raven's own vocabulary, not the RIDs a browser happens to use — Chrome
// sends "f"/"h"/"q", other stacks send "high"/"low", and the SDK's public
// API should not change shape because a browser did. `layerFromRID` does
// the mapping.
type LayerID string

const (
	LayerLow    LayerID = "low"
	LayerMedium LayerID = "medium"
	LayerHigh   LayerID = "high"
	// LayerAuto asks the SFU to choose. The default: a subscriber usually
	// wants "the best layer my connection can carry", not a fixed one.
	LayerAuto LayerID = "auto"
	// LayerNone is a non-simulcast track's single layer. Distinct from
	// LayerAuto so "there is nothing to choose between" and "choose for me"
	// are not the same state.
	LayerNone LayerID = ""
)

// layerFromRID maps a publisher's RID onto Raven's layer names.
//
// Empty RID means the publisher is not simulcasting at all, which is the
// common case for audio and for video from a client that disabled it.
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
		// An unrecognised RID is still a real layer carrying real media —
		// treating it as the lowest means a subscriber gets *something*
		// rather than nothing while the mapping gets fixed.
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
// # Why one per subscriber rather than one shared output
//
// An SFU that shares a single output track across subscribers cannot give
// them different simulcast layers, which is the entire reason simulcast
// exists: the participant on a phone over 4G and the one on a desktop
// looking at a full-screen tile should not receive the same bitrate. So
// each subscriber gets its own DownTrack, its own layer choice, and its
// own sequence-number space. The cost is a per-subscriber write of every
// packet, which is inherent to selective forwarding.
//
// # Sequence rewriting
//
// Each simulcast layer is a separate RTP stream with its own sequence
// numbers and timestamps. Switching layers therefore produces a
// discontinuity that a subscriber's jitter buffer reads as massive packet
// loss. DownTrack keeps its own monotonic sequence counter and a timestamp
// offset, so from the subscriber's perspective it is receiving one
// continuous stream that happens to change resolution at keyframes.
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
	// targetLayer is where we want to be. They differ while waiting for a
	// keyframe on the target layer.
	targetLayer LayerID
	// requestedLayer is what the subscriber asked for, which may be more
	// than their connection can carry. Kept separately so that when
	// conditions improve we know what to return to, rather than being
	// stuck at whatever congestion control last allowed.
	requestedLayer LayerID

	// Sequence/timestamp rewriting state.
	started         bool
	outboundSeq     uint16
	inboundSeqBase  uint16
	seqOffset       uint16
	timestampOffset uint32
	lastTimestamp   uint32
	// switching is true between asking for a layer and seeing its keyframe.
	switching bool

	// muted drops packets without tearing anything down, so a publisher
	// un-muting does not cost a renegotiation.
	muted atomic.Bool

	// Counters for telemetry. Atomic rather than mutex-guarded because
	// stats collection must never contend with the forwarding path.
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

// SetMuted stops or resumes forwarding without changing the negotiated
// track set. A muted publisher's subscribers keep their transceivers, so
// unmuting is immediate rather than another offer/answer round trip.
func (d *DownTrack) SetMuted(muted bool) {
	d.muted.Store(muted)
}

// RequestLayer records the subscriber's preference and, if that layer is
// available, begins switching to it.
//
// The switch is not immediate: `WriteRTP` completes it at the next
// keyframe on the target layer. Callers get no confirmation here because
// there is nothing honest to confirm yet — the layer actually in use is
// reported by `CurrentLayer`.
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
// "auto" means the highest available, which is the right default for a
// desktop subscriber and gets corrected downward by congestion control
// rather than by guessing low and never recovering.
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
	// Asked for a layer the publisher is not sending. Fall back to the
	// closest one below it, so a request for "high" from a publisher
	// sending only low/medium yields medium rather than silence.
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

// CurrentLayer is the layer being forwarded right now — not the one that
// was requested. Reported to telemetry so a quality readout reflects what
// the subscriber is receiving.
func (d *DownTrack) CurrentLayer() LayerID {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.currentLayer
}

// RequestedLayer is what the subscriber asked for, which may not be what
// they are getting.
func (d *DownTrack) RequestedLayer() LayerID {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.requestedLayer
}

// WriteRTP forwards one packet from one layer, if that layer is the one
// this subscriber should be receiving.
//
// Returns whether a keyframe is needed: true when the track is waiting to
// switch layers and has not yet seen a keyframe on the target. The caller
// turns that into a PLI toward the publisher, which is what makes a layer
// switch take milliseconds rather than however long until the encoder's
// next scheduled keyframe.
func (d *DownTrack) WriteRTP(packet *rtp.Packet, layer LayerID) (needsKeyframe bool, err error) {
	if d.closed.Load() {
		return false, nil
	}
	if d.muted.Load() {
		d.packetsDrop.Add(1)
		return false, nil
	}

	d.mu.Lock()

	// Not this subscriber's layer. If we are trying to switch *to* it, a
	// keyframe is what we are waiting for.
	if layer != d.currentLayer {
		if d.switching && layer == d.targetLayer {
			if !isKeyframe(d.mimeType, packet.Payload) {
				d.mu.Unlock()
				d.packetsDrop.Add(1)
				return true, nil
			}
			// Keyframe on the target layer: commit the switch. The new
			// layer's sequence numbers and timestamps are unrelated to the
			// old one's, so re-anchor both to keep the subscriber's stream
			// continuous.
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

	// Rewrite in place on a shallow copy: the packet is shared across every
	// subscriber of this layer, so mutating the original would corrupt
	// whatever writes after us.
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

// Stats is a snapshot of what this DownTrack has forwarded.
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
