# 01 — Threat Model (STRIDE)

| Threat | Asset | Vector | Mitigation |
|---|---|---|---|
| **S**poofing | User session | Stolen cookie → replay | Short access TTL (15m), refresh rotation chain reveals theft, IP/UA fingerprint logged |
| **S**poofing | Admin role | JWT forgery / alg=none | Explicit alg check, secret ≥256 bits, signed JWT verified before any role read |
| **S**poofing | Device | Stolen API key | Hash-only storage, single click revocation, last_seen IP logged |
| **T**ampering | Domain DNS records | MITM during DNS verification | TXT token is HMAC-bound to user_id+domain+server secret — cannot be forged externally |
| **T**ampering | Audit log | Insert false events / delete real ones | DB role: INSERT-only on audit_logs; rows include actor + request_id; tamper-evident by design |
| **R**epudiation | Destructive admin action | "I didn't do that" | Every destructive admin action audited with actor_user_id, request_id, ip, ua |
| **I**nformation disclosure | Other users' data | IDOR (incrementing IDs) | All queries scoped by `actor.user_id`; UUIDs used for external IDs to limit guessability |
| **I**nformation disclosure | Email existence | Different error on login | Identical 401 + constant-time response delay band |
| **I**nformation disclosure | Stack traces | 500 responses leak code | All errors mapped through `httpx.WriteError` — never raw |
| **I**nformation disclosure | Tokens in logs | Logger prints request body | Redaction filter on logger keys: `password\|token\|code\|secret\|api_key\|otp` |
| **D**enial of service | API server | Unauthenticated request flood | Per-IP rate limit on unauthenticated routes; behind Cloudflare in prod |
| **D**enial of service | DB | Slow/heavy queries | Connection pool capped (default 20); per-query context timeout; pagination required |
| **D**enial of service | DNS verifier | Stuck domains thrashing | Bounded backoff, max 30d, dead-letter to manual review |
| **E**levation of privilege | User → admin | Role write through API | `role` is never writable via user-facing endpoints; admin-only management endpoint with audit |
| **E**levation of privilege | Impersonation token kept | Admin "forgets" to exit impersonation | Impersonation JWT max TTL 10 min; cannot be refreshed |
| **C**SRF | Browser-trusted cookies | Cross-origin POST from evil.com | Double-submit CSRF token + SameSite=Lax cookies + CORS allow-list |
| **C**lickjacking | Admin actions | iframe overlay | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` |
| **X**SS | Stored user input rendered | Display name with `<script>` | React escapes by default; CSP `script-src 'self'`; no `dangerouslySetInnerHTML` |
| **S**QLi | Any user-controlled input in WHERE | String-concat query | GORM uses parameterized queries throughout; raw queries (if any) use `?` placeholders |
| **B**roken access on object | Domain belonging to user B | Pass user-B's domain ID to API | Service layer validates `domain.user_id == actor.user_id` before any action |
