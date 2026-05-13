# 05 — Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Refresh-token rotation chain bug → users get logged out unfairly | M | H | Unit-test the rotation chain explicitly; integration test for "reuse old token → entire chain dies, user must re-login" |
| R2 | CSRF + cookies misconfig blocks legitimate writes | M | M | Test in both same-origin and cross-origin scenarios; document SameSite=Lax behavior on POST navigations |
| R3 | DNS verifier infinite loop or thrashing on stuck domains | M | M | Bounded backoff (1m → 5m → 15m → 1h → 1h…); per-domain attempt counter; stop after 30 days unverified |
| R4 | Redis goes down mid-bind → DB has binding, Redis doesn't | L | H | Bind operation: Postgres tx → Redis SET → if Redis fails, rollback Postgres tx; on startup, reconciliation worker rebuilds Redis from DB if Redis is empty |
| R5 | Postgres returns rows of another user (broken WHERE user_id=) | L | Critical | Every service method takes a UserID and includes it in the WHERE; integration test that user A cannot read user B's domain by ID |
| R6 | WebSocket connection leaks goroutines | M | M | Read/write deadlines, ping/pong every 30s, hub closes on read error, defer close in goroutine |
| R7 | Time-of-check / time-of-use on bind operation (race when two clients bind same device) | L | M | DB unique constraint `subdomains.bound_device_id` when set; on conflict return "device already bound elsewhere" |
| R8 | Argon2 params too weak or too slow on target hardware | L | H | Bench in CI: hash must take 100–300ms on dev hw; fail build if outside band |
| R9 | JWT alg confusion (alg=none / RS256→HS256) | L | Critical | Explicitly check token.Method == jwt.SigningMethodHS256 before verifying |
| R10 | Open redirect on OAuth/PKCE callback | M | M | Whitelist of allowed callback URI patterns per device-code request |
| R11 | Admin impersonation token leaks → user data accessible | L | Critical | Impersonation JWT: 10-min expiry, includes `impersonated_by` claim, every action under it is audited with both actor and impersonated user IDs |
| R12 | Frontend XSS via user-controlled display strings | L | M | React escapes by default; never use `dangerouslySetInnerHTML`; CSP `default-src 'self'` |
| R13 | Email enumeration on login (different errors for "no user" vs "wrong password") | M | L | Return identical "invalid credentials" + timing-equalized response |
| R14 | Permissive CORS allows cookie-bearing requests from any origin | L | Critical | CORS allow-list: only `https://osmrouter.com` and dev `http://localhost:3000` |
| R15 | Race on email_otp: same code consumed twice | L | M | `UPDATE ... SET consumed_at=now() WHERE consumed_at IS NULL RETURNING ...` — atomic |
| R16 | Asynq/worker process not running → DNS never verifies | M | M | We chose in-process goroutine for v1; supervisor lives in API process; tested via integration |
| R17 | Migrations forgotten in deploy | M | M | API process runs migrations on startup, idempotently |
| R18 | Plain-text registrar API key stored | L | H | `domains.registrar_api_key_enc` encrypted with AES-256-GCM, master key from env (HSM-ready) |
| R19 | Test DB pollutes prod (env mis-set) | L | Critical | Refuse to run tests if `DATABASE_URL` doesn't contain "test" or "memory" |
| R20 | Sensitive data in logs (passwords, tokens) | M | H | Logger has a redaction filter; all sensitive request bodies replaced with `[redacted]` |
