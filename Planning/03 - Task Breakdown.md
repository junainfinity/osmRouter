# 03 — Task Breakdown (Major → Mini → Micro → Atomic → Nano)

> **How to read:** Five levels of granularity. The top three are planning, the bottom two are execution.
> *Nano* tasks are sized to be done in under 10 minutes each — they're what gets ticked off as work happens.

---

## 🌑 MAJOR (5 epics)

- **M1.** Backend foundation (Go + Echo + Postgres + Redis + migrations + auth)
- **M2.** Backend business logic (Domains, Devices, Subdomains, Tunnels, WebSockets, Workers, Admin)
- **M3.** Frontend foundation (Next.js 15 + design system port + routing + state)
- **M4.** Frontend feature pages (marketing, auth, dashboard, domains, devices, billing, settings, admin)
- **M5.** Test suites (unit, integration, security, frontend, E2E)

---

## 🌒 MINI (per major)

### M1 — Backend foundation
- M1.1 Repo scaffold, Makefile, env loader, structured logger
- M1.2 Postgres + GORM bootstrap + migrations harness
- M1.3 Redis bootstrap + healthcheck
- M1.4 Auth core (Argon2id, JWT issue/verify, refresh rotation, OTP)
- M1.5 Security middleware stack (request-id, security headers, CSP, CORS, CSRF, rate limit, recover)
- M1.6 Error contract + httpx helpers
- M1.7 Graceful shutdown
- M1.8 Audit log writer (append-only)

### M2 — Backend business logic
- M2.1 Domain CRUD + token generation (CNAME, TXT)
- M2.2 DNS verifier worker (Asynq + net.LookupTXT/CNAME)
- M2.3 Device CRUD + heartbeat endpoint + offline sweeper
- M2.4 PKCE device-code flow (initiate, approve, exchange)
- M2.5 Subdomain CRUD
- M2.6 Subdomain ↔ Device binding (Postgres + Redis transaction)
- M2.7 Reset device lock (deletes binding + Redis + emit kill-tunnel WS event)
- M2.8 WebSocket hub (per-user channels) + auth on upgrade
- M2.9 Admin: network stats (mock), user dossier, impersonation
- M2.10 Tunnel ingest endpoint (mock telemetry from proxy nodes; just records into DB)

### M3 — Frontend foundation
- M3.1 Next.js 15 init with TypeScript, ESLint, Tailwind v4, App Router
- M3.2 Port design tokens from `Design/.../index.html` to `globals.css`
- M3.3 Layout primitives — AppShell, Sidebar, Topbar (port from `layout.jsx`)
- M3.4 UI primitives — Button, Card, Input, Modal, Table, Badge, Stat, Spinner, StatusDot, Code, Tabs, Toast, Menu, Switch (port from `components.jsx`)
- M3.5 Icons set (port from `icons.jsx`)
- M3.6 API client (typed `fetch` wrapper, CSRF integration)
- M3.7 TanStack Query setup + Zustand store
- M3.8 WebSocket client singleton + event bus → React subscription
- M3.9 Theme provider (light/dark via `data-theme`)

### M4 — Frontend feature pages
- M4.1 Marketing landing
- M4.2 Auth: signup, verify (OTP), login, onboarding
- M4.3 User Dashboard (KPIs, recent activity, sparkline)
- M4.4 Domains page (list, add, verify, copy DNS, delete)
- M4.5 Devices page (list, online status, revoke)
- M4.6 Subdomains within Domain detail (bind/unbind to device)
- M4.7 Billing page (plan card + invoices placeholder)
- M4.8 Settings page (profile, API keys, MFA toggle)
- M4.9 Admin: Overview, Users, Network, Plans, Audit
- M4.10 Impersonation banner + exit flow
- M4.11 Notifications dropdown wired to WS

### M5 — Tests
- M5.1 Go unit tests — auth, crypto, services, validators
- M5.2 Go integration tests — full HTTP flow with testcontainers (Postgres + Redis)
- M5.3 Security tests — bypass attempts, SQLi, XSS, CSRF, rate limit, JWT replay/expiry
- M5.4 Frontend unit/component tests — Vitest + Testing Library
- M5.5 E2E happy path — Playwright (signup → verify → add domain → bind)
- M5.6 Load/smoke test — k6 or `hey` (basic threshold)

---

## 🌓 MICRO (selected expansions — full version inline in code, summary here)

### M1.4 Auth core
- M1.4.a Argon2id password hash + verify (parameters fixed in code)
- M1.4.b JWT signer (HS256, dev) — interface so we can swap to EdDSA later
- M1.4.c Refresh token: hash, store, rotate, revoke chain on reuse
- M1.4.d OTP: 6-digit, expiration, attempt counter, constant-time compare
- M1.4.e Session cookie setters (httpOnly, Secure, SameSite=Lax, Path=/)
- M1.4.f Handlers: register, verify-otp, login, refresh, logout, me

### M2.2 DNS verifier worker
- M2.2.a Asynq queue setup
- M2.2.b Task: `domain:verify` payload `{domain_id}`
- M2.2.c Worker resolves expected TXT + CNAME via stdlib `net`
- M2.2.d On success: update DB, emit WS event, log audit
- M2.2.e On failure: re-enqueue with exponential backoff (capped at 1h)

