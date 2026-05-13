# 11 — Data Plane Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| DR1 | Proxy reads stale Redis mapping → routes to wrong device | L | H | Control Plane writes are transactional with PG; Redis is the cache. If PG-Redis divergence, we route per Redis (cache is source of truth for routing). Periodic reconciliation worker is a v1.1 enhancement. |
| DR2 | Goroutine leak on dropped tunnel | M | M | Strict `defer` on stream cleanup; WS read/write deadlines; per-tunnel context that's canceled on close |
| DR3 | Stream-ID collision between two concurrent visitors | Negligible | M | UUIDv4 per stream; `sync.Map` keyed by ID; no second-chance behavior — collision treated as bug, panics under `-race` |
| DR4 | Slow client blocks proxy's send buffer | M | M | Per-tunnel outbound channel with bounded capacity (256); drop frame + close tunnel if buffer full for >5s |
| DR5 | Visitor uploads massive body → memory blow-up | M | H | Cap request body at 4MB (env-configurable); 413 above that |
| DR6 | One desktop client connects twice with same device_id | M | M | Replace policy: old tunnel sent `close{reason:"replaced"}`, removed; new takes over. INFO log + audit entry. |
| DR7 | Shared `OSM_PROXY_NODE_SECRET` leaks → impostor proxy can call Control Plane | L | Critical | Documented as v1 limitation; v1.1 = per-node credentials. v1 mitigation: secret is env-loaded, never logged, IP allow-list at the Control Plane (optional config). |
| DR8 | Tunnel client API key intercepted in transit | L | Critical | Tunnel WS must be `wss://` in prod (TLS). v1 dev path uses `ws://` on loopback only — flagged in CLI warning if `--proxy-url` is `ws://` and not localhost. |
| DR9 | DoS via thousands of unauthenticated WS connections to tunnel port | M | M | WS connection limit (configurable, default 10000); 5s deadline to receive `hello` or close; per-IP connection rate limit |
| DR10 | Control Plane DOWN → proxy can't verify new tunnels | M | M | Verify call has 5s timeout. If Control Plane down, reject new tunnel connects with friendly error frame; existing tunnels keep flowing (verify is done once at connect). |
| DR11 | Redis DOWN → proxy can't route any traffic | L | Critical | Proxy returns 503 with "Routing unavailable" page; doesn't crash. Periodic Redis ping; once recovered, traffic resumes automatically. |
| DR12 | Holding-state mass-503 burns DDOS bandwidth | M | M | Holding page is < 1KB, no images, no scripts. Plus we don't read request body before deciding to 503. |
| DR13 | Bytes-transferred counter drift between proxy and DB | M | L | Accept small drift (eventually consistent). Proxy reports on close + every 30s during long tunnels. DB row keeps last seen counter. |
| DR14 | Reverse-proxy header injection (visitor sends a `X-Forwarded-For` we trust) | L | M | Proxy *overwrites* `X-Forwarded-For` and `X-Real-IP` with the actual remote addr before forwarding |
| DR15 | Client forwards a request to localhost where there's no app listening | M | L | Forwarder catches connection-refused and emits an `error` frame; proxy writes 502 to visitor |
| DR16 | Same device, two proxy nodes — which one wins? | L | M | Out of scope for v1 (single proxy node). Documented: v1.1 needs Redis-based "tunnel lease" so only one node holds the device tunnel at a time. |
