# osmRouter V2 — Deployment Guide

> The full walkthrough from a freshly registered `osmrouter.com` to a live AI-tunneling SaaS.
> Companion docs: `README.md` (quick start) and the [To Compile V2](../../To%20Compile%20V2) folder for the Mac client side.

## 0. Topology choices

| Topology | When |
|---|---|
| **Single box** (this guide's default) | Up to ~500 active tunnels and ~1 Gbps total. Hetzner CX42 or similar. |
| **API box + 1+ proxy fleet nodes** | More than one region, or proxy fleet > 1 Gbps |
| **Managed DB + proxy fleet** | When you don't want to babysit Postgres + Redis |

## 1. Prerequisites

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git ufw caddy openssl
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
```

DNS records at your registrar (replace IPs):

| Record | Name | Value |
|---|---|---|
| A | `osmrouter.com`, `www`, `app`, `api`, `nodes`, `tunnel` | your server IPv4 |
| A | `*.osmrouter.com` *(optional, for the customer-less free tier)* | same |

The `tunnel.osmrouter.com` record is **the one your Mac sidecars dial**. The leaf cert minted by `init-ca.sh` must have it as a SAN.

## 2. Drop the code

```bash
scp -r ./osmRouter root@your-server:/opt/
ssh root@your-server
cd /opt/osmRouter
```

## 3. Mint the operator CA + leaf

```bash
# Edit the SAN list inside init-ca.sh BEFORE running — it must include
# every hostname your sidecars will dial.  Default SANs cover dev only.
SAN_LIST="DNS:tunnel.osmrouter.com" ./scripts/init-ca.sh
```

This creates `ca/`:
- `root.pem` — embedded into the Mac sidecar binary at build time. Distribute via the *To Compile V2* bundle.
- `root.key` — keep on this box. Locked-down. Re-used only when rotating leaves or minting a new root.
- `proxy-leaf.pem` + `.key` — mounted into the proxy container.

## 4. Generate secrets + write `.env`

```bash
cp .env.example .env
./scripts/generate-secrets.sh >> .env
chmod 600 .env
nano .env        # fill in every «CHANGE» token + SMTP creds
```

Required fills:

| Variable | Set to |
|---|---|
| `OSM_BRAND_DOMAIN` | your domain (e.g. `osmrouter.com`) |
| `OSM_PROXY_CNAME` | `tunnel.osmrouter.com` |
| `OSM_CORS_ORIGINS` | `https://osmrouter.com,https://app.osmrouter.com,...` |
| `OSM_COOKIE_DOMAIN` | `.osmrouter.com` |
| `OSM_NODE_ID` | unique per node, e.g. `proxy-blr-01` |
| `NEXT_PUBLIC_API_BASE` | `https://api.osmrouter.com` |
| 5 crypto secrets + DB + Redis passwords | already filled by `generate-secrets.sh` |
| SMTP credentials | from your provider (Postmark / SendGrid / SES) |

## 5. Wire SMTP

`server/internal/auth/service.go` has a `// TODO: send email` line in `Register()`. Replace it with a real send via `net/smtp` or your provider's SDK. Until you do, OTP codes are stored hashed but never delivered → public signups will hang.

## 6. Bring it up

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

Wait ~60 seconds for the build + first-boot. Then:

```bash
docker compose -f deploy/docker-compose.yml logs --tail=40
# expect:
#   osm-server   ... http server listening  addr=:8080 env=prod
#   osm-proxy    ... tls listener up        addr=:8443
#   osm-proxy    ... public listener up     addr=:8000
#   osm-web      ... Ready in <ms>
curl -sf http://127.0.0.1:8080/healthz   # → {"env":"prod","status":"ok"}
```

## 7. TLS terminator in front

The proxy's **public listener** on `:8000` and the **dashboard** on `:3000` (loopback only) need TLS terminated by a reverse proxy. The proxy's **TLS listener** on `:8443` terminates its own TLS with the operator CA — leave it alone.

```bash
sudo nano /etc/caddy/Caddyfile      # copy from deploy/Caddyfile.example
sudo caddy reload
```

Caddy will auto-fetch Let's Encrypt certs for `osmrouter.com`, `api.osmrouter.com`, etc.

## 8. Promote yourself to admin

```bash
docker exec -it osmrouter-v2-postgres-1 psql -U osm -d osm \
  -c "UPDATE users SET role='admin' WHERE email='you@osmrouter.com';"
```

(After you've signed up via the dashboard at `https://app.osmrouter.com`.)

## 9. Hand customers the Mac app

Build the desktop binary from the **To Compile V2** folder. The build process embeds your `ca/root.pem` into the sidecar so the trust anchor travels with the app. Distribute the signed/notarized `.dmg` from `https://download.osmrouter.com/...`.

## 10. End-to-end verification

From a customer's perspective:

1. Sign up at `https://app.osmrouter.com` → verify email → land on dashboard.
2. Add a domain you own → copy the CNAME (`tunnel.osmrouter.com`) and TXT record → paste into your registrar.
3. Wait one minute → status flips to **Verified** in real time.
4. Add a device → save API key.
5. Download + launch the Mac app → paste API key → it auto-tunnels.
6. Bind a subdomain to your device.
7. From another machine: `curl https://app.your-domain.com` → reaches your local app.
8. For an OpenAI-compatible LLM: point your local server at `:1234` (LM Studio) or `:11434` (Ollama), bind a subdomain, then `curl -N -X POST https://llm.your-domain.com/v1/chat/completions -d '{"model":"...","stream":true,"messages":[...]}'` → tokens stream chunk-by-chunk in real time.

## 11. Backups

```bash
# Postgres logical dump
docker exec osmrouter-v2-postgres-1 pg_dump -U osm osm | gzip | \
  aws s3 cp - s3://backups.osmrouter.com/$(date -u +%Y%m%dT%H%M%S).sql.gz
```

Schedule hourly via cron.

## 12. Updating

```bash
cd /opt/osmRouter
git pull
docker compose -f deploy/docker-compose.yml --env-file .env build
docker compose -f deploy/docker-compose.yml --env-file .env up -d
```

Pre-existing sidecar connections survive a brief proxy restart (sidecar's exponential backoff reconnects within 1–30 s).

## 13. CA rotation

```bash
# Two weeks before expiry of the leaf:
./scripts/init-ca.sh                # mints fresh proxy-leaf using same root
docker compose ... up -d --force-recreate proxy

# Every several years for the root:
./scripts/init-ca.sh --rotate-root
# → rebuild + ship Mac app with the new embedded root.pem during a 2-week
#   overlap window where BOTH roots are still trusted by the proxy. After
#   the overlap, retire the old root.
```

## 14. Troubleshooting

**Proxy log shows `verify-failed: host not bound to this device`**
→ User clicked "Bind" but the host string the sidecar sent doesn't match what's in the DB. Check `OSM_PROXY_CNAME` matches the FQDN the user added.

**Sidecar log shows `tls-handshake: certificate signed by unknown authority`**
→ The Mac binary was built against an older CA. Rebuild + redistribute, or run during a CA-rotation overlap window.

**LLM streaming buffers instead of chunking**
→ Check that the TLS terminator in front of `:8000` is configured to flush small writes. Caddy does by default; nginx requires `proxy_buffering off;` in the location block.

**Long inference (>30 s) returns 504**
→ Increase `proxy_read_timeout` on your TLS terminator. Caddy defaults to 5 minutes which is fine.

## 15. The five honest deferrals (v2.1)

- Real Cloudflare-for-SaaS for customer custom domains
- Stripe webhook handler
- WebAuthn admin MFA
- Per-node proxy mTLS (replaces shared Bearer)
- Auto-rotation of the leaf cert
