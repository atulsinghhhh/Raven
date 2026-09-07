// Package config loads the SFU's settings from the environment.
//
// Everything here has a working local default except the control-plane
// credential: a node that cannot authenticate to the control plane would
// register nowhere and serve nothing, so it refuses to start rather than
// running as an island that looks healthy from the outside.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	// NodeID is this node's stable name across restarts. It is what the
	// control plane keys its registry row on, so a redeploy reclaims the
	// same row instead of leaving a phantom behind.
	NodeID string
	Region string

	// PublicHost is the address clients reach for media. PublicIP is what
	// gets advertised in ICE candidates — separate because the host a
	// client resolves and the address this process can actually bind or
	// claim are not the same thing behind NAT or a load balancer.
	PublicHost string
	PublicIP   string

	// HTTPAddr serves the node-link WebSocket, health, and metrics. Control
	// traffic only; no media ever crosses it.
	HTTPAddr string

	// ControlPlaneURL is the Raven API this node registers with.
	ControlPlaneURL string
	// RegistrationSecret authenticates this node to the control plane.
	// Fleet membership, not a client credential.
	RegistrationSecret string

	HeartbeatIntervalSeconds int
	// RoomCapacity is what this node advertises it can hold. The allocator
	// treats it as a ceiling.
	RoomCapacity int

	// UDPPortMin/Max bound the range ICE binds media sockets in. A bounded
	// range is what makes the firewall rule for a deployment writable at
	// all — see docs/rtc/networking.md.
	//
	// Defaults to 51000-51200 rather than the more conventional 50000+ so
	// the range does not collide with whatever a host already had bound
	// there — two media processes contending for a port surfaces as
	// unexplained connection failures rather than a clear bind error, and
	// during the migration off LiveKit that was exactly 50000-50019.
	UDPPortMin uint16
	UDPPortMax uint16

	// ICEServers this node itself uses when gathering candidates. Usually
	// empty: an SFU normally sits on a reachable address and does not need
	// to relay its own traffic. Set when the node is itself behind NAT.
	STUNServers []string

	Version  string
	LogLevel string
}

func Load() (*Config, error) {
	cfg := &Config{
		NodeID:                   envOr("SFU_NODE_ID", defaultNodeID()),
		Region:                   envOr("SFU_REGION", "local"),
		PublicHost:               envOr("SFU_PUBLIC_HOST", "localhost"),
		PublicIP:                 os.Getenv("SFU_PUBLIC_IP"),
		HTTPAddr:                 envOr("SFU_HTTP_ADDR", ":7000"),
		ControlPlaneURL:          envOr("SFU_CONTROL_PLANE_URL", "http://localhost:4000"),
		RegistrationSecret:       os.Getenv("SFU_REGISTRATION_SECRET"),
		HeartbeatIntervalSeconds: envIntOr("SFU_HEARTBEAT_INTERVAL_SECONDS", 10),
		RoomCapacity:             envIntOr("SFU_ROOM_CAPACITY", 100),
		UDPPortMin:               uint16(envIntOr("SFU_UDP_PORT_MIN", 51000)),
		UDPPortMax:               uint16(envIntOr("SFU_UDP_PORT_MAX", 51200)),
		Version:                  envOr("SFU_VERSION", "dev"),
		LogLevel:                 envOr("SFU_LOG_LEVEL", "info"),
	}

	if stun := os.Getenv("SFU_STUN_SERVERS"); stun != "" {
		for _, s := range strings.Split(stun, ",") {
			if s = strings.TrimSpace(s); s != "" {
				cfg.STUNServers = append(cfg.STUNServers, s)
			}
		}
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	if c.RegistrationSecret == "" {
		// Refusing to boot is the honest failure. A node that started
		// without this would gather no rooms while still passing its own
		// health check — the worst kind of broken.
		return fmt.Errorf("SFU_REGISTRATION_SECRET is required — this node cannot register with the control plane without it")
	}
	if c.UDPPortMin == 0 || c.UDPPortMax == 0 || c.UDPPortMax < c.UDPPortMin {
		return fmt.Errorf("SFU_UDP_PORT_MIN/MAX must describe a non-empty range, got %d-%d", c.UDPPortMin, c.UDPPortMax)
	}
	// Two ports per participant is a rough floor (RTP mux keeps this low,
	// but ICE gathers more than one candidate). A range that cannot hold
	// the advertised capacity would fail as mysterious connection errors
	// under load, which is exactly when nobody wants to debug it.
	if span := int(c.UDPPortMax-c.UDPPortMin) + 1; span < c.RoomCapacity {
		return fmt.Errorf(
			"UDP port range %d-%d has %d ports but SFU_ROOM_CAPACITY is %d — widen the range or lower the capacity",
			c.UDPPortMin, c.UDPPortMax, span, c.RoomCapacity,
		)
	}
	if c.HeartbeatIntervalSeconds < 1 {
		return fmt.Errorf("SFU_HEARTBEAT_INTERVAL_SECONDS must be at least 1, got %d", c.HeartbeatIntervalSeconds)
	}
	return nil
}

// InternalURL is the address the control plane calls this node back on.
// Derived from the listen address and the container hostname, since a node
// knows where it is listening and an operator should not have to restate it.
func (c *Config) InternalURL() string {
	if explicit := os.Getenv("SFU_INTERNAL_URL"); explicit != "" {
		return explicit
	}
	host := os.Getenv("HOSTNAME")
	if host == "" {
		host = "localhost"
	}
	port := c.HTTPAddr
	if idx := strings.LastIndex(port, ":"); idx >= 0 {
		port = port[idx+1:]
	}
	return fmt.Sprintf("http://%s:%s", host, port)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envIntOr(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

// defaultNodeID prefers the container hostname, which is stable for a
// StatefulSet pod and unique for a Deployment one. Better than a random id,
// which would orphan a registry row on every restart.
func defaultNodeID() string {
	if host := os.Getenv("HOSTNAME"); host != "" {
		return "sfu-" + host
	}
	return "sfu-local-01"
}
