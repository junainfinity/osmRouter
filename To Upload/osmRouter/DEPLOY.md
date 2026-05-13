# osmRouter — Production Deployment Guide

*Version 1.0 · Target: a fresh Linux server (Ubuntu 24.04 / Debian 12 / similar) with Docker.*

This document walks you from a freshly registered domain (`osmrouter.com`) to a running osmRouter business that lets paying customers attach their own domains and tunnel traffic to their machines.

> **Honesty note.** osmRouter v1.0 ships with three known gaps that are **not blockers** for a soft launch but **must be addressed** before scale: (a) the email-OTP sender is not wired; (b) the `tunnels` Postgres table is populated only when proxy nodes are restarted (so byte counters are 0 until you fix the proxy-ingest wire); (c) the DNS verifier can race a manually-marked domain back to "failed". Each is called out in this document where it matters.

---

## 0. Choose your hosting topology

osmRouter is four services. You can collapse them onto one box for a soft launch or split them at any time:

| Topology | When |
|---|---|
| **Single box (≤ 100 users)** — all four containers + Postgres + Redis on one VPS | First 90 days. ~4 GB RAM is plenty. |
| **API box + proxy fleet** — Control Plane + DB + Redis on one box; proxy nodes on N edge boxes | Once you have customers in more than one region. |
| **Managed DB + proxy fleet** — Postgres + Redis on a managed service (Neon / Upstash / RDS); the rest on small VMs | Once you don't want to babysit databases. |

This guide assumes the **single box** topology and tells you which line to change if you split it later.

---

## 1. Prerequisites

On your server:

```bash
# Minimal Linux setup
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git ufw caddy
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
```

In your DNS provider:

| Record | Name | Value |
|---|---|---|
| `A` | `osmrouter.com` | your server's public IPv4 |
| `A` | `www.osmrouter.com` | same |
| `A` | `app.osmrouter.com` | same |
| `A` | `api.osmrouter.com` | same |
| `A` | `nodes.osmrouter.com` | same (the proxy public listener) |
| `A` | `tunnel.osmrouter.com` | same (the proxy tunnel listener — WSS) |
| `A` | `*.osmrouter.com` *(optional)* | same — only if you want `<anything>.osmrouter.com` to also work as a free tunnel hostname for users without a custom domain |

> **Customers' DNS** — your *customers* will be told (by the dashboard) to add a `CNAME` for their domain pointing at `nodes.osmrouter.com`. That's the value of the `OSM_PROXY_CNAME` env var; if you change it, the dashboard's "Add domain" modal automatically shows the new target.

---

## 2. Drop the code on the server

```bash
# As your deploy user
git clone <your-fork-of-osmrouter> /opt/osmrouter
cd /opt/osmrouter
```

Or — if you're copying this folder directly — `scp -r ./osmRouter root@your-server:/opt/`.

---

## 3. Generate secrets and write `.env`

```bash
cd /opt/osmrouter
cp .env.example .env
./scripts/generate-secrets.sh >> .env
```

Then **edit `.env`** and fill in *every* value still marked `«CHANGE»`. The complete checklist:

| Variable | Set to |
|---|---|
| `OSM_BRAND_DOMAIN` | `osmrouter.com` (or your domain) |
| `OSM_PROXY_CNAME` | `nodes.osmrouter.com` |
| `OSM_CORS_ORIGINS` | `https://osmrouter.com,https://app.osmrouter.com,https://www.osmrouter.com` |
| `OSM_COOKIE_DOMAIN` | `.osmrouter.com` (leading dot intentional) |
| `OSM_COOKIE_SECURE` | `true` |
| `OSM_ENV` | `prod` |
| `OSM_JWT_SECRET` | already filled by `generate-secrets.sh` |
| `OSM_OTP_MASTER_SECRET` | same |
| `OSM_CSRF_SECRET` | same |
| `OSM_AES_MASTER_KEY` | same |
| `OSM_PROXY_NODE_SECRET` | same |
| `POSTGRES_PASSWORD` | same |
| `REDIS_PASSWORD` | same |
| `NEXT_PUBLIC_API_BASE` | `https://api.osmrouter.com` |
| `OSM_NODE_ID` | a unique identifier for this proxy node, e.g. `node-blr-01` |

Locking it down:

```bash
chmod 600 .env
```

---

