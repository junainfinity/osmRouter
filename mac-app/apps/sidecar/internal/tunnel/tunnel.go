// Package tunnel implements the runtime data plane of the osm-agent.
//
// One Tunnel instance per binding:
//
//  1. Dial the cloud proxy over TLS 1.3 with a pinned root CA.
//  2. Use the resulting TLS connection as an HTTP/2 server — the cloud
//     proxy is the "client" issuing inbound requests; we're the server
//     answering them. This inversion is what makes the tunnel
//     NAT-traversal-free (PRD §5.2): we never have to accept inbound TCP.
//  3. For each inbound request, validate the Host header (S7.4), then
//     forward to 127.0.0.1:<localPort> with an injected X-Forwarded-For.
//  4. Emit telemetry, log every request, and reconnect with exponential
//     backoff (PRD §4.1.4) on disconnect.
//
// In v0.1 the cloud proxy is operated separately; we test the data plane
// against the internal/mockproxy package, which speaks the same TLS+H2
// protocol.
//
// Security controls implemented here:
//
//   - S7.1–S7.3 — TLS 1.3 only, pinned root CA (delegated to pinned_tls)
//   - S7.4      — Host header validation (delegated to hostcheck)
//   - S8.1–S8.2 — Target IP allow-list: only loopback + RFC1918
package tunnel

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/osmrouter/sidecar/internal/embedded_ca"
	"github.com/osmrouter/sidecar/internal/hostcheck"
	"github.com/osmrouter/sidecar/internal/pinned_tls"
	"github.com/osmrouter/sidecar/internal/telemetry"
	"golang.org/x/net/http2"
)

// Options is the per-binding configuration. Build one in cmd/osm-agent
// from the CLI flags and pass it to New.
type Options struct {
	// Domain is the public FQDN this tunnel serves (e.g. "dev.example.com").
	// Used both for HOST header validation and for the proxy handshake.
	Domain string
	// LocalPort is the TCP port on Target where the user's app listens.
	LocalPort int
	// Protocol is informational; "HTTP" today, others reserved.
	Protocol string
	// Target IPv4. Defaults to 127.0.0.1. Anything not loopback/RFC1918
	// is rejected by New (S8.1/S8.2).
	Target string
	// ProxyURL is the cloud proxy endpoint ("https://..."). Must be HTTPS.
	ProxyURL string
	// RootCAPath is an optional PEM file with the pinned trust anchor.
	// When empty, the sidecar falls back to the operator root CA embedded
	// at compile time (see internal/embedded_ca). System trust is *never*
	// consulted in either path.
	RootCAPath string
	// Token is the scoped bearer token. The proxy verifies it before
	// joining us to the routing table.
	Token string
	// DeviceID identifies this device to the proxy/Control Plane. Optional
	// in v0.1 (where the proxy didn't validate it); required in v0.2+.
	DeviceID string
	// HostValidator decides whether an inbound Host header is acceptable.
	// In production this is hostcheck.NewExact(Domain).
	HostValidator hostcheck.Validator
	// Telemetry sink for stdout JSON-line events.
	Telemetry *telemetry.Emitter
}

// Tunnel is the live data-plane object. Construct via New, drive with Run.
type Tunnel struct {
	opts   Options
	proxyU *url.URL
	tlsCfg *tls.Config
}

