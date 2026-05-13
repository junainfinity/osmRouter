// Package tunnels orchestrates one inbound sidecar connection: the
// register-frame handshake, the role-flip into HTTP/2 client, and the
// connection lifecycle (heartbeat + cleanup).
package tunnels

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"time"

	"github.com/osmrouter/proxy-node/internal/framing"
	"github.com/osmrouter/proxy-node/internal/ingest"
	"github.com/osmrouter/proxy-node/internal/registry"
	"golang.org/x/net/http2"
)

// Handler accepts a fully-TLS-handshaked sidecar connection, runs the
// register-frame exchange, validates with the Control Plane, registers
// the tunnel, and starts the health-watchdog goroutine.
type Handler struct {
	Reg     *registry.Registry
	Ingest  *ingest.Client
	NodeID  string
	Logger  *slog.Logger

	// HandshakeTimeout bounds how long we wait for the sidecar to send
	// its register frame after TLS handshake.
	HandshakeTimeout time.Duration

	// PingInterval is how often we ping the HTTP/2 connection to detect
	// silent failures (e.g., the sidecar's process crashed before close).
	PingInterval time.Duration

	// PingTimeout is the per-ping deadline.
	PingTimeout time.Duration
}

// New returns a Handler with sane defaults.
func New(reg *registry.Registry, ing *ingest.Client, nodeID string, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{
		Reg:              reg,
		Ingest:           ing,
		NodeID:           nodeID,
		Logger:           logger,
		HandshakeTimeout: 10 * time.Second,
		PingInterval:     30 * time.Second,
		PingTimeout:      10 * time.Second,
	}
}

// Serve runs the full lifecycle for one inbound connection. Blocks until
// the connection ends. Caller is responsible for closing tlsConn after.
func (h *Handler) Serve(ctx context.Context, tlsConn *tls.Conn) {
	defer func() { _ = tlsConn.Close() }()

	// 1) Read register frame (byte-by-byte; see framing pkg).
	frame, err := framing.ReadRegisterFrame(tlsConn, h.HandshakeTimeout)
	if err != nil {
		h.Logger.Warn("handshake: bad register frame", "err", err)
		_ = framing.WriteRegisterResponse(tlsConn, &framing.RegisterResponse{
			OK: false, Code: "BAD_FRAME", Message: err.Error(),
		})
		return
	}

	// 2) Validate with Control Plane.
	vctx, vcancel := context.WithTimeout(ctx, 8*time.Second)
	res, err := h.Ingest.Verify(vctx, frame.Token, frame.DeviceID, frame.Host)
	vcancel()
	if err != nil || res == nil {
		h.Logger.Warn("handshake: verify failed", "host", frame.Host, "err", err)
		_ = framing.WriteRegisterResponse(tlsConn, &framing.RegisterResponse{
			OK: false, Code: "VERIFY_UNAVAILABLE", Message: "control plane unreachable",
		})
		return
	}
	if !res.Valid {
		h.Logger.Info("handshake: rejected by control plane", "host", frame.Host, "reason", res.Reason)
		_ = framing.WriteRegisterResponse(tlsConn, &framing.RegisterResponse{
			OK: false, Code: "UNAUTHORIZED", Message: res.Reason,
		})
		return
	}

	// 3) Send ack.
	if err := framing.WriteRegisterResponse(tlsConn, &framing.RegisterResponse{
		OK: true, NodeID: h.NodeID, KeepaliveMS: 30000,
	}); err != nil {
		h.Logger.Warn("handshake: write ack failed", "err", err)
		return
	}

	// 4) Flip into HTTP/2 *client* mode. The sidecar is concurrently
	// calling http2.Server.ServeConn on its end of the same TLS connection.
	// Now we issue requests; it serves them.
	h2t := &http2.Transport{
		AllowHTTP:       false,
		ReadIdleTimeout: 90 * time.Second,
		PingTimeout:     15 * time.Second,
	}
	cc, err := h2t.NewClientConn(tlsConn)
	if err != nil {
		h.Logger.Warn("handshake: h2.NewClientConn failed", "err", err)
		return
	}

	// 5) Register.
	tun := registry.NewTunnel(frame.Host, res.DeviceID, res.UserID, h.NodeID, cc)
	prev := h.Reg.Set(frame.Host, tun)
	_ = prev // already logged inside Set
	h.Logger.Info("tunnel: up", "host", frame.Host, "device_id", res.DeviceID, "user_id", res.UserID)

	// 6) Tell Control Plane (best-effort; failure doesn't matter for serving).
	tid, _ := h.Ingest.TunnelStarted(ctx, res.DeviceID, frame.Host)

	// 7) Watch the connection. Returns when ping fails or ctx cancels.
	h.watch(ctx, tun)

	// 8) Cleanup.
	h.Reg.Delete(frame.Host, tun)
	tun.Close()
	if tid != "" {
		end, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = h.Ingest.TunnelEnded(end, tid, 0) // bytes counter is v1.1
		cancel()
	}
	h.Logger.Info("tunnel: down", "host", frame.Host, "device_id", res.DeviceID)
}

// watch blocks until either the connection fails its periodic ping or
// ctx is canceled.
func (h *Handler) watch(ctx context.Context, tun *registry.Tunnel) {
	t := time.NewTicker(h.PingInterval)
	defer t.Stop()
	missed := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-tun.Closed():
			return
		case <-t.C:
			pctx, cancel := context.WithTimeout(ctx, h.PingTimeout)
			err := tun.Healthcheck(pctx)
			cancel()
			if err != nil {
				missed++
				h.Logger.Warn("tunnel: ping failed", "host", tun.Host, "miss", missed, "err", err)
				if missed >= 3 {
					return
				}
				continue
			}
			missed = 0
		}
	}
}

// ErrConnClosed is returned by Healthcheck when the conn is gone.
var ErrConnClosed = errors.New("tunnel: connection closed")

// Compile-time conformance check
var _ net.Conn = (*tls.Conn)(nil)
