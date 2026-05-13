# 2026-05-12 — Session 2 — Data Plane

> Live log of the Data Plane build session. New entries at the bottom.

## Context

Session 1 shipped the Control Plane. The user reviewed and asked the right question: "is the project complete?" Honest answer was no — the Data Plane (proxy nodes) was out of scope per PRD §1, so osmRouter the *tunneling product* doesn't actually tunnel anything yet. This session closes that gap with a v1 Data Plane MVP.

## Goals for this session

1. ✅ Plan, self-critique, lock decisions for the Data Plane (see `Planning/07-11`)
2. ⏳ Build the tunnel wire protocol + tests
3. ⏳ Build the proxy node binary
4. ⏳ Build the tunnel-client CLI binary
5. ⏳ Add Control Plane endpoints for proxy ingest
6. ⏳ End-to-end smoke (curl → proxy → tunnel → local app → response)
7. ⏳ Update HANDOFF.md

## Decisions locked (see `Planning/10`)

- WebSocket + JSON frames (not gRPC) for tunnel
- 4 MB request body cap; streaming = v1.1
- Shared `OSM_PROXY_NODE_SECRET` for proxy↔Control Plane auth (per-node certs = v1.1)
- 30s holding state with simple 503 page (mid-stream splice = v1.1)
- Same-device second connection: replace (close old, register new) + INFO log + audit entry
- Frame protocol duplicated between `proxy-node/` and `tunnel-client/` (no shared module); canonical definition lives in `Planning/08`

## Status board

| Phase | Atomic | Status | Notes |
|---|---|---|---|
| 2A | Wire protocol + hub + router (proxy side) | ⏳ | Starting |
| 2B | Control Plane proxy-ingest endpoints | ⏳ | |
| 2C | Tunnel client CLI | ⏳ | |
| 2D | E2E smoke + HANDOFF update | ⏳ | |

## Log

### 13:00 — Planning complete
Phase 2 planning in `Planning/07-11`, security in `Security/03`, test strategy in `Testing/02`. Vault Index updated.

### 13:20 — Wire protocol + proxy node built
Three new packages in `proxy-node/`:
- `internal/tunnel/frame.go` — wire frames (hello, request, response, error, ping, pong, close), JSON envelope, base64 body, `Validate()`. 7 unit tests including malformed-input and validation. Canonical-mirror header per Planning/10 §C1.
- `internal/hub/hub.go` — per-node registry. Tunnel struct with bounded send channel + WritePump that handles ping/pong. `Hub.Register` replaces same-device tunnels (Planning/10 §C8) with a `close{reason:"replaced"}` frame. Stream registry on `sync.Map`. Tests cover delivery, orphan-stream-doesn't-panic, concurrent register.
- `internal/router/router.go` — visitor-facing handler. Redis lookup → hub lookup → stream send → response. Body cap (4 MB default). Sanitized `X-Forwarded-For`. Clean 502/503/504 pages. Test uses a real WS pair (gorilla/websocket on both ends) so the happy path is wire-real.

Also: `internal/ingest/client.go` (HTTP client back to Control Plane: verify-device, tunnel start/end, heartbeat), `internal/config/config.go`, and `cmd/proxy/main.go` wiring everything with graceful shutdown.

### 13:40 — Tunnel client CLI built
`tunnel-client/` module mirroring the protocol. `internal/forwarder/forwarder.go` does the HTTP forward to the local app + maps errors to error frames. `internal/client/client.go` dials the proxy WS, handshakes `hello`, runs a read loop dispatching concurrent visitor requests to goroutines. Exponential backoff reconnect; `ErrAuth` is fatal. `cmd/osmrouter-client/main.go` is the CLI entrypoint. 4 forwarder tests passing.

### 13:50 — Control Plane ingest endpoints added
New package `server/internal/proxyingest/`:
- `middleware.go` — Bearer shared-secret auth with constant-time compare
- `handlers.go` — `VerifyDevice` (looks up device by api_key hash), `TunnelStart` (creates tunnels row, publishes `tunnel.opened` WS event), `TunnelEnd`, `Heartbeat`

Wired into `server/internal/server/server.go` as `/api/v1/proxy/*`. `config.ProxyNodeSecret` added (env `OSM_PROXY_NODE_SECRET`). 5 ingest tests passing.