// New validates the options and pre-builds the TLS config. Returns a
// descriptive error for every invalid input so the parent can surface a
// helpful message in the UI.
//
// Errors:
//
//	"missing-domain"            — Domain is empty
//	"invalid-local-port"        — LocalPort outside 1..65535
//	"disallowed-target-ip:<ip>" — Target is not loopback/RFC1918
//	"bad-proxy-url: <err>"      — ProxyURL is not parseable
//	"proxy-url-not-https"       — ProxyURL scheme is not https
//	"pinned-ca-pem-invalid"     — RootCAPath does not contain a valid PEM
//	"no-pinned-ca: ..."         — RootCAPath empty AND no operator CA embedded
func New(opts Options) (*Tunnel, error) {
	if opts.Domain == "" {
		return nil, errors.New("missing-domain")
	}
	if opts.LocalPort < 1 || opts.LocalPort > 65535 {
		return nil, errors.New("invalid-local-port")
	}
	if opts.Target == "" {
		opts.Target = "127.0.0.1"
	}
	if !isAllowedTargetIP(opts.Target) {
		return nil, fmt.Errorf("disallowed-target-ip:%s", opts.Target)
	}
	pu, err := url.Parse(opts.ProxyURL)
	if err != nil {
		return nil, fmt.Errorf("bad-proxy-url: %w", err)
	}
	if pu.Scheme != "https" {
		return nil, errors.New("proxy-url-not-https")
	}
	// Trust anchor selection — explicit --root-ca path wins; otherwise we
	// fall back to the operator CA baked into the binary at compile time
	// (internal/embedded_ca). If neither is available, fail closed: refusing
	// to start beats silently downgrading to system trust.
	var pool *x509.CertPool
	if opts.RootCAPath != "" {
		pool, err = pinned_tls.LoadRootCA(opts.RootCAPath)
	} else {
		if vErr := embedded_ca.Validate(); vErr != nil {
			return nil, fmt.Errorf("no-pinned-ca: %w", vErr)
		}
		pool, err = pinned_tls.LoadRootCABytes(embedded_ca.RootPEM())
	}
	if err != nil {
		return nil, err
	}
	t := &Tunnel{
		opts:   opts,
		proxyU: pu,
		tlsCfg: pinned_tls.Config(pool, pu.Hostname()),
	}
	return t, nil
}

// isAllowedTargetIP enforces S8.1 (default to loopback) and S8.2 (LAN
// bind only with caller-side consent). Public IPs, multicast, link-local,
// and the unspecified 0.0.0.0 are all rejected — the UI never offers
// those options, and any caller passing one is treated as malformed.
func isAllowedTargetIP(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	if ip.IsPrivate() {
		return true
	}
	return false
}

