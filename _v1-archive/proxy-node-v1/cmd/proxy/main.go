// Command proxy is the osmRouter Data Plane proxy node.
//
// It serves two concurrent listeners:
//
//   - PUBLIC (HTTP) at OSM_PUBLIC_ADDR  — accepts visitor traffic.
//   - TUNNEL (WebSocket) at OSM_TUNNEL_ADDR — accepts persistent connections
//     from desktop tunnel-client instances.
//
// Routing rule: when a visitor request arrives with Host=`api.acme.test`,
// the proxy looks up `live:api.acme.test` in Redis. The value is the
// `device_id` whose tunnel should serve the request. The hub registry maps
// device_id → active WebSocket tunnel.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	goredis "github.com/redis/go-redis/v9"

	"github.com/osmrouter/proxy-node/internal/config"
	"github.com/osmrouter/proxy-node/internal/hub"
	"github.com/osmrouter/proxy-node/internal/ingest"
	"github.com/osmrouter/proxy-node/internal/router"
	"github.com/osmrouter/proxy-node/internal/tunnel"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config load", "err", err)
		os.Exit(1)
	}
	logger.Info("starting proxy node", "node_id", cfg.NodeID, "public_addr", cfg.PublicAddr, "tunnel_addr", cfg.TunnelAddr)

	// ----- Redis -----
	redisOpt, err := goredis.ParseURL(cfg.RedisURL)
	if err != nil {
		logger.Error("redis url parse", "err", err)
		os.Exit(1)
	}
	rdb := goredis.NewClient(redisOpt)
	{
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := rdb.Ping(ctx).Err(); err != nil {
			logger.Error("redis ping", "err", err, "url", cfg.RedisURL)
			os.Exit(1)
		}
	}

	mappings := &redisMappings{rdb: rdb}
	hubInst := hub.New(logger)
	ingestClient := ingest.New(cfg.ControlPlaneURL, cfg.SharedSecret, cfg.NodeID)

	// ----- Public HTTP server (visitor-facing) -----
	rtr := router.New(mappings, hubInst, logger)
	publicSrv := &http.Server{
		Addr:              cfg.PublicAddr,
		Handler:           rtr,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// ----- Tunnel WebSocket server (desktop-facing) -----
	tunnelMux := http.NewServeMux()
	tunnelMux.HandleFunc("/ws/tunnel", makeTunnelHandler(hubInst, ingestClient, cfg.NodeID, logger))
	tunnelMux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	tunnelSrv := &http.Server{
		Addr:              cfg.TunnelAddr,
		Handler:           tunnelMux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// ----- Start servers -----
	go func() {
		logger.Info("public listener up", "addr", cfg.PublicAddr)
		if err := publicSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("public listener", "err", err)
		}
	}()
	go func() {
		logger.Info("tunnel listener up", "addr", cfg.TunnelAddr)
		if err := tunnelSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("tunnel listener", "err", err)
		}
	}()

	// ----- Periodic heartbeat -----
	hbCtx, hbCancel := context.WithCancel(context.Background())
	defer hbCancel()
	go heartbeat(hbCtx, ingestClient, hubInst, logger)

	// ----- Wait for shutdown signal -----
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	logger.Info("shutdown signal — draining")
	hbCancel()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = publicSrv.Shutdown(shutdownCtx)
	_ = tunnelSrv.Shutdown(shutdownCtx)
	_ = rdb.Close()
	logger.Info("proxy node offline")
}

// ---------------------------------------------------------------------------
// Redis-backed mapping store
// ---------------------------------------------------------------------------

type redisMappings struct{ rdb *goredis.Client }

func (r *redisMappings) LookupDevice(ctx context.Context, host string) (string, error) {
	v, err := r.rdb.Get(ctx, "live:"+host).Result()
	if errors.Is(err, goredis.Nil) {
		return "", nil
	}
	return v, err
}

// ---------------------------------------------------------------------------
// Tunnel listener handler
// ---------------------------------------------------------------------------