### 14:00 — Dev Redis + end-to-end smoke
Docker daemon was unresponsive at first. Added `server/cmd/dev-redis/main.go` — a tiny in-process miniredis listener so smoke tests run without Docker. NOT for production.

Wrote `scripts/smoke_data_plane.sh` orchestrating: dev-redis :6390 → Control Plane :8080 → Python fake-app :3030 → proxy-node (:8000 public, :8001 tunnel) → user register/verify-OTP → device create → domain create + mark verified → subdomain create + bind → tunnel-client connect → curl through proxy.

**First successful run:**
```
GET / via proxy (Host: api.smoke.test):  HTTP 200 + "hello from local app, path=/"
GET /foo/bar via proxy:                  HTTP 200 + "hello from local app, path=/foo/bar"
```

osmRouter actually tunnels traffic now.

### 14:10 — Fixed client shutdown race
Caught a real bug: after `kill $clientPid`, the next request returned 504 (not 503). Root cause: `conn.ReadMessage()` blocks even after `ctx` cancels, so the client process didn't exit cleanly. Fix: added a watchdog goroutine in `connectAndPump` that closes the WS as soon as ctx is done, with a proper `CloseGoingAway` frame.

### 14:15 — Localhost smoke green
All three flows pass: happy path (200), path forwarding, holding state (503) on disconnect.

### 14:30 — Cross-machine demo via Docker
The localhost smoke proved correctness but not isolation. Wrote a Dockerized demo to prove routing actually crosses a machine boundary:

- `tunnel-client/Dockerfile` — multi-stage build: stage 1 (`golang:1.24-alpine` + `GOTOOLCHAIN=auto`) compiles the tunnel-client from source; stage 2 (`alpine:3.20` + `python3`) packages the binary with a tiny Python HTTP server.
- `tunnel-client/docker/local-app.py` — replies with a JSON containing the container's hostname so we can prove the response came from inside.
- `tunnel-client/docker/entrypoint.sh` — starts both the Python app and the tunnel-client; propagates SIGTERM.
- `scripts/docker_remote_laptop_demo.sh` — builds everything, brings up host services, runs the container, creates user+device+verified-domain+bound-subdomain, then asserts the visitor's response (a) contains the in-container marker AND (b) the hostname returned by the app matches `docker exec ... hostname`.

Initial Docker daemon was unresponsive; user restarted Docker Desktop. First build failed because the image was on Go 1.24 and our `go.mod` requires 1.26 — fixed by setting `GOTOOLCHAIN=auto` in the Dockerfile (Go auto-downloads the right toolchain).

**Result:**

```
--- visitor curl through proxy (Host: api.dockertest.example) ---
{
  "served_by": "in-container local app",
  "hostname":  "5faeda775c92",
  "path":      "/hello?from=host",
  ...
}
  ✓ response came from container's app
  ✓ container hostname:      5faeda775c92
  ✓ docker reports hostname: 5faeda775c92
✓✓ DEMO PASSED — traffic routed across host/container boundary correctly

--- POST through tunnel ---
{ "served_by": "in-container local app", "method": "POST", "path": "/post-here", ... }

--- killing container to test holding state ---
HTTP 503  ✓ Holding state page served
```

This is the highest-fidelity test we can run on a single Mac: container has its own kernel namespaces (PID, network, mount, hostname), connects to the host via `host.docker.internal`, and the response carries a hostname that ONLY exists inside that container. The proxy → tunnel → forwarder loop demonstrably crosses the boundary.

## Final tally — Phase 2

| Layer | Count |
|---|---|
| Go modules added | 2 (`proxy-node/`, `tunnel-client/`) |
| Go packages added | 8 |
| Backend tests passing (-race) on the whole stack | 72 (Control Plane 56 incl. 5 new proxy-ingest; Data Plane 16) |
| Smoke tests passing | 2 (localhost + Docker cross-boundary) |
| Obsidian planning notes added | 5 (Planning/07–11) |
| Security notes added | 1 (Security/03) |
| Testing notes added | 1 (Testing/02) |
| Dev log sessions | 2 |

osmRouter now tunnels traffic across an actual isolation boundary, not just localhost. The Control Plane writes routing intent into Redis; the proxy node reads it and pipes bytes through a tunnel client running in a separate kernel-namespace, back to a local app inside that container. The full PRD architecture (§1) is realized and **verified via Docker**.
