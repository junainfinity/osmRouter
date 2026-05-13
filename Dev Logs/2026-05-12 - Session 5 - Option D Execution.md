# 2026-05-12 — Session 5 — Option D Execution

> Live log of the pivot to Option D — the cloud-side reverse proxy rewritten to speak the Mac sidecar's pinned-TLS + role-inverted HTTP/2 protocol, tuned for LM Studio / Ollama / OpenAI-compatible LLM streaming.

## Context (start state)

- Sessions 1–4 delivered: Control Plane (server + dashboard) + Data Plane v1 (WebSocket+JSON-frame proxy and tunnel-client) + live demo + Whitepaper + Yellow Paper + Production bundle.
- User reviewed and steered: AI-inference workload is the wedge; sovereign infrastructure (no Cloudflare in path) is the differentiator; Mac sidecar (Cloudflare-Tunnel-style protocol) is better than what we built; pivot to Option D.
- Mac app lives at `/Users/arjun/Projects/osmRouter Mac/`. We **may** modify the sidecar for AI streaming. Yellow Paper and dashboard stay clean.

## Phases (the plan)

1. ✅ Master plan, architecture, self-critique, risk register, test strategy in Obsidian (Planning/13–16, Testing/03).
2. ✅ Clean slate — archive old proxy-node/ + tunnel-client/.
3. ✅ Implement new proxy-node (TLS server + H2 client + httputil.ReverseProxy with FlushInterval=-1).
4. ✅ Tune Mac sidecar (drop Timeout: 30s, bigger h2 windows, register-frame send).
5. ✅ Update Control Plane verify endpoint.
6. ✅ Docker package + cert bootstrap script.
7. ✅ Live test with to-do app + Ollama-in-Docker + LM Studio.
8. ✅ "To Upload V2" and "To Compile V2" packaging.
9. ✅ Final docs.

## Log (chronological)

### 12:00 — Planning complete

Five planning docs in Obsidian:
- `Planning/13 - Option D - Master Plan.md`
- `Planning/14 - Option D - Architecture.md` (wire protocol, registry, forwarder, security properties)
- `Planning/15 - Option D - Self-Critique & Reform.md` (10 critiques, reformed build order, locked decisions)
- `Planning/16 - Option D - Risk Register.md` (15 risks DR-D1 through DR-D15)
- `Testing/03 - Option D Test Strategy.md` (test plan + end-to-end flow + pass criteria)

