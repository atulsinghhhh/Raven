// Command sfu is Raven's Selective Forwarding Unit.
//
// Media comes in from publishers, goes back out to subscribers, all over
// bog-standard WebRTC (ICE, DTLS-SRTP, RTP/RTCP) on top of Pion. No
// application state lives here. Rooms, participants, permissions, tokens:
// all of that is the control plane's problem, and this process only ever
// hears about it through the node link.
//
// Which is the whole reason for the split. Clients never address this
// process directly, so we can redeploy it, re-scale it, or throw the
// implementation away entirely without shipping a new SDK.
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

	"github.com/atulsinghhhh/Raven/services/sfu/internal/config"
	"github.com/atulsinghhhh/Raven/services/sfu/internal/metrics"
	"github.com/atulsinghhhh/Raven/services/sfu/internal/registry"
	"github.com/atulsinghhhh/Raven/services/sfu/internal/room"
	"github.com/atulsinghhhh/Raven/services/sfu/internal/signal"
)

// How long we'll wait for rooms to close cleanly on SIGTERM.
//
// Worth the wait. Closing a PeerConnection properly lets the client
// reconnect straight away instead of sitting out an ICE timeout: a
// two-second blip versus a thirty-second one, for everybody on a call,
// every time we deploy.
const shutdownGrace = 10 * time.Second

func main() {
	cfg, err := config.Load()
	if err != nil {
		// No logger yet and we're about to die. stderr it is.
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	logger := newLogger(cfg)
	logger.Info("starting raven sfu",
		"node", cfg.NodeID, "region", cfg.Region, "version", cfg.Version,
		"httpAddr", cfg.HTTPAddr, "udpRange", portRange(cfg), "capacity", cfg.RoomCapacity)

	// Chicken and egg. The manager raises events the link forwards, and the
	// link turns around and drives the manager. Declare both up here, wire
	// them together below.
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
		// No Read/Write timeouts on purpose. The node link is a long-lived
		// WebSocket and a write timeout would simply kill it. Per-frame
		// timeouts happen inside the link itself.
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

	// Order matters here. Close the PeerConnections while the control plane
	// can still be told about it, and clients get told their session ended
	// instead of working it out from a timeout.
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

	// The node link. Control traffic only; media never comes near this
	// listener.
	mux.Handle("/internal/link", link.Handler())

	mux.Handle("/metrics", nodeMetrics.Handler())

	// Liveness: is the process up at all?
	//
	// This does not check the node link, and mustn't. A node with a dead
	// link is still happily serving its existing calls. Restart it and you
	// drop every one of them.
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"node":    cfg.NodeID,
			"region":  cfg.Region,
			"version": cfg.Version,
		})
	})

	// Readiness: can this node take on new participants? Needs the link,
	// since without one nobody can tell us about them.
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

	// JSON, node id stamped on every line. Spec §28 wants every RTC
	// operation traceable, so room/participant/track/session ids get
	// attached wherever they happen to be known. The node id is what tells
	// you which box in the fleet produced a given line.
	handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	return slog.New(handler).With("service", "raven-sfu", "rtcServer", cfg.NodeID)
}

func portRange(cfg *config.Config) string {
	return fmt.Sprintf("%d-%d", cfg.UDPPortMin, cfg.UDPPortMax)
}
