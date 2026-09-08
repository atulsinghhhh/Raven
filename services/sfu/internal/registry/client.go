// Package registry keeps this node's entry in the control plane's fleet
// registry up to date.
//
// Registering is the node's job, not an operator's. A node existing is a
// fact about the deployment, and making somebody separately declare it in a
// database is exactly how fleets end up full of phantom rows for machines
// that were scaled down months ago.
package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/atulsinghhhh/Raven/services/sfu/internal/config"
	"github.com/atulsinghhhh/Raven/services/sfu/internal/room"
)

// requestTimeout caps a registration or heartbeat call. Kept short: a
// heartbeat slower than the interval piles up behind itself, and the next
// attempt is only seconds away regardless.
const requestTimeout = 5 * time.Second

type Client struct {
	cfg     *config.Config
	manager *room.Manager
	http    *http.Client
	logger  *slog.Logger

	// registered: does the control plane know about us? A heartbeat coming
	// back 404 clears it so the next tick re-registers, instead of
	// heartbeating into the void forever. Which is what you get when
	// somebody restores the control plane's database from a backup.
	registered bool
}

func NewClient(cfg *config.Config, manager *room.Manager, logger *slog.Logger) *Client {
	return &Client{
		cfg:     cfg,
		manager: manager,
		http:    &http.Client{Timeout: requestTimeout},
		logger:  logger.With("component", "registry"),
	}
}

type registerRequest struct {
	Name        string `json:"name"`
	Region      string `json:"region"`
	PublicHost  string `json:"publicHost"`
	InternalURL string `json:"internalUrl"`
	Capacity    int    `json:"capacity"`
	Version     string `json:"version"`
}

type heartbeatRequest struct {
	ActiveRooms        int      `json:"activeRooms"`
	ActiveParticipants int      `json:"activeParticipants"`
	CPUPercent         *float64 `json:"cpuPercent,omitempty"`
	MemoryPercent      *float64 `json:"memoryPercent,omitempty"`
	NetworkInBps       *float64 `json:"networkInBps,omitempty"`
	NetworkOutBps      *float64 `json:"networkOutBps,omitempty"`
}

// Register announces this node. Call it as often as you like; the control
// plane upserts by name.
func (c *Client) Register(ctx context.Context) error {
	body := registerRequest{
		Name:        c.cfg.NodeID,
		Region:      c.cfg.Region,
		PublicHost:  c.cfg.PublicHost,
		InternalURL: c.cfg.InternalURL(),
		Capacity:    c.cfg.RoomCapacity,
		Version:     c.cfg.Version,
	}

	status, err := c.post(ctx, http.MethodPost, "/v1/rtc/servers/register", body)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("registration rejected with status %d", status)
	}

	c.registered = true
	c.logger.Info("registered with control plane",
		"node", c.cfg.NodeID, "region", c.cfg.Region, "capacity", c.cfg.RoomCapacity)
	return nil
}

// Run registers, then heartbeats until the context is cancelled.
//
// A failed heartbeat gets logged and retried on the next tick. We don't
// abort. The control plane being briefly unreachable must not stop this
// node serving the calls already on it. It does cost us new allocations,
// since the control plane marks us unhealthy once the timeout passes, and
// that's the right call from where it's sitting.
func (c *Client) Run(ctx context.Context) {
	// First registration gets retried with backoff instead of having to
	// succeed outright, so a node that boots a few seconds ahead of the API
	// doesn't sit there crash-looping.
	c.registerWithRetry(ctx)

	ticker := time.NewTicker(time.Duration(c.cfg.HeartbeatIntervalSeconds) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.tick(ctx)
		}
	}
}

func (c *Client) registerWithRetry(ctx context.Context) {
	backoff := time.Second
	const maxBackoff = 30 * time.Second

	for {
		if err := c.Register(ctx); err == nil {
			return
		} else {
			c.logger.Warn("registration failed, retrying", "err", err, "retryIn", backoff)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
			if backoff < maxBackoff {
				backoff *= 2
			}
		}
	}
}

func (c *Client) tick(ctx context.Context) {
	if !c.registered {
		if err := c.Register(ctx); err != nil {
			c.logger.Warn("re-registration failed", "err", err)
		}
		return
	}

	load := c.manager.Load()
	body := heartbeatRequest{
		ActiveRooms:        load.Rooms,
		ActiveParticipants: load.Participants,
	}
	if usage, err := readResourceUsage(); err == nil {
		body.CPUPercent = usage.CPUPercent
		body.MemoryPercent = usage.MemoryPercent
	}

	path := fmt.Sprintf("/v1/rtc/servers/%s/heartbeat", c.cfg.NodeID)
	status, err := c.post(ctx, http.MethodPut, path, body)
	if err != nil {
		c.logger.Warn("heartbeat failed", "err", err)
		return
	}

	switch {
	case status == http.StatusNotFound:
		// Control plane has no record of us. Restored database, or somebody
		// deleted the row by hand. Re-register on the next tick.
		c.logger.Warn("control plane does not know this node; will re-register")
		c.registered = false
	case status < 200 || status >= 300:
		c.logger.Warn("heartbeat rejected", "status", status)
	}
}

func (c *Client) post(ctx context.Context, method, path string, body any) (int, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return 0, fmt.Errorf("encode request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.cfg.ControlPlaneURL+path, bytes.NewReader(encoded))
	if err != nil {
		return 0, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.RegistrationSecret)

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("call control plane: %w", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}
