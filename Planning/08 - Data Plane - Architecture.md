# 08 — Data Plane Architecture

## System Diagram

```
                                  ┌─────────────────────────┐
                                  │  Visitor Browser        │
                                  │  GET https://api.acme.test/
                                  └────────────┬────────────┘
                                               │ HTTP(S)
                                               ▼
                              ┌──────────────────────────────────┐
                              │   Cloudflare-for-SaaS (prod)     │
                              │   - TLS termination at edge      │
                              │   - DDoS / WAF                   │
                              │   (in dev: skipped)              │
                              └────────────┬─────────────────────┘
                                           │ HTTP, Host: api.acme.test
                                           ▼
        ┌────────────────────────────────────────────────────────────────┐
        │                  Proxy Node (Go binary)                        │
        │                                                                │
        │  ┌─────────────────┐    ┌────────────────────────────────┐     │
        │  │ Public listener │───▶│ Router                         │     │
        │  │  :8000          │    │ 1. lookup live:<fqdn> in Redis │     │
        │  └─────────────────┘    │ 2. find tunnel in hub          │     │
        │                         │ 3. forward frame; await reply  │     │
        │                         │ 4. write HTTP response          │     │
        │                         └──────────────┬─────────────────┘     │
        │                                        │                       │
        │                                        ▼                       │
        │                         ┌────────────────────────────┐         │
        │                         │ Hub (device_id → tunnel)   │         │
        │                         │ sync.RWMutex + chan-based  │         │
        │                         └──────────────┬─────────────┘         │
        │                                        │                       │
        │                         ┌──────────────┴─────────────┐         │
        │                         │ Tunnel listener            │         │
        │                         │  :8001 (WebSocket)         │         │
        │                         │  Authenticates via         │         │
        │                         │  device API key            │         │
        │                         └──────────────┬─────────────┘         │
        └────────────────────────────────────────┼───────────────────────┘
                                                 │ Persistent WebSocket
                                                 │ (request/response frames)
                                                 ▼
                            ┌─────────────────────────────────────────┐
                            │    osmrouter-client (CLI on laptop)     │
                            │  --api-key=… --local-port=3000          │
                            │                                         │
                            │  WS reader ──▶ HTTP client ──▶ localhost:3000
                            │                  │                      │
                            │                  ▼ response               │
                            │  WS writer ◀── serialize                  │
                            └─────────────────────────────────────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │ User's local app │
                                       │ localhost:3000   │
                                       └──────────────────┘

           Async, side channels:

           Proxy Node ── (Bearer auth) ──▶ Control Plane:
              POST /api/v1/proxy/tunnels/start
              POST /api/v1/proxy/tunnels/:id/end
              POST /api/v1/proxy/nodes/heartbeat

           Control Plane ── (WebSocket) ──▶ User Dashboard:
              {type: "tunnel.opened", subdomain_id, device_id}
              {type: "tunnel.closed", subdomain_id, bytes_transferred}
```

## Tunnel Wire Protocol (v1)

WebSocket text frames carrying JSON. One persistent WS per connected client; multiple concurrent visitor requests multiplexed via `stream_id`.

### Frame envelope

```jsonc
{
  "type": "<frame_type>",
  "stream_id": "<uuid_v4>",  // omitted for non-stream frames
  ...type-specific fields...
}
```

### Frame types

| Type | Direction | Fields | Purpose |
|---|---|---|---|
| `hello` | client → proxy | `device_id, api_key, version` | First frame after WS upgrade. Authenticates. |
| `hello_ack` | proxy → client | `node_id, assigned_subdomains[]` | Server confirms auth |
| `request` | proxy → client | `stream_id, method, url, headers, body_b64` | Visitor request to forward |
| `response` | client → proxy | `stream_id, status, headers, body_b64` | Response from local app |
| `error` | either | `stream_id?, code, message` | Stream-level or connection-level error |
| `ping` | either | — | Keep-alive (in addition to WS-level pings) |
| `pong` | either | — | Reply to ping |
| `close` | proxy → client | `stream_id, reason?` | Stream closed (rare for v1) |

### Stream lifecycle

