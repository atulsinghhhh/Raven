// Package metrics exposes this node's Prometheus surface (spec §27).
//
// Every number here is measured off the forwarding path itself. You won't
// find a derived "quality" gauge. Any single number claiming to sum up a
// room's health would be made up, and spec §19 is blunt about it: quality
// comes from telemetry, we don't get to assert it.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/atulsinghhhh/Raven/services/sfu/internal/room"
)

type Metrics struct {
	registry *prometheus.Registry

	// Monotonic counters. Miss a scrape and you lose rate precision, but
	// never a whole event.
	ParticipantsJoined   prometheus.Counter
	ParticipantsLeft     prometheus.Counter
	RoomsCreated         prometheus.Counter
	TracksPublished      *prometheus.CounterVec
	TracksUnpublished    *prometheus.CounterVec
	NegotiationsStarted  prometheus.Counter
	NegotiationFailures  prometheus.Counter
	ConnectionsFailed    prometheus.Counter
	ConnectionsSucceeded prometheus.Counter
	LayerSwitches        prometheus.Counter
	KeyframesRequested   prometheus.Counter

	// Current state, pulled from the room manager at scrape time. We don't
	// write these on every change: the manager is the source of truth, and
	// keeping a second copy in sync is how the two end up disagreeing.
	activeRooms        prometheus.GaugeFunc
	activeParticipants prometheus.GaugeFunc
	activeAudioTracks  prometheus.GaugeFunc
	activeVideoTracks  prometheus.GaugeFunc
	nodeLinkConnected  prometheus.GaugeFunc
}

// New builds the node's metric set.
//
// linkConnected is a func, not a bool, so the gauge always reports the
// live state of the control-plane link. A node with a dead link keeps
// serving the calls it already has but can't take new ones. Alert on it.
func New(manager *room.Manager, linkConnected func() bool) *Metrics {
	registry := prometheus.NewRegistry()

	m := &Metrics{
		registry: registry,
		ParticipantsJoined: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_participants_joined_total",
			Help: "Participants admitted to a room on this node.",
		}),
		ParticipantsLeft: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_participants_left_total",
			Help: "Participants removed from a room on this node, for any reason.",
		}),
		RoomsCreated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_rooms_created_total",
			Help: "Media sessions started on this node.",
		}),
		TracksPublished: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "raven_sfu_tracks_published_total",
			Help: "Tracks this node began forwarding, by kind and source.",
		}, []string{"kind", "source"}),
		TracksUnpublished: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "raven_sfu_tracks_unpublished_total",
			Help: "Tracks this node stopped forwarding, by kind and source.",
		}, []string{"kind", "source"}),
		NegotiationsStarted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_negotiations_started_total",
			Help: "Offers this node created, including renegotiations.",
		}),
		NegotiationFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_negotiation_failures_total",
			Help: "Negotiations that could not be completed.",
		}),
		ConnectionsSucceeded: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_connections_succeeded_total",
			Help: "PeerConnections that reached the connected state. With connections_failed_total, this is the connection success rate.",
		}),
		ConnectionsFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_connections_failed_total",
			Help: "PeerConnections that reached the failed state without ever connecting.",
		}),
		LayerSwitches: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_layer_switches_total",
			Help: "Simulcast layer changes committed for a subscriber.",
		}),
		KeyframesRequested: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "raven_sfu_keyframes_requested_total",
			Help: "Keyframe requests (PLI) sent to publishers.",
		}),
	}

	m.activeRooms = prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "raven_sfu_active_rooms",
		Help: "Media sessions currently on this node.",
	}, func() float64 { return float64(manager.Load().Rooms) })

	m.activeParticipants = prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "raven_sfu_active_participants",
		Help: "Participants currently connected to this node.",
	}, func() float64 { return float64(manager.Load().Participants) })

	m.activeAudioTracks = prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "raven_sfu_active_audio_tracks",
		Help: "Audio tracks currently being forwarded.",
	}, func() float64 { return float64(manager.Load().AudioTracks) })

	m.activeVideoTracks = prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "raven_sfu_active_video_tracks",
		Help: "Video tracks currently being forwarded, including screen shares.",
	}, func() float64 { return float64(manager.Load().VideoTracks) })

	m.nodeLinkConnected = prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "raven_sfu_node_link_connected",
		Help: "1 when a control plane is attached. A node at 0 keeps serving existing calls but accepts no new participants.",
	}, func() float64 {
		if linkConnected() {
			return 1
		}
		return 0
	})

	registry.MustRegister(
		m.ParticipantsJoined, m.ParticipantsLeft, m.RoomsCreated,
		m.TracksPublished, m.TracksUnpublished,
		m.NegotiationsStarted, m.NegotiationFailures,
		m.ConnectionsSucceeded, m.ConnectionsFailed,
		m.LayerSwitches, m.KeyframesRequested,
		m.activeRooms, m.activeParticipants,
		m.activeAudioTracks, m.activeVideoTracks,
		m.nodeLinkConnected,
	)

	// Byte counters come in through a custom collector. They live on the
	// tracks, and mirroring them into Prometheus counters would mean a
	// metric write per packet. Not in the hot path, thanks.
	registry.MustRegister(newTrafficCollector(manager))

	return m
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// trafficCollector walks the live tracks at scrape time and adds up their
// byte and packet totals.
type trafficCollector struct {
	manager *room.Manager

	bytesReceived   *prometheus.Desc
	bytesSent       *prometheus.Desc
	packetsReceived *prometheus.Desc
	packetsSent     *prometheus.Desc
	packetsDropped  *prometheus.Desc
}

