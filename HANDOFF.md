# osmRouter Web — Handoff (v2 / Option D)

> This doc lives at the repo root. Open the same vault you're using for `Planning/`, `Security/`, `Testing/`, `Dev Logs/` to see all related notes.

> **v2 is live.** The Data Plane has been rewritten to speak the Mac sidecar's pinned-TLS + role-inverted HTTP/2 protocol, tuned for LM Studio / Ollama / OpenAI-compatible streaming. No third party in the data path. The customer-facing Mac app is in a sibling tree at `/Users/arjun/Projects/osmRouter Mac/` and gets rebuilt with the operator CA embedded via `//go:embed`. The v1 WebSocket-frame proxy is kept under `_v1-archive/` for reference; the v1 production bundle at `To Upload/` is also kept so older clients can still be served during a migration window.

---

## 🚀 v2 Production bundles (the things you actually ship)

| Bundle | Role | Path |
|---|---|---|
| **To Upload V2** | Cloud side — server, dashboard, new proxy, Docker | `To Upload V2/osmRouter/` |
| **To Compile V2** | Mac side — tuned sidecar, embedded operator CA, build script | `To Compile V2/osmRouter-app/` |

### Cloud side (To Upload V2) — 4 commands to launch

```bash
# 1. Drop on your server
scp -r "./To Upload V2/osmRouter" root@your-box:/opt/

# 2. Mint operator CA + fill .env
ssh root@your-box "cd /opt/osmRouter && \
    ./scripts/init-ca.sh && \
    cp .env.example .env && \
    ./scripts/generate-secrets.sh >> .env && \
    nano .env"

# 3. Bring up the Docker stack
ssh root@your-box "cd /opt/osmRouter && \
    docker compose -f deploy/docker-compose.yml --env-file .env up -d --build"

# 4. Front it with TLS (Caddy or nginx)
ssh root@your-box "cp /opt/osmRouter/deploy/Caddyfile.example /etc/caddy/Caddyfile && caddy reload"
```

Full walkthrough: `To Upload V2/osmRouter/DEPLOY.md` (or `DEPLOY.html`). 15 sections cover prereqs, DNS records, CA minting, SMTP wiring, Docker bring-up, TLS terminator, admin promotion, customer onboarding, end-to-end verification, backups, updating, CA rotation, troubleshooting, and the v2.1 deferral list.

### Mac side (To Compile V2) — compile the .dmg

```bash
# 0. After running ./scripts/init-ca.sh on the cloud side, copy the
#    operator root.pem into the embed slot:
cp /opt/osmRouter/ca/root.pem \
   "To Compile V2/osmRouter-app/apps/sidecar/internal/embedded_ca/root.pem"

# 1. One-shot build (CA gate → go tests → cross-compile → selftest → .dmg)
cd "To Compile V2/osmRouter-app" && ./scripts/compile-mac.sh
```

The script enforces a placeholder-CA gate at three layers: bash `grep`, Go `embedded_ca.Validate()`, and a unit test on `embedded_ca`. A build that forgot to swap the placeholder cannot ship.

Full build walkthrough: `To Compile V2/osmRouter-app/COMPILE.md`. Covers prereqs, CA drop, sidecar-only mode, full `.dmg` mode, signing + notarization (`@electron/notarize` wired), sanity test, CA rotation, troubleshooting.

### What changed vs v1 in two columns

| Layer | v1 | **v2 (Option D)** |
|---|---|---|
| Tunnel wire protocol | WebSocket + JSON frames | TLS 1.3 + role-inverted HTTP/2 |
| Streaming SSE / large bodies | 4 MB cap, buffered | Unbounded, `FlushInterval = -1` |
| Long inference (> 30 s) | 504 at wall-clock | Survives until visitor cancels |
| TLS trust model | System trust store | Pinned operator CA (system trust ignored) |
| Mac sidecar CA delivery | `--root-ca path/to.pem` flag | `//go:embed`'d at compile time |
| LLM workloads (Ollama, LM Studio) | Technically possible, never streamed | First-class, tested end-to-end |
| Customer custom domain Cloudflare-for-SaaS | Documented in deploy guide | Same (v2.1 backlog) |

---

## v1 reference (archived)

## What's in this repo

