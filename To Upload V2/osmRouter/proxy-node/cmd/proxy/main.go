// Command proxy is the osmRouter Data Plane proxy node, Option D edition.
//
// It runs two TCP listeners:
//
//  1. TLS listener (default :8443) — sidecars dial in here. Each
//     connection completes a TLS 1.3 handshake (with the operator's leaf
//     cert), sends a JSON register frame, and is upgraded to HTTP/2
//     where the proxy plays the client role.
//
//  2. Public HTTP listener (default :8000) — visitor traffic. Each
//     request is matched to a registered tunnel by Host header and
//     forwarded via httputil.ReverseProxy with FlushInterval=-1 so the
//     stream is preserved end-to-end. This is what makes SSE / LLM
//     token streaming work.
//
// The proxy talks to the Control Plane via /api/v1/proxy/* using a
// shared Bearer secret. v1.1 will move to per-node mTLS.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/osmrouter/proxy-node/internal/ca"
	"github.com/osmrouter/proxy-node/internal/forward"
	"github.com/osmrouter/proxy-node/internal/ingest"
	"github.com/osmrouter/proxy-node/internal/registry"
	"github.com/osmrouter/proxy-node/internal/tunnels"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg := loadConfig()
	logger.Info("starting proxy node",
		"node_id", cfg.NodeID,
		"tls_addr", cfg.TLSAddr,
		"public_addr", cfg.PublicAddr,
		"control_plane", cfg.ControlPlaneURL)

	// Load operator CA bundle.
	bundle, err := ca.Load(cfg.RootCA, cfg.LeafCert, cfg.LeafKey)
	if err != nil {
		logger.Error("ca load", "err", err)
		os.Exit(1)
	}

	reg := registry.New(logger)
	ing := ingest.New(cfg.ControlPlaneURL, cfg.SharedSecret, cfg.NodeID)
	handler := tunnels.New(reg, ing, cfg.NodeID, logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1) Start the TLS listener for sidecar connections.
	go func() {
		ln, err := tls.Listen("tcp", cfg.TLSAddr, bundle.ServerConfig())
		if err != nil {
			logger.Error("tls listen", "addr", cfg.TLSAddr, "err", err)
			cancel()
			return
		}
		logger.Info("tls listener up", "addr", cfg.TLSAddr)
		for {
			c, err := ln.Accept()
			if err != nil {
				if errors.Is(err, net.ErrClosed) {
					return
				}
				logger.Warn("tls accept", "err", err)
				continue
			}
			go serveTLS(ctx, c, handler, logger)
		}
	}()

	// 2) Start the public HTTP listener for visitor traffic.
	fwd := forward.New(reg, logger)
	publicSrv := &http.Server{
		Addr:              cfg.PublicAddr,
		Handler:           fwd,
		ReadHeaderTimeout: 10 * time.Second,
		// IdleTimeout intentionally LONG — multi-turn LLM clients keep
		// connections warm.
		IdleTimeout: 5 * time.Minute,
	}
	go func() {
		logger.Info("public listener up", "addr", cfg.PublicAddr)
		if err := publicSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("public listener", "err", err)
		}
	}()

	// 3) Heartbeat loop.
	go heartbeat(ctx, ing, reg, logger)

	// 4) Wait for shutdown.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh
	logger.Info("shutdown signal received, draining")

	shutdownCtx, c2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer c2()
	_ = publicSrv.Shutdown(shutdownCtx)
	cancel()
	logger.Info("proxy node offline")
}

func serveTLS(ctx context.Context, c net.Conn, h *tunnels.Handler, logger *slog.Logger) {
	tlsConn, ok := c.(*tls.Conn)
	if !ok {
		_ = c.Close()
		return
	}
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		logger.Warn("tls handshake from sidecar failed", "remote", c.RemoteAddr().String(), "err", err)
		_ = tlsConn.Close()
		return
	}
	h.Serve(ctx, tlsConn)
}

func heartbeat(ctx context.Context, ing *ingest.Client, reg *registry.Registry, logger *slog.Logger) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n, hosts := reg.Stats()
			hbCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			if err := ing.Heartbeat(hbCtx, n, hosts); err != nil {
				logger.Warn("heartbeat", "err", err)
			}
			cancel()
		}
	}
}

// Config ----

type config struct {
	NodeID          string
	TLSAddr         string
	PublicAddr      string
	RootCA          string
	LeafCert        string
	LeafKey         string
	ControlPlaneURL string
	SharedSecret    string
}

func loadConfig() *config {
	host, _ := os.Hostname()
	return &config{
		NodeID:          env("OSM_NODE_ID", "node-"+host),
		TLSAddr:         env("OSM_TLS_LISTEN_ADDR", ":8443"),
		PublicAddr:      env("OSM_PUBLIC_LISTEN_ADDR", ":8000"),
		RootCA:          env("OSM_CA_ROOT_PEM", "/etc/osm/ca/root.pem"),
		LeafCert:        env("OSM_CA_LEAF_CERT_PEM", "/etc/osm/ca/proxy-leaf.pem"),
		LeafKey:         env("OSM_CA_LEAF_KEY_PEM", "/etc/osm/ca/proxy-leaf.key"),
		ControlPlaneURL: env("OSM_CONTROL_PLANE_URL", "http://localhost:8080"),
		SharedSecret:    env("OSM_PROXY_NODE_SECRET", ""),
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// envInt is included for future tunable parameters.
func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

var _ = fmt.Sprintf  // silence unused
var _ = envInt