## 4. Decide how customers get an email-OTP

osmRouter generates a 6-digit one-time code on signup but does **not** ship a built-in email sender. Pick one of three paths:

### Path A — Wire SMTP (recommended)

Edit `server/internal/auth/service.go` and replace the `// TODO: send email` line in `Register()` with a real SMTP send. The Go standard library `net/smtp` works; for production hygiene use a library like `gopkg.in/gomail.v2`. Then fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` in `.env`. Rebuild.

### Path B — Wire a transactional-email API

Add a small HTTP client around your provider (SendGrid, Postmark, Resend, Mailgun). Same insertion point in `service.go`. This is faster than SMTP if you don't want to manage your own outbound mail server.

### Path C — Trusted-internal mode (NOT for public launch)

If osmRouter is for internal users only and you trust everyone behind your auth proxy, set `OSM_DEV_EXPOSE_OTP=true` in `.env`. The OTP code is returned in the HTTP body of `/api/v1/auth/register`. The dashboard's verify screen auto-fills it via a URL param. **Do not use this on a public-facing instance** — it leaks OTPs.

---

## 5. (Recommended) Cloudflare-for-SaaS

When a customer adds their domain and points their CNAME at `nodes.osmrouter.com`, **someone needs to issue an SSL cert for `app.theirdomain.com`**. Cloudflare-for-SaaS does this automatically. Alternative paths:

- **Run Caddy as the TLS terminator.** Caddy can do on-demand ACME for any hostname that points at it. Simplest. Free. Limit: needs the hostname to be public-resolvable when the first request hits.
- **Buy a wildcard cert for `*.osmrouter.com`** if you only need to support free-tier customers without their own domains.
- **Cloudflare-for-SaaS** for full BYO-domain at scale (paid).

If you go with Cloudflare-for-SaaS: in `.env`, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` for your `osmrouter.com` zone. (The integration hook in the server is a stub in v1.0 — wire it from `server/internal/domains/service.go` when you're ready.)

If you go with Caddy (recommended for first 90 days): copy `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, edit the domains, run `sudo caddy reload`. Caddy will auto-fetch certs for every hostname that resolves to your box.

---

## 6. Bring up the stack

```bash
cd /opt/osmrouter
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

Watch logs for the first minute to make sure migrations ran and the four services are healthy:

```bash
docker compose -f deploy/docker-compose.yml logs -f --tail=80
```

You should see:

```
osm-postgres-1   ...  database system is ready to accept connections
osm-redis-1      ...  Ready to accept connections
osm-server-1     ...  http server listening  addr=:8080  env=prod
osm-proxy-1      ...  public listener up  addr=:8000
osm-proxy-1      ...  tunnel listener up  addr=:8001
osm-web-1        ...  Ready in ...
```

Verify the API is alive from outside:

```bash
curl -sf https://api.osmrouter.com/healthz | jq .
# { "env": "prod", "status": "ok" }
```

---

## 7. Make yourself the first admin

The first user you sign up is just a regular user. Promote them in the database:

```bash
docker exec -it osm-postgres psql -U osm -d osm \
  -c "UPDATE users SET role='admin' WHERE email='you@osmrouter.com';"
```

Now refresh the dashboard and you'll see the `Admin` badge in the sidebar and a `Switch to admin` button.

---

## 8. Customise the branding & marketing

The Next.js source is in `web/app/`. The most operator-visible strings:

| File | What to edit |
|---|---|
| `web/app/page.tsx` | Marketing-landing copy: tagline, feature blurbs, pricing card text, edge-region claims. The hero subhead "**v2.4 — Static IP edges & bring-your-own-domain**" is in there too. Change "v2.4" to your real version or remove. |
| `web/app/layout.tsx` | `<title>` and `<meta description>`. |
| `web/components/icons/index.tsx` → `Wordmark` | The wordmark uses a single-letter "o" tile. Swap for your real logo if/when you have one. |
| `web/app/globals.css` → `--accent` (in both `:root` and `:root[data-theme="dark"]`) | Brand accent color. Currently `oklch(62% 0.19 252)` (blue). |
| `web/app/(marketing)/...` | Pricing card features list. v1.0 ships with Free + Pro tiers; if you want different tiering, also edit `server/internal/platform/db/migrate.go::SeedPlans`. |

After editing, rebuild only the `web` container:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env build web
docker compose -f deploy/docker-compose.yml --env-file .env up -d web
```

---

## 9. Distribute the desktop tunnel-client

Customers download `osmrouter-client` and run it on their machine with their device API key. Build the binaries for the platforms you support:

```bash
./scripts/build-clients.sh
# → dist/clients/<version>/
#     osmrouter-client-darwin-arm64
#     osmrouter-client-darwin-amd64
#     osmrouter-client-linux-amd64
#     osmrouter-client-linux-arm64
#     osmrouter-client-windows-amd64.exe
#     SHA256SUMS
```

Upload to a download host you control (S3, your CDN, a GitHub release):

```bash
aws s3 sync dist/clients/v1.0.0/ s3://download.osmrouter.com/v1.0.0/ \
  --acl public-read \
  --cache-control 'public, max-age=86400'
```

Edit `web/app/page.tsx` and the onboarding wizard so the **"Download client"** button points to your URL. A simple `curl | sh` installer script is helpful — your future v1.1 should ship one.

Customers will use the binary like this (the dashboard tells them their own API key + device ID):

```bash
osmrouter-client \
  --proxy-url wss://tunnel.osmrouter.com/ws/tunnel \
  --api-key   <theirs> \
  --device-id <theirs> \
  --local     http://localhost:3000
```

---

## 10. Verify end-to-end

From a fresh laptop, do the full flow:

1. Open `https://osmrouter.com` — see your marketing page.
2. Click **Start free** → sign up with a fresh email.
3. Receive OTP (via SMTP if wired, or check the response body in dev-expose mode).
4. Verify, land on the dashboard.
5. Click **Domains → Add domain** → enter `<some domain you own>`.
6. Copy the CNAME + TXT records into your registrar's DNS UI.
7. Wait one minute → status flips to **Verified** in the dashboard (real-time via WebSocket).
8. **Devices → Add device** → save the API key shown once.
9. Download the `osmrouter-client` for your OS.
10. Run a local app (`python3 -m http.server 3000`).
11. Start the client: `osmrouter-client --proxy-url wss://tunnel.osmrouter.com/ws/tunnel --api-key ... --device-id ... --local http://localhost:3000`.
12. Back in the dashboard: **Subdomains → Bind → choose your device**.
13. From another laptop, visit `https://app.yourdomain.com` — Python's directory listing renders.

That's the full happy path. Take screenshots, write a "How it works" blog post, ship.

---

## 11. Backups

**Postgres** (most important — losing this loses your customer accounts):

```bash
# Cron: hourly logical dump to S3
docker exec osm-postgres-1 pg_dump -U osm osm | \
  gzip | \
  aws s3 cp - s3://backups.osmrouter.com/postgres/osm-$(date -u +%Y%m%dT%H%M%S).sql.gz
```

Or use your DB provider's built-in PITR (Neon / Supabase / RDS all have this).

**Redis** is a cache. The state can be reconstructed from Postgres by re-running every `subdomain.bound` operation. If you don't want that, set `REDIS_PASSWORD` and `appendonly yes` (already in `docker-compose.yml`) so AOF is on; back up `/var/lib/docker/volumes/osmrouter_redis-data/` periodically.

**Application logs** — `docker compose logs` is stdout JSON; pipe into Loki / Datadog / CloudWatch.

---

## 12. Monitoring

A 5-line Prometheus-friendly check is built in at `https://api.osmrouter.com/api/v1/health`:

```json
{ "db": true, "redis": true, "mode": "ok" }
```

If `mode == "readonly"` the dashboard will show a banner and disable writes. Alert on:

- `db: false` for > 30 s
- `redis: false` for > 60 s (proxy nodes can serve cached state briefly)
- Any 5xx rate > 2 % on `/api/v1/*` (paths are tagged in the JSON logs as `path`)

---

## 13. Updating

```bash
cd /opt/osmrouter
git pull                # or scp the new tarball
docker compose -f deploy/docker-compose.yml --env-file .env build
docker compose -f deploy/docker-compose.yml --env-file .env up -d
```

Containers are restarted gracefully (HTTP server drains in-flight requests; tunnel client reconnects automatically).

---

## 14. Known limitations in v1.0

These are documented in the Yellow Paper and the project's Planning notes. Be aware:

1. **`tunnels` Postgres table not populated.** The proxy node registers tunnels in its in-memory hub but never calls `ingest.TunnelStarted` to record a row. Result: the dashboard's *Active tunnels* counter is permanently 0 and *Bytes routed* never increments. Fix is a 4-line edit in `proxy-node/cmd/proxy/main.go` (see `Screenshots/00 - Screenshot Analysis.md` in the dev repo, finding B1).
2. **Device "online" status decays after 90 seconds.** A device sends only one heartbeat on first connect; after 90 s the offline-sweeper marks it offline even though its tunnel is live. Mitigation: add a 30-s periodic heartbeat in `tunnel-client/internal/client/client.go` *or* infer online-ness from the presence of a registered tunnel.
3. **DNS verifier can race a manually-set "verified" back to "failed".** If you do `UPDATE domains SET dns_status='verified' WHERE …` from psql, the worker may overwrite. Either let the verifier do its job (recommended) or add a `verified_manual` column.
4. **No streaming response bodies through the tunnel.** Request and response are buffered up to 4 MB. Large file downloads through customer tunnels will fail with `RESPONSE_TOO_LARGE`. Plan v1.1.
5. **Single shared `OSM_PROXY_NODE_SECRET`** across all proxy nodes. If one is compromised, the secret leaks. Plan v1.1: per-node mTLS or per-node API key.

None of these prevent a soft launch. All of them should be on your v1.1 ticket list.

---

## 15. Troubleshooting

**`docker compose up` fails with "POSTGRES_PASSWORD: variable is not set"**
→ `.env` is not being loaded. Pass `--env-file .env` explicitly, or move `.env` to the same directory as the compose file.

**Dashboard renders but stays on a spinner after login**
→ Browser dev tools → console. If you see `Content Security Policy ... script-src 'self'` violations, the dashboard's CSP is too strict; `web/next.config.ts` should have `'unsafe-inline'` in `script-src` (already does in v1.0, but worth checking).

**Customer's tunnel keeps disconnecting after 60 s**
→ Reverse proxy in front of `tunnel.osmrouter.com` is timing out the WebSocket. Set `proxy_read_timeout 7d` (nginx) or `keepalive 5m` (Caddy). See `deploy/*.example`.

**Customer's domain stuck at "pending"**
→ Verifier failure. Test from the server box: `dig _osm.<customer-fqdn> TXT` and `dig <customer-fqdn> CNAME`. If both return correctly, look at `docker logs osm-server | grep verifier`. If one returns the wrong value, that's a customer DNS issue.

**Visitor request returns 503 "Reconnecting…" but the client is running**
→ The proxy can't see the tunnel in its hub. Either (a) the WS reverse proxy is rewriting Origin / Host headers, or (b) the proxy node restarted recently. The client's exponential backoff will reconnect within 30 s.

**Visitor request returns 502 "no route"**
→ The hostname has no entry in Redis. Check that the customer actually clicked **Bind** in the dashboard. From the box: `docker exec osm-redis redis-cli -a $REDIS_PASSWORD GET live:<their-host>`.

---

## 16. Going further

- **Multi-region.** Spin up additional proxy nodes in other regions. Each needs its own `.env` with the SAME `OSM_PROXY_NODE_SECRET` (it's shared in v1.0), a unique `OSM_NODE_ID`, and points to the same `OSM_CONTROL_PLANE_URL`. Customers' domains route to whichever node is geographically closer (you'll need Anycast or GeoDNS for that — out of scope for v1).
- **Postgres read replicas.** The dashboard's read endpoints (`/me`, `/domains`, `/devices`, etc.) can hit a replica. Add a second DB URL and split queries in `server/internal/platform/db/db.go`.
- **WebAuthn for admin MFA.** v1.0 has the columns (`mfa_enabled`, `totp_secret`); the endpoints aren't built. Wire from `server/internal/auth/`.
- **Billing.** Add a Stripe webhook handler at `/api/v1/billing/webhook`. The `plans` table is already seeded; you just need to map Stripe price IDs to plan rows.

---

*The companion technical specification is in the [Yellow Paper](../Yellow%20Paper/osmRouter-Yellow-Paper.html) (if you copied it). The narrative pitch is in the [Whitepaper](../Whitepaper/osmRouter-Whitepaper.html). Both are useful on your marketing site.*
