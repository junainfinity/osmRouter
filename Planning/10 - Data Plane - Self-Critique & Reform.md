# 10 — Data Plane: Self-Critique & Reformed Plan

> Adversarial pass on `07/08/09` before touching code. Where am I about to step on a rake?

## 🩻 Critiques

### C1. "Just duplicate frame.go between proxy-node/ and tunnel-client/" is fine for v1 but rots fast.

**Fix:** Add a comment header in both files: `// CANONICAL: see Planning/08 - Data Plane Architecture.md §Tunnel Wire Protocol`. Any wire-protocol change must update both files + the architecture doc. Add a CI check later that diff's the two files (out of scope for v1; documented as a v1.1 task).

### C2. Reading the full request body into memory before forwarding (v1 cut) is fine for HTML/JSON but a footgun for uploads.

**Fix:** Cap request body at 4MB by default (configurable). Larger requests get `413 Payload Too Large` from the proxy with a clear message. Documented; streaming bodies = v1.1.

### C3. The proxy authenticating each tunnel client by calling back to the Control Plane on every WS connect is fine but adds a hard dependency.

**Fix:** Acceptable for v1 — the Control Plane is meant to be highly available. If we want hardness later: cache positive auth results for 60s, fall back to cached on Control Plane outage. Don't build the cache yet.

### C4. Single shared secret for all proxy nodes is weak — one compromised node leaks the secret.

**Fix:** v1 ships with `OSM_PROXY_NODE_SECRET` env var. Document in HANDOFF that v1.1 must replace this with per-node certificates (mTLS) or per-node API keys with a `proxy_nodes` DB table. Note this in Security/03.

### C5. Hub holds the WS connection forever — if a client never sends `hello`, we leak a connection.

**Fix:** WS upgrade handler sets a deadline: client must send `hello` within 5 seconds, or we close. Plus the WS itself has read/write deadlines.

### C6. The "stream registry" (stream_id → response channel) on the proxy is per-process. If two visitor requests collide in the channel slot or a response arrives after timeout, we leak goroutines or panic on closed channel.

**Fix:** Use `sync.Map` keyed by stream_id; use `select` with default when delivering response (if stream is gone, drop the frame, log a warning). Always unregister stream on handler return via defer.

### C7. Response timeout of 30s is too long — client should also enforce it on its side to free up its outbound buffer.