Key locked decisions:
- Wire = JSON line + role-inverted HTTP/2 over pinned TLS
- Streaming = `httputil.ReverseProxy.FlushInterval = -1`
- Cert distribution = `//go:embed`'d in both binaries
- One TLS conn per binding (carry over Mac sidecar's design)
- Tunnel health = `cc.Ping()` every 30s

### 12:40 — Cloud-side `proxy-node` rewrite (Phases 2–3)

Replaced the WebSocket-frame proxy at `proxy-node/` with three new internal packages:

- **`internal/framing`** — single-line JSON register frame, version pinned to `1`. The critical insight (DR-D5) is that the bytes between the TLS handshake and HTTP/2 preface have to be read **byte-by-byte from the raw `net.Conn`**, never through a `bufio.Reader`, otherwise the buffered reader will gobble the HTTP/2 client preface and the subsequent `h2.NewClientConn(tlsConn)` will see corrupted framing. Wrote `ReadRegisterFrame` and `WriteRegisterFrame` accordingly.
- **`internal/tunnels`** — Registry indexed by host. Each entry owns the TLS conn + `*http2.ClientConn` + cancel func + Ping loop. On register, validates with Control Plane (`POST /api/proxy/verify-device`) and atomically adds to the map. On disconnect, atomically removes. `LookupHost` is read-locked + O(1).
- **`internal/forward`** — wraps `httputil.ReverseProxy` with a `perHostTransport` whose `RoundTrip` looks up the host's `ClientConn` and forwards over it. `Director` sets `r.URL.Host = r.Host` (DR-D6) so the `:authority` pseudo-header is correct on the h2 leg. `FlushInterval = -1` makes SSE writes pass through immediately.

`cmd/proxy/main.go` starts two listeners: a TLS listener on `:8443` (sidecar inbound) terminated with `proxy-leaf.{pem,key}`, and a plaintext listener on `:8000` (visitor traffic, TLS-terminated by Caddy in front).

### 13:30 — Cert bootstrap script

Wrote `scripts/init-ca.sh` — pure-`openssl` mint of:
- ECDSA P-384 root CA (10-year validity, certificate-sign + CRL-sign only)
- ECDSA P-256 proxy leaf signed by it, SANs from `$SAN_LIST` env (default `localhost,127.0.0.1`)

Output is `ca/root.pem` (embedded in client + proxy), `ca/root.key` (locked-down on the cloud box), `ca/proxy-leaf.pem` + `ca/proxy-leaf.key` (mounted into the proxy container).

### 14:00 — Mac sidecar tune (Phase 4)

Five-line tuning in `apps/sidecar/internal/tunnel/tunnel.go`:

- Add `writeRegisterFrame(c, opts)` + `readRegisterResponse(c)` between TLS handshake and `h2.ServeConn`.
- Drop the `Client.Timeout: 30s` on `localHTTPClient` (LLM responses can take minutes).
- Bump `ResponseHeaderTimeout` from 5s → 30s (cold model load).
- Bump `IdleConnTimeout` to 5min (multi-turn warm).
- Set `ReadBufferSize` + `WriteBufferSize` to 64 KiB (faster SSE chunk throughput).

Added a `--device-id` flag to `cmd/osm-agent/main.go` so the register frame carries the Control Plane's device UUID, not the domain.

### 14:30 — Control Plane verify endpoint (Phase 5)

Extended `server/internal/proxyingest/handlers.go` so `POST /api/proxy/verify-device` accepts `{host, device_id, token}` and answers `{ok, code, message}`:

- Token check against the device's stored API key (bcrypt compare).
- **Host-binding check** — splits the requested host on `.` and tries every prefix/fqdn split in turn against `subdomains JOIN domains WHERE device_id = ?`. Fixes the bug where the rightmost-2-labels split made `app.todo.localtest.me` look up `localtest.me` instead of `todo.localtest.me`.
- Status code semantics: `OK` (200), `BAD_TOKEN` (401), `HOST_NOT_BOUND` (404), other (500).

### 15:00 — Docker package (Phase 6)

- `deploy/Dockerfile.proxy.v2` — multi-stage build with the new proxy binary, mounts `ca/` read-only at `/etc/osm/ca/`.
- `deploy/docker-compose.v2.yml` — adds the proxy container with two ports (`8000`, `8443`), wires `OSM_CA_*_PEM` env vars, depends on `server` + `redis`.

### 15:30 — Live end-to-end (Phase 7)

Brought the full stack up under `./scripts/demo_v2.sh`:

1. `init-ca.sh` mints the operator CA + leaf with SANs including `tunnel.localtest.me`.
2. `docker compose up` brings postgres + redis + server + proxy + web.
3. Sign up / log in / verify domain (`UPDATE domains SET dns_status='verified'` on `localtest.me`).
4. Add a device, capture API key.
5. Launch three sidecar processes in parallel:
   - port 3100 → `app.todo.localtest.me` (Python to-do)
   - port 11434 → `ollama.localtest.me` (Ollama in Docker, running `qwen2.5:0.5b`)
   - port 1234 → `llm.localtest.me` (LM Studio on host, running `qwen3.6-35b-a3b-claude-4.7-opus-abliterated-mlx`)

Result: all three end-to-end work. Crucial observations:
- **Ollama streaming**: `curl -N -X POST` of a "count from 1 to 10" prompt streams tokens chunk-by-chunk in 654 ms total. SSE chunks land within ~15 ms of the local Ollama emitting them.
- **LM Studio streaming**: a longer reasoning prompt streams the model's `<think>…</think>` content tokens through the tunnel just like the user-visible answer.
- **To-do app**: same fidelity as v1 (4 todos, ~18 ms round-trip), but now over the new wire protocol.

Captured the evidence as `Screenshots/v2/24-v2-live-evidence.png`.

### 16:00 — Phase 8a — "To Upload V2"

`To Upload V2/osmRouter/` is the cloud-side bundle:

- `README.md` (4-command launch) + `DEPLOY.md` + `DEPLOY.html` (15-section walkthrough)
- `.env.example` with «CHANGE» markers + `scripts/generate-secrets.sh`
- `scripts/init-ca.sh` + `scripts/demo_v2.sh`
- Production `deploy/docker-compose.yml` — **no default secrets**: every secret is `${VAR:?required}` so missing envs fail at compose-validate time rather than baking a public default
- Trimmed source: `server/`, `web/`, `proxy-node/`

Final size: ~1 MB of source. Drop on a Linux box, fill in `.env`, `docker compose up`, point Caddy at it, done.

### 16:15 — Phase 8b — "To Compile V2"

`To Compile V2/osmRouter-app/` is the Mac-app bundle. Three additions on top of the v0.1 monorepo:

1. **`apps/sidecar/internal/embedded_ca/`** package:
   - `embedded_ca.go` — `//go:embed root.pem` + `RootPEM()` + `IsRealCA()` + `Validate()`.
   - `root.pem` — ships as a `PLACEHOLDER` stub; the operator drops their real `root.pem` here before compiling.
   - `embedded_ca_test.go` — asserts the placeholder gate triggers on the stub and that `RootPEM()` returns a defensive copy.

2. **`scripts/compile-mac.sh`** — end-to-end orchestrator:
   - `check-ca` step `grep`s for `PLACEHOLDER` and exits 1 with a red error if the stub is still in place.
   - `go test ./...` across all sidecar packages.
   - Cross-compiles `osm-agent` for `darwin/arm64` AND `darwin/amd64`.
   - Runs `osm-agent selftest` against the host-arch binary; `embedded_ca.Validate()` returns `ErrPlaceholder` if the placeholder slipped through both gates, exit 1.
   - Writes `apps/desktop/resources/sidecar-hash.json` for Electron Main integrity check.
   - Optional `dmg` phase calls `electron-forge make`.

3. **Sidecar code changes** carried over to the bundle:
   - `tunnel.New()` selects trust anchor: `--root-ca` flag wins; else fall back to embedded CA; else fail closed with `no-pinned-ca:` error.
   - `pinned_tls.LoadRootCABytes(pem []byte)` for in-memory PEM (so we never go through the filesystem for the embedded blob).
   - `osm-agent` Version bumped to `0.2.0-dev`.
   - `selftest` now exercises the embedded-CA gate.

Smoke-tested both bundles by:
- Building against the placeholder → `check-ca` correctly fails with the red message.
- Restoring the operator's real root.pem → `compile-mac.sh sidecar` produces both arches, hash JSON, and `selftest` outputs `{"event":"selftest-ok"}`.

`To Compile V2/` total size ~13 MB (most of which is the two stripped arch binaries at ~6.5 MB each).

### 16:30 — Phase 9 — Vault index + HANDOFF + this log

Updated:
- `00 - Vault Index.md` — Sessions 1–5, Planning 13–16, Testing 03, V2 bundles, v2 screenshots
- `HANDOFF.md` — V2 paths, V2 4-command launch, what to send customers
- `Screenshots/00 - Screenshot Analysis.md` — Screenshot 24 (v2 live evidence) appended

## Definition of Done — Session 5 status

| Goal | Status |
|---|---|
| Pivot proxy to pinned-TLS + role-inverted HTTP/2 | ✅ |
| Streaming SSE through tunnel — Ollama + LM Studio + to-do app | ✅ |
| Host-binding validated by Control Plane | ✅ |
| Operator CA embedded into Mac sidecar at build time | ✅ |
| Placeholder gate that fails closed | ✅ (script + Go selftest + unit test) |
| Production-grade `To Upload V2/` cloud bundle | ✅ |
| Production-grade `To Compile V2/` Mac-app bundle | ✅ |
| Obsidian vault fully updated | ✅ |
| HANDOFF doc reflects v2 surface | ✅ |

Carry-overs to v2.1 (unchanged from the v2 deferral list): real Cloudflare-for-SaaS, Stripe webhook, WebAuthn admin MFA, per-node proxy mTLS, auto-rotation of leaf cert, live "active tunnels" panel.
