# 13 — Option D Master Plan (CTO mode)

> **Mandate:** Pivot the cloud-side reverse proxy to match the existing Mac sidecar's wire protocol — pinned-TLS + role-inverted HTTP/2 — and tune both ends for self-hosted LLM workloads (LM Studio / Ollama / OpenAI-compatible streaming). Deliver Docker-packaged install for cloud side; updated Mac binary.

## 1. The North Star

osmRouter is positioning as the **sovereign reverse-tunnel built for self-hosted LLM inference**. The thesis: when a developer exposes LM Studio or Ollama to the public internet, they want streaming-fast, MITM-immune, multi-region routing — and they don't want a third party (Cloudflare, ngrok, Tailscale) able to read their prompts in transit.

Option D realises this on a foundation of three composed proven pieces:

1. **TLS 1.3 with pinned operator CA** — defeats corporate / state / captive-portal MITM.
2. **HTTP/2 with role inversion** — sidecar dials out, becomes the H2 server; cloud proxy is the H2 client. No port-forwarding, native NAT-traversal.
3. **`httputil.ReverseProxy` driven by per-binding `http2.Transport`** — natively streaming, no body cap, predictable Go stdlib code path.

## 2. What's Being Built (and what's NOT)

### IN SCOPE this session
- New `proxy-node/` (replaces the old WebSocket+JSON-frame proxy)
- Tuned Mac sidecar (the one in `/Users/arjun/Projects/osmRouter Mac/osmRouter-app/apps/sidecar`)
- One new Control Plane endpoint (sidecar-token verify, replaces old WebSocket-hello verify)
- Pinned-CA bootstrap (issue a root CA per operator install, distribute it inside both the proxy and the sidecar binary)
- New Docker package ("To Upload V2") and Mac compile bundle ("To Compile V2")
- Live end-to-end test against:
   - A simple to-do app on the Mac (port 3100, our existing demo)
   - **LM Studio on the Mac** (port 1234, the user's running instance)
   - **Ollama-in-Docker** (port 11434, container running on this Mac)
- Screenshots through every layer

### OUT OF SCOPE this session
- Multi-region proxy fleet (single proxy node)
- WebAuthn admin MFA (still on v1.1 backlog)
- Stripe wiring (still v1.1)
- Per-tenant CA (single operator CA for v1)
- RFC 8441 WebSocket-over-H2 (sketch only, full impl is v1.1)

## 3. Architecture (single diagram)

```
   ┌──────────── Cloud (Docker on operator's box) ──────────────┐
   │                                                             │
   │   ┌──────────────┐    ┌──────────────────────────────┐      │
   │   │ Control Plane│    │  proxy-node                  │      │
   │   │ Go + Postgres│    │                              │      │
   │   │ Redis + WS   │    │  TLS server :443             │      │
   │   │              │    │  - accepts inbound conns     │      │
   │   │ /api/v1/proxy│    │    from Mac sidecars         │      │
   │   │   /verify    │◀──▶│  - holds h2.Transport per    │      │
   │   │              │    │    connected device          │      │
   │   └──────────────┘    │  - registry[host] →          │      │
   │                       │    transport                 │      │
   │                       │                              │      │
   │                       │  Public listener :80/:8000   │      │
   │                       │  - httputil.ReverseProxy     │      │
   │                       │  - looks up host → transport │      │
   │                       │  - FlushInterval = -1        │      │
   │                       │    (streams SSE immediately) │      │
   │                       └────────────┬─────────────────┘      │
   └────────────────────────────────────┼────────────────────────┘
                                        │ ◀── outbound TLS 1.3, pinned CA
                                        │     HTTP/2 (inverted)
                                        ▼
   ┌──────────── Mac (end-user's machine) ──────────────────────┐
   │                                                             │
   │   ┌──────────────────────────────────────────────────────┐  │
   │   │  Electron Main + Renderer (unchanged in this phase)  │  │
   │   │  spawns one sidecar process per binding              │  │
   │   └─────────────┬────────────────────────────────────────┘  │
   │                 ▼ (stdin token + flags)                     │
   │   ┌──────────────────────────────────────────────────────┐  │
   │   │  osm-agent Go sidecar (tuned for AI streaming)       │  │
   │   │                                                       │  │
   │   │  - TLS 1.3 + pinned CA (already)                     │  │
   │   │  - HTTP/2 server on inverted conn (already)          │  │
   │   │  - host-header validation (already)                  │  │
   │   │                                                       │  │
   │   │  TUNED FOR LLM:                                       │  │
   │   │  - NO wall-clock client timeout (was 30s)            │  │
   │   │  - h2 stream window = 8 MB (was 64 KB default)       │  │
   │   │  - ResponseHeaderTimeout = 30s (model warmup)        │  │
   │   │  - IdleConnTimeout = 5 min                           │  │
   │   │  - register-frame on connect carries device_id+token │  │
   │   │  - forwarder uses streaming io.Copy (already)        │  │
   │   └─────────────┬────────────────────────────────────────┘  │
   │                 ▼ HTTP forward to localhost target          │
   │   ┌──────────────────────────────────────────────────────┐  │
   │   │  User's local app                                    │  │
   │   │  - to-do app (port 3100)                             │  │
   │   │  - LM Studio (port 1234)                             │  │
   │   │  - Ollama-in-Docker (port 11434)                     │  │
   │   └──────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────┘

           Visitor on the internet:
           curl https://app.maya-coder.com/v1/chat/completions  ─▶  cloud proxy
                                                                  routed by Host
                                                                  ─▶ device 1f8a
                                                                  ─▶ sidecar
                                                                  ─▶ LM Studio
                                                                  ─▶ streamed SSE back
```

## 4. The Wire Protocol (formal)

**Phase 1 — Connection establishment** (per binding):

1. Sidecar dials `tunnel.<operator>.com:443` (outbound TCP).
2. TLS 1.3 client handshake. Sidecar validates the leaf cert against the **pinned operator root CA**. System trust store is **never** consulted.
3. As soon as the TLS handshake completes, the sidecar transmits a **single control frame** (JSON over an HTTP/1.1-like prelude, or HTTP/2 first request) carrying:
   ```json
   {
     "version": 1,
     "device_id": "<uuid>",
     "token": "<bearer>",
     "host":   "app.maya-coder.com",
     "client":"osm-agent/0.1.0"
   }
   ```
4. The proxy validates `(token, device_id, host)` against the Control Plane via the existing `/api/v1/proxy/devices/verify` endpoint (extended to also check the `host` binding).
5. On accept, the proxy responds `{"ok": true, "node_id": "..."}` and immediately **flips roles**: the proxy now begins issuing HTTP/2 *requests* over the connection, with the sidecar serving them as an HTTP/2 server. On reject, proxy sends `{"ok": false, "code": "..."}` and closes.

**Phase 2 — Steady state:**

- The proxy maintains `registry: host → http.Transport` keyed by the validated host.
- Visitor requests hit the public listener. `httputil.ReverseProxy` looks up `r.Host`, picks the right transport, and proxies the request. Streaming is automatic — `httputil.ReverseProxy.FlushInterval = -1`.

**Phase 3 — Teardown:**

- Either side closes the TLS connection → proxy removes its entry from the registry, audits `tunnel.closed`.

## 5. Tuning the Mac Sidecar for AI Streaming (5 changes)

| Change | Where | Why |
|---|---|---|
| Drop `http.Client.Timeout: 30 * time.Second` | `apps/sidecar/internal/tunnel/tunnel.go::localHTTPClient` | Long inference responses (30s–5min) get killed today |
| `ResponseHeaderTimeout: 30 * time.Second` (was 5s) | same | Cold model load can exceed 5s for first response header |
| `IdleConnTimeout: 5 * time.Minute` | same | Multi-turn chat keeps connections warm |
| `ReadBufferSize / WriteBufferSize = 64 KB` | same | Faster SSE chunk throughput |
| Send `register-frame` immediately after TLS handshake | `runOnce` | Identifies the binding to the new proxy |

Five lines + one ~30-line addition for the register frame. Mac team's Yellow Paper §9 only requires a footnote.

## 6. Build Order

1. Planning docs (this batch).
2. Self-critique & reform.
3. Risk register.
4. Test strategy.
5. Stop old demo. Archive old `proxy-node/` and `tunnel-client/` to `_old/` so they're git-recoverable but not in the way.
6. New `proxy-node/cmd/proxy/main.go` + minimal supporting packages.
7. Sidecar tuning (5 changes above).
8. Control Plane: extend `/api/v1/proxy/devices/verify` to take host + return ok/reject.
9. Cert bootstrap script (`scripts/init-ca.sh` mints root + leaf, writes PEMs to volumes).
10. New Dockerfiles + compose.
11. Live test:
    - To-do app on :3100 → tunnel → `https://app.osmtest.localtest.me`
    - LM Studio on :1234 → tunnel → `https://llm.osmtest.localtest.me/v1/chat/completions` (streaming)
    - Ollama-in-Docker on :11434 → tunnel → `https://ollama.osmtest.localtest.me/v1/chat/completions` (streaming)
12. Screenshots throughout (browser + dashboard + admin + sidecar logs).
13. "To Upload V2" + "To Compile V2" packaging.
14. Vault index + dev-log finalization.

## 7. Definition of Done

- All five Go test suites green under `-race -count=1`
- Curl with `-N` against the public URL for a 30-second Ollama inference streams tokens as they're generated (not buffered)
- Browser screenshot of dashboard shows the live tunnel with the correct host
- "To Upload V2" deploys in under 30 seconds with three commands
- Mac sidecar binary in "To Compile V2" runs against the new proxy with no errors
- Obsidian vault has dev-log entries for every phase
