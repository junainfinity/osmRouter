# 04 — Self-Critique & Reformed Plan

> **Method:** Read 01-03 with adversarial eyes. Where am I optimistic, naive, or about to step on a rake?

## 🩻 Critiques of the Master Plan

### C1. "Build foundations first" is right *philosophically*, but the migrations list (9 tables before anything else) is bloated for v1.

**Fix:** Group migrations into 2 phases:
- Phase A (must-have for auth + happy path): `users`, `refresh_tokens`, `email_otps`, `plans`, `audit_logs`
- Phase B (after auth works): `devices`, `device_codes`, `domains`, `subdomains`, `tunnels`

This lets us prove auth end-to-end before introducing 4 more tables we can't yet exercise.

### C2. "Test coverage ≥ 80%" without a definition becomes a vanity metric.

**Fix:** Coverage is per-package on critical paths only:
- `auth/*` — ≥ 85% (security-critical)
- `domains/*`, `devices/*`, `subdomains/*` — ≥ 80%
- `platform/crypto`, `platform/csrf`, `platform/ratelimit` — ≥ 90%
- handlers — ≥ 70% (covered via integration tests too)
- `cmd/*`, scaffolding — not measured

### C3. The frontend port plan says "port primitives one-by-one" — but Shadcn already gives us most of these as battle-tested React components. We'd be rebuilding what already exists.

