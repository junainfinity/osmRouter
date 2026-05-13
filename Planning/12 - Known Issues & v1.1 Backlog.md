# 12 — Known Issues & v1.1 Backlog

> Single source of truth for what's broken or missing in v1.0, mapped to fix locations and priority. Surfaced from live UI review in Session 3 (see `Screenshots/00 - Screenshot Analysis.md`) and the deferred-items list in `Planning/04`.

## Severity scale

- **🔴 Critical** — blocks core flow or has a security implication
- **🟠 High** — visible to users, blocks a "nice to demo" moment, no security impact
- **🟡 Medium** — visible only to operator / power users
- **⚪ Low** — cosmetic or future-proofing

## 🟠 B1 — `tunnels` Postgres table never populated

**Symptom.** Dashboard's *Active tunnels* counter and *Bytes routed* total are stuck at 0 even when traffic is actively flowing through the proxy.

**Root cause.** The proxy node's WebSocket handshake handler logs `tunnel up`, registers the tunnel in the in-memory hub, and starts pump goroutines — but never calls `ingest.TunnelStarted()` to record a row in the `tunnels` Postgres table. Same for `TunnelEnded` on disconnect. The endpoint exists (`POST /api/v1/proxy/tunnels/start`), the client method exists (`ingest.Client.TunnelStarted`), they're just not wired together.

**Fix locator.** `proxy-node/cmd/proxy/main.go` → `makeTunnelHandler`. After the existing `h.Register(tn)` line:

```go
tunnelID, err := ing.TunnelStarted(r.Context(), res.DeviceID, r.Host)
if err != nil { logger.Warn("ingest tunnel start", "err", err) }
defer func() {
    if tunnelID != "" {
        _ = ing.TunnelEnded(context.Background(), tunnelID, /* TODO bytes */ 0)
    }
}()
```

Tracking byte counters requires a small atomic counter per stream + a flush on the heartbeat path. Acceptable to ship the "rows exist + start/end timestamps work, bytes = 0" version first; iterate.

**Effort.** ~30 minutes for the row-write portion, ~1 hour with byte counters.

## 🟠 B2 — Devices show offline 90 seconds after the only heartbeat

**Symptom.** A device that's actively serving traffic via the tunnel shows `offline` in both the user dashboard and the admin user list.

**Root cause.** The demo bootstrap script sends one heartbeat at startup. The tunnel-client itself does not send periodic heartbeats. The Control Plane's offline-sweeper marks `is_online = false` for any device whose `last_seen_at` is older than 90 s.

**Fix locator.** Two complementary fixes:

1. *Client side.* `tunnel-client/internal/client/client.go` → in `connectAndPump`, add a goroutine that sends `POST /api/v1/devices/heartbeat` with `Authorization: Bearer <api_key>` every 30 s. Stop on ctx cancel.
2. *Server side (better).* Infer online status from "currently has a registered tunnel in some proxy node's hub". This requires the proxy ingest's `nodes/heartbeat` to include the list of currently-connected `device_id`s, and the Control Plane to OR that with the `last_seen_at` check.

Doing both means clients reconnecting against a different proxy node still appear online while in transit.

**Effort.** Client-side fix: 15 minutes. Proxy-driven inference: 1–2 hours.

## 🟡 B3 — DNS verifier can race a manually-set "verified" back to "failed"

**Symptom.** Run `UPDATE domains SET dns_status='verified' WHERE …` from psql (e.g., during a demo). Two minutes later the row is back to `failed`.

**Root cause.** The verifier worker sweeps `WHERE dns_status IN ('pending', 'failed')` every 60 s. If the worker happened to be mid-attempt when the manual UPDATE landed, the worker's later `MarkFailed` call wins. Even without the race, the worker keeps re-trying failed rows; nothing tells it "this one is human-approved, leave it alone."

**Fix locator.** Two options, additive:

1. Add a boolean column `verified_manual` to `domains`. Update verifier's claim query to exclude rows with it set: `WHERE dns_status IN (...) AND verified_manual = false`.
2. Verifier should only flip `verifying → verified` or `verifying → failed`, never `verified → failed`. Add `AND dns_status != 'verified'` to the `MarkFailed` query.

**Effort.** ~30 minutes for option 2 alone.

## 🟠 B4 — No streaming response bodies through the tunnel

**Symptom.** A customer hosts a file-download endpoint behind their tunnel. Files > 4 MB fail with `error{code: RESPONSE_TOO_LARGE}` on the proxy side. Server-Sent Events and progressive streaming responses likewise don't work.

**Root cause.** v1.0 wire protocol buffers the full response body before sending the `response` frame. Hard-coded cap at `tunnel.MaxBodyBytes = 4 MB`.

**Fix locator.** Protocol-level change:

- Introduce `response_start` + `response_chunk` + `response_end` frames in `proxy-node/internal/tunnel/frame.go` (and the canonical-mirror in `tunnel-client/`).
- Update the proxy router to write headers from `response_start`, stream `response_chunk` bodies, finalize on `response_end`.
- Update the tunnel-client forwarder to read the local response body in chunks and emit per-chunk frames.

**Effort.** ~1 day. Coverage: increases the addressable use cases dramatically (file hosting, dashboards with SSE, video streaming).

