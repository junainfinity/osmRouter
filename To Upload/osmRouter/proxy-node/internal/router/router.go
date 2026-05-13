// Package router implements the proxy node's public-facing HTTP handler.
//
// For every visitor request:
//  1. The Host header is looked up in Redis (`live:<fqdn>` → device_id).
//  2. If the device has an active tunnel, a request frame is sent across
//     the tunnel and the response frame is awaited.
//  3. If the mapping is missing → 502 (no such tunnel registered).
//  4. If the mapping exists but no tunnel is currently connected →
//     503 with the holding-state page (PRD §4.1, simplified for v1).
//
// Request bodies are capped at tunnel.MaxBodyBytes (4 MB by default). The
// body is read BEFORE forwarding only when we know a tunnel is present —
// for hub-miss / holding-state responses, we short-circuit to spare both
// our memory and the visitor's bandwidth (Planning/10 §C12).
package router

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/osmrouter/proxy-node/internal/hub"
	"github.com/osmrouter/proxy-node/internal/tunnel"
)

// MappingStore is the contract the router needs from a routing-table backend.
// In production this is Redis; tests inject a fake.
type MappingStore interface {
	LookupDevice(ctx context.Context, host string) (deviceID string, err error)
}

// Router is the visitor-facing HTTP handler.
type Router struct {
	mappings       MappingStore
	hub            *hub.Hub
	logger         *slog.Logger
	streamTimeout  time.Duration
	maxBodyBytes   int64
}

// New constructs a Router.
func New(m MappingStore, h *hub.Hub, logger *slog.Logger) *Router {
	return &Router{
		mappings:      m,
		hub:           h,
		logger:        logger,
		streamTimeout: 30 * time.Second,
		maxBodyBytes:  tunnel.MaxBodyBytes,
	}
}

// ServeHTTP handles a single visitor request. Stateless; safe to mount as the
// proxy node's primary http.Handler.
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	host := stripPort(req.Host)

	deviceID, err := r.mappings.LookupDevice(ctx, host)
	if err != nil {
		r.logger.Warn("mapping lookup failed", "host", host, "err", err)
		writeBadGateway(w, "no route for "+host)
		return
	}
	if deviceID == "" {
		writeBadGateway(w, "no route for "+host)
		return
	}

	t := r.hub.LookupByDevice(deviceID)
	if t == nil {
		// Mapping exists but device isn't connected right now: holding-state.
		writeHoldingState(w, host)
		return
	}

	// Body cap. We read fully here — streaming is out of scope for v1.
	body, err := io.ReadAll(io.LimitReader(req.Body, r.maxBodyBytes+1))
	if err != nil {
		writeBadGateway(w, "could not read request body")
		return
	}
	if int64(len(body)) > r.maxBodyBytes {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return
	}

	streamID := uuid.NewString()
	respCh, cleanup := r.hub.RegisterStream(streamID)
	defer cleanup()

	frame := &tunnel.Frame{
		Type:     tunnel.FrameRequest,
		StreamID: streamID,
		Method:   req.Method,
		URL:      req.URL.RequestURI(),
		Headers:  sanitizeHeaders(req.Header, req.RemoteAddr),
		BodyB64:  tunnel.EncodeBody(body),
	}
	if err := t.Send(frame); err != nil {
		writeBadGateway(w, "tunnel send failed: "+err.Error())
		return
	}

	resp, err := hub.WaitWithCancel(ctx, respCh, r.streamTimeout)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return // visitor went away
		}
		writeGatewayTimeout(w)
		return
	}
	if resp.Type == tunnel.FrameError {
		writeBadGateway(w, resp.Message)
		return
	}
	writeResponseToVisitor(w, resp)
}

// stripPort returns the host portion without an attached `:port`.
func stripPort(host string) string {
	for i := 0; i < len(host); i++ {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
}

// sanitizeHeaders strips/overwrites headers that must come from the proxy
// (visitor IP family) rather than be trusted from the wire (Planning/11 DR14).
func sanitizeHeaders(in http.Header, remoteAddr string) map[string][]string {
	out := make(map[string][]string, len(in))
	for k, v := range in {
		// Drop hop-by-hop headers; they shouldn't be relayed end-to-end.
		switch k {
		case "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
			"Te", "Trailers", "Transfer-Encoding", "Upgrade":
			continue
		}
		out[k] = append([]string(nil), v...)
	}
	// Authoritatively set forwarding headers; never trust visitor input here.
	out["X-Forwarded-For"] = []string{remoteAddr}
	out["X-Real-Ip"] = []string{remoteAddr}
	out["X-Forwarded-Proto"] = []string{"http"} // v1; in prod Cloudflare adds https
	return out
}

// writeResponseToVisitor reconstructs an HTTP response from a `response` frame.
func writeResponseToVisitor(w http.ResponseWriter, f *tunnel.Frame) {
	for k, vs := range f.Headers {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	if f.Status == 0 {
		f.Status = http.StatusOK
	}
	w.WriteHeader(f.Status)
	if body, err := tunnel.DecodeBody(f.BodyB64); err == nil && len(body) > 0 {
		_, _ = w.Write(body)
	}
}

// writeBadGateway emits a clean 502 page (no script, no images).
func writeBadGateway(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusBadGateway)
	fmt.Fprintf(w, badGatewayHTML, reason)
}

// writeHoldingState emits the "Reconnecting…" page per PRD §4.1.
func writeHoldingState(w http.ResponseWriter, host string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Retry-After", "10")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusServiceUnavailable)
	fmt.Fprintf(w, holdingStateHTML, host)
}

func writeGatewayTimeout(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusGatewayTimeout)
	_, _ = w.Write([]byte("<h1>504 — Gateway timeout</h1><p>The upstream tunnel didn't respond in time.</p>"))
}

const badGatewayHTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>502 — No route</title>
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;color:#222;background:#fafafa;padding:40px;max-width:520px;margin:auto}
h1{font-size:18px;margin:0 0 8px}p{color:#666;margin:0}</style></head>
<body><h1>502 — No route</h1><p>%s</p></body></html>`

const holdingStateHTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reconnecting…</title><meta http-equiv="refresh" content="5">
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;color:#222;background:#fafafa;padding:40px;max-width:520px;margin:auto}
h1{font-size:18px;margin:0 0 8px}p{color:#666;margin:0}</style></head>
<body><h1>Reconnecting…</h1><p>The host for <code>%s</code> is temporarily offline. The page will reload automatically.</p></body></html>`
