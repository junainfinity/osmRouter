# 03 — Data Plane Threat Model

> Same STRIDE method as `01 - Threat Model.md`. Scope: proxy node + tunnel client + the new Control Plane ingest endpoints.

## Threats

| # | Threat | Asset | Vector | Mitigation |
|---|---|---|---|---|
| DT1 | **S**poofing | Proxy node identity | Attacker calls Control Plane ingest endpoints pretending to be a proxy node | Bearer `OSM_PROXY_NODE_SECRET` required; v1.1 → per-node TLS certs |
| DT2 | **S**poofing | Tunnel client identity | Attacker connects WS with stolen device api_key | api_key validated against Argon2-hashed-at-rest record at Control Plane; revoke device → all future verifies fail |
| DT3 | **T**ampering | Visitor request in transit | MITM on proxy ↔ client tunnel | All proxy↔client traffic MUST be `wss://` in prod (TLS). Dev allows `ws://` only for loopback. |
| DT4 | **T**ampering | Visitor response | Malicious client injects fake response | Trust boundary: the device owner controls the response — if they're malicious to their own visitors, that's their app, not osmRouter's responsibility. We log and forward verbatim. |
| DT5 | **R**epudiation | Tunnel events | "I never opened that tunnel" | Tunnel lifecycle (open, close, bytes) recorded in `tunnels` table; immutable audit entries for `tunnel.opened`, `tunnel.closed`, `tunnel.replaced` |
| DT6 | **I**nformation disclosure | api_key in transit | api_key sent in `hello` frame over WS | TLS in prod (mandatory). Plus: only sent once per WS connection (not per-request); never logged. |
| DT7 | **I**nformation disclosure | Request bodies in proxy memory | Sensitive request bodies sit briefly in proxy RAM | Documented. Proxy is treated as a trusted intermediary — same trust model as any reverse proxy. v1.1 may add end-to-end encryption (visitor→client TLS w/ pass-through), out of scope. |
| DT8 | **D**enial of service | Proxy node | Open thousands of WS, never `hello` | 5s deadline on `hello`; per-IP WS connect rate-limit; max connections cap |
| DT9 | **D**enial of service | Local app behind tunnel | Spam requests at public URL | Client-side rate limit (out of scope v1); Cloudflare WAF in prod absorbs volumetric attacks |
| DT10 | **E**levation of privilege | Cross-user via stream collision | Stream-id from user A's request matches B's response | UUIDv4 stream IDs (122-bit entropy). Collision probability vanishingly low. Plus: hub keys streams by `(tunnel, stream_id)` pair, not stream_id alone. |
| DT11 | **E**levation of privilege | Forge headers | Client sends fake `X-Real-IP` to proxy in response | Headers from response are forwarded to visitor; visitor's IP is fixed by proxy via overwrite of `X-Forwarded-For`/`X-Real-IP` on the inbound side, never overwritten on outbound. Headers in response are client's own UX choice. |
| DT12 | **E**levation of privilege | Replay tunnel `hello` | Capture a `hello` frame, send it from another machine | api_key in the `hello` frame, but only over TLS (DT3). Plus: Control Plane verify call is single-use; the proxy maintains the connection state, not the client. Reconnect from a stolen api_key works (same as any Bearer), so revocation in Control Plane is the kill switch. |

## Trust Boundaries

```
[ Visitor (untrusted) ]
        │ HTTP(S)
        ▼
[ Cloudflare WAF (semi-trusted) ]
        │ HTTPS, X-Forwarded-For sanitized
        ▼
[ Proxy node (trusted: osmRouter operator) ]
        │ wss:// + api_key auth
        ▼
[ Desktop client (trusted: device owner) ]
        │ HTTP localhost
        ▼
[ Local app (trusted: device owner) ]
```

The proxy node and Control Plane are both run by the osmRouter operator (the company). Anything between them is internal. Everything below the desktop client belongs to the user.

## Logging that's safe
- Tunnel WS open/close: device_id, user_id, remote_addr → log INFO
- Tunnel forward: stream_id, method, URL host, status code, byte count, duration → log INFO
- Request bodies: NEVER logged
- Response bodies: NEVER logged
- api_key, password, refresh_token, csrf_token: NEVER logged (redaction filter)

## v1 limitations (documented, not solved)

1. Single `OSM_PROXY_NODE_SECRET` shared across all proxy nodes
2. Plain `ws://` permitted in dev for loopback only (CLI warns)
3. No end-to-end encryption (visitor → desktop client) — proxy can read all traffic by design
4. No streaming response bodies (4MB buffered cap)
5. No rate limiting on per-domain visitor traffic at proxy level (Cloudflare handles)
