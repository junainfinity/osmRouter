# Launching osmRouter on your own infrastructure

> The single source of truth for what osmRouter is, why it's built the way it is, and what you need to know to run your own deployment. Read this before `DEPLOY.md` (which is the operator runbook) or `mac-app/COMPILE.md` (which is the Mac-app build walkthrough).

---

## 1. What osmRouter is

osmRouter is a **sovereign reverse-tunnel SaaS**: it binds a public hostname (a domain you own) to a process running on hardware you control (your Mac, your home server, your colo box), through a persistent reverse tunnel that survives reboots, IP changes, and CGNAT.

The product is shaped like Cloudflare Tunnel or ngrok — but the data path is fundamentally different: **no third party sits in the middle and decrypts your traffic**. The operator (whoever runs the cloud-side stack — you, if you're self-hosting) cannot read request bodies, replay them, or rate-limit them per-app. See §4 for why.

The system is built around two roles:

- **Operator** — runs the cloud-side stack: control plane, dashboard, proxy edge, Caddy TLS terminator. The operator issues API keys to end users.
- **End user** — owns a domain, runs the Mac app, exposes local services through their domain.

If you're reading this to **become an operator**, you'll deploy the cloud-side stack from this repo. End users download the Mac app you compile.

---

## 2. Architecture in 60 seconds

```
   ┌─────────────────────────┐
   │  visitor's browser      │
   │  (TLS 1.3)              │
   └────────────┬────────────┘
                │   https://customer-domain.com/...
                ▼
   ┌─────────────────────────────────────────────────┐
   │  Caddy edge (operator-run)                      │
   │  • mints Let's Encrypt cert on-demand           │
   │  • asks control plane: "is this host known?"    │
   └────────────┬────────────────────────────────────┘
                │   plain HTTP — internal-only loopback
                ▼
   ┌─────────────────────────────────────────────────┐
   │  osm-proxy (operator-run)                       │
   │  • httputil.ReverseProxy, FlushInterval = -1    │
   │  • per-host transport pool                      │
   │  • role-INVERTED HTTP/2 client into the tunnel  │
   └────────────┬────────────────────────────────────┘
                │   TLS 1.3 pinned to operator CA
                ▼
   ┌─────────────────────────────────────────────────┐
   │  osm-agent on the end user's Mac                │
   │  • TLS server using operator-issued leaf cert   │
   │  • inner HTTP/2 — sidecar is the SERVER         │
   │  • forwards request to a local listener         │
   └────────────┬────────────────────────────────────┘
                │   plain HTTP
                ▼
   ┌─────────────────────────┐
   │  the end user's process │
   │  (any OpenAI-API server,│
   │   web app, dev server)  │
   └─────────────────────────┘
```

The two unusual properties:

1. **Pinned TLS.** The trust anchor for the proxy↔Mac tunnel is the *operator's* root CA, embedded into both the proxy binary (at Docker-image build time) and the Mac sidecar binary (at app-compile time via `//go:embed`). System trust stores are ignored on this hop. There's no "did the user install the CA correctly?" question — the trust anchor travels with the binaries.
2. **Role inversion.** The Mac dials the proxy outbound (firewall-friendly). After the TLS handshake, the Mac is the HTTP/2 *server*; the proxy is the *client*. The proxy forwards visitor requests into the tunnel and the Mac responds. This is why your laptop can "be" the public origin without ever opening a port.

For the formal wire-protocol spec, see `Yellow Paper/osmRouter-Yellow-Paper.md`. For the business framing, see `Whitepaper/osmRouter-Whitepaper.md`.

---

## 3. Repository layout

```
osmRouter/
├── README.md              ← polished intro, screenshots, links
├── LAUNCH.md              ← this file: concepts + how it's built
├── DEPLOY.md              ← operator runbook: cloud-side deploy
├── mac-app/COMPILE.md     ← end-user runbook: build the Mac app
├── .env.example           ← every operator env var, with placeholders
├── .gitignore
│
├── server/                ← Go control plane (Echo + GORM + Redis + WebSockets)
│   ├── cmd/api/           ← main entry point
│   └── internal/          ← auth, domains, devices, billing, audit, mail, ...
│
├── web/                   ← Next.js 16 dashboard (App Router, Tailwind v4)
│   ├── app/               ← routes: /login, /signup, /dashboard, /domains, /devices, ...
│   ├── components/        ← UI primitives + DNS guide modal
│   └── lib/               ← API client, types, query helpers
│
├── docs/                  ← Fumadocs site that ships at docs.<your-domain>
│   ├── app/               ← Next.js layout + page renderer
│   └── content/docs/      ← every doc page as MDX
│
├── proxy-node/            ← Go data plane (proxy edge that runs the tunnel)
│   ├── cmd/proxy/         ← main
│   └── internal/          ← ca/, registry/, tunnels/, forward/, ingest/
│
├── mac-app/               ← Mac client source (electron-forge monorepo)
│   ├── apps/desktop/      ← SwiftUI/Electron panel
│   ├── apps/sidecar/      ← Go osm-agent binary
│   ├── COMPILE.md         ← step-by-step compile walkthrough
│   └── scripts/           ← compile-mac.sh (CA-gate + cross-compile + .dmg)
│
├── deploy/                ← container build + orchestration
│   ├── Dockerfile.server  ← Go control plane image
│   ├── Dockerfile.web     ← Next.js dashboard image
│   ├── Dockerfile.docs    ← Fumadocs docs site image
│   ├── Dockerfile.proxy   ← Go data plane image
│   ├── docker-compose.yml ← full stack: postgres + redis + server + web + docs + proxy
│   └── Caddyfile.example  ← TLS terminator + on-demand cert minting
│
├── scripts/               ← operator tools
│   ├── init-ca.sh         ← mint operator root CA + proxy leaf cert
│   └── generate-secrets.sh← generate every crypto secret in .env
│
├── Whitepaper/            ← business paper (Markdown + standalone HTML)
└── Yellow Paper/          ← formal technical specification (Markdown + HTML w/ MathJax)
```

Anything *not* in this list isn't in the repo. The internal session notes, the planning documents, the screenshots used during development, the v1 archive — all gone. If you find something here that looks vestigial, it's a bug; file an issue.

---

## 4. Components, one paragraph each

**Control plane (`server/`)** — A Go HTTP API on `:8080`. Talks to Postgres (state) and Redis (rate-limits, WebSocket fan-out). Speaks REST to the dashboard and the Mac app. Issues short-lived JWTs (15-min access, 30-day refresh with rotation chain), Argon2id-hashed passwords, 6-digit OTPs for email verification. The mailer is `net/smtp` STARTTLS — point it at Gmail/Postmark/SES.

**Web dashboard (`web/`)** — A Next.js 16 App Router site on `:3000`. Talks to the control plane over HTTPS+WS. UIs for sign-in/up, domains, devices, settings, billing, admin. Strict CSP except for the marketing landing at `/` (which is a static HTML file loading React+Babel from unpkg — runtime JSX, will be pre-compiled in v2.1).

**Docs site (`docs/`)** — A Fumadocs site on `:3001` covering everything an end user needs. Served at `docs.<your-brand-domain>`. The content is MDX. The sidebar is auto-derived from the file tree.

**Data plane / proxy edge (`proxy-node/`)** — A Go binary that opens two listeners: `:8000` for visitor HTTP (TLS-terminated by Caddy in front), `:8443` for sidecar tunnel inbound (terminates TLS itself with the operator leaf cert). On each tunnel acceptance: reads the register frame (line of JSON), calls the control plane to verify the device+host pair, then puts the connection into a per-host map. Visitor requests look up the right transport in that map and stream through with `httputil.ReverseProxy` + `FlushInterval = -1`. Long-running inference (>30s) survives — no wall-clock timeout, only visitor cancellation.

**Mac app (`mac-app/`)** — An electron-forge monorepo. `apps/desktop/` is the SwiftUI/Electron UI panel. `apps/sidecar/` is the Go `osm-agent` daemon. The operator CA root.pem is dropped into `apps/sidecar/internal/embedded_ca/root.pem` BEFORE compiling — three layers (build script grep, Go `Validate()`, unit test) fail-closed on a placeholder cert, so a Mac app that forgot to bake in the CA can't ship.

**Caddy** — Terminates public TLS. For your own brand domains, configure them in the Caddyfile (block per host). For customer bring-your-own-domains, the `:443` catch-all with `on_demand_tls` + the `ask` hook into your control plane's `/api/v1/internal/caddy-allow` endpoint auto-mints a Let's Encrypt cert.

---

## 5. The operator CA — what it is, how to mint it, why it matters

The operator CA is the **trust anchor between your proxy and the Mac sidecars connecting to it**. If someone steals your proxy leaf key, they can impersonate your proxy. If your Mac sidecars trusted the public web PKI, anyone with a valid `*.your-tunnel.com` cert could MITM the tunnel. So sidecars trust *only* your operator CA, embedded at compile time.

You mint it once per operator install:

```bash
SAN_LIST="DNS:tunnel.<your-domain>.com" ./scripts/init-ca.sh
```

Output goes to `ca/` (gitignored):

| File | What it is | Where it lives |
|---|---|---|
| `root.key` | 10-year root key | **Stays on your box**, restricted perms |
| `root.pem` | 10-year root cert | Embedded into both the proxy image *and* the Mac sidecar binary |
| `proxy-leaf.key` | 90-day proxy leaf key | Mounted into the proxy container at `/etc/osm/ca/` |
| `proxy-leaf.pem` | 90-day proxy leaf cert | Same |

Leaves rotate every 90 days. There's a `scripts/rotate-leaf.sh` you'll want on a cron (`0 0 * * 0`). Root rotation is a planned ceremony — it's a binary-rebuild for every Mac client, so don't do it casually.

---

## 6. Bringing the cloud side up — the four-command launch

Full walkthrough in `DEPLOY.md`. The headline path:

```bash
# 1. Drop the code on a server (Linux + Docker; Hetzner CX42 is plenty)
scp -r ./osmRouter root@your-box:/opt/

# 2. Mint the CA + fill .env + generate secrets
ssh root@your-box "cd /opt/osmRouter && \
    SAN_LIST=DNS:tunnel.your-domain.com ./scripts/init-ca.sh && \
    cp .env.example .env && \
    ./scripts/generate-secrets.sh >> .env && \
    nano .env"   # fill every «CHANGE» token + SMTP + NEXT_PUBLIC_OSM_EDGE_IP

# 3. Bring up the Docker stack
ssh root@your-box "cd /opt/osmRouter && \
    docker compose -f deploy/docker-compose.yml --env-file .env up -d --build"

# 4. Front it with TLS
ssh root@your-box "cp /opt/osmRouter/deploy/Caddyfile.example /etc/caddy/Caddyfile && \
    # ... edit the domain in Caddyfile to your brand domain
    systemctl reload caddy"
```

After that you'll have the dashboard at `https://your-domain.com`, the API at `https://api.your-domain.com`, and the docs at `https://docs.your-domain.com`. The tunnel listener for Mac sidecars is on `:8443` directly (the proxy terminates its own TLS — don't put Caddy in front of `:8443`).

