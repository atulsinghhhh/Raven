package room

import (
	"fmt"
	"log/slog"
	"net"
	"sync"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/intervalpli"
	"github.com/pion/webrtc/v4"

	"github.com/corvidhq/raven/services/sfu/internal/config"
)

// Manager owns this node's rooms and the WebRTC stack they share.
//
// One `webrtc.API` for the whole node, not one per PeerConnection: the API
// holds the UDP socket pool and the interceptor registry, and building it
// per connection would mean a fresh port allocation and a fresh set of
// interceptor state for every participant.
type Manager struct {
	cfg    *config.Config
	api    *webrtc.API
	logger *slog.Logger

	// iceServers is what this *node* uses when gathering. Usually empty —
	// an SFU normally sits on a publicly reachable address, and relaying
	// its own traffic through TURN would put every packet in the room
	// through a third hop.
	iceServers []webrtc.ICEServer

	mu    sync.RWMutex
	rooms map[string]*Room

	events RoomEvents
}

// NewManager builds the node's WebRTC stack.
//
// The interceptor registry is where standards-compliant recovery actually
// comes from (spec §9): Pion's defaults install NACK generation and
// response, receiver/sender reports, and TWCC. They are registered rather
// than reimplemented — spec §9 says use standards-compliant WebRTC, and
// this is what that means in practice.
func NewManager(cfg *config.Config, events RoomEvents, logger *slog.Logger) (*Manager, error) {
	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("register codecs: %w", err)
	}

	registry := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(mediaEngine, registry); err != nil {
		return nil, fmt.Errorf("register interceptors: %w", err)
	}

	// A periodic PLI on top of the event-driven ones. Belt and braces: a
	// subscriber whose PLI was itself lost would otherwise wait for the
	// encoder's next scheduled keyframe, which on a long call can be
	// several seconds of frozen video.
	pliFactory, err := intervalpli.NewReceiverInterceptor()
	if err != nil {
		return nil, fmt.Errorf("create interval PLI interceptor: %w", err)
	}
	registry.Add(pliFactory)

	settings := webrtc.SettingEngine{}

	// Bounded UDP range so a deployment has a firewall rule that can be
	// written down (spec §12, §41). Zero means "let the OS choose", which
	// config.Load never produces — it is for tests and for embedding, where
	// pinning a range would make parallel runs collide on ports.
	if cfg.UDPPortMin != 0 || cfg.UDPPortMax != 0 {
		if err := settings.SetEphemeralUDPPortRange(cfg.UDPPortMin, cfg.UDPPortMax); err != nil {
			return nil, fmt.Errorf("set UDP port range %d-%d: %w", cfg.UDPPortMin, cfg.UDPPortMax, err)
		}
	}

	// Behind NAT or a cloud load balancer, the address this process can
	// see is not the address a client can reach. Without this, every
	// candidate advertises an unroutable private IP and the only
	// connections that work are the ones that fall back to TURN.
	if cfg.PublicIP != "" {
		if net.ParseIP(cfg.PublicIP) == nil {
			return nil, fmt.Errorf("SFU_PUBLIC_IP %q is not a valid IP address", cfg.PublicIP)
		}
		settings.SetNAT1To1IPs([]string{cfg.PublicIP}, webrtc.ICECandidateTypeHost)
	}

	// mDNS candidates are for local peer-to-peer discovery and are useless
	// to a server: they would advertise a .local name no client can
	// resolve, wasting a candidate slot and a few hundred milliseconds of
	// connection time on every join.
	settings.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)

	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithInterceptorRegistry(registry),
		webrtc.WithSettingEngine(settings),
	)

	iceServers := make([]webrtc.ICEServer, 0, len(cfg.STUNServers))
	for _, url := range cfg.STUNServers {
		iceServers = append(iceServers, webrtc.ICEServer{URLs: []string{url}})
	}

	return &Manager{
		cfg:        cfg,
		api:        api,
		logger:     logger,
		iceServers: iceServers,
		rooms:      make(map[string]*Room),
		events:     events,
	}, nil
}

