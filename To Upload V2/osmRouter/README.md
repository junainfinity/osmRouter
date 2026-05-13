# osmRouter V2 — Production Bundle (Option D)

> The cloud side of osmRouter, tuned for self-hosted LLM inference. Pinned-TLS + role-inverted HTTP/2 wire protocol; **no third party in the data path**. Customer prompts never touch infrastructure you don't control.

## What's in this folder

```
osmRouter/
├── README.md              ← this file
├── DEPLOY.md              ← detailed deployment guide
├── DEPLOY.html            ← styled standalone HTML walkthrough
├── .env.example           ← every env var, commented + «CHANGE» markers
├── server/                ← Control Plane (Go API)
├── web/                   ← Dashboard (Next.js 16)
├── proxy-node/            ← Data Plane proxy — Option D wire protocol
├── deploy/
│   ├── Dockerfile.server / .web / .proxy
│   └── docker-compose.yml ← production — no defaults for secrets
└── scripts/
    ├── init-ca.sh         ← mint operator root CA + proxy leaf
    ├── generate-secrets.sh
    └── demo_v2.sh         ← spin-up-everything dev smoke
```

## Quickstart (4 commands)

```bash
# 1. Drop on your server
scp -r ./osmRouter root@your-box:/opt/

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

## What's different from V1

| Layer | V1 | **V2 (this)** |
|---|---|---|
| Tunnel wire protocol | WebSocket + JSON frames | TLS 1.3 + role-inverted HTTP/2 (Cloudflare-Tunnel-style) |
| Streaming SSE / large bodies | ❌ 4 MB cap, buffered | ✅ unbounded, `FlushInterval=-1` |
| Long inference (>30 s) | ❌ wall-clock timeout | ✅ context-bound only |
| TLS trust model | system trust store | **pinned operator root CA** — corporate / hotel / state MITM fails closed |
| Mac sidecar protocol match | did not match the existing Mac app | ✅ matches the Mac sidecar exactly (5-line tuning) |
| LLM workloads (Ollama, LM Studio) | technically possible, never streamed | ✅ first-class, tested end-to-end |

## What you must change before launch

1. **Mint the CA**: `./scripts/init-ca.sh`. The `root.pem` it produces gets embedded into the Mac sidecar binary at build time (see *To Compile V2*).
2. **Generate secrets**: `./scripts/generate-secrets.sh >> .env`.
3. **Edit `.env`** and replace every `«CHANGE»` token. Especially:
   - Domain (replace `osmrouter.com` everywhere)
   - SMTP credentials (for OTP delivery)
   - `OSM_PROXY_CNAME` — what customers point their domain at
4. **Wire SMTP** in `server/internal/auth/service.go` (still a TODO in v0.1; see DEPLOY.md §4).
5. **Marketing copy + wordmark + brand colour** in `web/app/page.tsx`, `web/app/globals.css`.
6. **Customer download URL** for the desktop app in the dashboard's onboarding wizard.

## Verifying it's live

```bash
# Visitor curl to a customer's tunneled LLM
curl -N -X POST https://app.maya-coder.com/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hi"}],"stream":true}'
# → tokens stream chunk-by-chunk in real time
```

That command — through your proxy, through the customer's pinned-CA tunnel, into their local app — is what you're selling.

## Honest v2 deferrals (v2.1 backlog)

The Option D pivot resolved all five v1 limitations called out in HANDOFF v1 §14. Remaining for v2.1:

- **Real Cloudflare-for-SaaS integration** (auto-cert for customer custom domains)
- **Stripe billing** (schemas exist; webhook handler not wired)
- **WebAuthn admin MFA** (DB columns exist)
- **Per-node proxy mTLS** instead of shared Bearer secret
- **Auto-rotation of the operator leaf cert** (currently manual via `init-ca.sh`)
- **Frontend "active tunnels" panel** subscribed to live WS events

Each is additive — none require rewriting V2.
