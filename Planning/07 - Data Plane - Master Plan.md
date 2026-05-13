# 07 — Data Plane Master Plan

> **Phase 2 of the project.** Phase 1 (`Planning/01 - Master Plan.md`) shipped the Control Plane. This is the other half: the reverse proxy fleet + the client side of the tunnel.

## 1. The North Star (recap)

The PRD splits osmRouter into:

| Plane | Job | Phase |
|---|---|---|
| **Control Plane** (Web + Go API) | Brain. Auth, billing, DNS, device locks, the *intent* of routing | ✅ Phase 1 (shipped) |
| **Data Plane** (Proxy Nodes) | Hands. Accepts public traffic, looks up Redis mapping, pipes bytes through a persistent tunnel back to the user's local app | **Phase 2 (this plan)** |

Without the Data Plane, osmRouter isn't actually a tunneling product — it's just a dashboard for one. This phase makes the product real.

## 2. What "complete" means for v1 of the Data Plane

A user can:
1. Sign up in the dashboard (Phase 1 — done)
2. Add a domain and verify it (Phase 1 — done)
3. Add a device, get an API key (Phase 1 — done)
4. **Bind a subdomain to that device** (Phase 1 wrote to Redis — now Phase 2 reads it)
5. **Run the `osmrouter-client` CLI on their laptop**, pointing it at `localhost:3000`
6. **A visitor hits `https://api.acme.test`** via the public proxy node
7. **The visitor's request lands at `localhost:3000` on the user's laptop**, the response comes back, and the visitor sees their app

Plus:
- Dashboard shows the tunnel as **live** in real-time (WebSocket event from proxy node → Control Plane → user's browser)
- Closing the laptop → visitor briefly sees `503 — Reconnecting…`, then traffic resumes when laptop wakes
- Revoking the device from the dashboard kills the tunnel immediately

## 3. Three new artifacts

### 3.1 `proxy-node/` (the fleet member)
A Go binary that listens on:
- **Public port** (HTTP for v1): receives visitor traffic. Looks up `live:<fqdn>` in Redis → finds connected device → forwards request over tunnel → writes response.
- **Tunnel port** (WebSocket): accepts long-lived connections from desktop clients. Authenticates them via their device API key. Holds the connection in an in-memory `Hub`.

### 3.2 `tunnel-client/` (the desktop side — a CLI tool)
A Go binary that:
- Takes flags: `--api-key`, `--proxy-url`, `--local-port`
- Opens a WebSocket to the proxy node, presents its API key
- Receives request frames, forwards to `http://localhost:<local-port>`, sends response frame back
- Auto-reconnects with exponential backoff

### 3.3 Tunnel ingest endpoints (added to the existing Control Plane)
- `POST /api/v1/proxy/tunnels/start` — proxy says "I just started tunneling for device X subdomain Y"
- `POST /api/v1/proxy/tunnels/:id/end` — proxy says "tunnel closed, here are bytes_transferred"
- `POST /api/v1/proxy/nodes/heartbeat` — proxy says "I'm alive, here's my health"

These use a separate auth scheme (shared secret in env var, sent as Bearer token).

## 4. Build order

1. **Tunnel wire protocol** (shared between proxy and client) + unit tests — start here because both sides depend on it
2. **Proxy node** with mocked tunnel registry — full Redis-backed router + public listener
3. **Tunnel client** CLI — talks to a proxy node
4. **Control Plane tunnel ingest endpoints**
5. **End-to-end smoke**: a real test where we have a fake local app, a real proxy, a real client, and curl hitting the public domain

## 5. Scope discipline — what is OUT of v1 of the Data Plane

Honest CTO call again:

**OUT:**
- gRPC. We use WebSocket + JSON frames. Same wire shape, easier to debug, no `.proto` files to maintain. gRPC migration is a future optimization.
- Streaming response bodies. v1 buffers the full response from the desktop app before sending to visitor. Covers 95% of HTTP traffic. Streaming (SSE, large file downloads) is v1.1.
- HTTPS termination at the proxy. v1 is plain HTTP — in production, Cloudflare-for-SaaS terminates TLS at the edge and forwards to our proxy over their backbone.
- Anycast / GeoDNS. v1 is one proxy node; "fleet" means multiple instances running the same binary, no fancy routing.
- Sticky-stream reconnect (PRD §4.1). v1's holding state is: device drops → 30s grace where visitors get a clean 503 with "Reconnecting" message → after 30s, mapping deleted. Truly seamless reconnect (mid-stream splicing) is v1.1.
- Per-proxy-node telemetry dashboards. Proxy reports bytes/start/end; surfacing it nicely is a UI task we defer.
- WebSocket compression. Premature; revisit if traffic warrants it.

**IN:**
- Public listener on configurable port (default :8000 in dev)
- Tunnel listener on separate port (default :8001 in dev)
- Hub with `device_id → tunnel` map, sync-safe
- Redis-driven route lookup with TTL-less keys (Control Plane manages lifecycle)
- Request/response frame protocol with stream multiplexing
- Heartbeat / keep-alive over WebSocket
- 30s holding state on disconnect
- Tunnel ingest reporting to Control Plane
- Graceful shutdown
- A working CLI client that proves the loop closes

## 6. Quality bars

- `go test ./... -race` clean on the new packages
- End-to-end smoke (curl through proxy → seen at fake local app → response back) recorded in dev log
- Idle proxy at rest uses < 10MB RSS (sanity check, not a hard SLO)
- Tunnel reconnect after `kill -STOP` / `kill -CONT` of the client process works
