# Screenshot Analysis — Live Stack Walkthrough

Captured 2026-05-12 from the live `./scripts/demo_live.sh` stack:
- **In Docker** (Linux containers): Redis, Control Plane API, proxy node, Next.js dashboard
- **On the Mac (host)**: the to-do app + `osmrouter-client`
- **Browser/visitor**: hits `app.todo.localtest.me:8000` → reaches the Mac's to-do app via the tunnel

Each screenshot is at viewport 1440 × 900 in dark mode unless noted.

## Index

| # | File | Page |
|---|---|---|
| 01 | `01-marketing-landing.png` | Marketing landing (full-page) |
| 02 | `02-signup-empty.png` | Signup, empty state |
| 03 | `03-signup-filled.png` | Signup, with strong password meter |
| 04 | `04-verify.png` | OTP verify |
| 05 | `05-login.png` | Login |
| 06 | `06-dashboard.png` | User dashboard (full-page) |
| 07 | `07-domains.png` | Domains list (full-page) |
| 08 | `08-domain-details-modal.png` | DNS records modal (CNAME + HMAC TXT token) |
| 09 | `09-devices.png` | Devices list (full-page) |
| 10 | `10-billing.png` | Billing (placeholder) |
| 11 | `11-settings.png` | Settings (placeholder) |
| 12 | `12-admin-overview.png` | Admin network overview (full-page) |
| 13 | `13-admin-users.png` | Admin user list w/ impersonate (full-page) |
| 14 | `14-admin-network.png` | Admin network stats |
| 15 | `15-admin-plans.png` | Admin plans (placeholder) |
| 16 | `16-admin-audit.png` | Admin audit log (full-page) |
| 17 | `17-todo-direct-mac.png` | To-Do app accessed directly on Mac (`localhost:3100`) (full-page) |
| 18 | `18-todo-via-proxy.png` | **To-Do app accessed via proxy + tunnel** (`app.todo.localtest.me:8000`) (full-page) |
| 19 | `19-light-mode-marketing.png` | Marketing in light theme (full-page) |
| 20 | `20-light-mode-dashboard.png` | Dashboard in light theme (full-page) |

## Pass / Concern / Break

### ✓ Passes

- **Design system fidelity** — the live Next.js port matches the JSX prototype's visual language: OKLCH dark/light themes, Inter + JetBrains Mono, infrastructure-tool aesthetic with subtle borders and accent-blue affordances. Spacing, padding, radii, and component proportions are tight across every screen.
- **Auth flow renders correctly** — signup form has a 4-bar password strength meter that fills in real-time; OTP screen has 6 distinct digit boxes with focus rings; the "marketing-side panel" gradient on auth screens is visually balanced.
- **Domains DNS-records modal** is one of the strongest screens — clearly labelled CNAME / TXT, copy buttons, "Verify now" CTA, and the actual HMAC-bound TXT token visible.
- **To-Do app via proxy** (screenshot 18) is the headline result. It shows:
  - Banner: `Served by M4-Max-MacBook-Pro.local · port 3100` — proving the response really came from the Mac
  - 4 todos including one I added via curl through the proxy
  - **Latency: 18 ms** end-to-end through the chain (browser → Docker proxy → WebSocket tunnel → Mac → Python server)
  - Same visual content as screenshot 17 (direct on Mac) — proving fidelity is preserved across the tunnel
- **Admin panel** — "Admin" badge in sidebar, distinct ADMIN nav group, working `Switch to user` button at the bottom. Impersonate button visible on the user row.
- **Audit log** populates with the bootstrap actions (user.created, device.created, domain.created, subdomain.bound, etc.).
- **Light mode** (19, 20) — every component re-renders cleanly with the light palette; no inverted text, no broken contrast.

### ⚠ Concerns — real feature breaks

These came out of the live demo. They aren't visual bugs, they're missing behaviour.

#### B1. The `tunnels` table is never populated

**Where:** dashboard shows `Active tunnels: 0` and `Bytes routed: 0`. Admin overview shows `Active tunnels: 0`.

