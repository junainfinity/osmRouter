# osmRouter Yellow Paper

**A formal specification of the osmRouter sovereign-tunneling protocol.**

*v1.0 · May 2026 · The osmRouter Project*

---

## Abstract

This paper specifies the wire formats, state-transition functions, cryptographic primitives, and security properties of the osmRouter system. The intended audience is implementers of compatible clients and proxy nodes, security reviewers, and operators who need a precise reference for what the system promises. Where the Whitepaper describes *what* osmRouter does, this paper specifies *how* — with enough rigour to write a conformant alternate implementation.

## 1. Notation and Conventions

Throughout this document:

- $\mathbb{B}$ denotes the set of all byte strings, $\mathbb{B}^n$ the set of length $n$.
- $\mathbb{Z}_n$ denotes integers modulo $n$.
- $\|$ denotes byte-string concatenation.
- $\overset{\\$}\leftarrow$ denotes uniform random sampling.
- $H(x)$ denotes SHA-256 of $x$, with output in $\mathbb{B}^{32}$.
- $\text{HMAC}_k(m)$ denotes HMAC-SHA-256 with key $k$ over message $m$.
- $\text{Argon2id}(p, s, \theta)$ denotes the Argon2id key-derivation function over password $p$, salt $s$, parameters $\theta$.
- $\text{AES}\text{-}\text{GCM}_k(\text{nonce}, \text{plaintext})$ denotes authenticated encryption.
- $\langle a, b, c \rangle$ denotes a tuple.
- All byte strings are big-endian where ordering matters.

API endpoints follow REST conventions. All HTTP responses use `Content-Type: application/json` unless otherwise noted. All times are ISO-8601 with a `Z` suffix unless stated.

## 2. Architecture and State

### 2.1 The Two Planes

osmRouter is partitioned into:

- $C$, the **Control Plane** — a single logical service holding authoritative state.
- $D = \{d_1, d_2, \ldots, d_k\}$, the **Data Plane** — a set of proxy nodes that read from $C$ via a fast cache and write back via an audited ingest API.

The two planes share state only through:

1. **Redis** (the cache) — write-mostly by $C$, read-mostly by $D$.
2. **HTTPS ingest** — write-only by $D$, authenticated by a shared secret.

### 2.2 Persistent State (PostgreSQL, owned by $C$)

The authoritative state is the union of these relations.

**Users.** $\mathcal{U} = \{u\}$ where each $u = \langle \text{id}, \text{email}, h_p, r, p_{\text{id}}, t_v, m, c, u_t \rangle$:

- $\text{id} \in \mathbb{B}^{16}$ — UUIDv4
- $\text{email} \in \Sigma_\text{ascii}^{\leq 320}$ — case-insensitive, unique
- $h_p$ — Argon2id-encoded password hash
- $r \in \{\text{user}, \text{admin}\}$
- $p_\text{id}$ — foreign key into plans
- $t_v \in \mathbb{T} \cup \{\bot\}$ — `email_verified_at`
- $m \in \{0, 1\}$ — `mfa_enabled`
- $c \in \mathbb{T}$ — `created_at`
- $u_t \in \mathbb{T}$ — `updated_at`

**RefreshTokens.** $\mathcal{R} = \{\rho\}$ forming an arborescence: each $\rho = \langle \text{id}, u_\text{id}, h_\rho, \pi, t_i, t_e, t_r, \ldots\rangle$:

- $h_\rho = H(s_\rho)$ where $s_\rho \in \mathbb{B}^{32}$ is the plaintext token issued exactly once
- $\pi$ — `parent_id`, the token this one rotated from (or $\bot$ for first issue)
- $t_e$ — `expires_at`, $t_e = t_i + 30~\text{days}$ by default
- $t_r$ — `revoked_at` (or $\bot$)

**EmailOTPs**, **Devices**, **DeviceCodes**, **Domains**, **Subdomains**, **Tunnels**, **AuditLogs** — described in §6 onwards.

### 2.3 Volatile State (Redis, populated by $C$ and read by $D$)

The Redis store keeps the **live mapping** that the data plane consults on every visitor request:

$$M : \Sigma_\text{host} \to \text{DeviceID}$$

Keys are strings of the form `live:<fqdn>` for apex bindings or `live:<prefix>.<fqdn>` for subdomain bindings. Values are device IDs as UUIDv4 strings. There is no TTL — entries are explicitly removed when a binding is reset.

