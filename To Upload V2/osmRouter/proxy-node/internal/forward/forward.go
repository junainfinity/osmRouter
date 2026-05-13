// Package forward implements the visitor-facing reverse-proxy handler.
//
// Each visitor HTTP request is matched to a registered tunnel by Host
// header. The request is then routed through that tunnel's HTTP/2 client
// to the sidecar, which forwards to the user's local app. The whole path
// is **streaming** — `httputil.ReverseProxy.FlushInterval = -1` ensures
// every chunk reaches the visitor immediately, which is the only way SSE
// (token-by-token LLM streaming) works.
package forward

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"

	"github.com/osmrouter/proxy-node/internal/registry"
)

// Forwarder is the HTTP handler hosted on the public-facing port.
type Forwarder struct {
	Reg    *registry.Registry
	Logger *slog.Logger
	proxy  *httputil.ReverseProxy
}

// New wires a Forwarder around a registry.
func New(reg *registry.Registry, logger *slog.Logger) *Forwarder {
	if logger == nil {
		logger = slog.Default()
	}
	f := &Forwarder{Reg: reg, Logger: logger}
	f.proxy = &httputil.ReverseProxy{
		Director:      f.director,
		Transport:     &perHostTransport{reg: reg, logger: logger},
		FlushInterval: -1, // ★ stream every write immediately
		ErrorHandler:  f.handleError,
	}
	return f
}

// ServeHTTP entry point — implements http.Handler.
func (f *Forwarder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	host := stripPort(r.Host)
	if host == "" {
		http.Error(w, "missing Host header", http.StatusBadRequest)
		return
	}
	if f.Reg.Get(host) == nil {
		// no tunnel registered — return holding page rather than 502
		writeHolding(w, host)
		return
	}
	f.proxy.ServeHTTP(w, r)
}

// director rewrites the outbound request as required by ReverseProxy.
// Crucially: we set URL.Scheme and URL.Host so the HTTP/2 :authority is
// set correctly when the request travels over the tunnel (DR-D6).
func (f *Forwarder) director(r *http.Request) {
	r.URL.Scheme = "https"
	r.URL.Host = r.Host
	// Sanitize / overwrite X-Forwarded-* — don't trust visitor input.
	if ip, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		r.Header.Set("X-Forwarded-For", ip)
		r.Header.Set("X-Real-IP", ip)
	}
	r.Header.Set("X-Forwarded-Proto", "https")
	// Strip hop-by-hop headers
	for _, h := range []string{"Connection", "Keep-Alive", "Proxy-Authenticate",
		"Proxy-Authorization", "Te", "Trailers", "Transfer-Encoding", "Upgrade"} {
		r.Header.Del(h)
	}
}

// handleError is called when the ReverseProxy can't reach the tunnel.
func (f *Forwarder) handleError(w http.ResponseWriter, r *http.Request, err error) {
	host := stripPort(r.Host)
	f.Logger.Warn("forward error", "host", host, "err", err)
	if f.Reg.Get(host) == nil {
		writeHolding(w, host)
		return
	}
	// Tunnel still present but the request couldn't make it. Most likely
	// the local app behind the tunnel is down.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusBadGateway)
	fmt.Fprintf(w, badGatewayHTML, host)
}

// perHostTransport is the http.RoundTripper plugged into ReverseProxy.
// For each request, it looks up the tunnel for r.Host and uses that
// tunnel's HTTP/2 ClientConn to issue the request.
type perHostTransport struct {
	reg    *registry.Registry
	logger *slog.Logger
}

func (t *perHostTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	host := stripPort(r.URL.Host)
	tun := t.reg.Get(host)
	if tun == nil {
		return nil, errNoTunnel
	}
	return tun.ClientConn.RoundTrip(r)
}

// errNoTunnel surfaces via ReverseProxy.ErrorHandler.
var errNoTunnel = fmt.Errorf("no tunnel registered for host")

// stripPort returns the hostname without :port.
func stripPort(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}

// writeHolding emits a clean 503 with the "reconnecting" page.
func writeHolding(w http.ResponseWriter, host string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Retry-After", "5")
	w.WriteHeader(http.StatusServiceUnavailable)
	fmt.Fprintf(w, holdingHTML, host)
}

const holdingHTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reconnecting…</title>
<meta http-equiv="refresh" content="5">
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;color:#222;background:#fafafa;padding:40px;max-width:520px;margin:auto}
h1{font-size:18px;margin:0 0 8px}p{color:#666;margin:0}</style></head>
<body><h1>Reconnecting…</h1><p>The host for <code>%s</code> is temporarily offline. The page will reload automatically.</p></body></html>`

const badGatewayHTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>502 — Local app unreachable</title>
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;color:#222;background:#fafafa;padding:40px;max-width:520px;margin:auto}
h1{font-size:18px;margin:0 0 8px}p{color:#666;margin:0}</style></head>
<body><h1>502 — Local app unreachable</h1><p>The tunnel for <code>%s</code> is open, but the local app didn't respond.</p></body></html>`