**Why:** the proxy node's WebSocket handshake handler logs `tunnel up` to stdout, registers the tunnel in the in-memory hub, **but never calls `ingest.TunnelStarted` to record a row in the `tunnels` Postgres table**. The ingest endpoint exists, the client method exists — they're not wired together. Same for `TunnelEnded` on disconnect.

**Impact:** every dashboard counter that reads from `tunnels` (active tunnels, total bytes, admin overview's active_tunnels) is permanently 0 even when traffic is flowing. The WS event `tunnel.opened` that the Control Plane is supposed to push to the user dashboard is also never emitted (since it fires inside `TunnelStart`).

**Fix:** in `proxy-node/cmd/proxy/main.go`'s `makeTunnelHandler`, after `hub.Register(tn)`, call `ing.TunnelStarted(ctx, deviceID, "")` and remember the tunnel_id; on `readPump` return, call `ing.TunnelEnded(ctx, tunnelID, 0)`. Bytes counter requires the proxy router to atomically increment a counter per stream and flush periodically — straightforward extension.

#### B2. Devices go "offline" 90 s after the only heartbeat

**Where:** dashboard recent devices section shows the demo MacBook as `offline`, and the devices page shows the same. But the device is *actively serving the to-do app right now* through the proxy.

**Why:** the demo script sends one heartbeat at bootstrap. The tunnel-client doesn't send periodic heartbeats. The Control Plane's offline-sweeper marks devices offline after 90 s without a heartbeat.

**Fix (two options, additive):**
1. Have the tunnel-client send a periodic heartbeat with `Authorization: Bearer <api_key>` (it has the key).
2. **Better:** infer online status from "currently has an active tunnel registered in some proxy node's hub". This needs the proxy ingest's heartbeat to include the list of currently-connected device_ids, and the Control Plane to consider those online regardless of last-seen.

#### B3. The DNS verifier flips manually-set "verified" back to "failed"

**Where:** the domains list shows `todo.localtest.me` as `failed`, even though the demo script ran `UPDATE domains SET dns_status='verified'` after creating it.

**Why:** the in-process verifier worker sweeps `WHERE dns_status IN (pending, failed)`. Once we manually set it to `verified`, the verifier should leave it alone — and it does. BUT: when we first created the domain (status=pending), the verifier picked it up, looked up the CNAME for `todo.localtest.me`, didn't match `nodes.osmrouter.demo`, flipped it to `failed`. Then our SQL UPDATE happened — but the verifier *also re-runs every 60 s*, and on its next sweep it picked the row up again (still in `failed`), re-tried, failed again. There's a race between the manual UPDATE and the worker's next sweep.

**Fix:** include the row's `updated_at` in the verifier's "claim" query, or just skip rows the user has manually approved (add a `verified_manual: bool` column).

### ℹ Minor / cosmetic

- **Signup page autocomplete**: Chrome's DOM warning recommends `autocomplete="current-password"` and similar attributes on the password inputs. Worth adding.
- **Activity feed on dashboard** says "Live events appear here as they happen" but the channel is wired and emitting (or *would* emit if B1 were fixed). After fixing B1 we should bind a real subscription to render this feed.
- **Admin Users → Impersonate button** is visible but clicking it is currently a no-op in the UI (backend endpoint exists; the click handler hasn't been wired to swap session).
- **Devices "last seen"** shows local-time formatted dates with seconds — fine for an ops UI, but inconsistent with the mono / faint-color treatment elsewhere; could use a relative-time component ("5 minutes ago").

## What screenshot 18 proves end-to-end

The single most important screenshot is #18. It demonstrates:

```
Browser (puppeteer-Chrome)
   │ GET http://app.todo.localtest.me:8000/
   ▼
[ Docker container: osm-proxy ]
   │ Host: app.todo.localtest.me → Redis lookup
   │ → device_id (the Demo MacBook)
   │ → tunnel in hub
   │ → frame{ request, stream_id }
   ▼
[ Mac host: osmrouter-client ]
   │ → fetch http://localhost:3100/
   ▼
[ Mac host: python3 server.py ]
   │ ← response (HTML + status + headers)
   ▼ frame{ response, stream_id, body_b64 }
[ Docker container: osm-proxy ]
   │ ← decode → write to visitor
   ▼
Browser renders: "Served by M4-Max-MacBook-Pro.local · port 3100"
```

That hostname `M4-Max-MacBook-Pro.local` is the Mac's `hostname` — confirms the response originated outside the Docker network, on the host machine.

Latency in the bottom right of the to-do app card is **measured by the browser**: `performance.now()` before fetch → after fetch. The 18 ms it reports is the *full* round trip: browser → Docker proxy → WS frame to client → HTTP localhost → response back → frame back → browser writes.

---

## v2 — Option D (Session 5)

The v2 architecture replaces WebSocket+JSON frames with pinned-TLS + role-inverted HTTP/2. Captured one composite evidence shot rather than 23 individual screens, because the dashboard / admin / marketing / signup surfaces are unchanged from v1 — what's different lives in the wire protocol and the LLM streaming behaviour, neither of which screenshots well in isolation.

| # | File | Page |
|---|---|---|
| 24 | `v2/24-v2-live-evidence.png` | Composite: architecture diagram + live `curl -N` SSE output (Ollama `qwen2.5:0.5b` streaming "count from 1 to 10" through the tunnel in 654 ms) + cloud-proxy stdout log + Mac-sidecar stdout log, captured from the running stack |

### What this screenshot proves

1. **A real visitor `curl`** hits the cloud proxy at `https://ollama.localtest.me:8000/api/generate`, requesting SSE stream output.
2. **The cloud proxy** (in Docker) looks up the host in its in-memory Registry, finds the live `*http2.ClientConn` for that hostname, forwards the request over it. `FlushInterval = -1` makes each chunk pass through immediately rather than batching.
3. **The Mac sidecar** receives the request over its inbound HTTP/2 server (same TLS conn), validates the Host header against `--domain` (S7.4), forwards to `http://127.0.0.1:11434` (Ollama).
4. **Ollama** emits one JSON line per token on its SSE stream.
5. **The sidecar's** `localHTTPClient` (no wall-clock Timeout, 64 KiB read buffer) reads each line and the h2 server writes it back over the tunnel.
6. **The cloud proxy** flushes each chunk to the visitor as it arrives.

The trace shows ~15 ms latency per chunk between Ollama emitting and the visitor browser receiving — exactly what we'd want for a token-streaming AI workload.

### Same path validated for two more workloads

- **LM Studio** on `:1234` running `qwen3.6-35b-a3b-claude-4.7-opus-abliterated-mlx` — a 35B-parameter reasoning model. The tunnel streams both `<think>...</think>` reasoning tokens and the visible answer tokens chunk-by-chunk, no buffering. Long inferences (>30 s) survive because the v0.1 `Client.Timeout: 30s` was removed in the tune; only the visitor's context cancellation can end the stream.
- **To-do app** on `:3100` — same fidelity as v1's screenshot 18, but over the new wire protocol. ~17 ms end-to-end (one extra ms vs v1, swallowed by the TLS+H2 overhead).

All three ran simultaneously from the same Mac through three separate sidecar processes bound to three different subdomains under the same verified domain.

### Pass / Concern (v2 only)

#### ✓ Passes
- Pinned TLS handshake: corporate / state MITM with a "trusted" intermediate cannot break in (proven by deliberately injecting a Charles Proxy with its CA in the system trust store → handshake fails closed with `tls-handshake: certificate signed by unknown authority`).
- Streaming chunking: no buffering on the proxy side; SSE chunks arrive within ~15 ms.
- Long inference: 90-second inference completes cleanly; old v1 wall-clock would have killed it at 30 s.
- Host-binding bug fix (label-split iteration) verified: requests for `app.todo.localtest.me` route to the right device; requests for an unbound `random.localtest.me` get rejected with `HOST_NOT_BOUND` (404) at register time.

#### ⚠ Concerns
- The dashboard's "Active tunnels" counter is still the v1 schema — it would need a small update to subscribe to the v2 proxy's per-register WS event. Same root cause as v1 §B1.
- Telemetry from the sidecar is unchanged — we now stream over a different wire but the JSON-line events the Electron Main process reads are identical. UI screens that depend on those events are intact.
- No new screenshots needed for the dashboard / admin / marketing — they look identical to screenshots 06, 07, 12, 19 because the Control Plane surface didn't change.
