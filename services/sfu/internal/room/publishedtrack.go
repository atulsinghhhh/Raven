package room

import (
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// TrackSource is what a track is a picture *of*, which the SDK's public API
// exposes and applications switch on ("show the screen share full-width").
//
// WebRTC itself has no such concept — it carries audio and video, and the
// intent is application metadata. The publisher declares it in the track's
// stream id, and this is where that declaration is read.
type TrackSource string

const (
	SourceMicrophone  TrackSource = "microphone"
	SourceCamera      TrackSource = "camera"
	SourceScreenShare TrackSource = "screenShare"
	SourceUnknown     TrackSource = "unknown"
)

// valid rejects a source the wire protocol does not define, so a malformed
// declaration cannot end up on a track and be forwarded to every
// subscriber as though it were meaningful.
func (s TrackSource) valid() bool {
	switch s {
	case SourceMicrophone, SourceCamera, SourceScreenShare:
		return true
	default:
		return false
	}
}

// pliInterval bounds how often a keyframe is requested for one track.
//
// Without a bound, N subscribers switching layers at once produce N PLIs,
// and the publisher's encoder responds to each with a keyframe — a
// bandwidth spike exactly when the network is already the problem. One
// keyframe serves every subscriber waiting for one, so they are coalesced.
const pliInterval = 500 * time.Millisecond

// PublishedTrack is one media track a participant is sending, along with
// every subscriber's copy of it.
//
// A simulcast video track arrives as several independent RTP streams (one
// per spatial layer) that share a track id. They are held together here so
// that layer selection is a property of the track, not of whichever stream
// happened to arrive first.
type PublishedTrack struct {
	ID            string
	ParticipantID string
	Kind          webrtc.RTPCodecType
	MimeType      string

	// StreamID is the publisher's MediaStream id, forwarded to subscribers
	// so their `ontrack` groups related audio and video the way the
	// publisher grouped them.
	StreamID string

	mu     sync.RWMutex
	source TrackSource
	layers map[LayerID]*trackLayer
	// downTracks is keyed by subscriber participant id.
	downTracks map[string]*DownTrack

	muted atomic.Bool

	lastPLI atomic.Int64

	packetsReceived atomic.Uint64
	bytesReceived   atomic.Uint64

	// writeRTCP sends RTCP toward the publisher. Supplied by the
	// participant, which owns the PeerConnection — RTCP for a received
	// track travels on the same transport, not through the receiver.
	writeRTCP RTCPWriter

	logger *slog.Logger
	closed atomic.Bool
}

// RTCPWriter sends RTCP packets to the peer that owns a track.
type RTCPWriter func(packets []rtcp.Packet) error

// trackLayer is one incoming RTP stream for this track.
type trackLayer struct {
	id     LayerID
	remote *webrtc.TrackRemote
	done   chan struct{}
}

func newPublishedTrack(participantID string, remote *webrtc.TrackRemote, declared TrackSource, writeRTCP RTCPWriter, logger *slog.Logger) *PublishedTrack {
	source := declared
	if !source.valid() {
		source = fallbackSource(remote.Kind())
	}

	return &PublishedTrack{
		ID:            remote.ID(),
		ParticipantID: participantID,
		Kind:          remote.Kind(),
		MimeType:      remote.Codec().MimeType,
		StreamID:      remote.StreamID(),
		source:        source,
		layers:        make(map[LayerID]*trackLayer),
		downTracks:    make(map[string]*DownTrack),
		writeRTCP:     writeRTCP,
		logger:        logger.With("trackId", remote.ID(), "publisherId", participantID),
	}
}

// Source is what this track is a picture of, as the publisher declared it.
func (t *PublishedTrack) Source() TrackSource {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.source
}

// setSource applies a declaration that arrived after the media.
//
// The two race — the client sends the declaration and then negotiates, but
// both are handled independently — so a track can exist with a fallback
// source for a few milliseconds before being corrected.
func (t *PublishedTrack) setSource(source TrackSource) {
	if !source.valid() {
		return
	}
	t.mu.Lock()
	changed := t.source != source
	t.source = source
	t.mu.Unlock()
	if changed {
		t.logger.Debug("track source corrected by declaration", "source", source)
	}
}

// fallbackSource is used when no declaration has arrived yet.
//
// A guess from the codec kind, and knowingly a poor one for video: it
// cannot tell a screen share from a camera, which is exactly why the
// client declares the source explicitly (see TypeTrackSource). This exists
// so a track is never labelled "unknown" during the few milliseconds
// before the declaration lands, and so a client that never declares still
// gets something sensible.
func fallbackSource(kind webrtc.RTPCodecType) TrackSource {
	switch kind {
	case webrtc.RTPCodecTypeVideo:
		return SourceCamera
	case webrtc.RTPCodecTypeAudio:
		return SourceMicrophone
	default:
		return SourceUnknown
	}
}

// AvailableLayers lists the layers the publisher is currently sending.
//
// Derived from streams actually arriving, not from what the publisher said
// it would send in the SDP: a client that negotiated three layers but is
// only encoding one (because it is on battery saver, or the CPU is busy)
// must not have subscribers waiting forever for a layer that will not come.
func (t *PublishedTrack) AvailableLayers() []LayerID {
	t.mu.RLock()
	defer t.mu.RUnlock()
	layers := make([]LayerID, 0, len(t.layers))
	for id := range t.layers {
		layers = append(layers, id)
	}
	return layers
}

func (t *PublishedTrack) IsSimulcast() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.layers) > 1
}