```
osmRouter Web/
├── server/          # Control Plane: Go API server (Echo + GORM + Redis + WebSockets)
├── web/             # Dashboard: Next.js 16 (App Router + Tailwind v4 + TanStack Query + Zustand)
├── proxy-node/      # Data Plane: the reverse-proxy fleet member (public + tunnel listeners)
├── tunnel-client/   # Data Plane: desktop client CLI that holds the tunnel open
├── mac-app/         # The demo "user app" — a Python to-do server that runs ON the Mac
├── deploy/          # Dockerfiles + docker-compose.yml for the cloud-side stack
├── scripts/         # Smoke + demo scripts (smoke_data_plane.sh, demo_live.sh, ...)
├── Whitepaper/      # Business/vision paper (Markdown + standalone HTML)
├── Yellow Paper/    # Formal technical specification (Markdown + standalone HTML w/ MathJax)
├── Screenshots/     # 22 live screenshots + Screenshot Analysis with feature breaks
├── Design/          # Original JSX prototype — visual reference only
├── Planning/        # Architecture, task breakdown, self-critique, risk register (Phase 1 + 2)
├── Security/        # Threat model, posture, mitigation checklist (Phase 1 + 2)
├── Testing/         # Test strategy (Phase 1 + 2)
├── Dev Logs/        # Sessions 1 (Control Plane), 2 (Data Plane), 3 (Live demo + papers)
├── To Upload/       # 🚀 Production bundle — drop on a server to start the business
└── HANDOFF.md       # ← this file
```

## 🚀 Production bundle (the thing you actually upload to a server)

`To Upload/osmRouter/` is a **self-contained, demo-free deployment bundle**. 137 files, 936 KB. Drop it on a Linux server with Docker and the [DEPLOY.md](To%20Upload/osmRouter/DEPLOY.md) (or [DEPLOY.html](To%20Upload/osmRouter/DEPLOY.html)) walks you from `git clone` to live in about 30 minutes.

**The 4-command launch:**
```bash
scp -r "./To Upload/osmRouter" root@your-server:/opt/
ssh root@your-server "cd /opt/osmRouter && cp .env.example .env && ./scripts/generate-secrets.sh >> .env && nano .env"
ssh root@your-server "cd /opt/osmRouter && docker compose -f deploy/docker-compose.yml --env-file .env up -d --build"
ssh root@your-server "cp /opt/osmRouter/deploy/Caddyfile.example /etc/caddy/Caddyfile && caddy reload"
```

**What you must change for your business** (full list in `DEPLOY.md` §3 + the README):

| What | Where |
|---|---|
| Your domain — replace `osmrouter.com` everywhere | `.env` (`OSM_BRAND_DOMAIN`, `OSM_PROXY_CNAME`, `OSM_CORS_ORIGINS`, `OSM_COOKIE_DOMAIN`, `NEXT_PUBLIC_API_BASE`) + the Caddyfile |
| All cryptographic secrets + DB/Redis passwords | `.env` — generated by `scripts/generate-secrets.sh` (one command) |
| Email sender for the OTP | `server/internal/auth/service.go` + the four `SMTP_*` env vars |
| Marketing copy + brand wordmark + accent colour | `web/app/page.tsx`, `web/components/icons/index.tsx`, `web/app/globals.css` |
| Download URL for `osmrouter-client` | the "Download client" button in `web/app/page.tsx` |
| Reverse-proxy domain config | `deploy/Caddyfile.example` (or `nginx.conf.example`) — change every `osmrouter.com` to yours |

What's intentionally **not** included in the bundle: the Obsidian planning vault, the JSX design prototype, the screenshots folder, the demo scripts, the to-do app, the Whitepaper/Yellow Paper sources (those can be served from your marketing site).

The DEPLOY guide also covers Cloudflare-for-SaaS for customer-domain TLS, backups, health monitoring, troubleshooting, and the three honest v1.0 limitations you should plan around (tunnels-table not populated, device offline status, DNS verifier race — all documented as v1.1 work).

## 🎬 Live demo (the showcase the rest of this doc builds towards)

```bash
./scripts/demo_live.sh
```

This brings up the whole cloud-side stack in Docker (Redis + Control Plane + Dashboard + Proxy node), runs the Python to-do app + osmrouter-client *directly on this Mac*, signs up the demo user, creates a verified domain (`todo.localtest.me`), creates and binds a subdomain (`app`) to the Mac device. Done in under a minute.

After it finishes, open in any browser:

- **Dashboard** (sign in as `demo@osmrouter.test` / `hunter22demo`): http://localhost:3030/login
- **To-Do app directly on Mac**: http://localhost:3100
- **To-Do app via the Docker proxy + WebSocket tunnel to Mac**: http://app.todo.localtest.me:8000

Then `./scripts/demo_stop.sh` tears it all down.

The `Screenshots/` folder has 22 captures of this exact live run, including screenshot 18 which shows the to-do app reached via the proxy — banner says "Served by M4-Max-MacBook-Pro.local · port 3100" with 18 ms round-trip latency, proving the byte crossed the Docker→Host boundary.

