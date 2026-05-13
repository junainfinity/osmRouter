# 14 — Option D Architecture (technical detail)

## 1. Components & Files

### New / Replaced

```
proxy-node/                                  (REPLACED — old code archived to _old/)
├── cmd/proxy/main.go                        Entry point, wires the two listeners
├── internal/
│   ├── ca/ca.go                             Loads operator root CA + leaf cert
│   ├── registry/registry.go                 host → http.Transport  (sync.RWMutex)
│   ├── tunnels/tunnels.go                   per-connection wrapper: handshake +
│   │                                          h2 transport + registry lifecycle
│   ├── forward/forward.go                   httputil.ReverseProxy with custom Director
│   │                                          and per-host transport selection
│   ├── ingest/ingest.go                     calls Control Plane /api/v1/proxy/*
│   └── verify/verify.go                     Bearer auth for Control Plane callbacks
├── go.mod
└── Makefile

server/                                      (1 endpoint change)
└── internal/proxyingest/handlers.go         VerifyDevice now takes {api_key, host}
                                              and validates host belongs to device

osmRouter Mac/osmRouter-app/apps/sidecar/    (5 small changes + register frame)
└── internal/tunnel/tunnel.go                tuned localHTTPClient; register frame
```

### Unchanged

Everything in `server/` except the one verify-handler. Dashboard, admin, audit, billing, auth flow — all untouched. The Mac app's Electron/Renderer code untouched. Mac sidecar's TLS pinning, host-check, target-IP allowlist, telemetry, crash-restart logic — all untouched.

## 2. Pinned-CA Design

### Bootstrap (`scripts/init-ca.sh`)

Run once per operator install:

```bash
# Generates:
#   ca/root.key   (kept locked-down on operator's box)
#   ca/root.pem   (distributed inside both binaries)
#   ca/proxy-leaf.key + ca/proxy-leaf.pem  (mounted into proxy-node container)
#
# The root cert is valid 10 years.
# The leaf is valid 90 days; rotate via cron + rolling proxy restart.
```

The root PEM is small (~1 KB). It's:

1. Embedded into the **proxy-node Docker image** at build time so the proxy can verify clients.
2. Embedded into the **Mac sidecar binary** at build time (via `//go:embed`) so the sidecar can verify the proxy without needing a separate file on disk.

This means **the trust anchor travels with the binaries**. There's no "did the user install the CA correctly?" question. The pinned CA is baked into the artefact.

### Why no client cert?

For v1 we authenticate clients via the Bearer token in the register frame, not via mTLS client certs. Reasons:
- Operator already issues per-device API keys via the dashboard; one is enough.
- mTLS per-device cert provisioning adds an enrolment step that users don't need yet.
- mTLS is on the v1.1 hardening list for defence-in-depth.

The proxy's leaf cert is the only mTLS-relevant cert; clients validate it.

## 3. Wire Protocol Detail

After the TLS handshake completes, the sidecar sends a **single line** of UTF-8 JSON terminated by `\n`. Maximum line length: 4 KB. The proxy reads this line *before* installing the HTTP/2 server on the conn. This avoids needing to invent an HTTP/2 control extension.

**Sidecar → Proxy (`register` frame):**

```json
{"v":1,"device_id":"<uuid>","token":"osm_<base64>","host":"<fqdn>","client":"osm-agent/0.1.0"}\n
```

**Proxy → Sidecar (response frame):**

```json
{"ok":true,"node_id":"node-prod-01","keepalive_ms":30000}\n
```

or

```json
{"ok":false,"code":"UNAUTHORIZED","message":"<reason>"}\n
```

Both frames are < 1 KB. After the response, both sides flip into HTTP/2 mode by calling:

- **Proxy side**: `http2.Transport.NewClientConn(tlsConn)` — proxy becomes the H2 client.
- **Sidecar side**: `(&http2.Server{}).ServeConn(tlsConn, &http2.ServeConnOpts{Handler: forwarder})` — sidecar becomes the H2 server.

The TLS connection now carries HTTP/2 frames in both directions. The HTTP/2 preface comes from the proxy as the client; the sidecar accepts and serves.

## 4. Routing

### Registry

```go
type Registry struct {
    mu sync.RWMutex
    byHost map[string]*Tunnel  // host → tunnel
}

type Tunnel struct {
    DeviceID string
    UserID   string
    Host     string
    H2Conn   *http2.ClientConn  // the proxy is the h2 client
    Transport http.RoundTripper // wraps H2Conn for httputil use
    OpenedAt time.Time
}
```

### Forwarder