// AddParticipant is the node's single entry point for a joining client.
//
// Creates the room if this is the first participant, which is why there is
// no separate "create room" call: a room on an SFU is a live media session,
// and one with nobody in it has nothing to be. The control plane's Room
// row is the durable record; this is the session.
func (m *Manager) AddParticipant(roomID, participantID, sessionID string, permissions Permissions) (*Participant, error) {
	target := m.getOrCreateRoom(roomID)

	pc, err := m.api.NewPeerConnection(webrtc.Configuration{ICEServers: m.iceServers})
	if err != nil {
		return nil, fmt.Errorf("create peer connection: %w", err)
	}

	// A participant that only subscribes still needs transceivers in the
	// offer, or the browser has nothing to answer with and no direction to
	// receive media in. Declared up front for both kinds, because adding
	// them later would cost an extra renegotiation on the very first
	// publish.
	if permissions.Subscribe {
		for _, kind := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeAudio, webrtc.RTPCodecTypeVideo} {
			if _, err := pc.AddTransceiverFromKind(kind, webrtc.RTPTransceiverInit{
				Direction: webrtc.RTPTransceiverDirectionRecvonly,
			}); err != nil {
				_ = pc.Close()
				return nil, fmt.Errorf("add %s transceiver: %w", kind, err)
			}
		}
	}

	participant, err := target.AddParticipant(participantID, sessionID, permissions, pc)
	if err != nil {
		_ = pc.Close()
		// A room that failed to admit its would-be first participant is
		// left with nobody in it; reap it rather than leaving an empty
		// room counted against this node's load.
		m.reapIfEmpty(roomID)
		return nil, err
	}
	return participant, nil
}

func (m *Manager) getOrCreateRoom(roomID string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, found := m.rooms[roomID]; found && !existing.Closed() {
		return existing
	}

	created := NewRoom(roomID, m.cfg.RoomCapacity, m.events, m.logger)
	m.rooms[roomID] = created
	m.logger.Info("room created", "roomId", roomID, "activeRooms", len(m.rooms))
	return created
}

// RemoveParticipant removes a session and reaps the room if it emptied.
func (m *Manager) RemoveParticipant(roomID, sessionID string) bool {
	target, found := m.Room(roomID)
	if !found {
		return false
	}
	removed := target.RemoveParticipant(sessionID)
	m.reapIfEmpty(roomID)
	return removed
}

// reapIfEmpty drops an empty room.
//
// Keeping empty rooms would inflate this node's reported load and, through
// the allocator, quietly reduce the fleet's usable capacity. The control
// plane releases the room's SFU assignment on the same signal, so the next
// call in that room is allocated fresh.
func (m *Manager) reapIfEmpty(roomID string) {
	m.mu.Lock()
	target, found := m.rooms[roomID]
	if !found {
		m.mu.Unlock()
		return
	}
	if target.Size() > 0 {
		m.mu.Unlock()
		return
	}
	delete(m.rooms, roomID)
	remaining := len(m.rooms)
	m.mu.Unlock()

	target.Close()
	m.logger.Info("room reaped", "roomId", roomID, "activeRooms", remaining)
}

func (m *Manager) Room(roomID string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	target, found := m.rooms[roomID]
	return target, found
}

// FindParticipant locates a session without the caller knowing its room.
//
// The node link's frames carry a room id, but a stale frame for a room
// that has since been reaped would otherwise fail with a confusing "room
// not found" rather than "unknown session".
func (m *Manager) FindParticipant(sessionID string) (*Participant, *Room, bool) {
	m.mu.RLock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, target := range m.rooms {
		rooms = append(rooms, target)
	}
	m.mu.RUnlock()

	for _, target := range rooms {
		if participant, found := target.Participant(sessionID); found {
			return participant, target, true
		}
	}
	return nil, nil, false
}

func (m *Manager) Rooms() []*Room {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, target := range m.rooms {
		rooms = append(rooms, target)
	}
	return rooms
}

// CloseRoom evicts a room on an admin request.
func (m *Manager) CloseRoom(roomID string) bool {
	m.mu.Lock()
	target, found := m.rooms[roomID]
	delete(m.rooms, roomID)
	m.mu.Unlock()

	if !found {
		return false
	}
	target.Close()
	return true
}

// Load is what the heartbeat reports.
type Load struct {
	Rooms        int
	Participants int
	AudioTracks  int
	VideoTracks  int
}

func (m *Manager) Load() Load {
	rooms := m.Rooms()
	load := Load{Rooms: len(rooms)}
	for _, target := range rooms {
		load.Participants += target.Size()
		audio, video := target.TrackCount()
		load.AudioTracks += audio
		load.VideoTracks += video
	}
	return load
}

// Shutdown closes every room. Called on SIGTERM, before the process exits,
// so clients get a clean PeerConnection close and reconnect immediately
// rather than waiting out an ICE timeout.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	rooms := m.rooms
	m.rooms = make(map[string]*Room)
	m.mu.Unlock()

	for _, target := range rooms {
		target.Close()
	}
	m.logger.Info("manager shut down", "roomsClosed", len(rooms))
}
