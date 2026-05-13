// Package registry holds the in-memory map from public hostname to the
// HTTP/2 transport that serves that hostname (via the connected sidecar).
//
// Concurrency is critical: Set must atomically replace a prior tunnel
// for the same host (closing the old one), and Get must be lock-free in
// the steady state because every visitor request hits it.
package registry

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"golang.org/x/net/http2"
)

// Tunnel is one connected sidecar + the HTTP/2 client we use to forward
// visitor requests over its TLS connection.
type Tunnel struct {
	Host     string
	DeviceID string
	UserID   string
	NodeID   string
	OpenedAt time.Time

	// ClientConn is the proxy-side HTTP/2 client. The sidecar runs
	// http2.Server.ServeConn on the OTHER end of the same TLS connection,
	// so requests we send through this ClientConn arrive at the sidecar
	// as if from a normal HTTP/2 client.
	ClientConn *http2.ClientConn

	// closeOnce ensures Close is idempotent.
	closeOnce sync.Once
	closed    chan struct{}
}

// NewTunnel constructs a Tunnel ready to register.
func NewTunnel(host, deviceID, userID, nodeID string, cc *http2.ClientConn) *Tunnel {
	return &Tunnel{
		Host:       host,
		DeviceID:   deviceID,
		UserID:     userID,
		NodeID:     nodeID,
		OpenedAt:   time.Now(),
		ClientConn: cc,
		closed:     make(chan struct{}),
	}
}

// Close tears down the HTTP/2 connection. Safe to call concurrently.
func (t *Tunnel) Close() {
	t.closeOnce.Do(func() {
		if t.ClientConn != nil {
			_ = t.ClientConn.Close()
		}
		close(t.closed)
	})
}

// Closed returns a channel closed when the tunnel has been torn down.
func (t *Tunnel) Closed() <-chan struct{} { return t.closed }

// Healthcheck pings the HTTP/2 connection. Used by the watchdog.
func (t *Tunnel) Healthcheck(ctx context.Context) error {
	if t.ClientConn == nil {
		return context.Canceled
	}
	return t.ClientConn.Ping(ctx)
}

// Registry is the per-proxy-node map of hosts to tunnels.
type Registry struct {
	mu      sync.RWMutex
	byHost  map[string]*Tunnel
	logger  *slog.Logger
}

// New returns a fresh empty Registry.
func New(logger *slog.Logger) *Registry {
	if logger == nil {
		logger = slog.Default()
	}
	return &Registry{byHost: make(map[string]*Tunnel), logger: logger}
}

// Set registers t under host. If a prior tunnel exists for the same host,
// it is closed and returned (so the caller can audit the replacement).
func (r *Registry) Set(host string, t *Tunnel) (replaced *Tunnel) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if prev, ok := r.byHost[host]; ok {
		r.logger.Info("registry: replacing tunnel", "host", host, "old_device", prev.DeviceID, "new_device", t.DeviceID)
		go prev.Close() // background — don't block the new registration
		replaced = prev
	}
	r.byHost[host] = t
	return
}

// Get returns the tunnel for a host, or nil. Read-side is RWMutex-RLocked
// so concurrent visitor requests don't serialize.
func (r *Registry) Get(host string) *Tunnel {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.byHost[host]
}

// Delete removes the tunnel for host iff it's still the given tunnel.
// (Otherwise we'd race with Set during a quick reconnect.)
func (r *Registry) Delete(host string, t *Tunnel) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.byHost[host] == t {
		delete(r.byHost, host)
		r.logger.Info("registry: tunnel removed", "host", host)
	}
}

// Stats returns observability counters.
func (r *Registry) Stats() (tunnels int, hosts []string) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tunnels = len(r.byHost)
	hosts = make([]string, 0, tunnels)
	for h := range r.byHost {
		hosts = append(hosts, h)
	}
	return
}
