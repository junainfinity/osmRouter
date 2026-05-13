# 00 — Security Posture

> Posture for the Control Plane only. Data plane (proxy nodes) is separately hardened.

## 🛡️ Defence in Depth Layers (mapped to `osmRouter Web Security.pdf`)

### Layer 1 — Perimeter (production only, documented)
- Cloudflare WAF (SQLi / XSS / Path traversal rules)
- DDoS absorption
- TLS 1.3 enforced at edge

### Layer 2 — Application transport
- All `Set-Cookie` headers: `HttpOnly; Secure; SameSite=Lax; Path=/`
- HSTS header in prod (`max-age=31536000; includeSubDomains; preload`)
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:`
- X-Content-Type-Options: `nosniff`
- X-Frame-Options: `DENY`
- Referrer-Policy: `strict-origin-when-cross-origin`
- Permissions-Policy: `camera=(), microphone=(), geolocation=()`

### Layer 3 — Authentication
- Argon2id password hash (memory=64MB, iterations=3, parallelism=4, keyLen=32, salt=16B)
- JWT access: 15 min, HS256, env-loaded secret (≥256 bits), `alg` checked explicitly
- Refresh: 30 days, rotation chain — reuse triggers chain revocation
- OTP: 6-digit, 10-min expiry, max 5 attempts, constant-time compare
- PKCE for device flow: S256 code challenge required

### Layer 4 — Authorization
- Every endpoint declares required role (`user` / `admin`)
- Every query scopes by `user_id` of the actor (no exceptions)
- Admin impersonation: short-lived JWT (10 min), audited under both IDs

### Layer 5 — CSRF
- Double-submit token via cookie + `X-CSRF-Token` header
- Token issued at `GET /api/v1/csrf` after login
- Required on all state-changing routes (POST/PUT/PATCH/DELETE)
- Skipped only when `Authorization: Bearer` header is present (machine clients)

### Layer 6 — Rate limiting
- Token bucket per user (or per IP for unauthenticated routes)
- Burst 100, refill 100/min for normal routes
- Burst 5, refill 5/min for auth routes (register, login, verify-otp)
- Exceed → `429 Too Many Requests` with `Retry-After` header

### Layer 7 — Data at rest
- Passwords: Argon2id (above)
- API keys / OTP codes / refresh tokens: stored as SHA-256 hashes (or HMAC), never plaintext
- Registrar API keys: AES-256-GCM with per-row nonce, master key from env (production: KMS/HSM)
- Audit logs: app role has INSERT only, no UPDATE/DELETE (DB-enforced)

### Layer 8 — Observability
- Every request: `X-Request-ID` header, structured slog with trace ID
- Audit log row on every destructive action (delete, bind, unbind, impersonate, role change)
- Sensitive fields redacted in logs (password, token, code, secret, api_key)

### Layer 9 — Graceful failure
- Health endpoint reports `{db, redis, mode}`
- DB down → response sets `mode: readonly`, frontend banner, writes disabled
- Redis down → rate-limit + WS degraded; bind operations refuse with friendly error
- Server shutdown → graceful drain of in-flight requests via `srv.Shutdown(ctx)`

## 🎯 Threats Explicitly Out of Scope (documented, not solved here)
- Side-channel attacks on the host (rowhammer, etc.) — kernel/host hardening
- Insider threat with DB-superuser access — DB role separation in prod infra
- Supply-chain attacks on Go/JS dependencies — depend on `go.sum`/`pnpm-lock.yaml` + Dependabot in prod CI