```go
// hosted under /api/v1 NO, under the public listener
director := func(r *http.Request) {
    // Find the tunnel for this host; nothing else to rewrite — the
    // request URL stays as the visitor sent it, the Transport will
    // dispatch over h2.
    r.URL.Scheme = "https"  // pretended for h2; never actually dialed
    r.URL.Host   = r.Host
    r.Header.Set("X-Forwarded-For", clientIP(r))
    r.Header.Set("X-Forwarded-Proto", "https")
}

transport := &perHostTransport{registry: reg}

rp := &httputil.ReverseProxy{
    Director:      director,
    Transport:     transport,
    FlushInterval: -1,            // ★ stream every chunk
    ErrorHandler:  serve502OrHolding,
}
```

**The `FlushInterval = -1` is the entire streaming story.** With it, every byte read from the upstream response is written to the visitor immediately. Without it, Go buffers chunks and flushes periodically (kills SSE).

### Per-host transport

```go
type perHostTransport struct{ registry *Registry }

func (t *perHostTransport) RoundTrip(r *http.Request) (*http.Response, error) {
    tun := t.registry.Get(r.Host)
    if tun == nil {
        return nil, errNoSuchHost  // -> 503 holding page or 502
    }
    return tun.Transport.RoundTrip(r)
}
```

`tun.Transport` is a thin wrapper that holds a single `*http2.ClientConn`. We don't pool; each tunnel has its own connection. If a connection drops mid-request, that's a 502 to the visitor; sidecar will reconnect within seconds.

## 5. Holding State (PRD §4.1)

When a host has no tunnel in the registry, the proxy returns:

- **HTTP 503** with `Retry-After: 5` and a clean HTML page saying "Reconnecting…"
- This is what visitors saw in the v1 design. Same UX.

When a host has a tunnel but the H2 connection has died (e.g., sidecar process killed before `Close` fired):

- The `Transport.RoundTrip` returns `ErrConnClosed` or similar.
- The `ErrorHandler` writes 502 once. The sidecar (or its replacement) will re-register within 1-30s due to exponential backoff.

## 6. Security Properties Preserved from v1

Every Yellow Paper §9 invariant carries over:

- ✓ TLS 1.3 with pinned operator CA
- ✓ Host header validation (sidecar-side, already there)
- ✓ X-Forwarded-For sanitisation (proxy injects; sidecar passes through)
- ✓ Target IP allow-list (sidecar-side, already there)
- ✓ Append-only audit log per tunnel lifecycle
- ✓ Bearer token, never in argv (env-var only)

New properties gained:
- ✓ End-to-end **streaming** (SSE, gRPC, long inference)
- ✓ **No body cap** anywhere in the path (HTTP/2 framing handles arbitrary length)
- ✓ **Connection-pooled** keep-alive for multi-turn chat workloads
- ✓ Native **HTTP/2 multiplexing** — many concurrent inference requests over one tunnel

## 7. Configuration Surface

### Proxy-node env vars (new shape)

```
OSM_TLS_LISTEN_ADDR        :443                          (sidecar inbound TLS)
OSM_PUBLIC_LISTEN_ADDR     :80                           (visitor traffic; behind reverse proxy)
OSM_CA_ROOT_PEM            /etc/osm/ca/root.pem
OSM_CA_LEAF_CERT_PEM       /etc/osm/ca/proxy-leaf.pem
OSM_CA_LEAF_KEY_PEM        /etc/osm/ca/proxy-leaf.key
OSM_CONTROL_PLANE_URL      http://server:8080
OSM_PROXY_NODE_SECRET      <shared>
OSM_NODE_ID                node-prod-01
OSM_PUBLIC_HOST_SUFFIX     osmrouter.com    (optional, for *.osmrouter.com customer-less mode)
```

### Mac sidecar (unchanged surface, register frame added internally)

Same flags as before: `--domain`, `--local-port`, `--proxy-url`, `--root-ca` (ignored if compiled-in CA is used), `--target`. Env `OSM_TOKEN` still carries the token.

## 8. Concrete LLM Streaming Test Plan

| Step | Tool | Expected |
|---|---|---|
| 1. Start Ollama in Docker with `qwen2.5:0.5b` (~370 MB model) | `docker run -p 11434:11434 ollama/ollama` + `ollama pull` | Ollama responds at `http://localhost:11434/v1/chat/completions` |
| 2. Start LM Studio on Mac (user has it running already at :1234) | manual | Same shape, OpenAI-compatible |
| 3. Run two sidecar processes from the new compiled binary | `osm-agent run --domain app.ollama.test.localtest.me --local-port 11434 …` and similar for LM Studio | Both registered in proxy's registry |
| 4. From a separate shell: `curl -N https://app.ollama.test.localtest.me/v1/chat/completions -d '{"model":"qwen2.5:0.5b","messages":[{"role":"user","content":"count to 30"}],"stream":true}'` | curl | Tokens stream into the terminal one chunk at a time, not buffered |
| 5. Browser hits dashboard, sees both tunnels live | dashboard | Live tunnel rows, byte counters updating |
| 6. Take screenshots | puppeteer | 6 frames documenting each step |