func (t *PublishedTrack) Muted() bool {
	return t.muted.Load()
}

// SetMuted propagates a publisher's mute to every subscriber's copy.
//
// Deliberately not an unpublish: the transceivers stay in place, so
// unmuting costs nothing and the subscriber's UI keeps the participant's
// tile rather than tearing it down and rebuilding it.
func (t *PublishedTrack) SetMuted(muted bool) {
	t.muted.Store(muted)
	t.mu.RLock()
	defer t.mu.RUnlock()
	for _, down := range t.downTracks {
		down.SetMuted(muted)
	}
}

// addLayer starts forwarding one incoming RTP stream.
//
// Called once per simulcast layer. The read loop it starts is the SFU's hot
// path: everything in it runs per packet, per layer, which is why it does
// no allocation beyond the packet Pion hands it and holds no lock while
// writing.
func (t *PublishedTrack) addLayer(remote *webrtc.TrackRemote) {
	layerID := layerFromRID(remote.RID())
	layer := &trackLayer{id: layerID, remote: remote, done: make(chan struct{})}

	t.mu.Lock()
	t.layers[layerID] = layer
	t.mu.Unlock()

	t.logger.Info("track layer started", "layer", layerID, "rid", remote.RID(), "codec", remote.Codec().MimeType, "ssrc", remote.SSRC())
	go t.readLayer(layer)
}

func (t *PublishedTrack) readLayer(layer *trackLayer) {
	defer close(layer.done)
	defer func() {
		t.mu.Lock()
		delete(t.layers, layer.id)
		remaining := len(t.layers)
		t.mu.Unlock()
		t.logger.Info("track layer ended", "layer", layer.id, "remainingLayers", remaining)

		// A layer disappearing while subscribers are on it — the publisher
		// dropped to fewer layers under CPU or bandwidth pressure — must
		// move them somewhere real, or they freeze on a stream that will
		// never send another packet.
		if remaining > 0 {
			t.rebalanceAfterLayerLoss(layer.id)
		}
	}()

	for {
		if t.closed.Load() {
			return
		}

		packet, _, err := layer.remote.ReadRTP()
		if err != nil {
			if !errors.Is(err, io.EOF) && !t.closed.Load() {
				t.logger.Debug("layer read ended", "layer", layer.id, "err", err)
			}
			return
		}

		t.packetsReceived.Add(1)
		t.bytesReceived.Add(uint64(len(packet.Payload)))

		t.forward(packet, layer)
	}
}

// forward hands one packet to every subscriber that wants this layer.
//
// Holds only a read lock, and never holds it across the network write —
// a slow subscriber must not be able to stall the publisher's read loop
// and thereby every other subscriber.
func (t *PublishedTrack) forward(packet *rtp.Packet, layer *trackLayer) {
	t.mu.RLock()
	targets := make([]*DownTrack, 0, len(t.downTracks))
	for _, down := range t.downTracks {
		targets = append(targets, down)
	}
	t.mu.RUnlock()

	keyframeWanted := false
	for _, down := range targets {
		needsKeyframe, err := down.WriteRTP(packet, layer.id)
		if needsKeyframe {
			keyframeWanted = true
		}
		if err != nil {
			// One subscriber's connection failing is not the publisher's
			// problem; the peer's own state change tears it down.
			t.logger.Debug("downtrack write failed", "subscriber", down.SubscriberID, "err", err)
		}
	}

	if keyframeWanted {
		t.requestKeyframe(layer)
	}
}

// requestKeyframe asks the publisher for an immediate keyframe via PLI.
//
// Rate-limited: several subscribers switching layers at once would
// otherwise each trigger a keyframe, spiking the publisher's bitrate at
// the worst possible moment. One keyframe satisfies all of them.
func (t *PublishedTrack) requestKeyframe(layer *trackLayer) {
	now := time.Now().UnixMilli()
	last := t.lastPLI.Load()
	if now-last < pliInterval.Milliseconds() {
		return
	}
	if !t.lastPLI.CompareAndSwap(last, now) {
		return // another goroutine just sent one
	}

	if t.writeRTCP == nil {
		return
	}
	if err := t.writeRTCP([]rtcp.Packet{
		&rtcp.PictureLossIndication{MediaSSRC: uint32(layer.remote.SSRC())},
	}); err != nil {
		t.logger.Debug("PLI failed", "layer", layer.id, "err", err)
	}
}

