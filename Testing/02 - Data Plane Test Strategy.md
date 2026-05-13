# 02 — Data Plane Test Strategy

## Layers

| Layer | Tool | Where | When |
|---|---|---|---|
| Wire-protocol unit | Go `testing` | `proxy-node/internal/tunnel/frame_test.go` | With protocol code |
| Hub concurrency | Go `testing` + `-race` | `proxy-node/internal/hub/hub_test.go` | With hub code |
| Router unit | Go `testing` with mocked Redis + hub | `proxy-node/internal/router/router_test.go` | With router code |
| Client forwarder | Go `testing` + `httptest.Server` as local app | `tunnel-client/internal/forwarder/forwarder_test.go` | With client code |
| Control-Plane ingest | Existing httptest harness in `server/` | `server/internal/server/proxy_ingest_test.go` | After endpoints exist |
| End-to-end smoke | Shell script + curl | `scripts/smoke_data_plane.sh` | Final phase |

## Critical paths

| Path | Test |
|---|---|
| Visitor request → proxy → hub miss → 502 | router unit test |
| Visitor request → proxy → hub hit → stream send → response delivery → 200 | router unit test |
| Tunnel hello with invalid api_key → connection rejected | proxy ingest test (mocked verify endpoint) |
| Two `hello`s from same device → first one closed, second registered | hub test |
| Tunnel disconnects mid-request → stream cleanup, no goroutine leak | router test |
| Holding state (device offline, 30s grace) → visitor sees 503 page | router test |
| Tunnel-client receives request → forwards to local → emits response | forwarder test |
| Tunnel-client local app down → 502 frame back to proxy | forwarder test |
| Control Plane DOWN at tunnel connect → tunnel verify fails cleanly | ingest client test |

## E2E smoke script outline

```bash
# 1. Start Redis (docker)
# 2. Start Control Plane (./server/bin/api)
# 3. Start Proxy node (./proxy-node/bin/proxy)
# 4. Start a fake local app (python3 -m http.server 3000)
# 5. Create user + domain + device + subdomain via curl against Control Plane
#    - mark domain verified directly via DB (skip DNS)
#    - bind subdomain to device
# 6. Start tunnel client (./tunnel-client/bin/osmrouter-client --api-key=$KEY ...)
# 7. curl -H "Host: api.osm.test" http://localhost:8000/
# 8. Expect: HTTP 200 + python's directory listing
# 9. Kill tunnel client
# 10. curl again → 503 "Reconnecting"
# 11. Restart tunnel client
# 12. curl → 200
# 13. Revoke device via API
# 14. curl → 502 (no mapping; Redis key deleted)
```

## What we deliberately DON'T test

- Real network packet loss / latency variation (would need `tc qdisc` orchestration — out of scope v1)
- WebSocket connection-flood DoS at scale (would need k6/vegeta with thousands of conns — manual test only)
- TLS termination (Cloudflare's responsibility in prod)

## Pass criteria

- All Go unit tests in `proxy-node/`, `tunnel-client/`, and `server/internal/proxyingest/` pass under `-race -count=1`
- E2E smoke script returns exit code 0
- Manual: kill -STOP on tunnel-client → 503; kill -CONT → traffic resumes within 1s