var tunnelUpgrader = websocket.Upgrader{
	ReadBufferSize:  64 * 1024,
	WriteBufferSize: 64 * 1024,
	// Tunnel clients are NOT browsers; origin checks don't apply. We auth
	// via the api_key in the `hello` frame after upgrade.
	CheckOrigin: func(*http.Request) bool { return true },
}

func makeTunnelHandler(h *hub.Hub, ing *ingest.Client, nodeID string, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := tunnelUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}

		// Allow up to 5s to receive the `hello` frame, then close.
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			_ = conn.Close()
			return
		}
		hello, err := tunnel.Unmarshal(raw)
		if err != nil || hello.Type != tunnel.FrameHello {
			_ = writeFrame(conn, &tunnel.Frame{Type: tunnel.FrameError, Code: "BAD_HELLO", Message: "first frame must be hello"})
			_ = conn.Close()
			return
		}
		if err := hello.Validate(); err != nil {
			_ = writeFrame(conn, &tunnel.Frame{Type: tunnel.FrameError, Code: "BAD_HELLO", Message: err.Error()})
			_ = conn.Close()
			return
		}

		// Validate api_key against Control Plane.
		verifyCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		res, err := ing.VerifyDevice(verifyCtx, hello.APIKey)
		if err != nil || res == nil || !res.Valid {
			_ = writeFrame(conn, &tunnel.Frame{Type: tunnel.FrameError, Code: "UNAUTHORIZED", Message: "device api_key rejected"})
			_ = conn.Close()
			return
		}

		// Hello accepted. Clear read deadline (we set ping-driven ones in the loop).
		_ = conn.SetReadDeadline(time.Time{})
		conn.SetPongHandler(func(string) error {
			_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
			return nil
		})

		tn := hub.NewTunnel(conn, res.DeviceID, res.UserID, nodeID, logger)
		if prev := h.Register(tn); prev != nil {
			logger.Info("tunnel replaced (same device)", "device_id", res.DeviceID, "user_id", res.UserID)
		}
		_ = writeFrame(conn, &tunnel.Frame{Type: tunnel.FrameHelloAck, NodeID: nodeID})
		logger.Info("tunnel up", "device_id", res.DeviceID, "user_id", res.UserID, "remote_addr", r.RemoteAddr)

		// Start write pump in a goroutine; do reads in the request goroutine.
		go tn.WritePump(30*time.Second, 10*time.Second)
		readPump(conn, tn, h, logger)
		tn.Close()
		h.Unregister(tn)
		logger.Info("tunnel down", "device_id", res.DeviceID)
	}
}

// readPump drains inbound frames from the WS and routes them to the stream
// registry. Returns when the connection ends or an unrecoverable error occurs.
func readPump(conn *websocket.Conn, tn *hub.Tunnel, h *hub.Hub, logger *slog.Logger) {
	conn.SetReadLimit(8 * 1024 * 1024) // hard upper bound; logical cap is per-frame body cap
	_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		f, err := tunnel.Unmarshal(raw)
		if err != nil {
			logger.Warn("frame decode failed", "device_id", tn.DeviceID, "err", err)
			continue
		}
		switch f.Type {
		case tunnel.FrameResponse, tunnel.FrameError:
			h.DeliverStream(f)
		case tunnel.FramePing:
			_ = tn.Send(&tunnel.Frame{Type: tunnel.FramePong})
		case tunnel.FramePong:
			// no-op
		default:
			logger.Warn("ignoring inbound frame", "type", f.Type, "device_id", tn.DeviceID)
		}
		_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	}
}

func writeFrame(conn *websocket.Conn, f *tunnel.Frame) error {
	b, err := json.Marshal(f)
	if err != nil {
		return err
	}
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return conn.WriteMessage(websocket.TextMessage, b)
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

func heartbeat(ctx context.Context, ing *ingest.Client, h *hub.Hub, logger *slog.Logger) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			beatCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			if err := ing.Heartbeat(beatCtx, h.Stats()); err != nil {
				logger.Warn("heartbeat failed", "err", err)
			}
			cancel()
		}
	}
}
