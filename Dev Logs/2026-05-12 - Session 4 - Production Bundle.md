# 2026-05-12 — Session 4 — Production Bundle

> Goal: take everything that's been built across Sessions 1–3 and package it as a self-contained, demo-free deployment bundle that ships to a server and turns into a live business under the operator's own domain.

## Context (what existed at the start of this session)

- Session 1 shipped the Control Plane (server + dashboard) — see `Dev Logs/2026-05-12 - Session 1.md`
- Session 2 shipped the Data Plane (proxy-node + tunnel-client) — see `Dev Logs/2026-05-12 - Session 2 - Data Plane.md`
- Session 3 ran the live cross-boundary demo, took 22 screenshots, found three honest v1.0 bugs, and shipped the Whitepaper + Yellow Paper — see `Dev Logs/2026-05-12 - Session 3 - Live Demo & Papers.md`

The repo at this point had a lot of stuff in it — planning vault, JSX design prototype, screenshots, demo scripts, the to-do app, papers. Plenty of it is invaluable for the team building osmRouter but **none of it should land on a production server**.

## Goals for this session

1. ✅ Audit the codebase for hardcoded sample / demo strings
2. ✅ Create `To Upload/osmRouter/` containing only what an operator needs to deploy
3. ✅ Production `.env.example` covering every env var with `«CHANGE»` markers
4. ✅ Production `docker-compose.yml` with **no demo defaults** — refuses to start unless every required value is set
5. ✅ Production Dockerfiles for server, web, proxy
6. ✅ Reverse-proxy examples (Caddy + nginx) for TLS termination
7. ✅ Helper scripts: `generate-secrets.sh`, `build-clients.sh`
8. ✅ `DEPLOY.md` — detailed step-by-step (16 sections)
9. ✅ `DEPLOY.html` — same, rendered with osmRouter design system
10. ✅ `README.md` — TL;DR + the 4 commands to launch
11. ✅ Verify all three Go modules build clean from the bundle's copy
12. ✅ Stop the live demo and remove `.demo-state/`
13. ✅ Update vault index + HANDOFF with the bundle reference

## Log

### 11:21 — Audit

```bash
grep -rEn "(sasha|hunter22demo|demo@|localtest\.me|M4-Max|osmrouter\.local|osmrouter\.test)" \
    server/internal/ server/cmd/ web/app/ web/components/ web/lib/ proxy-node/ tunnel-client/
```

Five hits, all of them benign:

- `server/internal/proxyingest/handlers.go:167` — a doc comment giving `acme.com` as an example FQDN
- `server/internal/config/config.go:60` — dev fallback `proxy.osmrouter.local` for the CNAME target (only used when env var is unset *and* env is dev)
- `web/app/page.tsx:58–65` — marketing-page CLI mock-up using `api.acme.co` (intentional placeholder)

Verdict: production code is clean. Demo strings live in `scripts/demo_live.sh`, `mac-app/`, `Screenshots/` — none of which ship in the bundle.

### 11:22 — Build `To Upload/osmRouter/`

Copied the four source folders with `rsync` excluding `node_modules`, `.next`, `bin`, build caches. Then created `deploy/` and `scripts/` subfolders.

### 11:23 — `.env.example`

A single 90-line file covering **every** env var the system reads. Organised by category:

1. Domain & deployment surface
2. Cryptographic secrets (5 of them — one HMAC per concern + AES master key + proxy-node Bearer)
3. PostgreSQL
4. Redis
5. Rate limits
6. Email (OTP delivery) — REQUIRED for public launch, three paths called out (SMTP, transactional API, dev-expose mode for trusted internal use)
7. Cloudflare-for-SaaS (optional)
8. Stripe (optional)
9. Observability (optional)
10. Per-proxy-node settings
11. NEXT_PUBLIC_API_BASE for the dashboard build

Every value that must be changed is marked `«CHANGE»`.

### 11:24 — Production `docker-compose.yml`

Critical differences from the dev compose:

- **No `${X:-default}` fallbacks for secrets.** Every required env var uses `${X:?required}` syntax — compose refuses to start if any are missing.
- **Postgres + Redis bound to docker network only.** No host ports. Only the API (`:8080`), web (`:3000`), and proxy (`:8000`, `:8001`) are exposed — and the first two only on `127.0.0.1` so the TLS terminator can reach them.
- **Volume mounts.** `postgres-data` and `redis-data` named volumes for persistence.
- **Restart policies.** `restart: always` on everything.
- **Health checks.** Postgres `pg_isready`, Redis `PING`.
- **CGO_ENABLED=1 server build.** Needed for go-sqlite3; alpine gcc/musl-dev added at build time.

### 11:24 — Reverse-proxy examples

Two options, both work, pick one:

- **`deploy/Caddyfile.example`** — recommended for first 90 days. Caddy auto-fetches Let's Encrypt certificates for every hostname that resolves to the box, including the wildcard `*.osmrouter.com` once you configure Cloudflare DNS challenge.
- **`deploy/nginx.conf.example`** — for operators who already have nginx and certbot wired up.

Both include the WebSocket-specific timeouts for `tunnel.osmrouter.com` (`proxy_read_timeout 7d` / `keepalive 5m`) without which long-lived tunnel connections would die every 60 seconds.

### 11:25 — Helper scripts

