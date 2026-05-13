# osmRouter Whitepaper

**Sovereign tunneling for the next billion local apps.**

*v1.0 · May 2026 · The osmRouter Project*

---

## Abstract

Every developer eventually needs to expose a local service to the public internet. Today that's done with a small set of incumbent tunneling services — ngrok, Cloudflare Tunnel, Tailscale Funnel — each of which trades convenience for control. The address you get is theirs. The TLS certificate is theirs. The DNS namespace is theirs. The routing brain is theirs. Your laptop is just a leaf.

osmRouter inverts that relationship. It is a **sovereign reverse-tunnel system**: visitors connect through a public proxy fleet you (or your organisation) control, traffic terminates inside a persistent outbound tunnel into the user's own machine, and *every layer is operated by the same entity that uses it* — no third-party SaaS in the request path. We separate the system into a **Control Plane** (auth, billing, DNS records, device locks, audit) and a **Data Plane** (the reverse-proxy fleet) so the brain stays online even when the hands restart. This paper describes the architecture, the user experience, the security posture, and the operating model.

## 1. The Problem

A handful of recurring failures with today's tunneling services:

1. **You don't own the address.** With most providers the public URL is `whatever.their-domain.com`. You can attach a custom domain on paid tiers, but the certificate and the DNS still flow through their control plane.
2. **No device locking.** If your tunnel token leaks, it can be reused anywhere. There's no first-class concept of "this domain serves traffic from *this* machine and no other."
3. **Vendor lock-in.** Moving off the provider is a project, not a config change. The tunnel protocol, the routing rules, and the SSL provisioning are all theirs.
4. **Limited residency control.** For teams in jurisdictions with data-protection acts (India's DPDP, the EU's GDPR, etc.) the lack of choice about where the proxy actually runs is a real compliance gap.
5. **Opaque failure modes.** When the tunnel drops, what the visitor sees depends on the provider — usually an unbranded error page that says "the host is offline" with no context, no retry guidance, and no operator visibility.

Each of these is solvable in isolation. None of them is solved well by any single product today.

## 2. The Vision

osmRouter is the **Sovereign Gateway**. The thesis is simple: a serious operator should be able to run the entire path from public visitor to local app on infrastructure they control, with the user experience of a hosted SaaS.

Three concrete commitments follow:

1. **Bring-your-own-domain by default, not by upsell.** Every user can attach a domain they own. DNS verification is HMAC-bound to the operator's secret, so the verification token can't be forged externally.
2. **Device-locked tunnels.** A subdomain binds to a single authenticated device. Revoke the device → traffic stops in milliseconds. Move it to a new device → one click in the dashboard.
3. **Operator-controlled data plane.** The proxy fleet is the operator's binaries on the operator's machines, in the operator's chosen regions. No third-party packet inspection between the visitor and the tunnel.

## 3. The Solution: Architecture at a Glance

osmRouter is split into two planes that talk over a thin, well-defined interface:

```
                  ┌──────────────────────┐
                  │  Control Plane       │
                  │  - Next.js dashboard │
                  │  - Go API server     │
                  │  - PostgreSQL        │
                  │  - Redis (live map)  │
                  └──────────┬───────────┘
                             │ writes routing intent
                             ▼
                  ┌──────────────────────┐
                  │  Data Plane          │
                  │  (one or more nodes) │
                  │  - public listener   │
                  │  - tunnel listener   │
                  │  - reads live map    │
                  └──────────┬───────────┘
                             │ persistent WS tunnel
                             ▼
                  ┌──────────────────────┐
                  │  Desktop tunnel-client│
                  │  + the user's app    │
                  └──────────────────────┘
```

The Control Plane is the brain. It manages users, billing, DNS records, device locks, audit logs, and the WebSocket channel that streams real-time events to the dashboard. It writes "routing intent" into Redis: a key per public hostname (`live:api.acme.com`) whose value is the `device_id` currently authorised to serve that hostname.

The Data Plane is the muscle. Each proxy node terminates visitor traffic, looks up the Redis mapping, finds the corresponding tunnel in its in-memory registry, and pipes bytes between the visitor and the desktop client across a persistent WebSocket. Proxy nodes have no opinion about who the user is or what the policy is — they just route per what Redis tells them.

The desktop tunnel-client is a single Go binary that maintains an outbound WebSocket to the proxy. It receives request frames, makes the corresponding HTTP call against the user's local app, and sends back a response frame.

**Why a Control / Data split?** Because the failure profiles are different:
- The Control Plane is OLTP-y: small writes, careful auth, audit-heavy, infrequent restarts.
- The Data Plane is throughput-y: large byte transfer, low-latency hot paths, frequent restarts during deploys, regional fanout.