**Fix:** Client-side has an HTTP request timeout of 25s (less than proxy's 30s), so it always responds *something* (200 or 502-ish error frame) before proxy gives up.

### C8. If two clients connect with the same device_id (e.g., user accidentally runs CLI twice), the hub silently overwrites.

**Fix:** On `hello`, if a tunnel for that device already exists, close the *old* one cleanly first (send a `close` frame with reason "replaced"), then register the new one. Log at INFO level. Audit-log this on Control Plane side (added `tunnel.replaced` audit action).

### C9. Tunnel auth call to Control Plane goes over plain HTTP in dev. Means the API key flows in plaintext on localhost.

**Fix:** In dev, this is acceptable (loopback). In prod, all proxy↔Control Plane traffic must be mutual TLS or at minimum TLS+Bearer. Document.

### C10. Frontend has no UI to subscribe to "tunnel.opened" events yet.

**Fix:** Phase 2's done bar is: the *dashboard receives* the event (we can log it in dev console). Rendering a live "Active tunnels" panel is a Phase 2.1 polish task. Scope-cut.

### C11. We're not testing with real network packet loss / latency. In-process tests give us correctness but not robustness.

**Fix:** v1 ships with: unit tests + a manual smoke test. A `tc qdisc`-based chaos test is documented as future work.

### C12. "30s holding state" — but during those 30s, the holding response is served from the proxy *without* the request body. If visitor is doing a POST with a 5MB body, we've already read it but have nowhere to send it. We waste their bandwidth and ours.

**Fix:** On hub miss / device offline, return 503 *before* reading the request body. Use `r.Body.Close()` immediately. This is also a small DoS defense — attacker can't make us read 1000 concurrent giant bodies destined for an offline device.

### C13. WebSocket origin check on tunnel listener? The tunnel-client is a CLI, not a browser, so no origin header. Defaults are fine but worth being explicit.

**Fix:** Tunnel listener's WS upgrader has `CheckOrigin: func(*http.Request) bool { return true }` — explicitly. We auth via the `hello` frame, not origin.

### C14. Proxy node has nothing to discover its own NODE_ID.

**Fix:** From env var `OSM_NODE_ID` (default: hostname). Reported in every heartbeat.

### C15. Time pressure (again): the user wants this *done*, not *perfect*. Cut anything not on the demo critical path.

**Reformed scope cuts (additional):**
- No "nearest proxy" lookup endpoint for clients. v1 client connects to a single hardcoded URL passed via flag.
- No real WS event from proxy → Control Plane → browser yet. Phase 2 emits an *audit log entry* and the dashboard polling picks it up next refresh. Real-time push of `tunnel.opened` to the browser is added if time permits.
- No GeoDNS, no Anycast, no health-check-driven failover — single-process proxy is fine for a working demo.

---

## ✅ Reformed Build Order

Replaces atomic list in `09 - Data Plane Task Breakdown`:

### Phase 2A — Wire + Proxy + Tests
1. `proxy-node/` Go module init
2. `proxy-node/internal/tunnel/frame.go` + tests
3. `proxy-node/internal/hub/hub.go` + tests (concurrent register/unregister/replace)
4. `proxy-node/internal/ingest/client.go` (Control Plane caller)
5. `proxy-node/internal/router/router.go` + tests (mocked Redis + mocked hub)
6. `proxy-node/cmd/proxy/main.go` (wire it: WS server + HTTP server + graceful shutdown + ingest client)

### Phase 2B — Control Plane endpoints
7. `server/internal/proxyingest/middleware.go` (Bearer shared secret)
8. `server/internal/proxyingest/handlers.go` (verify device api_key, tunnel start, tunnel end, node heartbeat)
9. Wire group in `server/internal/server/server.go`
10. Integration test for proxy ingest (cookie-less, Bearer-auth)

### Phase 2C — Client
11. `tunnel-client/` Go module init
12. `tunnel-client/internal/tunnel/frame.go` (copy, annotated as canonical-mirror)
13. `tunnel-client/internal/client/client.go` (dial + hello + frame loop + reconnect)
14. `tunnel-client/internal/forwarder/forwarder.go` (HTTP forward to local port)
15. `tunnel-client/cmd/osmrouter-client/main.go`

### Phase 2D — Smoke + Polish
16. Manual smoke: start Control Plane, proxy, fake local app (`python3 -m http.server 3000`), tunnel-client; bind via dashboard; `curl -H "Host: api.test" http://proxy:8000/` returns the file listing
17. Update Dev Log Session 2 with the live trace
18. Update HANDOFF with the new components, run instructions, and what's still deferred to v1.1

---

## 📌 Decisions Locked

| Decision | Choice | Reason |
|---|---|---|
| Tunnel transport | WebSocket text frames carrying JSON | Same wire format as browser dashboard; easy to debug |
| Stream multiplexing | Per-request stream_id, single WS connection | Avoids per-request connect overhead |
| Auth on tunnel | Device api_key in `hello` frame, validated by Control Plane | Reuses existing device API key infrastructure |
| Auth on proxy→Control Plane | Shared secret Bearer token, env var | Simplest; v1.1 upgrades to per-node creds |
| Body handling | Buffered, capped at 4MB | Covers 95% of HTTP; streaming = v1.1 |
| Holding state | 30s grace with 503 page; no mid-stream splice | Per PRD §4.1 simplified |
| Same-device reconnect | Close old WS, register new (with INFO log) | Prevents zombie sessions |
| Node identity | `OSM_NODE_ID` env (default: hostname) | Trivial |
| Frontend live tunnel UI | Out of scope for Phase 2 | Audit log shows tunnel events instead |
