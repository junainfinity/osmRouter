# 09 — Data Plane Task Breakdown

## 🌑 MAJOR (3 epics)

- **D1.** Tunnel wire protocol + shared types
- **D2.** Proxy node binary
- **D3.** Desktop client (CLI) + Control Plane integration

## 🌒 MINI (per major)

### D1 — Wire protocol
- D1.1 Frame type definitions + JSON marshaling
- D1.2 Codec: read/write frames over a `*websocket.Conn`
- D1.3 Stream registry (for matching responses to in-flight requests)
- D1.4 Unit tests for codec round-trip and edge cases

### D2 — Proxy node
- D2.1 Module scaffold (`proxy-node/go.mod`, Makefile)
- D2.2 Config loader (env vars: HTTP_ADDR, TUNNEL_ADDR, REDIS_URL, CONTROL_PLANE_URL, SHARED_SECRET, NODE_ID)
- D2.3 Hub (device→tunnel registry, sync-safe)
- D2.4 Tunnel listener: WS upgrade + `hello` handshake + auth call back to Control Plane
- D2.5 Public listener: HTTP server that does Host-based lookup + forwarding
- D2.6 Router: Redis lookup → hub lookup → frame send → response wait → HTTP write
- D2.7 Holding state on tunnel close (30s grace, 503 page)
- D2.8 Heartbeat + ingest client (calls back to Control Plane)
- D2.9 Graceful shutdown
- D2.10 Tests: hub concurrency, router happy path, missing-mapping 502, holding-state 503

### D3 — Tunnel client
- D3.1 Module scaffold + CLI flag parsing
- D3.2 WebSocket dialer + `hello` frame
- D3.3 Request forwarder: receive `request` → HTTP call to local port → emit `response`
- D3.4 Auto-reconnect with exponential backoff
- D3.5 Ctrl+C clean shutdown
- D3.6 Tests: forwarder with `httptest.NewServer` as the "local app"

### Plus inside Control Plane (`server/`):
- C1. Proxy ingest router group: `/api/v1/proxy/*`
- C2. Proxy auth middleware (Bearer shared secret)
- C3. Device-verify endpoint
- C4. Tunnel start / end / bytes endpoints
- C5. Node heartbeat endpoint
- C6. WS event emission when tunnel opens/closes (to user dashboard)
- C7. Integration test for the proxy-ingest endpoints

## 🌓 MICRO (selected expansions)

### D1.1 Frame types
```go
type FrameType string
const (
    FrameHello    FrameType = "hello"
    FrameHelloAck FrameType = "hello_ack"
    FrameRequest  FrameType = "request"
    FrameResponse FrameType = "response"
    FrameError    FrameType = "error"
    FramePing     FrameType = "ping"
    FramePong     FrameType = "pong"
    FrameClose    FrameType = "close"
)

type Frame struct {
    Type     FrameType         `json:"type"`
    StreamID string            `json:"stream_id,omitempty"`
    // hello
    DeviceID string            `json:"device_id,omitempty"`
    APIKey   string            `json:"api_key,omitempty"`
    Version  string            `json:"version,omitempty"`
    // hello_ack
    NodeID string              `json:"node_id,omitempty"`
    // request
    Method  string             `json:"method,omitempty"`
    URL     string             `json:"url,omitempty"`
    Headers map[string][]string `json:"headers,omitempty"`
    BodyB64 string             `json:"body_b64,omitempty"`
    // response
    Status int                 `json:"status,omitempty"`
    // error
    Code    string             `json:"code,omitempty"`
    Message string             `json:"message,omitempty"`
}
```

### D2.6 Router happy path
```
1. handler := func(w http.ResponseWriter, r *http.Request) {
2.   host := r.Host
3.   deviceID, err := redisClient.Get(ctx, "live:"+host).Result()
4.   if err != nil { write502(w, "no mapping"); return }
5.   tunnel := hub.GetByDevice(deviceID)
6.   if tunnel == nil { writeHolding503(w); return }
7.   streamID := uuid.New()
8.   respCh := make(chan Frame, 1)
9.   hub.RegisterStream(streamID, respCh)
10.  defer hub.UnregisterStream(streamID)
11.  bodyBytes, _ := io.ReadAll(r.Body)
12.  req := buildRequestFrame(streamID, r, bodyBytes)
13.  if err := tunnel.Send(req); err != nil { write502(w); return }
14.  select {
15.    case resp := <-respCh:
16.       writeResponseToVisitor(w, resp)
17.    case <-time.After(30*time.Second):
18.       writeTimeout(w)
19.  }
20. }
```

## 🌗 ATOMIC (concrete order of execution)

1. `proxy-node/go.mod` init
2. `tunnel-client/go.mod` init
3. `proxy-node/internal/tunnel/frame.go` (frame types)
4. `proxy-node/internal/tunnel/frame_test.go` (codec tests)
5. Copy `frame.go` to `tunnel-client/internal/tunnel/`
6. `proxy-node/internal/config/config.go`
7. `proxy-node/internal/hub/hub.go` + test
8. `proxy-node/internal/ingest/client.go` (HTTP client to Control Plane)
9. `proxy-node/internal/router/router.go` + test
10. `proxy-node/cmd/proxy/main.go` (wire it all together; WS upgrade; HTTP server)
11. `tunnel-client/internal/tunnel/frame.go` (copied)
12. `tunnel-client/internal/client/client.go` (dial + hello + read loop)
13. `tunnel-client/internal/forwarder/forwarder.go` (HTTP forward)
14. `tunnel-client/cmd/osmrouter-client/main.go`
15. `server/internal/proxyingest/middleware.go` (Bearer-shared-secret auth)
16. `server/internal/proxyingest/handlers.go` (verify, start, end, heartbeat)
17. Wire the new group in `server/internal/server/server.go`
18. Update `server/internal/config/config.go` with `OSM_PROXY_NODE_SECRET`
19. Smoke test: run Control Plane + proxy node + client + local "hello world" server, curl through public URL
20. Update dev log + HANDOFF

## 🌘 NANO (per-atomic-task — captured in Dev Log Session 2 as we go)
