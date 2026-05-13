# osmRouter — Production Bundle

This folder is everything you need to deploy osmRouter on your own infrastructure and start running it as a business under your own domain.

## What's in here

```
osmRouter/
├── README.md                        ← this file (quick start)
├── DEPLOY.md                        ← detailed step-by-step deployment
├── DEPLOY.html                      ← same, but in your browser
├── .env.example                     ← every env var, commented
├── server/                          ← Control Plane (Go API)
├── web/                             ← Dashboard (Next.js 16)
├── proxy-node/                      ← Reverse-proxy fleet node (Go)
├── tunnel-client/                   ← Desktop client your customers download
├── deploy/
│   ├── docker-compose.yml           ← production compose — no defaults
│   ├── Dockerfile.server
│   ├── Dockerfile.web
│   ├── Dockerfile.proxy
│   ├── Caddyfile.example            ← TLS-terminating reverse proxy
│   └── nginx.conf.example
└── scripts/
    ├── generate-secrets.sh          ← run this first
    └── build-clients.sh             ← cross-compile customer downloads
```

## TL;DR — the four commands to start running

```bash
# 1. Land the code on your server
scp -r ./osmRouter root@your-server:/opt/
ssh root@your-server
cd /opt/osmRouter

# 2. Generate secrets
cp .env.example .env
./scripts/generate-secrets.sh >> .env
$EDITOR .env                       # fill in every «CHANGE»

# 3. Bring up the stack
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build

# 4. Front it with TLS
cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo caddy reload
```

Then point `osmrouter.com` (and `api.`, `app.`, `nodes.`, `tunnel.`) at your server's public IP in your DNS provider.

## What you have to change before launch

These are the **must-edit** items. The complete walk-through is in `DEPLOY.md`.

| What | Where |
|---|---|
| Your domain name (replace `osmrouter.com` everywhere) | `.env`: `OSM_BRAND_DOMAIN`, `OSM_PROXY_CNAME`, `OSM_CORS_ORIGINS`, `OSM_COOKIE_DOMAIN`, `NEXT_PUBLIC_API_BASE` |
| All five cryptographic secrets | `.env` — run `./scripts/generate-secrets.sh` |
| Postgres + Redis passwords | `.env` — same script |
| Email sender (SMTP or transactional-mail API) | `server/internal/auth/service.go` + four `SMTP_*` env vars |
| Marketing copy + brand wordmark | `web/app/page.tsx`, `web/app/layout.tsx`, `web/components/icons/index.tsx`, `web/app/globals.css` (`--accent` color) |
| Customer download URL | `web/app/page.tsx` and the onboarding wizard — point at where you publish the `osmrouter-client` binaries |
| Reverse-proxy domain config | `deploy/Caddyfile.example` (or `nginx.conf.example`) — change every `osmrouter.com` to yours |

## What you cannot skip

- **Generate fresh secrets.** Don't deploy with the `.env.example` placeholders. The server refuses to start with the dev fallbacks when `OSM_ENV=prod`.
- **Set `OSM_COOKIE_SECURE=true`** and serve everything over HTTPS. The auth cookies will not be sent over plain HTTP.
- **Bind Postgres + Redis to the docker network only.** The compose file in here already does this (no host port for either).
- **Wire email sending** before you take public signups. Otherwise nobody can complete the OTP step.

## Known limitations in v1.0

Documented in `DEPLOY.md` §14:

1. The `tunnels` Postgres table is never populated by the proxy node, so the dashboard's `Active tunnels` and `Bytes routed` are stuck at 0. (Four-line fix in `proxy-node/cmd/proxy/main.go`.)
2. Devices report `offline` after 90 s of inactivity even when actively serving traffic. Workaround: add a periodic heartbeat in the tunnel-client.
3. DNS verifier can race a manually-set `verified` back to `failed`. Either let the verifier do its job, or add a `verified_manual` column.
4. No streaming response bodies — request/response is buffered at 4 MB.
5. Single shared proxy-node Bearer secret across the whole fleet.

None are blockers for a soft launch. All belong on your v1.1 list.

## Next step

Open `DEPLOY.html` in your browser for a styled, step-by-step walkthrough.
Or `DEPLOY.md` if you prefer plain text.