Treating them as one process forces the slow concerns onto the fast path. Treating them as two lets the operator scale each independently and lets each restart without taking the other down.

## 4. Key Features

### 4.1 Frictionless DNS

Adding a domain is a two-record copy-paste. The user enters their FQDN; the dashboard generates a CNAME target (`nodes.osmrouter.net` in the hosted plan, configurable in self-hosted) and a TXT verification token. The TXT token is `osm-verify=<HMAC>` where the HMAC is computed over `(user_id, fqdn, server_secret)`. The verifier worker polls public DNS, confirms both records, and flips the domain's status to `verified`. The user gets a real-time WebSocket event the moment it lands.

### 4.2 Device Locking & "Reset Lock"

A subdomain (e.g. `app.acme.com`) binds to exactly one device. The bind is transactional: the Postgres row and the Redis key are written in a single transaction; if the Redis write fails, the Postgres row is rolled back. There's no state where the database thinks the binding happened but the routing table disagrees.

If the user wants to move the domain to a different device — broken laptop, different office, whatever — they click **Reset Lock** in the dashboard. The Postgres row is updated, the Redis key is deleted, and any active tunnel on the previous device is sent a `close{reason: "replaced"}` frame.

### 4.3 Holding State on Disconnect

When a tunnel drops — laptop closes, network flips — the proxy doesn't immediately return errors. Visitors hitting the (still-mapped) hostname receive a clean **HTTP 503 with a "Reconnecting…" page** for the first 30 seconds. The page auto-refreshes; if the client comes back during the grace window, the visitor's next request flows through normally and they may not even notice.

This is small but matters a lot in the field. Wi-Fi blips, laptop wakes, and CGNAT IP rotations are routine. Burning a request with `502 Bad Gateway` per blip would be a continuous papercut for both the operator and the visitor.

### 4.4 Real-Time Dashboard

Everything that happens in the system streams to the user's dashboard over a persistent WebSocket: DNS verification flips, devices coming online or offline, subdomains being bound/unbound, tunnels opening and closing. The dashboard is "infrastructure-tool" aesthetic — dark theme by default, OKLCH colour palette, mono numerics — but ports cleanly to a light theme.

### 4.5 Admin Command Center

For operators running osmRouter for a customer base or internal teams, the Admin role unlocks:
- A live network overview (online devices, verified domains, total active tunnels)
- Paginated user search with full dossier (devices, domains, recent audit log entries)
- **Impersonation** — issuing a short-lived JWT with an `impersonated_by` claim. Every action under impersonation is double-audited (actor + target).
- Append-only audit log of every destructive action across the whole system.

### 4.6 Audit Log

Every destructive action — user created, password changed, refresh token reused, device revoked, subdomain bound, admin impersonates — writes a row to the `audit_logs` table. The table is structured so the application role can only `INSERT` and `SELECT`; there's no `UPDATE` or `DELETE` granted. Tampering with the audit trail requires direct DB-superuser access, which is monitored separately.

## 5. Security Posture

osmRouter's security architecture is the subject of a separate document (the Yellow Paper). The summary version, mapped to the threats they address:

| Threat | Control |
|---|---|
| Stolen password | Argon2id at rest (m=64MB, t=3, p=4, 32-byte key), constant-time verify |
| Stolen session cookie | JWT access tokens limited to 15 minutes; refresh rotation chain that detects re-use and revokes the entire chain |
| Cross-site request forgery | Double-submit token, HttpOnly+SameSite=Lax cookies, strict CORS allow-list |
| Credential stuffing / brute force | Per-IP token-bucket rate limit on auth routes (5/minute) |
| Forged DNS verification | HMAC token bound to operator's secret — unforgeable without it |
| Tunnel hijack | Device API key validated server-side at every tunnel connect; revoke is single-click |
| Algorithm confusion (alg=none) | Explicit allowlist of `HS256` only; alg=none JWTs rejected |
| Cross-user data leakage | Every database query scopes by actor `user_id`; integration-tested |
| TLS downgrade | TLS 1.3 at the edge (Cloudflare for SaaS in the hosted plan); proxy nodes require WSS in production |

We assume Zero-Trust: the public internet is hostile, the user's local network is compromised, any one proxy node could be intercepted. Every layer is designed so a compromise at one boundary does not compromise the others.

## 6. Use Cases

osmRouter's primary persona is a developer who wants production-shaped public hostnames for things running on their machine — but it generalises.