DNS records you need at your registrar:

| Type | Name | Value |
|---|---|---|
| `A` | `@` (apex), `www`, `app`, `api`, `nodes`, `tunnel`, `docs` | your server's IPv4 |
| `A` | `*` (wildcard, optional) | same IPv4 — only if you want all subdomains to land on this box |

---

## 7. Building the Mac app — the operator-issued .dmg

End users don't run `osm-agent` directly; they install your branded Mac app. You build it from `mac-app/`:

```bash
# After ./scripts/init-ca.sh has produced ca/root.pem:
cp ca/root.pem mac-app/apps/sidecar/internal/embedded_ca/root.pem

# One-shot build (CA gate → tests → cross-compile → selftest → signed .dmg):
cd mac-app && ./scripts/compile-mac.sh
```

Full walkthrough in `mac-app/COMPILE.md`. Signing/notarization is wired through `@electron/notarize`; you'll need an Apple Developer ID for production distribution.

---

## 8. Security posture in five bullets

1. **Argon2id passwords**, parameters tuned for 64 MB / 3 iterations / 4 parallelism / 32-byte key. The cost is on every login, not every request — fine on a CX42.
2. **JWT access tokens** are 15-min HS256 with the secret loaded from env (≥256 bits). Refresh tokens are 30-day rotation chains — re-use triggers chain revocation.
3. **CSRF**: double-submit token via cookie + `X-CSRF-Token` header on every state-changing route. Bearer-authenticated machine clients skip CSRF.
4. **Audit log** is INSERT-only at the DB role level. Every destructive action (delete, bind, unbind, impersonate, role change) writes a row signed with the actor + admin (if impersonating).
5. **At-rest encryption**: registrar API keys + Stripe customer IDs use AES-256-GCM with per-row nonce; master key from env. OTP codes and refresh tokens are stored as SHA-256 hashes, never plaintext.

