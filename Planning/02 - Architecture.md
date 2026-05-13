# 02 — Architecture

## System Diagram (Control Plane only)

```
                    ┌────────────────────────────────────┐
                    │   Browser (Next.js 15 dashboard)   │
                    │   - TanStack Query (REST)          │
                    │   - Zustand (UI state)             │
                    │   - native WebSocket (live events) │
                    └────────────┬───────────────────────┘
                                 │ HTTPS (httpOnly cookies)
                                 │ WSS  (cookie auth on upgrade)
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Go Backend (Echo)                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  Middleware chain (applied to every request)           │      │
│  │  RequestID → Logger → Recover → CORS → SecurityHdrs    │      │
│  │  → RateLimit(perUser) → CSRF(on writes) → AuthJWT      │      │
│  │  → AuthorizeRole → AuditLog(on writes)                 │      │
│  └────────────────────────────────────────────────────────┘      │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  HTTP API    │  │  WebSocket   │  │  Asynq       │            │
│  │  /api/v1/... │  │  /ws         │  │  Workers     │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                  │                   │
│         ▼                 ▼                  ▼                   │
│  ┌──────────────────────────────────────────────────────┐        │
│  │              Service layer (pure logic)              │        │
│  │  Users · Domains · Devices · Subdomains · Tunnels    │        │
│  │  Auth · Audit · DNSVerifier · Cloudflare (stub)      │        │
│  └────────┬──────────────────────┬──────────────────────┘        │
│           │                      │                               │
│           ▼                      ▼                               │
│  ┌──────────────────┐   ┌──────────────────┐                     │
│  │  PostgreSQL      │   │  Redis           │                     │
│  │  (pgx + GORM)    │   │  (go-redis)      │                     │
│  │  - source of     │   │  - live mappings │                     │
│  │    truth         │   │  - rate buckets  │                     │
│  │  - audit log     │   │  - Asynq queue   │                     │
│  └──────────────────┘   └──────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

## Data Model (PostgreSQL)

```
users               id, email (unique, citext), password_hash, role (enum), plan_id,
                    email_verified_at, mfa_enabled, totp_secret, created_at, updated_at
                    INDEX (email)

refresh_tokens      id, user_id, token_hash (unique), parent_id (rotation chain),
                    issued_at, expires_at, revoked_at, ip, user_agent
                    INDEX (user_id, expires_at), INDEX (token_hash)

email_otps          id, user_id, code_hash, purpose (signup|password_reset|sensitive),
                    expires_at, consumed_at, attempts

devices             id, user_id, hardware_uuid, name, os_type, last_seen_at, is_online,
                    api_key_hash (unique), revoked_at, created_at
                    INDEX (user_id), INDEX (hardware_uuid)

device_codes        id, user_id (nullable until claimed), device_code, user_code,
                    code_challenge, code_challenge_method, scope, expires_at,
                    approved_at, consumed_at
                    INDEX (device_code), INDEX (user_code)

domains             id, user_id, fqdn (unique citext), registrar, dns_status (enum),
                    cname_target, txt_token, verification_attempted_at,
                    verified_at, created_at
                    INDEX (user_id), INDEX (fqdn)

subdomains          id, parent_domain_id, prefix, target_port, bound_device_id (nullable),
                    bound_at, created_at
                    INDEX (parent_domain_id), INDEX (bound_device_id)

tunnels             id, subdomain_id, device_id, proxy_node_id, started_at,
                    ended_at (nullable), bytes_transferred
                    INDEX (subdomain_id), INDEX (device_id, ended_at)

audit_logs          id, actor_user_id, action (enum), target_kind, target_id,
                    metadata (jsonb), ip, user_agent, request_id, created_at
                    INDEX (actor_user_id, created_at DESC), INDEX (target_kind, target_id)
                    NOTE: append-only — no update/delete grants in app role

plans               id, slug (free|pro), price_cents, max_domains, max_devices, bandwidth_gb_month

rate_buckets        (Redis only) — key: rl:{user_id}:{route_class}, value: token count
                    TTL: window size

live_mappings       (Redis only) — key: domain:{fqdn[:prefix]}, value: {device_id, tunnel_id}
                    no TTL (long-lived) — invalidated by app