- **Demo links.** A `demo-acme.com` that's *always* you, regardless of which Wi-Fi you're on.
- **Hardware in the field.** A retail kiosk in a CGNAT'd shopping mall can serve its admin dashboard over `kiosk-3.your-domain.com` without the franchise needing a public IP.
- **IoT control panels.** A 3D printer's web UI, a home media server, a Pi running a side project — all accessible at a domain you own, without poking holes in routers.
- **Sovereign-compliance hosting.** Self-hosted on infrastructure in the right region. The data plane is yours; nothing leaves jurisdiction.
- **Internal-network bridges.** Connect an internal staging server to a public verifiable URL for a partner integration, then revoke in one click when the engagement ends.

## 7. Comparison to Alternatives

|  | osmRouter | ngrok | Cloudflare Tunnel | Tailscale Funnel | FRP (self-host) |
|---|---|---|---|---|---|
| Custom domain on free tier | ✓ | — | ✓ | partial | ✓ |
| Operator-controlled proxy fleet | ✓ | — | — | — | ✓ |
| Device locking by default | ✓ | — | — | partial | manual |
| Built-in dashboard | ✓ | ✓ | ✓ | ✓ | — |
| Admin / multi-tenant out of the box | ✓ | ✓ | ✓ | — | — |
| Holding state on disconnect | ✓ | ✓ | partial | — | — |
| Audit log | ✓ | ✓ | ✓ | partial | — |
| Self-hostable end-to-end | ✓ | — | — | — | ✓ |

The honest summary: **osmRouter sits between ngrok-style polish and FRP-style sovereignty.** You get the dashboard, the auth, the audit trail, the device locks, and the holding state — but every byte of the request path is your binary on your machine.

## 8. Operating Model

osmRouter is delivered as four artefacts that can run independently:

1. **`server/`** — Control Plane API (one Docker image, ~80 MB)
2. **`web/`** — Next.js dashboard (one Docker image, ~250 MB)
3. **`proxy-node/`** — fleet node (one Docker image, ~30 MB)
4. **`tunnel-client/`** — desktop binary (single 12 MB Go binary, macOS / Windows / Linux)

A reasonable production deployment runs one Control Plane (with a DB cluster and a Redis cluster), N proxy nodes across the regions you care about, and the dashboard behind whatever CDN you already use. The desktop binary is the only artefact that goes to end users.

For demos and small teams, all four run on a single host. The `scripts/demo_live.sh` script in this repository spins up the full stack in under a minute on a developer Mac.

## 9. Roadmap

**Shipped (v1.0 — what this paper describes):**
- Full Control Plane with auth, OTP, JWT rotation, CSRF, rate limiting, audit log
- Full dashboard (marketing, auth, user app pages, admin)
- Data Plane proxy node with WebSocket tunnel
- Desktop tunnel-client
- End-to-end demo (`scripts/demo_live.sh`) and cross-boundary demo (`scripts/docker_remote_laptop_demo.sh`)

**v1.1 — Hardening (next):**
- Real Cloudflare-for-SaaS integration (auto-provision SSL for custom domains)
- Stripe billing wired through the plans table
- WebAuthn for admin MFA
- Per-node mTLS for proxy → Control Plane communication
- Tunnel-ingest wiring: the `tunnels` table populated for every connection, so `bytes_transferred` and `active_tunnels` are real numbers
- Streaming response bodies through the tunnel (currently buffered, 4 MB cap)
- "Mid-stream splice" reconnect: visitors don't even see the holding-state page on transient client blips

**v2.0 — Scale (later):**
- Anycast / GeoDNS for proxy node selection
- gRPC + HTTP/2 frame transport (current is WebSocket + JSON — same wire shape but more debuggable)
- Read replicas with automatic leader promotion
- Per-proxy-node observability dashboards
- Cross-region failover with sub-60-second cutover

## 10. Conclusion

The goal of osmRouter is not to be cleverer than ngrok. It's to make a kind of infrastructure that until now has been "either polished-and-not-yours or yours-and-not-polished" feel like both. Same dashboard quality, same auth flows, same uptime guarantees — but every layer is operated by the same hands that use it.

This whitepaper has described the product surface; the Yellow Paper describes the protocol formally. The reference implementation in this repository is small enough that a single developer can read it end-to-end in a weekend and large enough that a real team can run a real production load on it.

The web doesn't need to be more centralised. We're building osmRouter on the bet that, given a credible alternative, a lot of developers would prefer to keep their own keys.

---

*For the formal technical specification — wire protocol, state-transition functions, cryptographic parameters, formal security claims — see the companion [Yellow Paper](../Yellow%20Paper/osmRouter-Yellow-Paper.md).*

*The full source, tests, deployment artefacts, and an Obsidian vault of design decisions live in this repository.*