For the full threat model, see the comments in `server/internal/auth/` and the rate-limit/CSRF middlewares in `server/internal/server/`. For the data-plane threat model, see `Yellow Paper/osmRouter-Yellow-Paper.md`.

---

## 9. Streaming, long inference, and other gotchas

- **`FlushInterval = -1` on the proxy's `ReverseProxy`** — every SSE chunk hits the visitor in real time. The default would buffer for 200 ms, which breaks word-by-word LLM streaming.
- **`ResponseHeaderTimeout = 30 s` on the sidecar** — first byte must arrive within 30 s. Long-running inference is fine *after* the first byte; only cold-start matters here. Bump if your upstream is slow.
- **No wall-clock timeout on the visitor end** — only visitor cancellation kills the request. A `curl -N` from a phone over LTE that runs for 4 minutes works fine.
- **Non-streaming requests to streaming-only upstreams** — osmBroker is streaming-only (the underlying CLI bridges are streaming). A client that asks for `stream: false` will hang until the timeout. The docs site (`docs/content/docs/troubleshooting/upstream-errors.mdx`) covers this.

---

## 10. What's open / what's deferred to v2.1

Honest list, carried over from the planning notes:

1. **Cloudflare-for-SaaS** — automating customer-domain onboarding so they don't need to add their own `A` records. The control plane has the integration spot (`server/internal/cloudflare/`) but it's stubbed.
2. **Stripe billing** — schema + handlers exist, webhook is stubbed. Wire `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` + an actual webhook handler when you're ready to monetize.
3. **WebAuthn admin MFA** — admin login still uses email OTP. WebAuthn is on the v2.1 backlog.
4. **Per-node proxy mTLS** — proxy nodes share one leaf cert. Per-node leaves give you defense in depth; not blocking for v1.
5. **CA auto-rotation** — leaf rotation is a manual script call today; v2.1 has it on a cron with rolling proxy restart.
6. **WebSocket push for binding changes** — if a user rebinds a domain from the web dashboard, the Mac app's sidecar manager doesn't auto-reconcile yet. Workaround: restart the Mac app.
7. **Pre-compile the marketing landing** — `web/public/landing.html` uses React+Babel from CDN, requires `'unsafe-eval'` in the landing CSP. Pre-compiling the JSX lets us drop both.

---

## 11. Where to read more

- `Yellow Paper/osmRouter-Yellow-Paper.md` — formal wire-protocol spec, every frame and state transition.
- `Whitepaper/osmRouter-Whitepaper.md` — business framing, why this exists.
- `DEPLOY.md` — operator runbook with the full deploy sequence including SMTP, CA rotation, backups, troubleshooting.
- `mac-app/COMPILE.md` — Mac-app build walkthrough including signing + notarization.

---

## 12. Thanks

osmRouter was forged by the [osmAPI.com](https://osmapi.com) team. The architectural conviction — that compute should be sovereign, that the data path should never depend on a third party, that the operator should not be a landlord — comes from years of building infrastructure for autonomous agents under the same brand.

If this project is useful to you, build something with it that you couldn't have built on a cloud landlord.
