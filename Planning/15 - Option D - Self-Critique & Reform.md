# 15 — Option D: Self-Critique & Reformed Plan

> Adversarial read of `13 - Master Plan.md` and `14 - Architecture.md`. Where am I about to ship a footgun?

## Critiques

### C1. "Send a JSON register frame, then call ServeConn / NewClientConn" — the byte boundary is tricky.

The HTTP/2 client-preface is `PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n` — 24 specific bytes. If the proxy reads the JSON line and *also* reads a byte too many, the H2 transport will see corrupted preface. If we use `bufio.Reader.ReadString('\n')`, the reader's internal buffer may contain bytes past the newline.

**Fix:** the proxy reads the JSON frame using a **byte-by-byte read until `\n`**, not `bufio.Reader`. Costs nothing — register frames are < 1 KB. After the response, hand the *raw* `tlsConn` (not a buffered wrapper) to `http2.Transport.NewClientConn`. Tested by integration test against a real sidecar.

### C2. `http2.Transport.NewClientConn` doesn't actually exist in the public API of `golang.org/x/net/http2`.

The way you start an H2 client connection on a pre-established conn is `(&http2.Transport{}).NewClientConn(conn)` — **and it does exist** in `golang.org/x/net/http2`. Verified by reading source. The connection wrapper around it: `t.NewClientConn(c) (*http2.ClientConn, error)`. Good.

But there's a subtlety: `*http2.ClientConn` doesn't implement `http.RoundTripper`. To use it with `httputil.ReverseProxy`, we wrap it:

```go
type singleConnTransport struct{ cc *http2.ClientConn }

func (t *singleConnTransport) RoundTrip(r *http.Request) (*http.Response, error) {
    return t.cc.RoundTrip(r)
}
```

That's it. The wrapper is six lines.

### C3. `httputil.ReverseProxy` requires the request URL to be set carefully or it'll send `Host: ` from the wrong place.

Specifically, `r.URL.Host` is what gets written to the outbound HTTP/2 `:authority` header. If we don't override `r.URL.Host`, it's empty (because incoming requests have an empty `URL.Host`; the host is in `r.Host`). 

**Fix:** in the Director, set `r.URL.Scheme = "https"`, `r.URL.Host = r.Host`. The sidecar's HTTP/2 server will see the right `:authority` and route accordingly.

### C4. Proxy must handle the case where sidecar dies during a streaming response — visitor will hang otherwise.

When the sidecar's TLS conn closes mid-stream, the `*http2.ClientConn` returns errors on the existing stream. `httputil.ReverseProxy` will propagate the error and close the visitor's response. **That's fine for visitor.** But the registry still has a stale entry.

**Fix:** the proxy starts a goroutine per connection that watches `cc.Ping()` every 30 seconds. On three failures, removes the entry and closes the conn. Same pattern as our v1 code; carry it over.

### C5. The "one TCP conn per binding" model means a user with 5 active domains has 5 TLS connections.

Fine for v1 (most users have 1–3). At scale (a user runs 50 staging environments) it's wasteful. But that's a **v1.1+** problem. The Mac sidecar already has the "one process per binding" model; we don't fight it.

**Recommendation:** document this as Risk DR-D1 in the new risk register and move on.

### C6. `FlushInterval = -1` is the right value but the docs are confusing about it.

From `httputil.ReverseProxy.FlushInterval` godoc:
> "negative values mean to flush immediately after each write to the client."

That's exactly what we want for SSE. Verified.

### C7. Cert distribution: the PEM is "baked into the binary" — but what if the operator wants to rotate the CA?

**Fix:** include the PEM as a `var rootCA = []byte("...")` constant that's `//go:embed`'d from `internal/ca/root.pem`. To rotate, rebuild the binaries from a new PEM. For v1 we accept this — operator rolls out a binary update, customers redownload.

Document for operator (in DEPLOY V2): "to rotate the CA, run `scripts/init-ca.sh --rotate`, rebuild proxy + Mac binaries, ship the update via the auto-updater channel. Existing connections continue with the old CA until they reconnect, at which point they validate against the new one — so include a 2-week overlap window where BOTH CAs are valid."