- **`scripts/generate-secrets.sh`** — runs `openssl rand -hex 32` for each of the 5 crypto secrets + `openssl rand -base64 24 | …` for the DB and Redis passwords. Output is `.env`-format ready to append.
- **`scripts/build-clients.sh`** — cross-compiles the tunnel-client for `darwin/{arm64,amd64}`, `linux/{amd64,arm64}`, `windows/amd64`. Produces SHA256SUMS. The operator uploads the binaries to their CDN.

### 11:25 — `DEPLOY.md` (16 sections, ~16 KB)

Structure:

0. Choose your hosting topology (single box → multi-region)
1. Prerequisites (Docker, ufw, caddy) + DNS records the operator must add
2. Drop the code on the server
3. Generate secrets + write `.env` (full checklist table)
4. **Decide how customers get an email-OTP** — explicit honest call-out that no built-in sender ships
5. Cloudflare-for-SaaS choice (or Caddy on-demand-ACME, or wildcard cert)
6. Bring up the stack (the actual `docker compose up`)
7. Promote yourself to admin via direct SQL
8. Customise branding & marketing copy — file-by-file
9. Distribute the desktop tunnel-client
10. Verify end-to-end (full happy path)
11. Backups (pg_dump + Redis AOF)
12. Monitoring (`/api/v1/health` endpoint shape)
13. Updating
14. **Known limitations in v1.0** — the three honest bugs surfaced during Session 3:
    - B1: `tunnels` table never populated (proxy doesn't call `ingest.TunnelStarted`)
    - B2: Device offline status after 90s of no heartbeat
    - B3: DNS verifier can race manually-set "verified" back to "failed"
15. Troubleshooting (5 common failures with diagnostics)
16. Going further (multi-region, read replicas, WebAuthn, Stripe)

### 11:25 — `DEPLOY.html`

Rendered via the same `marked` + osmRouter-design-system template used for the Whitepaper. Blue accent (vs amber for Yellow Paper). Self-contained — no external CSS.

### 11:25 — Verify the bundle builds

```bash
cd To\ Upload/osmRouter/server      && go build ./... && echo SERVER OK
cd ../proxy-node                    && go build ./... && echo PROXY OK
cd ../tunnel-client                 && go build ./... && echo CLIENT OK
```

All three green. No orphan imports, no broken refs.

### 11:25 — Strip the last dev artifacts

After the initial rsync, two things still belonged only in the dev repo:

- `server/cmd/dev-redis/` — in-process miniredis listener used by the localhost smoke test. Replaced in prod by the real Redis container. Removed; `go mod tidy` confirmed no orphan deps.
- `tunnel-client/Dockerfile` + `tunnel-client/docker/` — the cross-boundary demo container. The tunnel-client runs on customer Macs/PCs, not in a container; these are demo-only. Removed.

Final bundle: **137 files, 936 KB**.

### 11:26 — Stop the live demo

```bash
./scripts/demo_stop.sh    # tunnel-client + to-do app + docker compose down -v
rm -rf .demo-state         # PIDs, cookies, the built binary
```

The demo is reproducible — anyone can re-run `./scripts/demo_live.sh` from a clean checkout in under 90 seconds.

### 11:27 — Vault + HANDOFF updates

- `00 - Vault Index.md` — added Production-bundle section under Papers
- `HANDOFF.md` — added a top section pointing at `To Upload/` with the 4-command launch and the must-change checklist

### 11:28 — Screenshot the rendered DEPLOY.html

Saved as `Screenshots/23-deploy-guide-html.png`. Confirms the styled rendering works: typography, table styling, code blocks, dark-theme palette all match the dashboard's design tokens.

## Final tally — Session 4

| Artifact | Size |
|---|---|
| `To Upload/osmRouter/` total | 137 files / 936 KB |
| `.env.example` | 5.3 KB — 11 categories, every var documented |
| `DEPLOY.md` | 16.6 KB — 16 sections |
| `DEPLOY.html` | 27.4 KB self-contained |
| `README.md` | 4.3 KB — quick start |
| `docker-compose.yml` | production, `${X:?required}` everywhere |
| `Caddyfile.example` | covers dashboard + API + proxy + tunnel (WS) hostnames |
| `nginx.conf.example` | same coverage |
| Helper scripts | 2 (`generate-secrets.sh`, `build-clients.sh`) |
| Honest v1.0 limitations called out in DEPLOY §14 | 5 |

## What the operator gets

`To Upload/osmRouter/` is what you scp to your server. 936 KB. Drop it, run four commands, point your DNS at the box, you have osmRouter running on `osmrouter.com`. Read DEPLOY.md / DEPLOY.html for the full walkthrough.

## What's intentionally NOT in the bundle

| What | Why |
|---|---|
| `Planning/` Obsidian notes | dev artifacts, valuable to the team but irrelevant to the operator |
| `Security/`, `Testing/` | same |
| `Dev Logs/` | this file lives here, not in prod |
| `Design/` JSX prototype | replaced by the live Next.js port |
| `Screenshots/` | UI review for the team |
| `Whitepaper/`, `Yellow Paper/` | useful on the operator's marketing site — the operator can copy these themselves if they want them on `osmrouter.com/about` |
| `mac-app/` | demo to-do app, not part of the product |
| `scripts/demo_live.sh`, `smoke_data_plane.sh`, `docker_remote_laptop_demo.sh` | demo scripts |
| `server/cmd/dev-redis/` | dev-only in-process miniredis |
| `tunnel-client/Dockerfile` + `docker/` | demo container; tunnel-client ships as a native binary |
| `HANDOFF.md` | a guide for the *next dev* on this codebase, not the operator |

The bundle is for an operator who has a domain, a server, and a credit card. The dev vault is for the team building v1.1.