// rebalanceAfterLayerLoss moves subscribers off a layer that has stopped.
func (t *PublishedTrack) rebalanceAfterLayerLoss(lost LayerID) {
	available := t.AvailableLayers()
	t.mu.RLock()
	targets := make([]*DownTrack, 0, len(t.downTracks))
	for _, down := range t.downTracks {
		targets = append(targets, down)
	}
	t.mu.RUnlock()

	for _, down := range targets {
		if down.CurrentLayer() != lost {
			continue
		}
		// Re-resolve against their original preference rather than pinning
		// them to whatever is left: if the publisher restores the layer,
		// they should go back up.
		down.RequestLayer(down.RequestedLayer(), available)
		t.logger.Info("subscriber moved off lost layer", "subscriber", down.SubscriberID, "lost", lost, "now", down.CurrentLayer())
	}
}

// AddSubscriber registers a subscriber's copy of this track.
func (t *PublishedTrack) AddSubscriber(down *DownTrack) {
	available := t.AvailableLayers()
	down.RequestLayer(LayerAuto, available)
	if t.muted.Load() {
		down.SetMuted(true)
	}

	t.mu.Lock()
	t.downTracks[down.SubscriberID] = down
	t.mu.Unlock()

	// A subscriber joining mid-call starts at whatever point the stream is
	// at, which is almost certainly mid-frame. Ask for a keyframe now so
	// they see a picture in milliseconds rather than at the encoder's next
	// scheduled one.
	t.RequestKeyframeNow()
}

// RequestKeyframeNow forces a keyframe request on the layer subscribers
// are actually using, bypassing nothing but the "is anyone waiting" check.
// Still rate-limited — the reasons for that do not stop applying.
func (t *PublishedTrack) RequestKeyframeNow() {
	if t.Kind != webrtc.RTPCodecTypeVideo {
		return
	}
	t.mu.RLock()
	var chosen *trackLayer
	for _, layer := range t.layers {
		if chosen == nil || layerRank(layer.id) > layerRank(chosen.id) {
			chosen = layer
		}
	}
	t.mu.RUnlock()
	if chosen != nil {
		t.requestKeyframe(chosen)
	}
}

func (t *PublishedTrack) RemoveSubscriber(subscriberID string) *DownTrack {
	t.mu.Lock()
	down := t.downTracks[subscriberID]
	delete(t.downTracks, subscriberID)
	t.mu.Unlock()

	if down != nil {
		down.Close()
	}
	return down
}

// SetSubscriberLayer applies a subscriber's explicit layer preference.
func (t *PublishedTrack) SetSubscriberLayer(subscriberID string, layer LayerID) bool {
	t.mu.RLock()
	down := t.downTracks[subscriberID]
	t.mu.RUnlock()
	if down == nil {
		return false
	}
	down.RequestLayer(layer, t.AvailableLayers())
	// The switch lands on the next keyframe; asking for one now is what
	// makes it feel immediate.
	t.RequestKeyframeNow()
	return true
}

func (t *PublishedTrack) SubscriberIDs() []string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	ids := make([]string, 0, len(t.downTracks))
	for id := range t.downTracks {
		ids = append(ids, id)
	}
	return ids
}

type PublishedTrackStats struct {
	TrackID         string
	ParticipantID   string
	Kind            string
	Source          TrackSource
	Muted           bool
	Simulcast       bool
	Layers          []LayerID
	PacketsReceived uint64
	BytesReceived   uint64
	DownTracks      []DownTrackStats
}

func (t *PublishedTrack) Stats() PublishedTrackStats {
	t.mu.RLock()
	downs := make([]DownTrackStats, 0, len(t.downTracks))
	for _, down := range t.downTracks {
		downs = append(downs, down.Stats())
	}
	layers := make([]LayerID, 0, len(t.layers))
	for id := range t.layers {
		layers = append(layers, id)
	}
	simulcast := len(t.layers) > 1
	// Read here rather than via Source(): the lock is already held, and
	// re-entering an RWMutex for read is only safe until a writer queues
	// between the two acquisitions, at which point it deadlocks.
	source := t.source
	t.mu.RUnlock()

	return PublishedTrackStats{
		TrackID:         t.ID,
		ParticipantID:   t.ParticipantID,
		Kind:            t.Kind.String(),
		Source:          source,
		Muted:           t.muted.Load(),
		Simulcast:       simulcast,
		Layers:          layers,
		PacketsReceived: t.packetsReceived.Load(),
		BytesReceived:   t.bytesReceived.Load(),
		DownTracks:      downs,
	}
}

// Close stops forwarding and releases every subscriber's copy.
func (t *PublishedTrack) Close() {
	if !t.closed.CompareAndSwap(false, true) {
		return
	}
	t.mu.Lock()
	downs := t.downTracks
	t.downTracks = make(map[string]*DownTrack)
	t.mu.Unlock()

	for _, down := range downs {
		down.Close()
	}
	t.logger.Info("track closed")
}