### C8. The Control Plane endpoint signature changes — `VerifyDevice {api_key}` becomes `VerifyDevice {api_key, host}`.

That's a breaking change to the old proxy-node's contract. But we're throwing away the old proxy, so it doesn't matter for production. Old integration tests in `server/internal/server/proxyingest_test.go` will need updating.

**Fix:** update those tests in Phase 5; don't try to keep both shapes.

### C9. Live LLM streaming test depends on having models pulled.

`ollama pull qwen2.5:0.5b` downloads ~370 MB. That's a 1-2 minute wait inside the Docker container's first run. Plan for it.

LM Studio is whatever model the user has loaded; can't predict. Test the path with whatever's there.

### C10. "Single proxy node + Docker on one box" — what if traffic kills it?

For v1.1+ we'd add horizontal scaling. For this session: a single box can serve ~1 Gbps and ~10k concurrent streams comfortably. That's well past where you'd worry about scaling.

## Reformed Build Order

Replaces §6 in `13 - Master Plan.md`:

1. Write planning docs (this batch) ✓
2. Self-critique + reform (this doc) ✓
3. Risk register + test strategy (next two docs)
4. **Stop old demo + archive** old `proxy-node/` and `tunnel-client/` into `proxy-node-v1.0-archive/` and `tunnel-client-v1.0-archive/`. Keep them in git history but out of the build path.
5. **Cert bootstrap script** (`scripts/init-ca.sh`) — runs first because both proxy and sidecar embed the PEM at build time.
6. **New proxy-node**:
   1. `internal/ca/ca.go` — embed root + load leaf
   2. `internal/registry/registry.go` — sync map of host → tunnel
   3. `internal/tunnels/tunnels.go` — register-frame parser, http2 transport wrapper
   4. `internal/forward/forward.go` — httputil.ReverseProxy with Director + perHostTransport
   5. `internal/ingest/ingest.go` — calls Control Plane to verify
   6. `cmd/proxy/main.go` — wire everything; two listeners
   7. unit tests for each package
7. **Mac sidecar tuning**:
   1. `localHTTPClient` config (drop Timeout, raise windows, etc.)
   2. `register-frame` send after TLS handshake (~30 lines added to `runOnce`)
   3. **Embedded CA**: `//go:embed root.pem` so `--root-ca` flag becomes optional
8. **Control Plane**: `VerifyDevice` accepts `host` and validates it's bound to the device. Integration test for it.
9. **Docker package**:
   - `Dockerfile.proxy-v2` builds the new proxy
   - `deploy/docker-compose.v2.yml` brings up: server, web, redis, postgres, proxy
   - `scripts/init-ca.sh` copies CA into volumes at first run
10. **Live test**:
    - Boot stack
    - Start sidecar against to-do app → verify with curl
    - Pull Ollama, start sidecar against it → verify streaming with curl -N
    - Try LM Studio (if running) → verify with curl -N
    - Take 8 screenshots: dashboard signed in, domains page, devices page, admin overview, admin audit, terminal output of curl -N streaming, sidecar logs, proxy logs
11. **Packaging**:
    - "To Upload V2/osmRouter/" with new Dockerfiles, compose, .env.example, DEPLOY.md
    - "To Compile V2/osmRouter Mac/" with tuned sidecar source + Mac README
12. **Final docs**: update Vault Index, write Session 5 dev log entry tracing every decision.

## Locked Decisions

| Question | Decision |
|---|---|
| Wire format for register-frame | One JSON line terminated by `\n`, < 4 KB |
| H2 library | `golang.org/x/net/http2` (same as Mac sidecar uses) |
| Streaming knob | `httputil.ReverseProxy.FlushInterval = -1` |
| Cert distribution | `//go:embed` into both binaries |
| Auth on sidecar connect | Bearer token in register-frame; Control Plane validates (host, device_id, token) |
| Rotation strategy for CA | Rebuild + push update; 2-week dual-trust window |
| Per-binding model | One sidecar process per active binding (carry over from Mac sidecar design) |
| Health-check on tunnels | `cc.Ping()` every 30s, drop after 3 misses |