## 🔴 B5 — Single shared proxy-node Bearer secret

**Symptom.** Every proxy node uses the same `OSM_PROXY_NODE_SECRET` to authenticate to the Control Plane. Compromise of any node leaks the secret. Rotation requires a coordinated update across the fleet.

**Fix locator.** Replace the single shared secret with per-node credentials:

- *Option A — mTLS.* The Control Plane issues a unique TLS client certificate to each proxy node at provisioning time. The Control Plane's proxy-ingest router verifies the cert's SAN against a `proxy_nodes` table.
- *Option B — per-node API keys.* Add a `proxy_nodes` table with hashed keys (same pattern as `devices`). The proxy node sends its key in the Bearer header; the middleware looks it up.

Option B is simpler; Option A is more secure.

**Effort.** Option A: 1–2 days (PKI / certificate management). Option B: ~half a day.

## 🟠 B6 — No real email sender wired

**Symptom.** Production deployments with `OSM_DEV_EXPOSE_OTP=false` (correct setting) cannot complete the signup flow — the OTP code is generated and stored hashed, but never reaches the user. Operators must wire SMTP or a transactional-mail API themselves.

**Fix locator.** Three places in `server/internal/auth/service.go`:

- `Register()` — sends signup OTP
- `passwordResetRequest()` (not yet implemented) — sends reset OTP
- `sensitiveOpRequest()` (not yet implemented) — sends re-auth OTP

Define an interface `EmailSender` with one method `Send(ctx, to, subject, body) error`. Provide three implementations: SMTP (via `net/smtp`), HTTP webhook (calls a configurable URL), and a no-op `LogSender` for dev. Pick at startup based on env vars.

**Effort.** ~2 hours.

## 🟠 B7 — PKCE device-code endpoints not built

**Symptom.** The desktop client (when shipped to end users) must authenticate against the Control Plane via the PKCE flow described in PRD §4.2. The DB schema for this exists (`device_codes` table, model in `internal/models/`), but the four HTTP endpoints aren't wired:

- `POST /api/v1/device-codes` — desktop initiates flow
- `GET /web/auth/device?user_code=...` — browser sees "Allow this device?"
- `POST /api/v1/device-codes/:user_code/approve` — browser approves
- `POST /api/v1/device-codes/exchange` — desktop exchanges for api-key

Currently the operator hands customers an api-key from the dashboard manually.

**Fix locator.** New `server/internal/auth/device_code.go` + handlers + dashboard `/auth/device` page.

**Effort.** ~1 day.

## ⚪ B8 — Frontend impersonate button is a UI no-op

**Symptom.** Admin clicks "Impersonate" on a user row — nothing happens.

**Fix locator.** The backend endpoint `POST /api/v1/admin/users/:id/impersonate` works (returns a short-lived JWT with `impersonated_by` claim). The UI button in `web/app/(admin)/admin/users/page.tsx` doesn't wire a click handler.

**Effort.** ~30 minutes — call the endpoint, swap the access cookie, redirect to `/dashboard`, show the impersonation banner from the AppShell.

## ⚪ B9 — Subdomain bind/unbind UI not built

**Symptom.** After verifying a domain, users have no way through the dashboard to create a subdomain and bind it to a device. The backend works (the demo script does it via curl); the UI doesn't.

**Fix locator.** New page `web/app/(app)/domains/[id]/page.tsx` showing the domain's subdomains with bind/unbind controls.

**Effort.** ~3–4 hours.

## ⚪ B10 — Live "Active tunnels" panel not subscribed to WS events

**Symptom.** The dashboard's activity feed says "Live events appear here as they happen" but doesn't render any. The backend emits `tunnel.opened`, `tunnel.closed`, `domain.verified`, `subdomain.bound` etc. The frontend's `useRealtime` hook is wired, but only the `dashboard/page.tsx` consumes it for toast notifications.

**Fix locator.** Bind a real subscription in the Activity card on the dashboard. After fixing B1 the events would actually fire, so this is a B1-blocked nice-to-have.

**Effort.** ~1 hour after B1.

## v1.1 Backlog Summary

Priority for a v1.1 sprint:

| # | Priority | Effort | Why first |
|---|---|---|---|
| B6 | 🔴 must-have for public launch | 2 hr | Without email, public signups don't work |
| B5 | 🔴 prod hardening | 0.5–2 days | Single shared secret is a real risk |
| B1 | 🟠 high-value | 1 hr | Restores the "Active tunnels" + bytes counters everyone will check first |
| B2 | 🟠 high-visibility | 0.25 day | Devices showing offline while serving traffic is confusing |
| B7 | 🟠 high — gating desktop GA | 1 day | Manual api-key copy-paste is painful |
| B3 | 🟡 medium | 0.5 hr | One-line query change |
| B9 | 🟡 medium UX gap | 0.5 day | Today users can't manage subdomains from the dashboard |
| B8 | ⚪ low | 0.5 hr | Endpoint works, just needs to be wired |
| B4 | 🟠 enables new use cases | 1 day | Streaming unlocks file hosting + SSE |
| B10 | ⚪ depends on B1 | 1 hr | After B1 |

Total v1.1 budget: ~5 working days for one engineer.
