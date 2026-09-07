// Command sfu is Raven's Selective Forwarding Unit.
//
// It receives media from publishers and forwards it to subscribers over
// standards-compliant WebRTC — ICE, DTLS-SRTP, RTP/RTCP — using Pion. It
// holds no application state: rooms, participants, permissions and tokens
// all live in Raven's control plane, and this process learns about them
// only through the node link.
//
// That split is the point. Clients never address this process directly, so
// the media plane can be redeployed, re-scaled, or reimplemented without
// an SDK release.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	ossignal "os/signal"
	"syscall"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/corvidhq/raven/services/sfu/internal/config"
	"github.com/corvidhq/raven/services/sfu/internal/metrics"
	"github.com/corvidhq/raven/services/sfu/internal/registry"
	"github.com/corvidhq/raven/services/sfu/internal/room"
	"github.com/corvidhq/raven/services/sfu/internal/signal"
)

// shutdownGrace bounds how long we wait for rooms to close cleanly on
// SIGTERM. Closing a PeerConnection properly lets the client reconnect
// immediately instead of waiting out an ICE timeout, which is the
// difference between a two-second blip and a thirty-second one for
// everyone on a call during a deploy.
const shutdownGrace = 10 * time.Second

func main() {
	cfg, err := config.Load()
	if err != nil {
		// No logger yet, and this is fatal — stderr is the right channel.
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	logger := newLogger(cfg)
	logger.Info("starting raven sfu",
		"node", cfg.NodeID, "region", cfg.Region, "version", cfg.Version,
		"httpAddr", cfg.HTTPAddr, "udpRange", portRange(cfg), "capacity", cfg.RoomCapacity)

	// The manager and the node link are mutually referential: the manager
	// raises events the link forwards, and the link drives the manager.
	// Declared first, wired below.
	var link *signal.Server
	var nodeMetrics *metrics.Metrics

	events := room.RoomEvents{
		OnOffer: func(p *room.Participant, sdp webrtc.SessionDescription) {
			nodeMetrics.NegotiationsStarted.Inc()
			link.SendOffer(p, sdp)
		},
		OnICECandidate: func(p *room.Participant, candidate *webrtc.ICECandidate) {
			link.SendICECandidate(p, candidate)
		},
		OnTrackChange: func(p *room.Participant, track *room.PublishedTrack, published bool) {
			counter := nodeMetrics.TracksUnpublished
			if published {
				counter = nodeMetrics.TracksPublished
			}
			counter.WithLabelValues(track.Kind.String(), string(track.Source())).Inc()
			link.SendTrackChange(p, track, published)
		},
		OnStateChange: func(p *room.Participant, iceState, peerState string) {
			switch peerState {
			case webrtc.PeerConnectionStateConnected.String():
				nodeMetrics.ConnectionsSucceeded.Inc()
			case webrtc.PeerConnectionStateFailed.String():
				nodeMetrics.ConnectionsFailed.Inc()
			}
			link.SendConnectionState(p, iceState, peerState)
		},
		OnParticipantGone: func(p *room.Participant) {
			nodeMetrics.ParticipantsLeft.Inc()
		},
	}

	manager, err := room.NewManager(cfg, events, logger)
	if err != nil {
		logger.Error("could not build webrtc stack", "err", err)
		os.Exit(1)
	}

	link = signal.NewServer(manager, cfg.RegistrationSecret, logger)
	link.Start()
	defer link.Stop()
	nodeMetrics = metrics.New(manager, link.Connected)

	ctx, stop := ossignal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	registryClient := registry.NewClient(cfg, manager, logger)
	go registryClient.Run(ctx)

	server := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: newHTTPHandler(cfg, manager, link, nodeMetrics),
		// Read/write timeouts are deliberately unset: the node link is a
		// long-lived WebSocket, and a write timeout here would kill it. The
		// link does its own per-frame timeout instead.
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("http listening", "addr", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server failed", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")

	// Rooms first, then the listener: closing PeerConnections while the
	// control plane can still be told about it means the clients on those
	// calls learn their session ended, rather than discovering it by
	// timeout.
	manager.Shutdown()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Warn("http shutdown did not complete cleanly", "err", err)
	}
	logger.Info("stopped")
}

func newHTTPHandler(cfg *config.Config, manager *room.Manager, link *signal.Server, nodeMetrics *metrics.Metrics) http.Handler {
	mux := http.NewServeMux()

	// The node link. Control traffic only — media never touches this
	// listener.
	mux.Handle("/internal/link", link.Handler())

	mux.Handle("/metrics", nodeMetrics.Handler())

	// Liveness: is the process running at all. Deliberately does not check
	// the node link, because a node whose link is down should not be
	// restarted — it is still serving calls, and restarting would drop them.
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"node":    cfg.NodeID,
			"region":  cfg.Region,
			"version": cfg.Version,
		})
	})

	// Readiness: can this node take new participants. Requires the link,
	// because without it there is no way to be told about one.
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		load := manager.Load()
		ready := link.Connected()
		status := http.StatusOK
		if !ready {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, map[string]any{
			"ready":              ready,
			"nodeLinks":          link.LinkCount(),
			"activeRooms":        load.Rooms,
			"activeParticipants": load.Participants,
			"capacity":           cfg.RoomCapacity,
		})
	})

	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func newLogger(cfg *config.Config) *slog.Logger {
	level := slog.LevelInfo
	switch cfg.LogLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}

	// JSON, with the node id on every line. Spec §28 wants every RTC
	// operation traceable: room, participant, track and session ids are
	// attached at the point they are known, and the node id here means a
	// line from a fleet of SFUs says which one produced it.
	handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	return slog.New(handler).With("service", "raven-sfu", "rtcServer", cfg.NodeID)
}

func portRange(cfg *config.Config) string {
	return fmt.Sprintf("%d-%d", cfg.UDPPortMin, cfg.UDPPortMax)
}
