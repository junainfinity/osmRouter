// Package hub keeps the in-memory registry of connected tunnel clients on
// a single proxy node. One device may have at most one active tunnel; new
// connections from the same device replace the old (see Planning/10 §C8).
//
// The hub also tracks in-flight streams — one per visitor request currently
// awaiting a response. The router registers a stream before sending a
// `request` frame and consumes its response on the corresponding channel.
package hub

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/osmrouter/proxy-node/internal/tunnel"
)

// Tunnel is a single connected client (one device, one open WebSocket).
type Tunnel struct {
	DeviceID string
	UserID   string
	NodeID   string
	OpenedAt time.Time

	conn   *websocket.Conn
	send   chan []byte
	closed chan struct{}
	once   sync.Once
	logger *slog.Logger
}

// NewTunnel constructs a Tunnel around an already-upgraded WebSocket. The
// caller is expected to start the read pump separately (the read pump
// drives stream-response delivery and lives in the WS handler).
func NewTunnel(conn *websocket.Conn, deviceID, userID, nodeID string, logger *slog.Logger) *Tunnel {
	return &Tunnel{
		DeviceID: deviceID,
		UserID:   userID,
		NodeID:   nodeID,
		OpenedAt: time.Now(),
		conn:     conn,
		send:     make(chan []byte, 256),
		closed:   make(chan struct{}),
		logger:   logger,
	}
}

// Send queues a frame for transmission. Returns an error if the tunnel is
// closed or the send buffer is full and not drained within a short window.
func (t *Tunnel) Send(frame *tunnel.Frame) error {
	b, err := frame.Marshal()
	if err != nil {
		return err
	}
	select {
	case <-t.closed:
		return errors.New("tunnel: closed")
	case t.send <- b:
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("tunnel: send buffer full")
	}
}

// WritePump drains the send channel to the WebSocket. It also injects
// periodic WS-level pings. Blocks until the tunnel is closed.
func (t *Tunnel) WritePump(pingInterval, writeTimeout time.Duration) {
	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	defer t.Close()
	for {
		select {
		case <-t.closed:
			return
		case msg, ok := <-t.send:
			if !ok {
				return
			}
			_ = t.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := t.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			_ = t.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := t.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Closed returns a channel that is closed when the tunnel has shut down.
func (t *Tunnel) Closed() <-chan struct{} { return t.closed }

// Close is idempotent. After Close, further Send calls return error.
func (t *Tunnel) Close() {
	t.once.Do(func() {
		close(t.closed)
		_ = t.conn.Close()
	})
}

// ===========================================================================

// Hub is the per-proxy-node registry of connected tunnels and active streams.
type Hub struct {
	mu      sync.RWMutex
	tunnels map[string]*Tunnel // device_id → tunnel

	streams sync.Map // stream_id → chan *tunnel.Frame
	logger  *slog.Logger
}

// New returns an empty Hub.
func New(logger *slog.Logger) *Hub {
	return &Hub{tunnels: make(map[string]*Tunnel), logger: logger}
}

// Register attaches a tunnel for a device. If one already exists, it is
// closed (with a `close` frame, reason "replaced"). Returns the replaced
// tunnel (if any) so the caller can audit the replacement.
func (h *Hub) Register(t *Tunnel) (replaced *Tunnel) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if prev, ok := h.tunnels[t.DeviceID]; ok {
		_ = prev.Send(&tunnel.Frame{Type: tunnel.FrameClose, Code: "replaced", Message: "another client connected with the same device_id"})
		go func(prev *Tunnel) {
			time.Sleep(200 * time.Millisecond) // allow the close frame to flush
			prev.Close()
		}(prev)
		replaced = prev
	}
	h.tunnels[t.DeviceID] = t
	return
}

// Unregister removes a tunnel from the hub IFF it is still the current one
// for its device (i.e., wasn't already replaced).
func (h *Hub) Unregister(t *Tunnel) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if cur, ok := h.tunnels[t.DeviceID]; ok && cur == t {
		delete(h.tunnels, t.DeviceID)
	}
}

// LookupByDevice returns the currently registered tunnel for a device, or nil.
func (h *Hub) LookupByDevice(deviceID string) *Tunnel {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.tunnels[deviceID]
}

// Stats returns counts for observability.
func (h *Hub) Stats() (tunnels int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.tunnels)
}

// ----- Stream registry -----

// RegisterStream allocates a response channel for a pending visitor request
// and returns a function the caller MUST defer to clean up.
func (h *Hub) RegisterStream(streamID string) (<-chan *tunnel.Frame, func()) {
	ch := make(chan *tunnel.Frame, 1)
	h.streams.Store(streamID, ch)
	return ch, func() { h.streams.Delete(streamID) }
}

// DeliverStream routes an incoming frame to the registered handler for its
// stream. If no handler is registered (likely a late response after the
// caller gave up), the frame is dropped and a warning is logged.
func (h *Hub) DeliverStream(f *tunnel.Frame) {
	v, ok := h.streams.Load(f.StreamID)
	if !ok {
		if h.logger != nil {
			h.logger.Warn("hub: dropping orphan stream frame", "stream_id", f.StreamID, "type", f.Type)
		}
		return
	}
	ch := v.(chan *tunnel.Frame)
	select {
	case ch <- f:
	default:
		// Buffer already has a frame — unusual. Drop and warn.
		if h.logger != nil {
			h.logger.Warn("hub: stream channel full, dropping", "stream_id", f.StreamID)
		}
	}
}

// ----- helpers -----

// WaitWithCancel blocks until either a frame is delivered, the context is
// canceled, or the timeout elapses. Returns the frame or a typed error.
func WaitWithCancel(ctx context.Context, ch <-chan *tunnel.Frame, timeout time.Duration) (*tunnel.Frame, error) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case f := <-ch:
		return f, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, errors.New("hub: stream timeout")
	}
}