## 📄 Whitepaper & Yellow Paper

- **[Whitepaper](Whitepaper/osmRouter-Whitepaper.md)** ([HTML](Whitepaper/osmRouter-Whitepaper.html)) — business and vision narrative. ~3500 words. Sections: Problem, Vision, Architecture, Key Features, Security Posture, Use Cases, Comparison to ngrok / Cloudflare Tunnel / Tailscale Funnel / FRP, Operating Model, Roadmap.
- **[Yellow Paper](Yellow%20Paper/osmRouter-Yellow-Paper.md)** ([HTML](Yellow%20Paper/osmRouter-Yellow-Paper.html)) — formal technical specification. ~6500 words. 12 numbered sections + appendix. Formal cryptographic primitives, state-transition pseudocode, wire-protocol schema, 9 security-property theorems (P1–P9), failure-mode conformance table, performance bounds, conformance checklist.

Both HTML versions are self-contained (no external CSS), styled in the osmRouter design system (Inter + JetBrains Mono, OKLCH dark theme with a light-mode toggle). The Yellow Paper loads MathJax for the formal math notation.

## How to run

### Full stack (E2E demo) — the fastest path

```bash
./scripts/smoke_data_plane.sh
```

This one script builds all binaries, boots dev-redis + Control Plane + a fake local app + proxy node + tunnel client, walks through full signup → device → domain → bind, then curls through the proxy. Expects HTTP 200 from the fake local app via `http://localhost:8000/` with `Host: api.smoke.test`. Also tests holding-state.

### Each component individually

**Dev Redis** (for the Data Plane to do mapping lookups):
```bash
cd server
go run ./cmd/dev-redis -addr=:6379       # in-process miniredis
# OR for production:  brew services start redis  /  docker run -p 6379:6379 redis:7-alpine
```

**Control Plane (backend API)**:
```bash
cd server
go run ./cmd/api
# defaults:
#   OSM_ENV=dev, OSM_HTTP_ADDR=:8080
#   OSM_DATABASE_URL=sqlite://osm-dev.db
#   OSM_REDIS_URL=  (empty in dev — bind/unbind degrades gracefully)
#   OSM_DEV_EXPOSE_OTP=true  (returns OTP in /register response)
#   OSM_PROXY_NODE_SECRET=<shared-secret-for-proxy-ingest>
```

**Frontend (dashboard)**:
```bash
cd web
pnpm install
pnpm dev          # http://localhost:3000
```

**Proxy Node** (Data Plane — needs Redis + Control Plane up):
```bash
cd proxy-node
OSM_PROXY_NODE_SECRET=<same-as-control-plane> \
OSM_REDIS_URL=redis://localhost:6379 \
OSM_CONTROL_PLANE_URL=http://localhost:8080 \
  go run ./cmd/proxy
# listens on :8000 (public) + :8001 (tunnel)
```