### M2.6 Bind subdomain to device
- M2.6.a Validate device belongs to same user as domain
- M2.6.b Validate device.is_online = true
- M2.6.c Postgres tx: update subdomains row
- M2.6.d Redis SET `domain:{fqdn}/{prefix}` → `{device_id, tunnel_id?}`
- M2.6.e If Redis fails, rollback Postgres tx
- M2.6.f Emit WS event `subdomain.bound` to user channel
- M2.6.g Write audit log entry

---

## 🌗 ATOMIC (concrete code-unit tasks, sequential)

**Order of execution — this is the build script we follow:**

1. `server/go.mod` init, deps pinned
2. `server/cmd/api/main.go` — minimal Echo server, /healthz endpoint
3. `server/internal/config/config.go` — env vars + .env loader (dev only)
4. `server/internal/platform/db/db.go` — GORM + pgx, migrate hook
5. `server/migrations/0001_users.sql`
6. `server/migrations/0002_refresh_tokens.sql`
7. `server/migrations/0003_email_otps.sql`
8. `server/migrations/0004_devices.sql`
9. `server/migrations/0005_device_codes.sql`
10. `server/migrations/0006_domains.sql`
11. `server/migrations/0007_subdomains.sql`
12. `server/migrations/0008_tunnels.sql`
13. `server/migrations/0009_audit_logs.sql`
14. `server/migrations/0010_plans_seed.sql`
15. `server/internal/platform/redis/redis.go`
16. `server/internal/platform/crypto/argon2.go` + tests
17. `server/internal/platform/crypto/jwt.go` + tests
18. `server/internal/platform/crypto/random.go` (secure random codes)
19. `server/internal/platform/httpx/errors.go` + `response.go`
20. `server/internal/platform/csrf/csrf.go` + tests
21. `server/internal/platform/ratelimit/ratelimit.go` + tests
22. `server/internal/platform/ws/hub.go`
23. `server/internal/audit/audit.go`
24. `server/internal/auth/service.go` + tests (register, login, refresh, otp)
25. `server/internal/auth/handlers.go`
26. `server/internal/auth/middleware.go` (RequireAuth, RequireRole)
27. `server/internal/server/middleware.go` (compose: req-id → log → secure → cors → ratelimit → csrf → audit-tail)
28. `server/internal/domains/service.go` + tests
29. `server/internal/domains/handlers.go`
30. `server/internal/domains/verifier.go` (DNS check goroutine)
31. `server/internal/devices/service.go` + tests
32. `server/internal/devices/handlers.go`
33. `server/internal/subdomains/service.go` + tests
34. `server/internal/subdomains/handlers.go`
35. `server/internal/admin/service.go` + tests
36. `server/internal/admin/handlers.go`
37. `server/cmd/worker/main.go` (Asynq worker; for now we spawn in-process for v1)
38. `server/cmd/api/main.go` — final wiring of all routes, graceful shutdown
39. Backend smoke run + `go test ./...`
40. `web/` Next.js init via `pnpm create next-app`
41. `web/app/globals.css` — port design tokens
42. `web/components/ui/*` — port primitives 1-by-1 (TS, Tailwind, no inline styles)
43. `web/components/icons/*` — port icons (single barrel file)
44. `web/components/shell/sidebar.tsx`, `topbar.tsx`, `app-shell.tsx`
45. `web/lib/api.ts` — typed fetch wrapper
46. `web/lib/queries.ts` — query keys + hooks
47. `web/lib/websocket.ts`
48. `web/lib/store.ts`
49. `web/app/(marketing)/page.tsx` — port landing
50. `web/app/(auth)/signup/page.tsx`
51. `web/app/(auth)/verify/page.tsx`
52. `web/app/(auth)/login/page.tsx`
53. `web/app/(auth)/onboard/page.tsx`
54. `web/app/(app)/layout.tsx` — AppShell wrapper, auth guard
55. `web/app/(app)/dashboard/page.tsx`
56. `web/app/(app)/domains/page.tsx`
57. `web/app/(app)/devices/page.tsx`
58. `web/app/(app)/billing/page.tsx`
59. `web/app/(app)/settings/page.tsx`
60. `web/app/(admin)/overview/page.tsx`
61. `web/app/(admin)/users/page.tsx`
62. `web/app/(admin)/network/page.tsx`
63. `web/app/(admin)/plans/page.tsx`
64. `web/app/(admin)/audit/page.tsx`
65. Frontend smoke run
66. Backend test pass: `go test -race ./...`
67. Security test suite execution
68. Frontend test pass: `pnpm test`
69. E2E happy-path: signup → verify → login → add domain → see DNS records
70. Final dev log entry + handoff doc

---

## 🌘 NANO (per-atomic-task checklist — written as we execute, in the Dev Log)

Each atomic task becomes 3–7 nano steps when we touch it. We track them in `Dev Logs/`.

Example for #16 `argon2.go`:
- create file with package decl
- import golang.org/x/crypto/argon2 + crypto/rand + encoding/base64
- define Params struct + sensible defaults (memory=64MB, time=3, threads=4, keyLen=32, saltLen=16)
- `Hash(password) -> encoded` returning $argon2id$v=19$... format
- `Verify(encoded, password) -> bool, error` with constant-time compare
- write 3 tests: hash-then-verify-true, hash-then-verify-wrong-false, malformed-encoded-error
- run `go test ./internal/platform/crypto -run Argon2 -race -v`
- ✓ mark complete