// Run drives the dial-serve-reconnect loop until ctx is cancelled.
//
// On a clean disconnect or ctx cancellation, Run returns ctx.Err().
// On an unrecoverable error (TLS misconfiguration, pinned-CA missing on
// disk after start, etc.), Run returns that error. The CLI translates
// "ctx-cancelled" to exit 0 and everything else to exit 1.
//
// Reconnection: per PRD §4.1, every disconnect triggers an exponential
// backoff (1s → 2s → 4s → ... cap 64s). The cap keeps us from creating
// hot loops against an unreachable proxy and bounds the resume latency.
func (t *Tunnel) Run(ctx context.Context) error {
	t.opts.Telemetry.Info("dialing-proxy")

	// Dial with backoff. PRD §4.1.4.
	attempt := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := t.runOnce(ctx)
		if err == nil {
			return nil
		}
		t.opts.Telemetry.Warn(fmt.Sprintf("proxy-disconnected: %v", err))
		// Exponential backoff with jitter elision.
		delay := backoff(attempt)
		attempt++
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// backoff returns the delay for the Nth reconnection attempt. Doubles
// from 1s and caps at 64s (attempt 6). Mirrors the Main-side
// `backoffMs(attempt, { base: 1000 })` so the UI's banner countdown
// matches what the sidecar actually does.
func backoff(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	if attempt > 6 {
		attempt = 6
	}
	return time.Duration(1<<uint(attempt)) * time.Second
}

// runOnce performs one dial→serve cycle:
//
//  1. TCP-dial the cloud proxy with a 5s timeout.
//  2. TLS-handshake using the pinned trust pool.
//  3. Emit "ready" so the parent flips UI state to Active.
//  4. ServeConn — block on this until the proxy closes the connection or
//     ctx cancels.
//
// Returns io.EOF on a clean disconnect; an unwrapped error otherwise.
// The caller (Run) treats both as "reconnect after backoff".
func (t *Tunnel) runOnce(ctx context.Context) error {
	host := t.proxyU.Host
	if !strings.Contains(host, ":") {
		host = host + ":443"
	}
	rawConn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", host)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	tlsConn := tls.Client(rawConn, t.tlsCfg)
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		_ = rawConn.Close()
		return fmt.Errorf("tls-handshake: %w", err)
	}
	t.opts.Telemetry.Info("tls-handshake-ok")

	// --- v0.2: send register frame, await ack ----------------------------
	// The cloud proxy expects a single JSON line carrying the device
	// identity + token + host, then flips into HTTP/2 *client* mode. See
	// proxy-node/internal/framing for the canonical spec.
	if err := writeRegisterFrame(tlsConn, t.opts); err != nil {
		_ = tlsConn.Close()
		return fmt.Errorf("register-write: %w", err)
	}
	resp, err := readRegisterResponse(tlsConn)
	if err != nil {
		_ = tlsConn.Close()
		return fmt.Errorf("register-read: %w", err)
	}
	if !resp.OK {
		_ = tlsConn.Close()
		// Fatal: bad token / unknown host / revoked device.
		return fmt.Errorf("register-rejected: %s: %s", resp.Code, resp.Message)
	}
	// ---------------------------------------------------------------------

	t.opts.Telemetry.Ready()

	// Use HTTP/2 over the TLS conn for stream multiplexing.
	h2 := &http2.Server{
		MaxReadFrameSize:           1 << 20, // 1 MiB — fast SSE chunks
		MaxConcurrentStreams:       250,
		PermitProhibitedCipherSuites: false,
		IdleTimeout:                  5 * time.Minute,
	}
	mw := hostcheck.Middleware(t.opts.HostValidator, func(host string) {
		t.opts.Telemetry.Warn("host-header-mismatch:" + host)
	})
	handler := mw(http.HandlerFunc(t.forwardLocal))
	h2.ServeConn(tlsConn, &http2.ServeConnOpts{Handler: handler})
	return io.EOF
}

// writeRegisterFrame emits a single-line JSON object identifying this
// sidecar to the proxy. Bytes are written in one Write call.
func writeRegisterFrame(c net.Conn, opts Options) error {
	frame := map[string]interface{}{
		"v":         1,
		"device_id": opts.Domain, // fallback if Options.DeviceID is empty
		"token":     opts.Token,
		"host":      opts.Domain,
		"client":    "osm-agent/0.2.0",
	}
	if opts.DeviceID != "" {
		frame["device_id"] = opts.DeviceID
	}
	b, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	_ = c.SetWriteDeadline(time.Now().Add(10 * time.Second))
	_, err = c.Write(b)
	_ = c.SetWriteDeadline(time.Time{})
	return err
}

// registerResponse mirrors the proxy's ack/reject JSON.
type registerResponse struct {
	OK          bool   `json:"ok"`
	NodeID      string `json:"node_id,omitempty"`
	KeepaliveMS int    `json:"keepalive_ms,omitempty"`
	Code        string `json:"code,omitempty"`
	Message     string `json:"message,omitempty"`
}

// readRegisterResponse consumes the response frame byte-by-byte until
// '\n'. Must NOT use bufio.Reader — see proxy-node/internal/framing
// DR-D5 note.
func readRegisterResponse(c net.Conn) (*registerResponse, error) {
	_ = c.SetReadDeadline(time.Now().Add(10 * time.Second))
	defer func() { _ = c.SetReadDeadline(time.Time{}) }()
	buf := make([]byte, 0, 256)
	one := make([]byte, 1)
	for {
		n, err := c.Read(one)
		if err != nil {
			return nil, err
		}
		if n == 0 {
			continue
		}
		if one[0] == '\n' {
			break
		}
		buf = append(buf, one[0])
		if len(buf) > 4096 {
			return nil, fmt.Errorf("response too large")
		}
	}
	var r registerResponse
	if err := json.Unmarshal(buf, &r); err != nil {
		return nil, fmt.Errorf("decode: %w (raw=%q)", err, string(buf))
	}
	return &r, nil
}