1. Proxy receives visitor HTTP request
2. Allocates `stream_id`, registers an in-memory `responseChan chan ResponseFrame`
3. Sends `request` frame over WS
4. Awaits response on `responseChan` (timeout 30s)
5. Receives `response`, writes to visitor's `http.ResponseWriter`
6. Cleans up stream registry

### Auth on tunnel connect

- Client opens WS to `wss://proxy/ws/tunnel`
- First frame must be `hello` containing `device_id` + plaintext `api_key`
- Proxy validates by calling Control Plane: `POST /api/v1/proxy/devices/verify` with the api_key, gets back `{device_id, user_id, valid: true}` (or `false`)
- Authentication is single-call at connection time; thereafter the WS connection is trusted for its lifetime

### Heartbeat

- WS-level ping every 30s from proxy
- Application-level `ping` frame every 60s (defense in depth — some intermediaries drop WS pings)
- Three missed → connection torn down, device marked offline

## In-memory state at the Proxy Node

```go
type Hub struct {
    mu      sync.RWMutex
    tunnels map[string]*Tunnel   // device_id → tunnel
    streams sync.Map             // stream_id → chan ResponseFrame
}

type Tunnel struct {
    DeviceID string
    UserID   string
    Conn     *websocket.Conn
    Send     chan []byte          // outbound buffer
    closed   chan struct{}
    openedAt time.Time
}
```

## Redis Keys Used (read by Proxy, written by Control Plane)

| Key pattern | Value | Set by |
|---|---|---|
| `live:<fqdn>` (apex) or `live:<prefix>.<fqdn>` | `<device_id>` | Control Plane on subdomain bind |
| `tunnel:<stream_id>` | (not used in v1) | — |

The Control Plane already writes these in `internal/subdomains/service.go::Bind`. Phase 2 is the consumer.

## Control Plane endpoints added in Phase 2

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/proxy/devices/verify` | Proxy Bearer | Validate a device api_key, return device + user info |
| `POST` | `/api/v1/proxy/tunnels/start` | Proxy Bearer | Record a new tunnel row |
| `POST` | `/api/v1/proxy/tunnels/:id/end` | Proxy Bearer | Close tunnel, record bytes |
| `POST` | `/api/v1/proxy/nodes/heartbeat` | Proxy Bearer | Proxy node liveness |

Auth: `Authorization: Bearer $OSM_PROXY_NODE_SECRET`. In v1, all proxy nodes share one secret. v1.1: per-node keys.

## Holding State on Disconnect (PRD §4.1, simplified)

When a `device.connection_lost`:
1. Proxy marks tunnel `state=holding`, sets `holding_until=now+30s`
2. Visitor requests during holding window receive a clean `503` with HTML page:
   ```
   <h1>Reconnecting…</h1>
   <p>This host is temporarily offline. The connection will resume automatically.</p>
   ```
3. If a new `hello` frame arrives from same `device_id` within 30s, holding cleared, traffic resumes
4. After 30s, hub entry deleted, Redis `live:<fqdn>` left alone (Control Plane manages that key)

v1.1 will splice in-flight streams back to a re-handshaking client. v1 just buffers visitors briefly.

## Repository layout (additions)

```
osmRouter Web/
├── server/                       (existing — adds 4 new endpoints)
│   ├── internal/
│   │   ├── proxyingest/          NEW — Control Plane endpoints for proxy nodes
│   │   └── ...
├── proxy-node/                   NEW — separate Go binary
│   ├── cmd/proxy/main.go
│   ├── internal/
│   │   ├── config/
│   │   ├── hub/
│   │   ├── router/
│   │   ├── tunnel/               (server side of protocol)
│   │   └── ingest/               (calls back to Control Plane)
│   ├── go.mod
│   └── Makefile
└── tunnel-client/                NEW — CLI binary
    ├── cmd/osmrouter-client/main.go
    ├── internal/
    │   ├── client/
    │   ├── forwarder/
    │   └── tunnel/               (client side of protocol)
    ├── go.mod
    └── Makefile
```

**Shared code:** The wire protocol (`tunnel/` types) is duplicated in two Go modules rather than introducing a shared `pkg/`. The protocol is small (one file, ~150 lines). Duplication is cheaper than premature shared-module ceremony. We document the canonical definition in this Architecture doc; both copies must match.
