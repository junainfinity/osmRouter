# 02 — Mitigation Checklist

> Walked through during implementation. Each item links to where it's enforced in code, and is verified by a security test.

## Auth (M1.4)
- [ ] Argon2id with documented params (`crypto/argon2.go`)
- [ ] Password verify is constant-time (`subtle.ConstantTimeCompare`)
- [ ] JWT signed with HS256; verifier asserts `tok.Method == HS256`
- [ ] Access JWT 15-min TTL
- [ ] Refresh token stored as SHA-256 hash
- [ ] Refresh rotation: parent_id chain
- [ ] Refresh reuse → entire chain revoked + user notified
- [ ] OTP: random 6 digits, 10-min TTL, max 5 attempts, hashed storage
- [ ] Login: identical error for "no user" vs "wrong password"
- [ ] Logout: refresh chain revoked + cookies cleared

## Cookies (M1.5)
- [ ] `Secure` flag (always — even in dev, behind reverse proxy if needed)
- [ ] `HttpOnly`
- [ ] `SameSite=Lax`
- [ ] `Path=/`
- [ ] Cookie names: `osm_access`, `osm_refresh`, `osm_csrf`

## CSRF (M1.5)
- [ ] CSRF token issued at `GET /api/v1/csrf` (returns body + sets cookie)
- [ ] Header `X-CSRF-Token` required on POST/PUT/PATCH/DELETE
- [ ] Tokens are 32-byte URL-safe random
- [ ] Token compared to cookie value with constant-time
- [ ] Bypass only for `Authorization: Bearer` requests

## Rate limit (M1.5)
- [ ] Token bucket per user (authenticated) and per IP (unauthenticated)
- [ ] Auth routes: 5 attempts / min
- [ ] Normal routes: 100 / min
- [ ] 429 + `Retry-After` header

## Security headers (M1.5)
- [ ] `Strict-Transport-Security` (prod only)
- [ ] `Content-Security-Policy`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy`
- [ ] No `Server`/`X-Powered-By` headers

## Input validation (every handler)
- [ ] Bind JSON only to typed struct (no `map[string]interface{}`)
- [ ] Required fields validated
- [ ] String lengths bounded
- [ ] Email format checked
- [ ] Domain FQDN format checked (label rules)
- [ ] Subdomain prefix: `[a-z0-9-]{1,63}`, no leading/trailing hyphen
- [ ] Port: int 1-65535
- [ ] UUID inputs parsed via `uuid.Parse` (rejects malformed)

## Authorization (every handler)
- [ ] `user_id` extracted from JWT, never from request body/query
- [ ] Service layer enforces ownership before any read/write
- [ ] Admin routes guarded by `RequireRole("admin")`

## Audit (M1.8)
- [ ] Every destructive action writes audit log row
- [ ] Audit log row includes actor + request_id + ip + ua
- [ ] App DB role has INSERT-only on audit_logs (documented; tested in integration)

## Logging
- [ ] Structured JSON via `log/slog`
- [ ] Every request gets a `request_id` injected
- [ ] Sensitive keys redacted (password, token, code, secret, api_key, otp)
- [ ] Errors logged with stack via `log/slog` handler

## TLS
- [ ] Dev: HTTP on localhost (acceptable)
- [ ] Prod: served behind TLS-terminating reverse proxy; HSTS sent

## Frontend
- [x] No `dangerouslySetInnerHTML` anywhere
- [x] All API responses parsed as JSON, never `eval`
- [x] CSP enforced in `next.config.ts` headers — *with `'unsafe-inline'` on `script-src` because Next.js emits inline bootstrap scripts. **Live demo (Session 3) verified this is required.** v1.1 backlog item: move to a nonce-based CSP via Next.js proxy middleware (see `Planning/12` and the Next.js CSP guide bundled at `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).*
- [x] No third-party scripts in v1
- [x] Tokens never put in localStorage (httpOnly cookies only)

## Graceful failure
- [ ] `srv.Shutdown(ctx)` on SIGINT/SIGTERM
- [ ] `/api/v1/health` reports {db, redis, mode}
- [ ] Frontend banner on readonly mode