Additional ephemeral keys:

- `rl:<class>:<actor>` — token-bucket rate-limit counters, TTL equal to window
- `tunnel:<id>` — (reserved for v1.1)

## 3. Cryptographic Primitives

### 3.1 Password Hashing

Passwords are stored as the Argon2id PHC-encoded string:

$$\text{store}(p) = \text{phc}\Big(\text{Argon2id}\big(p, s, \theta_\text{default}\big)\Big)$$

with parameters $\theta_\text{default} = \langle m = 64\,\text{MiB}, t = 3, p = 4, \text{keyLen} = 32, \text{saltLen} = 16\rangle$ and $s \overset{\\$}\leftarrow \mathbb{B}^{16}$ on each call. Verification recomputes the key with the stored salt and parameters and compares the result in constant time.

### 3.2 Access Tokens (JWT)

Access tokens are signed JSON Web Tokens with header $\text{alg} = \texttt{HS256}$, $\text{typ} = \texttt{JWT}$. The payload is:

```json
{
  "sub": "<user_id>",
  "role": "user|admin",
  "scopes": [],
  "impersonated_by": "<admin_id>",  // optional
  "iss": "osmrouter",
  "aud": "osmrouter-web",
  "iat": <int>, "nbf": <int>, "exp": <int>
}
```

with $\text{exp} - \text{iat} = 15~\text{min}$ for regular access tokens and $10~\text{min}$ for impersonation tokens.

**Verification.** Any deserializer MUST:

1. Reject tokens whose header advertises any algorithm other than `HS256`. In particular, `alg: none` MUST be rejected before the signature is even read.
2. Verify the signature using the issuer's HMAC key $k_J \in \mathbb{B}^{\geq 32}$.
3. Verify $\text{iat} \leq \text{now} \leq \text{exp}$ with a tolerance of zero (no clock skew allowance).
4. Verify $\text{aud} = $ the verifier's audience identifier.

### 3.3 Refresh Tokens

Refresh tokens are URL-safe random byte strings of 32 bytes. The plaintext is sent to the client exactly once (in an `HttpOnly; Secure; SameSite=Lax` cookie). The server stores only $H(\text{token})$ in the `refresh_tokens` table.

Each refresh token has a `parent_id` pointing to the token it rotated from, forming a forest. The **chain** of a refresh token is the transitive parent chain plus all its direct children.

### 3.4 OTP Codes

Email OTPs are 6 random decimal digits generated by rejection-sampling 8-bit values $v \in [0, 250)$ and mapping $v \bmod 10$. This eliminates modulo bias.

The plaintext OTP is sent over email; only $H(\text{otp})$ is stored. Verification compares hashes in constant time. After 5 failed verification attempts the OTP is locked.

### 3.5 Domain Verification Token

The TXT verification token for domain $f$ owned by user $u$ is:

$$\text{TXT}(u, f) = \texttt{osm-verify=} ~\|~ \text{trunc}_{32}\big(\text{HMAC}_{k_\text{TXT}}(\texttt{dns-verify}~\|~u~\|~f)\big)$$

where $k_\text{TXT} \in \mathbb{B}^{\geq 32}$ is the operator's verification secret. Without $k_\text{TXT}$ an attacker cannot construct a valid token for a domain — only the legitimate user, who got the token from the dashboard, can.

### 3.6 At-Rest Encryption (Registrar API Keys, etc.)

Sensitive fields in the database are encrypted with AES-256-GCM:

$$c = \text{nonce} ~\|~ \text{AES-GCM}_{k_E}(\text{nonce}, p), \quad \text{nonce} \overset{\\$}\leftarrow \mathbb{B}^{12}$$

The master key $k_E \in \mathbb{B}^{32}$ is loaded from the environment in v1; the v1.1 hardening migrates this to a KMS / HSM.

## 4. Identity & Session Lifecycle

### 4.1 Registration

`POST /api/v1/auth/register {email, password, name?}`. The handler:

1. Lowercase-and-trim the email; validate against RFC 5322 minimal grammar.
2. Validate the password: length $\geq 8$, contains at least one digit. (Stronger rules are policy, not protocol.)
3. Check uniqueness on `email`. Return `409 EMAIL_IN_USE` on conflict.
4. Compute $h_p = \text{store}(\text{password})$.
5. Insert $u$ with $t_v = \bot$.
6. Generate $\text{otp} = $ 6 random digits; insert into `email_otps` with $H(\text{otp})$, `purpose = signup`, `expires_at = now + 10~min`.
7. (Dev mode only) Echo $\text{otp}$ in the response body.