func newTrafficCollector(manager *room.Manager) *trafficCollector {
	return &trafficCollector{
		manager: manager,
		bytesReceived: prometheus.NewDesc(
			"raven_sfu_media_bytes_received_total",
			"Media bytes received from publishers.", nil, nil,
		),
		bytesSent: prometheus.NewDesc(
			"raven_sfu_media_bytes_sent_total",
			"Media bytes forwarded to subscribers. Expected to exceed bytes received, since one publisher feeds many subscribers.", nil, nil,
		),
		packetsReceived: prometheus.NewDesc(
			"raven_sfu_media_packets_received_total",
			"RTP packets received from publishers.", nil, nil,
		),
		packetsSent: prometheus.NewDesc(
			"raven_sfu_media_packets_sent_total",
			"RTP packets forwarded to subscribers.", nil, nil,
		),
		packetsDropped: prometheus.NewDesc(
			"raven_sfu_media_packets_dropped_total",
			"Packets deliberately not forwarded: a muted track, or a simulcast layer this subscriber is not receiving. Not a loss indicator.", nil, nil,
		),
	}
}

func (c *trafficCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.bytesReceived
	ch <- c.bytesSent
	ch <- c.packetsReceived
	ch <- c.packetsSent
	ch <- c.packetsDropped
}

func (c *trafficCollector) Collect(ch chan<- prometheus.Metric) {
	var bytesIn, bytesOut, packetsIn, packetsOut, dropped float64

	for _, activeRoom := range c.manager.Rooms() {
		for _, participant := range activeRoom.Participants() {
			for _, track := range participant.PublishedTracks() {
				stats := track.Stats()
				bytesIn += float64(stats.BytesReceived)
				packetsIn += float64(stats.PacketsReceived)
				for _, down := range stats.DownTracks {
					bytesOut += float64(down.BytesSent)
					packetsOut += float64(down.PacketsSent)
					dropped += float64(down.PacketsDropped)
				}
			}
		}
	}

	ch <- prometheus.MustNewConstMetric(c.bytesReceived, prometheus.CounterValue, bytesIn)
	ch <- prometheus.MustNewConstMetric(c.bytesSent, prometheus.CounterValue, bytesOut)
	ch <- prometheus.MustNewConstMetric(c.packetsReceived, prometheus.CounterValue, packetsIn)
	ch <- prometheus.MustNewConstMetric(c.packetsSent, prometheus.CounterValue, packetsOut)
	ch <- prometheus.MustNewConstMetric(c.packetsDropped, prometheus.CounterValue, dropped)
}