**Fix:** Use Shadcn primitives where they fit. The Design folder JSX is the *visual* target, not the *implementation* target. We:
- Install Shadcn (`button`, `card`, `input`, `dialog`, `dropdown-menu`, `tabs`, `switch`, `badge`, `toast`)
- Override their CSS variables to match the design tokens from `index.html` (the OKLCH ones)
- Build only the non-Shadcn components ourselves: `Wordmark`, `Sparkline`, `StatusDot`, `Code`, `Stat`, custom `Table` (because the design's table is bespoke)
- Reuse Shadcn's Tooltip/HoverCard/ScrollArea where the design implies them

### C4. WebSocket auth on upgrade is tricky — browsers don't send custom headers on `WebSocket` upgrade.

**Fix:** Cookie-based auth works on upgrade (browser sends cookies automatically on same-origin WS). We just verify the access cookie's JWT during the upgrade handler. No protocol header trickery needed. Document this and make sure CORS is strict so cross-origin WS can't be opened with stolen cookies.

### C5. "Mock Cloudflare for SaaS" — but we still need to generate *something* the user can paste into their DNS provider. What we tell them must match what a real proxy node would expect.

**Fix:** Codify a fixed CNAME target string (env-driven, default `proxy.osmrouter.local` in dev, `nodes.osmrouter.net` in prod). The DNS verifier resolves the CNAME for the user's domain and confirms it points to that target. The TXT record uses a per-domain HMAC token: `osm-verify={HMAC(user_id||domain||secret)}`. This is a real, working mechanism — not a mock.

### C6. PKCE flow without a real desktop client to test against is hard.

**Fix:** Build the *endpoints* and *state machine* correctly per RFC 8628 (device code grant) + PKCE. Test via curl + a `curl_pkce_demo.sh` script in `server/scripts/`. The web side renders "Allow this device?" given a `user_code` query param. Real desktop client integrates later; nothing changes server-side.

### C7. Rate-limiting "tarpitting" sounds clever but is a footgun on a single-process server — holding 500 connections for 5 seconds eats descriptors and goroutines for *no* user benefit.

**Fix:** v1 returns `429` with `Retry-After` header (per RFC 6585). Document tarpitting as a future hardening for a multi-tier rate limit (Cloudflare WAF handles edge, our app returns clean 429s). Don't introduce DoS-on-ourselves.

### C8. "Audit log: cannot be edited by any user, including admins."

In application code we can promise this. At the DB level we need a constraint:
**Fix:** Grant the app role `INSERT, SELECT` only on `audit_logs`. No `UPDATE, DELETE`. Include this as a permissions migration. In dev with single-user Postgres this is documented, in prod it's enforced.

### C9. "Graceful failure: PostgreSQL Outage → Stateless Mode."

For the Control Plane (dashboard), PG outage means we can't serve writes. We can serve cached reads. But we should *fail loudly* (banner: "Read-only mode — DB unavailable") — not silently. Otherwise users lose trust when their writes silently fail.

**Fix:** A `/api/v1/health` endpoint returns `{db, redis, mode}`. The frontend polls this every 15s. If `mode=readonly`, show a sticky banner. Disable all write buttons.

### C10. We're going to drown in middleware ordering bugs unless we lock it down.

**Fix:** Single composition function: `chain(reqID, logger, recover, secureHeaders, cors, rateLimit, csrf, auth)`. Inject in *that order*. Document why each comes before the next. Test order with an integration test that asserts e.g. "rate limit fires before auth" (so unauthenticated brute-force can't spam JWT verify).

### C11. CSRF protection on a JSON API with httpOnly cookies — double-submit-token is the standard, but it's fiddly.

**Fix:** Use Echo's built-in CSRF middleware with cookie storage and `X-CSRF-Token` header. Token issued to authenticated session on `/api/v1/csrf` (called once after login). Frontend reads it from response body (NOT cookie) and attaches as header on every write. Reject mismatches with 403. Skip CSRF for `Authorization: Bearer` requests (device clients, no browser).

### C12. Naming: "subdomains" is ambiguous — is `api.acme.com` a subdomain of `acme.com` (registered as one domain row) or a separate Domains row?

**Fix:** A **Domain** is what you register (an apex or any FQDN with its own DNS records). A **Subdomain** in our schema is a *routing rule* under a Domain — e.g. domain=`acme.com`, subdomain prefix=`api` means traffic to `api.acme.com` routes per the rule. The Domain stores the DNS records, the Subdomain stores the device binding. Confirmed against PRD §3.1 — that matches.

### C13. The User Dashboard JSX likely shows aggregated stats. We don't have a tunnels table populated.

**Fix:** Stub realistic counters in the dashboard endpoint (`GET /api/v1/dashboard`) that compute from existing tables: `len(domains)`, `len(devices_online)`, `sum(bytes_transferred)` (which will be 0 until proxy nodes write). Mark as honest "no traffic yet" in UI. Don't fake numbers.

### C14. The OTP flow in design auto-advances on 6th digit — this is good UX but creates a race condition if the server is slow. The UI must show a spinner and lock inputs.

**Fix:** Already in the design JSX. Port as-is.

### C15. Time pressure: a full prototype of *everything* in one session is unrealistic.

**Honest CTO call:** I'll deliver:
- **Backend:** full code for foundation + business logic (M1, M2) with passing unit tests
- **Frontend:** Next.js scaffold + design tokens + auth flow + dashboard + domains page wired to backend (M3, parts of M4)
- **Tests:** unit + a representative integration test + security test suite for auth + CSRF
- **Docs:** all Obsidian planning + dev log + handoff doc

Pages I'll *scaffold* but not fully wire in this session (placeholder pages with TODO markers + working route): admin pages, billing, settings, devices detail. They'll render but be marked clearly as "stub — full impl in M4 follow-up".

This way the user gets a runnable thing today, with the foundation strong enough that finishing the placeholder pages is a 1-day follow-up — not a re-do.

---

## ✅ Reformed Build Order

(Replaces atomic list #1-#70 in Plan 03.)

### Phase 1 — Backend Foundation (M1 complete)
1. Scaffold Go module + Makefile
2. Config, logger, healthz, graceful shutdown
3. DB + Redis bootstrap
4. Phase-A migrations (users, refresh_tokens, email_otps, plans, audit_logs)
5. Crypto package (argon2 + JWT + secure-random) + **unit tests as we write each function**
6. httpx (error mapping + response helpers)
7. CSRF + rate-limit middleware + **unit tests**
8. WebSocket hub
9. Audit log writer
10. Auth service (register, login, OTP, refresh) + **unit tests**
11. Auth handlers + Echo router with middleware chain
12. Smoke: `curl /healthz`, register, login, me, logout

### Phase 2 — Business Logic (M2 complete)
13. Phase-B migrations (devices, device_codes, domains, subdomains, tunnels)
14. Domain service + handlers (add, list, delete, regen verification) + **unit tests**
15. DNS verifier (in-process goroutine pool, not Asynq for v1 simplicity — Asynq is overkill)
16. Device service + heartbeat + revoke + **unit tests**
17. PKCE device-code endpoints (initiate, approve, exchange)
18. Subdomain service + bind/unbind (with Postgres + Redis transactional write) + **unit tests**
19. Admin service (network mock, users, dossier, impersonation) + **unit tests**
20. Wire WS events from each service into the hub
21. Smoke: full happy-path via curl

### Phase 3 — Frontend (M3 + selected M4)
22. Next.js 15 init (TypeScript, Tailwind v4, Shadcn, App Router)
23. Port design tokens to `globals.css`
24. Install Shadcn primitives + override theme to match
25. Build non-Shadcn primitives (Wordmark, Sparkline, StatusDot, Code, Stat)
26. Port icons (single barrel)
27. Build AppShell + Sidebar + Topbar
28. lib/api.ts + lib/queries.ts + lib/websocket.ts + lib/store.ts
29. Marketing page
30. Auth pages (signup, verify, login, onboard)
31. AuthGuard wrapper for (app) and (admin) layouts
32. User dashboard page (KPIs from real backend)
33. Domains page (list, add, copy DNS, force-verify, delete)
34. Devices page (list, online status — *placeholder data ok*)
35. Subdomain detail (bind/unbind)
36. Admin: overview, users, audit pages (read-only; ports of design)
37. Stub pages: billing, settings, admin/network, admin/plans (clean placeholders with `TODO` banner)

### Phase 4 — Testing (M5)
38. Integration test harness using `httptest` + a test DB (sqlite for v1 OR testcontainers Postgres if available; I'll choose sqlite for portability)
39. Security test suite:
   - Unauthenticated access rejected (every protected endpoint)
   - Wrong role rejected (admin endpoints under user)
   - Expired JWT rejected
   - Replayed refresh token rejected (and cascades revocation)
   - CSRF missing/invalid token → 403
   - Rate limit exceeded → 429 with Retry-After
   - SQLi attempts in user inputs → safely parameterized (sanity check, GORM does this)
   - XSS in user-supplied display names → not reflected unescaped (covered by JSON responses)
   - JWT alg confusion attack (alg=none) → rejected
40. Frontend component tests (Vitest + Testing Library)
41. E2E happy path (Playwright; optional if time runs short — at minimum scripted curl in `scripts/`)
42. Final dev log + handoff README

---

## 📌 Decisions Locked In (don't revisit during execution)

| Decision | Choice | Reason |
|---|---|---|
| Go web framework | Echo v4 | PRD specifies it; mature, minimal |
| ORM | GORM v2 + pgx driver | PRD specifies it; raw SQL where needed |
| Job queue | In-process goroutine pool (v1) | Asynq is over-engineering for one worker type |
| JWT signing | HS256 with env-loaded secret (v1) | Single-process server; EdDSA-ready interface |
| Frontend test runner | Vitest | Faster than Jest, first-class TS, Next.js compatible |
| Frontend E2E | Playwright (optional in this session) | Browser parity |
| Backend test DB | SQLite for unit/handler tests, real Postgres for explicit integration test | Speed + parity |
| CSRF | Double-submit token via Echo middleware, header `X-CSRF-Token` | Standard |
| Session transport | httpOnly + Secure + SameSite=Lax cookies | Standard |
| Refresh rotation | Rotation chain table; reuse → revoke entire chain | Spec |
| Logger | log/slog (stdlib) with JSON handler | No extra dep, structured |
