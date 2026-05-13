// Package client implements the desktop side of the osmRouter tunnel.
//
// Lifecycle:
//
//  1. Dial the proxy node's WebSocket endpoint.
//  2. Send a `hello` frame with our device api_key. Receive `hello_ack`.
//  3. Loop: read frames from the proxy; for each `request`, forward to the
//     local app via the forwarder; write the resulting `response` frame.
//  4. On any error or close, reconnect with exponential backoff.
package client

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/osmrouter/tunnel-client/internal/forwarder"
	"github.com/osmrouter/tunnel-client/internal/tunnel"
)

// Config is the runtime configuration for a tunnel client.
type Config struct {
	ProxyURL     string // ws://... or wss://...
	APIKey       string
	DeviceID     string
	LocalTarget  string // http://localhost:3000
	Logger       *slog.Logger
	InitialDelay time.Duration
	MaxDelay     time.Duration
}

// Run drives the connect loop. Returns when ctx is canceled.
//
// Failures (dial, hello rejection, connection drop) trigger reconnect with
// exponential backoff up to MaxDelay. Auth rejection (`error` frame with
// code=UNAUTHORIZED) terminates Run with a fatal error — there's no point
// retrying with a known-bad key.
func Run(ctx context.Context, cfg Config) error {
	if cfg.InitialDelay == 0 {
		cfg.InitialDelay = 1 * time.Second
	}
	if cfg.MaxDelay == 0 {
		cfg.MaxDelay = 30 * time.Second
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	fwd := forwarder.New(cfg.LocalTarget)
	delay := cfg.InitialDelay

	for {
		if err := connectAndPump(ctx, cfg, fwd); err != nil {
			if errors.Is(err, ErrAuth) {
				return err
			}
			cfg.Logger.Warn("tunnel disconnected; reconnecting", "err", err, "delay", delay)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		delay *= 2
		if delay > cfg.MaxDelay {
			delay = cfg.MaxDelay
		}
	}
}

// ErrAuth indicates the proxy rejected our api_key. Fatal.
var ErrAuth = errors.New("client: auth rejected")

// connectAndPump is one connection attempt. Returns when the connection
// closes or fails. nil return means the parent ctx is done.
func connectAndPump(ctx context.Context, cfg Config, fwd *forwarder.Forwarder) error {
	if strings.HasPrefix(cfg.ProxyURL, "ws://") && !isLoopback(cfg.ProxyURL) {
		cfg.Logger.Warn("WARNING: non-loopback ws:// is insecure — use wss:// in production")
	}

	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 10 * time.Second
	conn, _, err := dialer.DialContext(ctx, cfg.ProxyURL, http.Header{})
	if err != nil {
		return err
	}
	defer conn.Close()

	// Send hello.
	hello := &tunnel.Frame{
		Type:     tunnel.FrameHello,
		DeviceID: cfg.DeviceID,
		APIKey:   cfg.APIKey,
		Version:  tunnel.ProtocolVersion,
	}
	if err := writeFrame(conn, hello); err != nil {
		return err
	}

	// Await hello_ack (or error).
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return err
	}
	ack, err := tunnel.Unmarshal(raw)
	if err != nil {
		return err
	}
	if ack.Type == tunnel.FrameError && ack.Code == "UNAUTHORIZED" {
		return ErrAuth
	}
	if ack.Type != tunnel.FrameHelloAck {
		return errors.New("client: expected hello_ack, got " + string(ack.Type))
	}
	cfg.Logger.Info("tunnel established", "node_id", ack.NodeID, "device_id", cfg.DeviceID)

	_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
		return nil
	})

	// Watchdog: close the WS as soon as the parent context cancels.
	// Without this, ReadMessage stays blocked even after cancel().
	closeOnce := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseGoingAway, "client shutting down"),
				time.Now().Add(time.Second))
			_ = conn.Close()
		case <-closeOnce:
		}
	}()
	defer close(closeOnce)

	// Concurrent writes: serialize through a channel.
	send := make(chan *tunnel.Frame, 64)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case f, ok := <-send:
				if !ok {
					return
				}
				if err := writeFrame(conn, f); err != nil {
					return
				}
			case <-t.C:
				_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// Read loop.
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			close(send)
			wg.Wait()
			return err
		}
		f, err := tunnel.Unmarshal(raw)
		if err != nil {
			cfg.Logger.Warn("frame decode", "err", err)
			continue
		}
		switch f.Type {
		case tunnel.FrameRequest:
			// Handle each request in its own goroutine — concurrent in-flight
			// requests are explicitly supported by the protocol.
			go func(in *tunnel.Frame) {
				resp := fwd.Forward(ctx, in)
				select {
				case send <- resp:
				case <-ctx.Done():
				}
			}(f)
		case tunnel.FramePing:
			send <- &tunnel.Frame{Type: tunnel.FramePong}
		case tunnel.FrameClose:
			cfg.Logger.Info("server requested close", "reason", f.Code, "msg", f.Message)
			close(send)
			wg.Wait()
			return nil
		case tunnel.FrameError:
			cfg.Logger.Warn("error frame from server", "code", f.Code, "msg", f.Message)
		}
		_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	}
}

func writeFrame(conn *websocket.Conn, f *tunnel.Frame) error {
	b, err := f.Marshal()
	if err != nil {
		return err
	}
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return conn.WriteMessage(websocket.TextMessage, b)
}

func isLoopback(u string) bool {
	return strings.Contains(u, "://localhost") ||
		strings.Contains(u, "://127.") ||
		strings.Contains(u, "://[::1]")
}