// forwardLocal proxies one inbound request to the user's local origin.
//
// Pre-conditions: the Host header has already been validated by the
// hostcheck middleware. By the time we reach this function the request is
// known to be for our --domain.
//
// Side effects:
//   - Increments active-connection counter for telemetry
//   - Copies all inbound headers (except Host, which net/http rewrites)
//   - Injects X-Forwarded-For so the user's app sees the visitor IP (PRD §5.3)
//   - On origin-dial failure, returns 502 to the proxy and emits a
//     warning to stdout so the Diagnostic HUD can show the user.
func (t *Tunnel) forwardLocal(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	t.opts.Telemetry.ConnsOpened()
	defer t.opts.Telemetry.ConnsClosed()

	target := fmt.Sprintf("http://%s:%d%s", t.opts.Target, t.opts.LocalPort, r.URL.RequestURI())
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
	if err != nil {
		http.Error(w, "bad-gateway", http.StatusBadGateway)
		return
	}
	// Copy headers, then inject X-Forwarded-For. PRD §5.3.
	for k, vs := range r.Header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	} else {
		if ip, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
			req.Header.Set("X-Forwarded-For", ip)
		}
	}

	resp, err := localHTTPClient.Do(req)
	if err != nil {
		// Surface ECONNREFUSED cleanly. Logged for the "Diagnostic HUD".
		t.opts.Telemetry.Warn(fmt.Sprintf("origin-dial-failed: %v", err))
		http.Error(w, "bad-gateway", http.StatusBadGateway)
		t.emitReq(r, http.StatusBadGateway, time.Since(start), 0)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	n, _ := bufferedCopy(w, resp.Body)
	t.opts.Telemetry.AddInbound(uint64(n))
	t.opts.Telemetry.AddOutbound(uint64(n))
	t.opts.Telemetry.RecordLatency(time.Since(start))
	t.emitReq(r, resp.StatusCode, time.Since(start), n)
}

func (t *Tunnel) emitReq(r *http.Request, status int, elapsed time.Duration, sizeBytes int) {
	remote := r.Header.Get("X-Forwarded-For")
	if remote == "" {
		remote = r.RemoteAddr
	}
	t.opts.Telemetry.Request(
		r.Method, r.URL.Path, status, int(elapsed/time.Millisecond), sizeBytes, remote,
	)
}

func bufferedCopy(dst io.Writer, src io.Reader) (int, error) {
	br := bufio.NewReader(src)
	n, err := io.Copy(dst, br)
	return int(n), err
}

// localHTTPClient is used to dial the user's local origin.
//
// Tuned for AI inference workloads (v0.2):
//   - **No wall-clock Timeout**: LLM responses can take 30s–5min.
//     Connection-level liveness is handled by ResponseHeaderTimeout +
//     visitor-context cancellation, not a global stopwatch.
//   - **30s ResponseHeaderTimeout**: cold-loading a model can take >5s
//     before the first byte. 30s is the empirical safety margin.
//   - **5min IdleConnTimeout**: multi-turn chat keeps connections warm.
//   - **64 KiB read/write buffers**: faster SSE chunk throughput.
//   - **No env-proxy**: prevents local-attacker MITM via env vars.
//   - **No redirect-following**: forward verbatim; visitor browser follows.
var localHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		ResponseHeaderTimeout: 30 * time.Second,
		IdleConnTimeout:       5 * time.Minute,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		ReadBufferSize:        64 * 1024,
		WriteBufferSize:       64 * 1024,
		ForceAttemptHTTP2:     true,
	},
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
	// Timeout: 0  (intentionally unset — see comment above)
}
