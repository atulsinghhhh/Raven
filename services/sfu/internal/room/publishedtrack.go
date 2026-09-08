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

// TrackSource is what a track is a picture *of*. The SDK's public API
// exposes it and applications switch on it ("show the screen share
// full-width").
//
// WebRTC has no such concept. It carries audio and video; the intent is
// application metadata. The publisher declares it in the track's stream id,
// and this is where we read that declaration back out.
type TrackSource string

const (
	SourceMicrophone  TrackSource = "microphone"
	SourceCamera      TrackSource = "camera"
	SourceScreenShare TrackSource = "screenShare"
	SourceUnknown     TrackSource = "unknown"
)

// valid rejects any source the wire protocol doesn't define, so a
// malformed declaration can't stick to a track and get forwarded to every
// subscriber as though it meant something.
func (s TrackSource) valid() bool {
	switch s {
	case SourceMicrophone, SourceCamera, SourceScreenShare:
		return true
	default:
		return false
	}
}

// pliInterval caps how often we'll ask for a keyframe on one track.
//
// Uncapped, N subscribers switching layers together produce N PLIs, and the
// publisher's encoder dutifully answers each one with a keyframe. That's a
// bandwidth spike at precisely the moment the network is already what's
// wrong. One keyframe serves everyone waiting, so we coalesce them.
const pliInterval = 500 * time.Millisecond

// PublishedTrack is one media track a participant is sending, plus every
// subscriber's copy of it.
//
// A simulcast video track shows up as several independent RTP streams, one
// per spatial layer, all sharing a track id. Holding them together here
// makes layer selection a property of the track itself instead of a
// property of whichever stream happened to arrive first.
type PublishedTrack struct {
	ID            string
	ParticipantID string
	Kind          webrtc.RTPCodecType
	MimeType      string

	// StreamID is the publisher's MediaStream id, passed on to subscribers
	// so their ontrack groups audio and video the way the publisher did.
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

	// writeRTCP sends RTCP back toward the publisher. Supplied by the
	// participant, since it owns the PeerConnection. RTCP for a received
	// track rides the same transport; it doesn't go via the receiver.
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

// setSource applies a declaration that turned up after the media did.
//
// The two race. The client sends the declaration and then negotiates, but
// we handle both independently, so a track can sit on a fallback source for
// a few milliseconds before we correct it.
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

// fallbackSource covers the window before any declaration arrives.
//
// It's a guess off the codec kind, and a knowingly bad one for video: it
// can't tell a screen share from a camera. That's the whole reason clients
// declare the source explicitly (see TypeTrackSource). This exists so a
// track is never labelled "unknown" for the few milliseconds before the
// declaration lands, and so a client that never declares at all still ends
// up with something sensible.
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

// AvailableLayers lists the layers the publisher is actually sending.
//
// Built from streams genuinely arriving, not from whatever the publisher
// promised in the SDP. A client that negotiated three layers but is only
// encoding one, because it's on battery saver or the CPU is pegged, must
// not leave subscribers waiting forever on a layer that isn't coming.
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

// SetMuted pushes a publisher's mute out to every subscriber's copy.
//
// Not an unpublish, on purpose. The transceivers stay put, so unmuting
// costs nothing and the subscriber's UI keeps the participant's tile
// instead of tearing it down and building a new one.
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
// Runs once per simulcast layer. The read loop it kicks off is the SFU's
// hot path. Everything in there executes per packet, per layer, which is
// why it allocates nothing beyond the packet Pion hands it and holds no
// lock while writing.
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

		// A layer can vanish with subscribers still on it, when the
		// publisher drops to fewer layers under CPU or bandwidth pressure.
		// Move them somewhere real or they freeze on a stream that will
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
// Read lock only, and never held across the network write. One slow
// subscriber must not be able to stall the publisher's read loop, and
// through it every other subscriber in the room.
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
			// One subscriber's connection dying isn't the publisher's
			// problem. That peer's own state change will tear it down.
			t.logger.Debug("downtrack write failed", "subscriber", down.SubscriberID, "err", err)
		}
	}

	if keyframeWanted {
		t.requestKeyframe(layer)
	}
}

// requestKeyframe asks the publisher for an immediate keyframe, via PLI.
//
// Rate-limited. Several subscribers switching layers at once would each
// otherwise trigger a keyframe, spiking the publisher's bitrate at the
// worst imaginable moment. One keyframe satisfies the lot of them.
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
		// Re-resolve against their original preference instead of pinning
		// them to whatever's left. If the publisher brings the layer back,
		// they should go back up with it.
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

	// A subscriber joining mid-call comes in wherever the stream happens to
	// be, which is almost certainly mid-frame. Ask for a keyframe now and
	// they get a picture in milliseconds instead of waiting on the
	// encoder's next scheduled one.
	t.RequestKeyframeNow()
}

// RequestKeyframeNow forces a keyframe request on the layer subscribers are
// actually using. The only thing it skips is the "is anyone waiting" check.
// Still rate-limited; those reasons don't stop applying just because we
// asked nicely.
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
	// The switch lands on the next keyframe. Asking for one right now is
	// what makes it feel instant.
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
	// Read it here instead of calling Source(). We already hold the lock,
	// and re-entering an RWMutex for read is fine right up until a writer
	// queues between the two acquisitions. Then it deadlocks.
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

// Close stops forwarding and lets go of every subscriber's copy.
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