**Tunnel Client** (Data Plane — runs on the user's laptop):
```bash
cd tunnel-client
go run ./cmd/osmrouter-client \
  --proxy-url ws://localhost:8001/ws/tunnel \
  --api-key   $YOUR_DEVICE_API_KEY \
  --device-id $YOUR_DEVICE_ID \
  --local     http://localhost:3000
```

Once all five are up: `curl -H "Host: your-domain" http://localhost:8000/` → request reaches your local app.

## How to run tests

### Control Plane (Go)
```bash
cd server && go test ./... -race -count=1
```
**Result:** 56 tests pass — 19 crypto, 6 CSRF, 4 rate-limit, 5 integration (auth + bind/unbind cycle), 17 security (JWT alg confusion, CSRF, refresh reuse, headers, CORS, …), 5 proxy-ingest (Bearer auth, verify-device, tunnel lifecycle).

### Data Plane (Go)
```bash
cd proxy-node     && go test ./... -race -count=1
cd tunnel-client  && go test ./... -race -count=1
```
**Result:** 16 tests pass — 7 wire-protocol, 4 hub concurrency, 3 router scenarios (happy path with real WS pair, 503 holding, 413 too-large; plus 502 no-mapping), 4 forwarder.

### Frontend
```bash
cd web && pnpm next build && pnpm vitest run
```
**Result:** Production build green (17 routes); 10 component tests pass.

### End-to-end smokes (verify the entire system end-to-end)
```bash
./scripts/smoke_data_plane.sh             # all on localhost, fastest
./scripts/docker_remote_laptop_demo.sh    # tunnel-client + local app run in a Docker container
```
**Localhost smoke:** HTTP 200 via proxy → tunnel → local app; HTTP 503 holding state when client disconnected.

**Docker smoke** (highest-fidelity — proves routing crosses an isolation boundary): visitor curl on the host hits the proxy node on the host; the proxy forwards over a WebSocket tunnel into a container; inside the container the tunnel-client forwards to a Python HTTP server. The response JSON includes the container's hostname (e.g. `5faeda775c92`) which `docker exec ... hostname` confirms — proving traffic genuinely passed through the container's network namespace. POST bodies survive the round trip; killing the container yields HTTP 503 holding state.

## End-to-end smoke (validated)

**Localhost path (`./scripts/smoke_data_plane.sh`):**
```
GET / via proxy (Host: api.smoke.test):  HTTP 200 + "hello from local app, path=/"
GET /foo/bar via proxy:                  HTTP 200 + "hello from local app, path=/foo/bar"
kill tunnel-client; GET / via proxy:     HTTP 503 + "Reconnecting…" page
```

**Cross-boundary Docker path (`./scripts/docker_remote_laptop_demo.sh`):**
```
GET /hello?from=host via proxy:
{
  "served_by": "in-container local app",
  "hostname":  "5faeda775c92",
  "path":      "/hello?from=host"
}
  ✓ docker exec ... hostname == "5faeda775c92"
  ✓ DEMO PASSED — traffic routed across host/container boundary correctly

POST /post-here with body "visitor-payload":  served by container, method=POST ✓
docker stop container; GET via proxy:         HTTP 503 + "Reconnecting…" ✓
```

## Architecture summary

osmRouter splits into two planes per the PRD:

**Control Plane** (`server/` + `web/`):
- **Auth:** Argon2id password hash, JWT (HS256, 15-min access) in HttpOnly cookies, refresh token rotation with reuse-detection → entire chain revoked.
- **Domain verification:** in-process goroutine pool polls every 60s + on-demand enqueue. Uses `net.LookupCNAME` + `net.LookupTXT` (swappable via `domains.Resolver` interface). HMAC-bound TXT token cannot be forged externally.
- **Subdomain binding:** Postgres update + Redis SET in a transaction. If Redis fails, Postgres rolls back. Hub broadcasts `subdomain.bound` / `subdomain.unbound` to user's WS channel.
- **CSRF:** double-submit token via cookie + `X-CSRF-Token` header on every write. Bearer auth (device API keys + proxy-node shared secret) bypasses CSRF.
- **Rate limiting:** per-IP token bucket on auth routes (5/min), per-user on everything else (100/min). 429 + `Retry-After` header.
- **Audit log:** append-only `audit_logs` table. Every destructive action records actor + target + IP + UA + request_id.
- **Proxy ingest** (`/api/v1/proxy/*`): Bearer-secret-authed endpoints for proxy nodes to validate device api_keys, record tunnel start/end/bytes, and report node liveness.

**Data Plane** (`proxy-node/` + `tunnel-client/`):
- Proxy node listens on two ports: public (HTTP visitor traffic) + tunnel (WebSocket from desktop clients).
- Visitor request → Redis `live:<fqdn>` lookup → look up tunnel in hub → multiplexed stream over WebSocket → desktop client forwards to local app → response piped back.
- Stream multiplexing via UUID `stream_id`. Single WS per connected device.
- Holding state: when a tunnel drops, visitors get a clean 503 "Reconnecting…" page; mapping stays in Redis until the user explicitly unbinds.
- Auth on tunnel connect: device api_key validated against Control Plane (single call per WS connection).
- Same-device second connection: replaces the old (sends `close{reason:"replaced"}` to old, registers new).

## Data Plane wire protocol (quick reference)

WebSocket text frames carrying JSON. Canonical spec: `Planning/08 - Data Plane - Architecture.md §Tunnel Wire Protocol`.

| Frame | Direction | Purpose |
|---|---|---|
| `hello` | client → proxy | Authenticate via device_id + api_key |
| `hello_ack` | proxy → client | Auth ok; carries node_id |
| `request` | proxy → client | Visitor HTTP request to forward |
| `response` | client → proxy | Reply from local app |
| `error` | either | Stream- or connection-level error |
| `ping` / `pong` | either | Application-level keep-alive (in addition to WS pings) |
| `close` | proxy → client | Server-initiated stream close (e.g. "replaced") |

Stream multiplexing: each visitor request gets a fresh `stream_id` (UUIDv4); the proxy holds a per-stream response channel that receives the matching `response` frame.

## Security controls implemented (mapped to `osmRouter Web Security.pdf`)

| Section | Implementation | Verified by |
|---|---|---|
| §1.1 IAM — Argon2id + JWT lifecycle + refresh rotation | ✓ `internal/auth/*`, `internal/platform/crypto/argon2.go`, `jwt.go` | unit + security tests |
| §1.1 OAuth 2.1 + PKCE | endpoint shape ready (`device_codes` table), full flow stubbed | — |
| §1.2 TLS 1.3, AES-256-GCM | `internal/platform/crypto/aes.go`; TLS at reverse proxy in prod | AES test |
| §2.1 Cloudflare for SaaS | interface ready; provisioning in prod infra | — |
| §2.2 Rate limit | leaky/token bucket + Retry-After | rate-limit + security tests |
| §3.1 Circuit breakers | not in v1 (no external API integrations yet) | — |
| §3.2 DB connection pool | GORM default, healthcheck reports DB up/down | health endpoint |
| §4.1 Multiplexed recovery, holding state | proxy holding-state 503 page, mid-stream splice deferred to v1.1 | router test + smoke |
| §4.2 Proxy node load balancing | single-node v1; Anycast/GeoDNS deferred | — |
| §5.1 CSP | strict on API responses + `next.config.ts` header on frontend | security test |
| §5.2 CSRF | double-submit + header | csrf + security tests |
| §6 Failure matrix — Redis crash, DB outage, rate limit | health endpoint reports mode, banner in UI, 429 with Retry-After, holding state on tunnel drop | health + rate-limit + router tests + smoke |
| §7.1 Structured JSON logging + request IDs | `log/slog` JSON, `X-Request-ID` injected and echoed | manual verification |
| §7.2 Audit logs | append-only table, write on every destructive action | integration tests |
| §8 Disaster recovery | infra concern; documented in `Planning/05` | — |
| §9 Graceful shutdown | `srv.Shutdown(ctx)` on SIGINT/SIGTERM, plus tunnel-client closes WS on ctx cancel | manual + smoke |

## What's deferred to v1.1 (intentionally)

Documented in `Planning/04 - Self-Critique & Reformed Plan.md` (Control Plane) and `Planning/10 - Data Plane - Self-Critique & Reform.md` (Data Plane).

**Still deferred:**
- Real Cloudflare-for-SaaS provisioning (we generate the CNAME target + HMAC TXT token; we don't yet call Cloudflare's API)
- Real Stripe billing
- WebAuthn for admin MFA
- HSM/KMS for the AES master key (currently env-loaded)
- Real PKCE endpoints (device-code schema is there; HTTP endpoints aren't)
- Email sending (OTPs are dev-echoed)
- Read replicas / multi-region failover
- gRPC for the tunnel (we use WebSocket + JSON — same wire shape, easier to debug)
- Streaming response bodies through the tunnel (currently buffered, 4 MB cap — covers 95% of HTTP)
- mid-stream splice on tunnel reconnect (we show 503 holding page; real seamless reconnect is v1.1)
- Per-node mTLS or per-node API keys for proxy → Control Plane (one shared secret in v1)
- Frontend: domain-detail UI, subdomain bind/unbind UI from the dashboard (backend works; UI uses the API directly via curl/script for now)
- Frontend: live "Active tunnels" panel driven by `tunnel.opened` / `tunnel.closed` WS events (events are emitted; UI doesn't render them yet)
- Per-proxy-node Anycast / GeoDNS / load balancing — v1 ships a single-process proxy

Schemas, contracts, and WS events are all in place so each of these is additive — not a rewrite.

## Where to look first

**Control Plane (Phase 1):**
- **"How does X work?"** → `Planning/02 - Architecture.md`
- **"Why did we choose Y?"** → `Planning/04 - Self-Critique & Reformed Plan.md`
- **"What's the threat model?"** → `Security/01 - Threat Model.md`
- **"What tests cover what?"** → `Testing/00 - Test Strategy.md`
- **"What happened during the Phase 1 build?"** → `Dev Logs/2026-05-12 - Session 1.md`

**Data Plane (Phase 2):**
- **"How does the proxy fleet work?"** → `Planning/08 - Data Plane - Architecture.md`
- **"What's the wire protocol?"** → also in `Planning/08`
- **"Why didn't we use gRPC / X?"** → `Planning/10 - Data Plane - Self-Critique & Reform.md`
- **"What are the risks?"** → `Planning/11 - Data Plane - Risk Register.md`
- **"What's the threat model?"** → `Security/03 - Data Plane Threat Model.md`
- **"What happened during the Phase 2 build?"** → `Dev Logs/2026-05-12 - Session 2 - Data Plane.md`
