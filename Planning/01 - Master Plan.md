# 01 — Master Plan

> **CTO-mode thinking:** Before writing a single line of code, what must be true?

## 1. The North Star

Build the **Control Plane** of osmRouter. *Not* the Data Plane (proxy nodes) — those are separate, run elsewhere, and just consume the Redis live-mapping table that this Control Plane writes to.

**Therefore:** every API the dashboard exposes and every database/Redis write the backend performs must be designed assuming a fleet of Proxy Nodes will read them out-of-process.

## 2. The Two Halves

| Half | What | Stack |
|---|---|---|
| **Backend** | API server, DB, Redis, WebSockets, background workers | Go 1.22+, Echo, GORM, pgx, go-redis, Asynq, WebSocket via gorilla/websocket |
| **Frontend** | Marketing + Auth + User dashboard + Admin command center | Next.js 15 App Router, TanStack Query, Zustand, Tailwind, Shadcn-styled primitives, native WebSocket client |

These are independent codebases under `server/` and `web/`. They talk over HTTP (REST) and WebSocket (push). Cookies for browser auth, Bearer for desktop client (later).

## 3. The Build Order (with reasoning)

We don't build the iceberg's tip first. We build foundations:

1. **Database schema + migrations** — without this nothing else has a place to live.
2. **Auth (Argon2, JWT in httpOnly cookie, refresh rotation)** — the gate. Every other endpoint depends on it.
3. **Security middleware (rate-limit, CSRF, CSP, security headers, request-id, audit log writer)** — once auth exists, the rest must be protected from day one. Do not bolt this on later.
4. **Domain / Device / Subdomain / Tunnel CRUD + Redis live-map writer** — the actual business logic.
5. **DNS verification worker (Asynq)** — async logic that closes the loop.
6. **WebSocket hub** — push side of the system.
7. **Admin endpoints** — separate auth scope (`role == admin`).
8. **Next.js scaffold** + design system port (use design tokens from `index.html` verbatim — they're already excellent).
9. **Wire frontend ↔ backend** route by route.
10. **Tests** — *but* unit tests are co-written with each backend module; only integration + security tests are batched at the end.

## 4. Scope Discipline — What is OUT of v1

Honest CTO call: we don't try to do everything, we do the right things well.

**OUT** (intentionally):
- Real PKCE desktop flow (we stub it; real exchange happens when desktop client exists)
- Real Cloudflare-for-SaaS integration (we model it; real provisioning is post-MVP)
- Real Stripe billing (we model `plan_id`; real payment is post-MVP)
- HSM / KMS for AES-256-GCM encryption of registrar API keys (we use envelope encryption with a local master key in v1, ready to swap)
- WebAuthn for admin (we lay the schema column `admin_mfa_required`, but implementation is post-MVP)
- Multi-region failover, PITR backups (infra concerns; out of code scope)
- Read replicas / leader election (config concern, code uses primary)

**IN** (must work end-to-end):
- Argon2id password hashing
- JWT access (15-min) + refresh (30-day, rotated)
- Email + password signup, OTP verification (email-stub for now)
- Custom domain add → DNS records shown → background worker verifies
- Device list, Online status (last-seen heartbeat endpoint)
- Subdomain ↔ Device binding (PostgreSQL + Redis sync, transactional)
- Reset device lock (deletes binding + Redis + emits "kill tunnel" event)
- WebSocket broadcast per-user channel for `dns.verified`, `device.online`, `device.offline`, `subdomain.bound`, `subdomain.unbound`
- Admin: live network stats (mocked telemetry endpoint), user dossier, impersonation (short-lived scoped JWT)
- Full security middleware stack
- Comprehensive structured logging with `X-Trace-ID`
- Immutable audit log table for every destructive action
- Graceful shutdown
- Rate limiting (token bucket per-user) with tarpitting on excess

## 5. Quality Bars

| Concern | Bar |
|---|---|
| Test coverage (backend critical path) | ≥ 80% statements |
| All security tests pass | 100% |
| `go vet`, `staticcheck`, `golangci-lint` | clean |
| `next lint`, `tsc --noEmit` | clean |
| Every API endpoint has at least one happy-path + one auth-rejection test | enforced |
| Every destructive endpoint has a CSRF rejection test | enforced |
| Every input is validated server-side, never trusts client | enforced |
