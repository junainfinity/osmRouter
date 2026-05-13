# 16 — Option D Risk Register

| ID | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| DR-D1 | Per-binding connection model wastes resources at scale (one TLS conn per active domain) | 🟡 medium | medium-term | Documented limit in DEPLOY V2; v1.1 multiplexes multiple bindings over one conn |
| DR-D2 | Embedded CA means rotation requires binary update | 🟡 medium | low | 2-week dual-trust window in operator runbook |
| DR-D3 | If proxy crashes, all tunnels need to re-register | 🟠 high (UX) | low | Mac sidecar's exponential-backoff reconnect already handles this; restoration is automatic within 30s |
| DR-D4 | `http2.Transport.NewClientConn` API stability | 🟡 medium | low | `golang.org/x/net/http2` is stable; vendored if needed |
| DR-D5 | Buffered `bufio.Reader` could swallow bytes past the register-frame newline | 🔴 critical | high if not careful | Read register frame **byte-by-byte** before installing H2; verified by integration test |
| DR-D6 | Proxy's `httputil.ReverseProxy.Director` doesn't set `URL.Host` → empty `:authority` → sidecar's host validator rejects | 🔴 critical | high if forgotten | Director explicitly sets `URL.Scheme=https`, `URL.Host=r.Host`; integration test verifies the sidecar sees `Host:` correctly |
| DR-D7 | Streaming visitor disconnects mid-stream — h2 stream cleanup leaks goroutine | 🟡 medium | medium | `httputil.ReverseProxy` propagates context cancellation; verified by chaos test (kill curl mid-stream) |
| DR-D8 | LM Studio / Ollama returns large initial header timeout if model is cold-loading | 🟠 high | likely on first request | `ResponseHeaderTimeout: 30s` in sidecar's `localHTTPClient`; visitor's first call may take 5s but won't 504 |
| DR-D9 | Pinned CA blocks legitimate proxy upgrade (cert change) | 🟠 high | low | 2-week overlap window during rotation; operator runbook documents |
| DR-D10 | TLS handshake fails silently if operator's leaf cert SAN doesn't match the sidecar's `--proxy-url` hostname | 🟡 medium | medium | Cert script generates SAN list explicitly; sidecar logs handshake error clearly; DEPLOY V2 troubleshooting section covers it |
| DR-D11 | `cc.Ping()` failing 3 times might happen during a 30s+ inference where the connection is idle from a control perspective but the visitor is waiting | 🟡 medium | low | Ping uses a separate control stream; doesn't interfere with active data streams. Verified by long-streaming test. |
| DR-D12 | Two sidecars register the same host → race in the registry | 🟡 medium | low | Registry's `Set` is `mu.Lock` + check-and-replace; last writer wins, previous tunnel sent a `close` frame and its h2 conn dropped |
| DR-D13 | LLM responses may exceed 4 GB (extreme RAG cases) | ⚪ low | very low | HTTP/2 framing supports arbitrary length; `httputil.ReverseProxy` streams without buffering; not a real risk in our design |
| DR-D14 | Sidecar can't reach Control Plane on connect → can't get verified | 🟠 high | low | Proxy returns `{"ok":false,"code":"VERIFY_UNAVAILABLE"}`; sidecar backs off and retries; operator alert if persists |
| DR-D15 | Operator forgets to put TLS terminator in front of proxy's :80 public listener → cleartext visitor traffic | 🟡 medium | medium | DEPLOY V2 strongly recommends Caddy or nginx with Let's Encrypt; included in `deploy/Caddyfile.example.v2` |