```

## API Surface (v1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/register` | none | Email+password signup, sends OTP |
| POST | `/api/v1/auth/verify-otp` | none | Consume OTP, mark email verified, issue session |
| POST | `/api/v1/auth/login` | none | Password login, issue session |
| POST | `/api/v1/auth/refresh` | refresh cookie | Rotate refresh, issue new access |
| POST | `/api/v1/auth/logout` | access cookie | Revoke refresh chain, clear cookies |
| GET  | `/api/v1/auth/me` | access cookie | Current user profile |
| GET  | `/api/v1/csrf` | access cookie | Issue CSRF token |
| GET  | `/api/v1/domains` | access | List user's domains |
| POST | `/api/v1/domains` | access + csrf | Add domain, generate CNAME/TXT values |
| DELETE | `/api/v1/domains/:id` | access + csrf | Remove domain (cascades subdomains) |
| POST | `/api/v1/domains/:id/verify` | access + csrf | Force-trigger verification |
| GET  | `/api/v1/domains/:id/subdomains` | access | List subdomains |
| POST | `/api/v1/domains/:id/subdomains` | access + csrf | Create subdomain |
| POST | `/api/v1/subdomains/:id/bind` | access + csrf | Bind to device (Redis write) |
| POST | `/api/v1/subdomains/:id/unbind` | access + csrf | Reset device lock |
| GET  | `/api/v1/devices` | access | List user's devices |
| POST | `/api/v1/devices/:id/heartbeat` | device api-key | Mark device online, bump last_seen_at |
| DELETE | `/api/v1/devices/:id` | access + csrf | Revoke device |
| POST | `/api/v1/device-codes` | none (desktop initiated) | Initiate PKCE flow |
| POST | `/api/v1/device-codes/:user_code/approve` | access + csrf | Approve from web |
| POST | `/api/v1/device-codes/exchange` | none (desktop) | Exchange code for api-key |
| GET  | `/api/v1/admin/network` | access + admin | Live network telemetry (mock) |
| GET  | `/api/v1/admin/users` | access + admin | Paginated user list |
| GET  | `/api/v1/admin/users/:id` | access + admin | User dossier |
| POST | `/api/v1/admin/users/:id/impersonate` | access + admin | Issue short-lived impersonation JWT |
| GET  | `/api/v1/admin/audit` | access + admin | Paginated audit log |
| GET  | `/ws` | access cookie (upgrade) | WebSocket — server pushes only |

## Error Contract

All errors return:
```json
{ "error": { "code": "DOMAIN_ALREADY_EXISTS", "message": "human-readable", "request_id": "..." } }
```

HTTP statuses mapped from a canonical error type. No 500s leak stack traces.

## Project Structure (server/)

```
server/
├── cmd/api/main.go              # entrypoint, wiring
├── cmd/worker/main.go           # Asynq worker entrypoint
├── internal/
│   ├── auth/                    # password, JWT, refresh, OTP, PKCE
│   ├── audit/                   # audit log writer (append-only)
│   ├── config/                  # env loader, sane defaults
│   ├── domains/                 # domain service + DNS verifier
│   ├── devices/                 # device service + heartbeat
│   ├── subdomains/              # subdomain + binding service
│   ├── tunnels/                 # tunnel service
│   ├── admin/                   # admin service (impersonation etc.)
│   ├── platform/
│   │   ├── db/                  # GORM init, migrations
│   │   ├── redis/               # go-redis client
│   │   ├── ws/                  # WebSocket hub
│   │   ├── ratelimit/           # token bucket
│   │   ├── csrf/                # token issue/verify
│   │   ├── crypto/              # Argon2id, AES-GCM, HMAC
│   │   └── httpx/               # shared error mapper, response helpers
│   └── server/                  # echo handlers grouped by domain
├── migrations/                  # numbered SQL files (golang-migrate compatible)
├── testdata/                    # fixtures
├── go.mod
└── Makefile                     # run, test, lint, migrate
```

## Project Structure (web/)

```
web/
├── app/
│   ├── (marketing)/page.tsx     # landing
│   ├── (auth)/
│   │   ├── signup/page.tsx
│   │   ├── verify/page.tsx
│   │   ├── login/page.tsx
│   │   └── onboard/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx           # AppShell (Sidebar + Topbar)
│   │   ├── dashboard/page.tsx
│   │   ├── domains/page.tsx
│   │   ├── devices/page.tsx
│   │   ├── billing/page.tsx
│   │   └── settings/page.tsx
│   ├── (admin)/
│   │   ├── layout.tsx
│   │   ├── overview/page.tsx
│   │   ├── users/page.tsx
│   │   ├── network/page.tsx
│   │   ├── plans/page.tsx
│   │   └── audit/page.tsx
│   ├── api/                     # Next.js proxies to Go backend if needed
│   ├── globals.css              # design tokens ported from index.html
│   └── layout.tsx               # root, ThemeProvider, ReactQueryProvider
├── components/
│   ├── ui/                      # Button, Card, Input, Modal, Table, ...
│   ├── icons/                   # IconHome, IconGlobe, ...
│   ├── shell/                   # Sidebar, Topbar
│   └── feature/                 # domain-specific composed components
├── lib/
│   ├── api.ts                   # fetch wrapper, type-safe
│   ├── queries.ts               # TanStack Query keys + hooks
│   ├── websocket.ts             # singleton ws client + event bus
│   ├── store.ts                 # Zustand store
│   └── csrf.ts                  # CSRF token helper
├── public/
│   ├── logo-light.png           # copied from Design/assets
│   └── logo-dark.png
├── tests/                       # vitest + playwright
└── package.json
```
