// Package registry keeps this node's entry in the control plane's fleet
// registry current.
//
// Registration is the node's job, not an operator's: a node's existence is
// a fact about the deployment, and requiring someone to also declare it in
// a database is how fleets end up with phantom rows for machines that were
// scaled down months ago.
package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/corvidhq/raven/services/sfu/internal/config"
	"github.com/corvidhq/raven/services/sfu/internal/room"
)

// requestTimeout bounds a registration or heartbeat call. Short, because a
// heartbeat that takes longer than the interval would pile up, and because
// the next attempt is only seconds away anyway.
const requestTimeout = 5 * time.Second

type Client struct {
	cfg     *config.Config
	manager *room.Manager
	http    *http.Client
	logger  *slog.Logger

	// registered tracks whether the control plane knows us. A heartbeat
	// that comes back 404 clears it, so the next tick re-registers rather
	// than heartbeating into the void forever — which is what happens if
	// the control plane's database was restored from a backup.
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

// Register announces this node. Safe to call repeatedly — the control
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
// A failed heartbeat is logged and retried on the next tick rather than
// aborting: the control plane being briefly unreachable must not stop this
// node serving the calls already on it. What it does cost is new
// allocations — the control plane will mark us unhealthy after the timeout,
// which is the correct behaviour from its side.
func (c *Client) Run(ctx context.Context) {
	// The first registration is retried with backoff rather than being
	// required to succeed, so a node that boots slightly before the API
	// does not crash-loop.
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
		// The control plane has no record of us — a restored database, or a
		// row deleted by hand. Re-register on the next tick.
		c.logger.Warn("control plane does not know this node — will re-register")
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
