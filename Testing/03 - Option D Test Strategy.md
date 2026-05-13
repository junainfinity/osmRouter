# 03 — Option D Test Strategy

## Levels

| Layer | Tool | Scope |
|---|---|---|
| Unit | Go `testing` + `httptest` | Each new package in `proxy-node/internal/` |
| Integration | Go `testing` + real TLS + real h2 | proxy + a mock sidecar (lives in `proxy-node/testdata/`) talking through a unix-domain TLS conn |
| End-to-end | shell + curl + ollama | Real proxy, real sidecar, real LM Studio + Ollama, real visitor curl |
| UI | puppeteer-core | Dashboard renders both tunnels as active; admin audit log shows their open/close events |

## Specific tests to write

### `proxy-node/internal/registry/registry_test.go`
- `TestRegistry_SetGetDelete` — happy path
- `TestRegistry_Set_ReplacesAndClosesOld` — second `Set(same-host, …)` closes the prior tunnel
- `TestRegistry_Concurrent_NoRaces` — `go test -race`, 100 goroutines registering/deregistering
- `TestRegistry_GetByDevice` — lookup the other way (for unbind operations)

### `proxy-node/internal/tunnels/tunnels_test.go`
- `TestRegisterFrame_RoundTrip` — encode/decode the JSON frame
- `TestRegisterFrame_RejectsBadInput` — malformed JSON, missing fields, oversize
- `TestHandshake_ReadsFrameByteByByte` — **DR-D5**: the byte-by-byte read leaves the TLS conn pristine for h2 (verified by a mock that immediately writes HTTP/2 preface after the proxy responds)

### `proxy-node/internal/forward/forward_test.go`
- `TestDirector_SetsURLHostAndScheme` — **DR-D6** regression test
- `TestForward_HappyPath_StreamingBody` — upstream emits SSE chunks, downstream receives them in real time (verify with timestamps)
- `TestForward_MissingRegistryEntry_ReturnsHolding503` — host not in registry
- `TestForward_LargeRequestBody` — 50 MB POST, no buffer cap
- `TestForward_VisitorDisconnectsMidStream_NoLeak` — kill visitor's reader, verify no leaked goroutines

### `proxy-node/internal/ingest/ingest_test.go`
- `TestVerify_OK` — control plane returns ok → frame accepted
- `TestVerify_Reject` — control plane returns reject → frame rejected, conn closed
- `TestVerify_Timeout` — control plane unreachable → frame rejected with "verify-unavailable"

### Server-side changes
- `server/internal/server/proxyingest_test.go` — update existing tests so `VerifyDevice` payload includes `host` and validation walks domain+subdomain table

### Mac sidecar (`apps/sidecar/internal/tunnel/tunnel_test.go`)
- `TestSidecar_SendsRegisterFrame_AfterTLSHandshake` — drives the modified `runOnce` against the integration mockproxy; verifies the JSON frame arrives correctly
- `TestSidecar_RespectsLongStreamingResponse` — local target sends an SSE stream over 60s; sidecar streams it without timing out (regression vs old `Timeout: 30s`)

## End-to-end flow

```
PHASE A: Docker up
  docker compose up -d
  curl http://localhost:8080/healthz   →  200

PHASE B: Bootstrap demo user
  # uses the existing demo_live.sh but tuned for the new endpoints
  ./scripts/demo_live.v2.sh

PHASE C: Mac side
  cd "/Users/arjun/Projects/osmRouter Mac/osmRouter-app"
  npm run build:sidecar       # build the tuned sidecar
  
  # Tunnel 1 — the to-do app
  ./apps/desktop/resources/osm-agent-darwin-arm64 run \
    --domain app.todo.osmrouter.test.localtest.me \
    --local-port 3100 \
    --proxy-url https://localhost:8443
  
  # Tunnel 2 — LM Studio (user has it running)
  ./apps/desktop/resources/osm-agent-darwin-arm64 run \
    --domain llm.osmrouter.test.localtest.me \
    --local-port 1234 \
    --proxy-url https://localhost:8443
  
  # Tunnel 3 — Ollama in Docker
  docker run -d --name ollama -p 11434:11434 ollama/ollama
  docker exec ollama ollama pull qwen2.5:0.5b
  
  ./apps/desktop/resources/osm-agent-darwin-arm64 run \
    --domain ollama.osmrouter.test.localtest.me \
    --local-port 11434 \
    --proxy-url https://localhost:8443

PHASE D: Visitor side
  # Plain GET to the to-do app
  curl -k https://app.todo.osmrouter.test.localtest.me:8443/
  
  # Streaming chat completion
  curl -k -N -X POST https://ollama.osmrouter.test.localtest.me:8443/v1/chat/completions \
    -H 'Content-Type: application/json' \
    -d '{"model":"qwen2.5:0.5b","messages":[{"role":"user","content":"count to 30 slowly"}],"stream":true}'
  
  # ↑ expect tokens to appear in terminal one-by-one, not at the end

PHASE E: UI verification
  Open dashboard, log in as demo user
  Verify 3 active tunnels listed
  Verify admin audit shows their open events
  Take screenshots
```

## Pass criteria

- All Go unit tests green (~25 new tests)
- All integration tests green
- `curl -N` against the Ollama tunnel streams tokens in real time (not buffered)
- Browser dashboard shows 3 active tunnels with live byte counters
- Admin audit log shows `tunnel.opened` for each
- Screenshots captured of: dashboard, admin overview, admin audit, sidecar logs (terminal), proxy logs (terminal), curl streaming output (terminal), to-do app accessed via tunnel (browser), Ollama OpenAI-compatible chat response streaming (terminal)