Return 201 with $\{u_\text{id}, \text{email}\}$.

### 4.2 OTP Verification

`POST /api/v1/auth/verify-otp {email, code}`. Handler:

1. Find the most recent unexpired, unconsumed OTP for `email` with purpose `signup`.
2. If `attempts >= 5`, return `429 OTP_ATTEMPTS_EXCEEDED`.
3. If $H(\text{code}) \neq H(\text{stored})$ (constant time): atomically increment `attempts`, return `400 OTP_INVALID`.
4. Atomically `UPDATE email_otps SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL` and verify exactly 1 row affected.
5. If user's `email_verified_at` is null, set it to now.
6. Issue session (§4.4).

### 4.3 Login

`POST /api/v1/auth/login {email, password}`. Handler:

1. Look up user by `email`.
2. **Equal-time path**: if user not found, perform a dummy Argon2id verify against a fixed encoded hash to equalise timing, then return `401 INVALID_CREDENTIALS`.
3. Verify password with Argon2id. On mismatch return `401 INVALID_CREDENTIALS` with the *same* message and code as case 2 — error messages MUST NOT distinguish "no such user" from "wrong password".
4. If `email_verified_at = null`, return `403 EMAIL_NOT_VERIFIED`.
5. Issue session (§4.4).
6. Update `last_login_at`, `last_login_ip`.
7. Write audit log `user.logged_in`.

### 4.4 Issuing a Session

To issue a session for user $u$ with optional parent refresh token $\rho_\pi$:

1. Mint access JWT $A$ (§3.2) with `exp = now + 15 min`.
2. Generate plaintext refresh $s_\rho \overset{\\$}\leftarrow \mathbb{B}^{32}$ (URL-safe base64).
3. Insert refresh row: $\langle h_\rho = H(s_\rho), u_\text{id}, \pi = \rho_\pi, t_i = \text{now}, t_e = \text{now} + 30~\text{days}\rangle$.
4. Set cookies:
   - `osm_access = A` with `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900`
   - `osm_refresh = s_\rho` with same flags but `Max-Age=2592000`.

### 4.5 Refresh and Reuse Detection

`POST /api/v1/auth/refresh`. Handler reads $s_\rho$ from `osm_refresh`. Algorithm:

```
ρ ← refresh_tokens WHERE token_hash = H(s_ρ)
if ρ is null OR now > ρ.expires_at OR ρ.revoked_at is not null:
    # REUSE OR EXPIRY OR REVOCATION
    if ρ exists:
        revoke_chain(ρ.user_id, ρ)
        audit(action="auth.refresh_reuse_detected", actor=ρ.user_id, ...)
    return 401 UNAUTHORIZED
mark ρ.revoked_at ← now
new_session ← issue_session(ρ.user_id, parent_id=ρ.id)
return 204
```

**Theorem (Chain Revocation).** *If an attacker captures a refresh token $\rho$, uses it once successfully (rotating to $\rho'$), and later the legitimate user presents $\rho$ again, then the entire chain of $\rho$ — every $\rho^{(i)}$ reachable by ancestors-or-descendants — is revoked, including the attacker's $\rho'$.*

**Proof sketch.** On the legitimate user's reuse of $\rho$, the row exists (we never delete on reuse, only revoke). It has `revoked_at != null` (from the attacker's successful refresh). The handler enters the "REUSE OR EXPIRY" branch and calls `revoke_chain`, which sets `revoked_at = now()` on every refresh token for that user where `revoked_at IS NULL`. After this, any future request — by the attacker or the legitimate user — that presents any descendant of $\rho$ will land in the same branch. $\square$

### 4.6 Logout

`POST /api/v1/auth/logout`. Handler: reads $s_\rho$, revokes the chain, clears both cookies via `Max-Age=-1`.

## 5. CSRF and Rate Limiting

### 5.1 CSRF (Cross-Site Request Forgery)

`GET /api/v1/csrf` returns $\{ \text{csrf\_token} \}$ and `Set-Cookie: osm_csrf=<token>; SameSite=Lax`. The token is 32 random bytes, URL-safe base64.

For any request with method $\in \{\text{POST}, \text{PUT}, \text{PATCH}, \text{DELETE}\}$ to an authenticated route:

1. If the request has `Authorization: Bearer ...`, skip CSRF (machine clients).
2. Else: require the request to carry both `osm_csrf` cookie *and* `X-CSRF-Token` header, with values matching in constant time.
3. Otherwise, return `403 CSRF_INVALID`.

### 5.2 Rate Limit (Token Bucket)

Each rate-limit class has parameters $(C, R)$ where $C$ is bucket capacity and $R$ is the steady-state refill rate (tokens per second). Each request consumes one token; if none available, the request is rejected with `429 TOO_MANY_REQUESTS` and the response carries `Retry-After: ⌈1/R⌉` seconds.

The default classes:

| Class | Key | $C$ | $R$ |
|---|---|---|---|
| auth | `ip:<remote>` | 5 | $5/60$ |
| normal | `u:<user_id>` | 100 | $100/60$ |

The implementation uses a leaky token bucket with continuous refill: at each request, $\text{tokens} \leftarrow \min(C, \text{tokens} + (\text{now} - \text{last}) \cdot R)$.

## 6. Domains and Subdomains

### 6.1 FQDN Validation

A label is valid iff it matches $[a-z0-9](?:[a-z0-9\text{-}]^{0..61}[a-z0-9])?$. A TLD is a final label matching $[a-z]^{\geq 2}$. An FQDN is one or more labels followed by a TLD, total length $\leq 253$. Case is normalised by lowercasing on ingress.

### 6.2 Domain Lifecycle

When a user creates a domain $f$:

1. Validate $f$ (§6.1).
2. Check uniqueness on `fqdn`. Conflicts return `409 DOMAIN_EXISTS`.
3. Enforce plan limit (count of user's domains < `plan.max_domains`).
4. Generate $\text{CNAME} = $ the operator's configured proxy target, $\text{TXT} = \text{TXT}(u, f)$ (§3.5).
5. Insert with `dns_status = pending`.
6. Enqueue verification.

### 6.3 DNS Verifier (Worker Loop)

The verifier maintains a queue of `domain_id`s. Periodically, every 60 seconds, plus on every enqueue, it drains the queue. For each domain:

1. `UPDATE domains SET dns_status='verifying', verification_attempted_at=now() WHERE id=? AND dns_status IN ('pending','failed') RETURNING *;`
2. Look up CNAME for $f$ via the configured resolver. If it matches the operator's target string (case-insensitive, dots-trimmed), continue; else go to step 4.
3. Look up TXT for $\texttt{\_osm.}f$. If any returned string equals $\text{TXT}(u, f)$, mark verified.
4. If we did not mark verified, look up TXT for $f$ directly. If any match, mark verified. Else mark failed.

When marking verified, also publish `domain.verified` to the user's WebSocket channel.

### 6.4 Subdomains and Binding

A subdomain is $\sigma = \langle \text{id}, f_\text{id}, p, \text{port}, d_\text{bound} \rangle$ where $p \in \Sigma$ is a label or the empty string (apex), and $d_\text{bound}$ is a `device_id` or null.

**Bind algorithm:**

```
input: (user_id, subdomain_id, target_device_id)

sd ← subdomains WHERE id = subdomain_id
domain ← domains WHERE id = sd.parent_domain_id AND user_id = user_id
if domain is null:
    return SUBDOMAIN_NOT_FOUND  // do not leak existence

device ← devices WHERE id = target_device_id AND user_id = user_id AND revoked_at IS NULL
if device is null:                              return DEVICE_NOT_OWNED
if device.last_seen_at older than 5 minutes:    return DEVICE_OFFLINE

BEGIN TRANSACTION
    UPDATE subdomains SET bound_device_id=device.id, bound_at=now() WHERE id=sd.id
    REDIS SET key=liveMapKey(domain.fqdn, sd.prefix), value=device.id, no_ttl
    if redis SET fails: ROLLBACK; return INTERNAL_ERROR
COMMIT

publish_ws(user_id, "subdomain.bound", {...})
audit("subdomain.bound", actor=user_id, target=sd.id, ...)
```

The composite Redis key is:

$$\text{liveMapKey}(f, p) = \begin{cases} \texttt{live:} ~\|~ f & p = \varepsilon \\ \texttt{live:} ~\|~ p ~\|~ \texttt{.} ~\|~ f & \text{otherwise} \end{cases}$$

**Unbind** clears `bound_device_id`, deletes the Redis key, and publishes `subdomain.unbound`. If a tunnel is currently live on the previous device, it remains open until the visitor's request times out or the proxy receives the next routing miss.

## 7. The Tunnel Wire Protocol

### 7.1 Transport

Tunnels are WebSocket connections from the desktop client to the proxy node. Each frame is one text-mode WebSocket message carrying one JSON object. Maximum WebSocket payload size: $2^{23}$ bytes (8 MiB) — but the protocol's logical body cap is 4 MiB (§7.4).

### 7.2 Frame Schema

Every frame conforms to:

```json
{
  "type": "<FrameType>",
  "stream_id": "<UUIDv4>",   // optional, present iff type is per-stream
  ...                        // per-type fields
}
```

Frame types and required fields:

| `type` | Direction | Required fields |
|---|---|---|
| `hello` | client → proxy | `device_id`, `api_key`, `version` |
| `hello_ack` | proxy → client | `node_id` |
| `request` | proxy → client | `stream_id`, `method`, `url`, `headers`, `body_b64?` |
| `response` | client → proxy | `stream_id`, `status`, `headers?`, `body_b64?` |
| `error` | either | `code`, `message`, `stream_id?` |
| `ping` | either | — |
| `pong` | either | — |
| `close` | proxy → client | `stream_id?`, `code`, `message?` |

`body_b64` is the base64-std-padding encoding of the request or response body.

### 7.3 Connection Lifecycle

1. Client opens WSS connection to `<proxy>/ws/tunnel`.
2. Within 5 seconds, client MUST send a `hello` frame. Failure → proxy sends `error{code: BAD_HELLO}` and closes.
3. Proxy POSTs `/api/v1/proxy/devices/verify` to Control Plane with $\{\text{api\_key}\}$. The Control Plane returns $\{ \text{valid}, \text{device\_id}, \text{user\_id}, \text{name} \}$.
4. If invalid, proxy sends `error{code: UNAUTHORIZED}` and closes.
5. If valid, proxy registers the tunnel in its hub. If a tunnel for this `device_id` already exists, the old one is sent `close{code: replaced}` and dropped first.
6. Proxy sends `hello_ack{node_id}`.
7. Connection remains open until either side closes or 70 s elapse without traffic in either direction.

WebSocket PING is sent by the proxy every 30 s. The client MUST respond with PONG. Application-level `ping` / `pong` frames are also accepted, sent at 60 s cadence, as defence-in-depth against intermediaries that drop WS-level pings.

### 7.4 Request / Response Pairing

When a visitor request arrives at the proxy:

1. Allocate `stream_id = UUIDv4()`.
2. Atomically register the stream in the proxy's stream registry, associated with a buffered channel.
3. Read the visitor's body bounded by 4 MiB. If exceeded, return `413 PAYLOAD_TOO_LARGE` to the visitor immediately, without forwarding.
4. Construct a `request` frame:
   ```json
   {
     "type": "request",
     "stream_id": "<id>",
     "method": "<method>",
     "url": "<request-uri>",
     "headers": { "X-Forwarded-For": ["<visitor IP>"], "X-Real-IP": ["<visitor IP>"], ... },
     "body_b64": "<base64 body>"
   }
   ```
5. Send over the tunnel.
6. Await the matching `response` frame on the stream channel, with a deadline of 30 s.
7. On `response`: write headers, status, body to the visitor.
8. On `error` for the same `stream_id`: write `502 Bad Gateway` with the error's `message` to the visitor.
9. On timeout: write `504 Gateway Timeout`.
10. Always: deregister the stream from the registry.

**Header sanitization.** Before forwarding, the proxy:
- Removes hop-by-hop headers: `Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `Te`, `Trailers`, `Transfer-Encoding`, `Upgrade`.
- Overwrites `X-Forwarded-For`, `X-Real-IP` with the visitor's remote address — never trusts what arrives on the wire for these.
- Sets `X-Forwarded-Proto` to `http` (v1) or `https` if behind a TLS terminator.

### 7.5 Holding State

If a visitor request arrives for a host whose `live:<host>` mapping points to a device whose tunnel is not currently registered in the proxy's hub:

- Return `503 Service Unavailable` with a static HTML page indicating "Reconnecting…". The page sets `Retry-After: 10`.
- Do NOT read the request body before deciding — it's wasted bandwidth otherwise.

This is the v1 holding state. v1.1 will add mid-stream splice: when a client reconnects within the grace window, in-flight visitor sockets are spliced into the new tunnel.

### 7.6 Proxy Node ↔ Control Plane Ingest

All proxy → Control Plane traffic carries `Authorization: Bearer <shared_secret>` and goes to the `/api/v1/proxy/*` routes:

| Endpoint | Method | Body | Effect |
|---|---|---|---|
| `/proxy/devices/verify` | POST | `{api_key}` | Validates api_key, returns device/user identity |
| `/proxy/tunnels/start` | POST | `{device_id, host, node_id}` | Creates a `tunnels` row, returns `{tunnel_id}` |
| `/proxy/tunnels/:id/end` | POST | `{bytes_transferred}` | Closes the tunnel row |
| `/proxy/nodes/heartbeat` | POST | `{node_id, tunnels}` | Liveness signal |

The shared secret is compared in constant time. In v1.1 this becomes per-node mTLS or per-node Bearer.

## 8. Failure Modes (Conformance Reference)

A conformant implementation MUST behave as specified in this matrix.

| Condition | Visitor sees | Operator sees |
|---|---|---|
| No `live:<host>` mapping | `502` w/ "no route" page | Audit log: nothing; logs note the miss |
| Mapping exists, no tunnel in hub | `503` w/ "Reconnecting…" page, `Retry-After: 10` | `device.offline` event eventually |
| Tunnel send buffer full > 5 s | `502` from `tunnel: send buffer full` | Tunnel closed by writePump; metric increment |
| `response` not received within 30 s | `504` | Stream cleanup; metric increment |
| Local app down (client reports error) | `502` with the `error.message` from the client | `error` frame written to per-tunnel log |
| Client api_key revoked between connect & next request | The active session continues (auth is one-shot at connect). Revoke takes effect on next reconnect. | `device.revoked` audit entry; the proxy may also be ordered to drop active tunnels in v1.1 |
| Request body > 4 MiB | `413` from proxy; body discarded; nothing sent down tunnel | Nothing |
| Two `hello`s from same `device_id` | The earlier client gets `close{code: replaced}`; the later one wins | Audit `tunnel.replaced` (v1.1) |
| Control Plane unreachable | Existing tunnels continue routing. New tunnel connects fail at `hello` verify. | Proxy logs `verify: 503`; metrics show ingest failures |
| Redis unreachable | All visitor requests get `502` (lookup fails). Tunnels stay registered in the hub. | Logs note Redis ping failures; periodic retry |

## 9. Security Properties (Formal)

Let $\mathcal{A}$ be a probabilistic polynomial-time adversary.

**P1 — Password indistinguishability under DB compromise.**
If $\mathcal{A}$ obtains a snapshot of $\mathcal{U}$, recovering a password $p$ given its stored $h_p$ requires expected time $\Omega(2^{n_p})$ for an $n_p$-bit password, modulated by Argon2id cost. With $\theta_\text{default}$, a single guess on commodity hardware (2026) is bounded below by $\approx 250~\text{ms}$, making mass dictionary attacks economically inefficient.

**P2 — JWT unforgeability.**
Given the public knowledge of the protocol but not $k_J$, $\mathcal{A}$'s probability of producing a token that the verifier accepts is bounded by HMAC-SHA-256's existential-unforgeability bound for $\mathcal{A}$'s queries.

**P3 — Refresh-token reuse triggers cascade.**
For any history in which a refresh token $\rho$ is presented twice with at least one intervening successful rotation, every refresh token in the chain of $\rho$ has $\text{revoked\_at} \neq \bot$ after the second presentation. (Proof in §4.5.)

**P4 — Domain-verification unforgeability.**
$\mathcal{A}$ without $k_\text{TXT}$ cannot produce $\text{TXT}(u, f)$ for any choice of $(u, f)$ with probability better than negligible in $|k_\text{TXT}|$, by HMAC-SHA-256 EUF.

**P5 — Cross-user data isolation.**
Every Control Plane SELECT/UPDATE/DELETE against user-scoped relations includes a `user_id = ?` predicate in the WHERE clause. No path through the API permits a user $u$ to read or modify any row where `user_id \neq u`. Verified by integration test `TestIntegration_DomainOwnership_ForbidsCrossUserAccess`.

**P6 — Algorithm-confusion immunity.**
The JWT parser's first step is asserting `tok.Method == jwt.SigningMethodHS256`. Tokens with `alg: none`, `alg: RS256`, or any other are rejected before signature verification. Verified by `TestJWT_AlgNone_Rejected`.

**P7 — CSRF protection on writes.**
For browser-mediated POST/PUT/PATCH/DELETE requests to authenticated routes, both `osm_csrf` cookie AND `X-CSRF-Token` header are required; constant-time comparison ensures presence-mismatch and value-mismatch both yield `403`. Verified by `TestSecurity_CSRF_*`.

**P8 — Login does not leak account existence.**
For any login request, the response when "no such user" is byte-identical to the response when "wrong password", and the timing distributions are equalised by an artificial Argon2id verify in the no-user branch.

**P9 — Audit append-only at the application layer.**
The audit-writer module has no function that issues `UPDATE` or `DELETE` against `audit_logs`. At the DB level, the application role's grants on `audit_logs` are restricted to `INSERT` and `SELECT`. (Enforcement is operator-configurable; the application code never expects to mutate audit rows.)

## 10. Performance Bounds

These are observed bounds from the reference implementation on commodity hardware (Apple M4 Max, 64 GiB RAM, 2026); they're not protocol guarantees, but they're useful for sizing.

| Operation | Bound (median) | Note |
|---|---|---|
| Argon2id hash (default params) | 200–500 ms | Set so a single guess is expensive |
| JWT sign + parse | < 0.5 ms | HS256 is fast |
| Redis lookup (live mapping) | < 1 ms | Hot data |
| Tunnel forwarding (small bodies) | 5–20 ms | Browser → proxy → tunnel → local app → back |
| WS reconnect after drop | 1–5 s | Exponential backoff, capped at 30 s |

## 11. Conformance Checklist

To call an implementation "osmRouter-compatible", the following MUST hold:

- [ ] Argon2id with $\theta_\text{default}$ for password hashing.
- [ ] JWT HS256 with explicit alg allowlist.
- [ ] Refresh-token rotation with reuse-cascade revoke.
- [ ] Identical login response shape for no-user vs wrong-password.
- [ ] OTP: 6 digits via rejection sampling; hashed at rest; attempt-counter; constant-time compare.
- [ ] CSRF double-submit on all browser writes.
- [ ] Per-actor rate limit with token bucket and `Retry-After` header.
- [ ] FQDN validation matching §6.1.
- [ ] HMAC TXT token matching §3.5.
- [ ] Tunnel frame format from §7.2.
- [ ] `request` / `response` pairing via per-stream `stream_id`.
- [ ] Holding-state `503` with `Reconnecting…` page for hub-miss-on-mapped-host.
- [ ] Append-only audit log row on every destructive action.
- [ ] All HTTPS responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict CSP.

## 12. Versioning

This is **Yellow Paper v1.0**. The wire-protocol version (sent in `hello.version`) is `"1"`. Backward-incompatible changes increment the major version; the proxy MUST reject `hello` frames whose major version does not match what it speaks, by sending `error{code: VERSION_INCOMPATIBLE}`.

---

## Appendix A — Reference Implementation Cross-Index

| §  | Reference implementation locator |
|---|---|
| 2.2 | `server/internal/models/models.go` |
| 3.1 | `server/internal/platform/crypto/argon2.go` |
| 3.2 | `server/internal/platform/crypto/jwt.go` |
| 3.5 | `server/internal/platform/crypto/random.go` (`DomainVerifyToken`) |
| 3.6 | `server/internal/platform/crypto/aes.go` |
| 4.x | `server/internal/auth/service.go` |
| 5.1 | `server/internal/platform/csrf/csrf.go` |
| 5.2 | `server/internal/platform/ratelimit/ratelimit.go` |
| 6.x | `server/internal/domains/`, `server/internal/subdomains/` |
| 7.2 | `proxy-node/internal/tunnel/frame.go` (canonical), `tunnel-client/internal/tunnel/frame.go` (mirror) |
| 7.3 | `proxy-node/cmd/proxy/main.go` (`makeTunnelHandler`) |
| 7.4 | `proxy-node/internal/router/router.go` |
| 8 | `proxy-node/internal/router/router.go`, `tunnel-client/internal/forwarder/forwarder.go` |

---

*The companion narrative is in the [Whitepaper](../Whitepaper/osmRouter-Whitepaper.md). The complete reference implementation, full test suite, and Obsidian vault of design decisions live in this repository.*
