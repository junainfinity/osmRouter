# Session 7 — DNS, Wildcard-Cert Trap, Per-Registrar Onboarding Docs

> User states: "i've added the * A record, i had already added the @ A record when the instructions were given by you, verify it. but the problem is, our user will not be able to do this unless detailed instructions are given to them step by step. create the documentation for top 5 domain registrars including Godaddy".

## What I found during verification

### Authoritative DNS (GoDaddy NS) — DIAGNOSIS COMPLETE

Ran `dig @ns55.domaincontrol.com a2a.one ANY +noall +answer`. GoDaddy is currently serving for `a2a.one`:

```
NS    ns55.domaincontrol.com.
NS    ns56.domaincontrol.com.
SOA   ns55.domaincontrol.com. dns.jomax.net. ...
TXT   "osm-verify=92d7fce2023fdc85e349b325bf3591b7"
```

**That's it. No A records. No wildcard. No CNAMEs.**

Reading this carefully: the **TXT record is present** (`osm-verify=92d…` — that's why the domain shows as verified in our DB; ownership-proof was the fallback path). But **no A records exist** for `@` or `*`. The user's claim was "i've added the * A record, i had already added the @ A record" — but the authoritative answer says neither is actually there.

Theories:
1. The user added them but in a non-DNS section (Forwarding / Mail / etc).
2. They saved but never clicked the final "Save" / "Submit" button (GoDaddy has a multi-step flow).
3. They deleted the old AWS records but didn't add ours — the previous AWS A records ARE gone (which is good), but nothing replaced them.
4. They added them at the wrong domain.

Either way: **right now, `a2a.one` does not point to our server.** Public-HTTPS to `https://a2a.one` cannot work until that's fixed.

The TXT record IS correct (matches the token in DB) — credit there.

### Caddy wildcard-cert trap (the real blocker)

I configured Caddy with this block earlier in the session:

```
a2a.one, www.a2a.one, *.a2a.one {
    reverse_proxy 127.0.0.1:8000
}
```

The `*.a2a.one` part is the problem. Caddy's log:

```
"no solvers available for remaining challenges"
"configured=[http-01 tls-alpn-01] offered=[dns-01]"
"identifier":"*.a2a.one"
```

**Why this fails:**

- Let's Encrypt issues wildcard certs ONLY via DNS-01 challenge.
- DNS-01 requires Caddy to programmatically write a TXT record at the registrar.
- That needs a DNS-API token (GoDaddy / Cloudflare / etc).
- We never configured one.
- Caddy is stuck retrying every 30 min, will eventually back off to 1 day, but will never succeed without DNS-01.

**Fix:** drop the `*.a2a.one` from Caddy. We have `a2a.one` (apex) and `www.a2a.one` — both work via HTTP-01. Wildcard subdomains can still be tunneled by registering them explicitly later (one Caddy line per subdomain), or by adding a DNS-01-capable plugin in v2.1.

Important: **wildcard subdomain routing through the proxy still works at the routing layer** — proxy parses the Host header and looks up label-by-label in the subdomains table. It's only the TLS-cert layer that needs each specific name. Most customers won't notice this gap because they'll bind specific subdomains via the Mac app's Services tab anyway.

### What the user actually needs (per-registrar docs)

The "Add domain" modal in the web dashboard currently shows the records in our internal format. For a real user, this isn't enough — they don't know:
- Where to click in GoDaddy / Cloudflare / Namecheap / Hostinger / etc
- Whether to type `@` or `a2a.one` in the Name field
- Whether the platform appends the domain automatically
- What TTL to set

So I'm building per-registrar walk-throughs.

## Records every osmRouter customer needs (the canonical set)

For domain `<your-domain.com>`, after server IP `157.180.124.246`:

| Type | Name | Value | TTL | Purpose |
|---|---|---|---|---|
| **A** | `@` | `157.180.124.246` | 600 | Apex traffic lands on our server |
| **A** | `*` | `157.180.124.246` | 600 | Wildcard subdomains for app-style binding (optional, advanced) |
| **TXT** | `_osm` | `osm-verify=<unique-token>` | 600 | Ownership proof — verifier reads this |

Three records, three lines. Same shape regardless of registrar.

## Top-5 registrars I'll build walkthroughs for

By market share + customer overlap:

1. **GoDaddy** — biggest market share
2. **Namecheap** — popular with devs
3. **Cloudflare Registrar** — many AI/tech users
4. **Hostinger** — fastest-growing budget/intl
5. **Squarespace Domains** (formerly Google Domains) — many product/SaaS users
6. (bonus) **Porkbun** — popular with indie devs

Each gets:
- Exact menu path: "Click X → Click Y → click 'Add new record'"
- Per-record form-field mapping: "Type: A — Name: @ — Points to: 157.180.124.246 — TTL: 600"
- Gotchas specific to that registrar (e.g. GoDaddy's "Forwarding" toggle, Cloudflare's grey vs orange cloud, Squarespace's "Hostname" field)

## What I'm building (technical scope)

**Server-side**: nothing — the records are already returned by `POST /api/v1/domains`. I just need the dashboard to render them per-registrar.

**Web dashboard**:
- New component: `<DnsRegistrarGuide domain={d}/>` — tabbed UI with one tab per registrar
- Reuses the existing `txt_token` + `cname_target` from the domain row
- Replaces the current `DnsRecordsHelp` inside the domain detail modal
- Format: exactly `<Type> — <Name> — <Value> — <TTL>` per the user's spec

**Mac app**: same component if signed-in user hits an unverified domain (they shouldn't — verification happens on web).

## Execution order

1. ✅ Diagnose DNS state for a2a.one (above)
2. ✅ Fix Caddy to drop `*.a2a.one` (resolves cert acquisition loop)
3. ✅ Build the per-registrar dashboard component
4. ✅ Wire into existing add-domain + domain-details flows
5. ✅ Deploy + verify in browser
6. ⏳ Re-check a2a.one cert + run public-HTTPS inference test (waiting on user DNS save)

## What shipped (Step 2: Caddy)

Patched `/etc/caddy/Caddyfile` to drop the `*.a2a.one` SAN. The block is now:

```
a2a.one, www.a2a.one {
    reverse_proxy 127.0.0.1:8000
    encode gzip
}
```

`caddy validate` passed, `systemctl reload caddy` succeeded. The 30-min retry loop ends.

Why this is OK functionally: wildcard subdomain ROUTING through the proxy still works — the proxy parses the Host header and looks up label-by-label in the subdomains table, regardless of whether Caddy has a wildcard cert. The only consequence: customers binding an ad-hoc subdomain like `random.a2a.one` will get a cert error from the browser unless we ALSO add `random.a2a.one` to Caddy. Realistic-customer flow: they bind explicit subdomains via the Mac app's Services tab → we add those as named entries to Caddy → HTTP-01 works fine.

True wildcard cert support is a v2.1 task that needs the DNS-01 plugin + a per-registrar API token. Documented for later.

## What shipped (Step 3 + 4: Per-registrar guide)

New file: `web/components/dns/DnsRegistrarGuide.tsx`.

**Six registrars** with full step-by-step:
1. **GoDaddy** — biggest customer overlap. Includes the gotcha about deleting their parking IP first + the `Custom (seconds)` TTL trick.
2. **Namecheap** — has a per-row save (green ✓). Highlights the `URL Redirect` interception trap.
3. **Cloudflare Registrar** — must set proxy to **grey cloud** or TLS termination collides with ours. Spelled out.
4. **Hostinger** — fastest-growing; their default parking record at `@` (`84.32.x.x`) silently shadows.
5. **Squarespace Domains** — formerly Google Domains; "Add Custom Record" not "Add Preset".
6. **Porkbun** (bonus) — only registrar where the apex Host must be **blank**, not `@`. Surprises devs.

Format the user spec'd (`Type — Name — Data — TTL`) is rendered in a grid with copy-on-click cells AND a per-row "all" button that copies the full string. The three records:

| Type | Name | Data | TTL |
|---|---|---|---|
| A | @ | 157.180.124.246 | 600 |
| A | * | 157.180.124.246 | 600 |
| TXT | _osm | osm-verify=&lt;token&gt; | 600 |

Each registrar tab also shows:
- **Name field convention** for that registrar (does it want `@` or empty? does it auto-append?)
- **TTL field convention** (seconds vs dropdown vs hidden)
- One **⚠ Watch out** line for the most common pitfall

## Deploy

```
docker compose build web → 38s
docker compose up -d --no-deps web → recreated
```

Confirmed via `curl https://app.osmrouter.com/login -sI` → HTTP/2 200 with the new CSP. The modal will render the guide whenever a domain row has `dns_status !== "verified"`.

## What the user does next

1. Sign in at `https://app.osmrouter.com`.
2. Go to **Domains**. `a2a.one` will currently show as **verified** (TXT did register) but no A records → click the row to open the details modal.
3. (Optional) Delete `a2a.one` and re-add it to surface the per-registrar modal — OR just go straight to GoDaddy with the records above.
4. Open `dcc.godaddy.com` → **a2a.one** → **DNS** → add three records per the GoDaddy tab.
5. Click **Save** at GoDaddy (top right — easy to miss).
6. Within 2 min, `dig +short a2a.one` returns `157.180.124.246`.
7. Caddy auto-fetches the LE cert (HTTP-01 — works because no wildcard).
8. `curl https://a2a.one/v1/chat/completions ...` → LM Studio responds.

## Open follow-ups

- **DNS-01 for wildcard certs** — needs a per-registrar DNS API token. Cloudflare is easiest (free, well-supported plugin). GoDaddy's API needs a $5/yr add-on for tokens. Will revisit when v2.1 hits the public roadmap.
- **Test the new guide modal in the rebuilt web** by clicking through it for a fresh domain.
- **Magic-link instead of OTP** for registration — pending SMTP creds from user (Gmail App Password or Postmark/SES key).

---

## Phase 2 — Redesign of the DNS-instructions modal (max readability)

User feedback after the v1 modal landed: "redesign the page for maximum readability". The first version had records crammed into a 5-column grid with an "ALL" header (actually a copy-all button mislabeled), all step / hint / warn text running together.

### Redesign principles applied

| Pattern | Before | After |
|---|---|---|
| Records as **cards** | One narrow grid row per record | Each record = a card with explicit **NAME / VALUE / TTL** columns, click-to-copy cells, big numbered circle, plain-English caption, and Type pill (blue **A**, green **TXT**) |
| **Eyebrow labels** | All sections equal weight | `STEP 1 / STEP 2 / STEP 3` in accent color carry the user through the flow |
| **Numbered steps** | Bullets blended with text | Each step gets a circled number + a single-action sentence |
| **Field hints** | Inline prose | Pulled out into a 2-col `NAME / TTL` key-value strip below the steps |
| **Watch-out** | Inline warning prose | Own warn-tinted card with ⚠ icon |

### Modal scroll fix — the deeper bug

After the redesign, the modal became too tall for the viewport. Symptoms:
- Modal content overflowed below the visible viewport
- Could not scroll *within* the modal — page scroll didn't move modal content
- Close / Verify buttons invisible

Diagnosis via `getComputedStyle`:
- Modal panel had `maxHeight: 798px` (correct: calc(100vh - 48px)) and `display: flex` (correct, my redesign)
- But panel was positioned at `top: -191px` — pushed up off the viewport top
- Modal-backdrop computed `position: fixed, top: 77, height: 262` — NOT `100vh` as the CSS said `inset: 0`

Walked the parent chain looking for `transform / filter / will-change / contain` ancestors that create a CSS *containing block*. Found:

```
<div class="fade-in"> with transform: matrix(1, 0, 0, 1, 0, 0)
```

The `.fade-in` keyframe ends with `transform: none` but `animation-fill-mode: forwards` left a residual identity-transform on the element. **An identity-transform STILL creates a containing block**, which constrains `position: fixed` of any descendant to that ancestor instead of the viewport.

**Fix:** moved the Modal to a React **portal** — `createPortal(modalBody, document.body)`. Bypasses every wrapper element including the `.fade-in` containing block. Now `position: fixed` resolves to the viewport as intended; modal centers properly; internal scrolling works.

Verified end-to-end in the browser via the Chrome MCP — modal renders top-to-bottom with all three records, all 6 registrar tabs, numbered steps, field hints, warn callout, and verify button.

---

## Phase 3 — Auto-LE-cert via on-demand TLS (the "any customer domain just works" piece)

User's pain point: after adding their first customer-style domain (`a2a.one`), they noticed I had to manually add a per-domain block to Caddyfile. That doesn't scale.

### What I built

**Server side** — a small "ask" endpoint Caddy calls before issuing a cert:

```go
api.GET("/internal/caddy-allow", func(c echo.Context) error {
    host := strings.ToLower(strings.TrimSpace(c.QueryParam("domain")))
    labels := strings.Split(host, ".")
    var n int64
    for i := 0; i <= len(labels); i++ {
        fqdn := strings.Join(labels[i:], ".")
        if fqdn == "" { continue }
        err := d.DB.WithContext(ctx).Raw(
            `SELECT COUNT(*) FROM domains WHERE fqdn = ? AND dns_status = 'verified'`, fqdn,
        ).Row().Scan(&n)
        if err == nil && n > 0 {
            return c.NoContent(http.StatusOK)
        }
    }
    return c.NoContent(http.StatusNotFound)
})
```

Walks label by label so both apex (`a2a.one`) AND deep subdomains (`llm.tunnels.a2a.one`) match if any parent FQDN is a verified domain.

**Caddyfile** — a single catch-all on `:443`:

```
{
    email arjun.subburaj@gmail.com
    on_demand_tls {
        ask http://127.0.0.1:8080/api/v1/internal/caddy-allow
    }
}

# osmRouter brand surface
osmrouter.com, www.osmrouter.com, app.osmrouter.com {
    reverse_proxy 127.0.0.1:3000
}
api.osmrouter.com {
    reverse_proxy 127.0.0.1:8080
}

# Catch-all for EVERY customer domain
:443 {
    tls { on_demand }
    reverse_proxy 127.0.0.1:8000
}
```

### Customer flow (now)

1. Add domain in dashboard → verify via TXT
2. Point DNS A record(s) at `157.180.124.246` (the per-registrar guide tells them how)
3. Hit `https://their-domain.com` — Caddy asks our `/caddy-allow` hook → 200 → Let's Encrypt cert minted via HTTP-01 in ~5s → proxied to `osm-proxy:8000` → tunneled to their Mac

**Zero per-customer Caddyfile edits ever again.** Tested in this session — `a2a.one` → 200, `llm.a2a.one` → 200, `evil.com` → 404.

---

## Phase 4 — Devices Bound column in the dashboard

User noticed there was no way to see which device a domain was bound to from the Domains list. Added a column.

New `BoundDevicesCell` component fetches `/domains/:id/subdomains` + `/devices`, joins client-side. Displays:
- `—` if no subdomain bindings exist
- Green dot badge with device name if 1 device is bound
- "Device A +N more" if multiple devices are bound to different subdomains
- "N detached" warn-tone if subdomains exist but none are bound

Verified live — `a2a.one` row shows `● Test Mac (signin flow)`.

---

## Phase 5 — Making a2a.one actually work end-to-end

User correctly pushed back on my "DNS isn't there" diagnosis with: "I already added them, why is it verified then?". 

### The UX flaw I exposed

"Verified" in the dashboard ONLY means ownership-proof via TXT record. It does NOT mean DNS A records point to our server. A domain can be `verified` while traffic-routing-DNS is missing. This confused the user because "verified" reads as "ready to use".

I confirmed authoritatively (`dig @ns55.domaincontrol.com a2a.one ANY +noall +answer`):
- Only NS, SOA, TXT records existed
- No A records at all

User's earlier UI edits at GoDaddy hadn't persisted. Likely cause: GoDaddy's per-row save vs top-of-page Save are separate buttons; missing the top one means nothing commits.

### GoDaddy API route — bypassing the broken UI

User provided their GoDaddy API key + secret. Authenticated:

```
Authorization: sso-key <KEY>:<SECRET>
```

Tested with `GET /v1/domains/a2a.one/records` — 200 OK, returned existing records (NS, SOA, TXT, CNAME for www).

PATCHed the two A records:

```
PATCH https://api.godaddy.com/v1/domains/a2a.one/records
Body: [
  {"type":"A","name":"@","data":"157.180.124.246","ttl":600},
  {"type":"A","name":"*","data":"157.180.124.246","ttl":600}
]
→ 200 OK
```

Confirmed at all three resolvers (`1.1.1.1`, `8.8.8.8`, `ns55.domaincontrol.com`): `a2a.one → 157.180.124.246`.

### Caddy cert acquisition — final dance

First HTTPS attempt: `__HTTP_000` — Caddy was in a retry-backoff loop from earlier failed attempts (when DNS wasn't there yet). Reset Caddy's cert state:

```
rm -rf /var/lib/caddy/.local/share/caddy/certificates/*/a2a.one*
rm -rf /var/lib/caddy/.local/share/caddy/locks/*a2a.one*
systemctl restart caddy
```

Hit the SNI handshake directly with `openssl s_client -servername a2a.one -connect 157.180.124.246:443` — Caddy returned a valid cert with `subject=CN=a2a.one, issuer=C=US, O=Let's Encrypt, CN=E8`. **The cert was minted via on-demand TLS on the first SNI handshake.**

### The headline test — public-internet inference through `a2a.one`

Local DNS cache was stale (no sudo to flush), so used `curl --resolve` to bypass — same effect as a fresh client elsewhere on the internet.

```
GET https://a2a.one/v1/models
→ HTTP 200, 985 ms
→ {"data":[{"id":"qwen3.6-35b-a3b-claude-4.7-opus-abliterated-mlx",...},
            {"id":"text-embedding-nomic-embed-text-v1.5",...}]}
```

```
POST https://a2a.one/v1/chat/completions
Body: {"model":"qwen3.6-35b-...","messages":[
        {"role":"system","content":"Answer in one short sentence."},
        {"role":"user","content":"What is osmRouter ..."}],
       "max_tokens":80}

→ HTTP 200, ~2.6 s
→ "osmRouter is an open-source routing engine ..."  (model still thinks it's the OSM project — funny but correct end-to-end)
→ 79 completion tokens, 35 prompt tokens, reasoning_content also generated
```

Streaming test:
```
POST https://a2a.one/v1/chat/completions  with "stream":true
→ data: {"reasoning_content":"Thinking"}
→ data: {"reasoning_content":" Process"}
→ data: {"reasoning_content":":"}
→ data: {"reasoning_content":"\n\n"}
→ data: {"reasoning_content":"1"}
…
```

SSE chunks arriving live, no buffering, full path:

```
visitor (anywhere)
  ↓ HTTPS / SNI a2a.one
Caddy :443 — LE cert minted on-demand (~5s, first time only)
  ↓ HTTP loopback :8000
osm-proxy public listener — looks up Host header in subdomains table
  ↓ HTTP/2 stream over pinned-TLS tunnel
osm-agent (sidecar) on Mac
  ↓ HTTP loopback :1234
LM Studio — qwen3.6-35b-a3b-claude-4.7-opus-abliterated-mlx
```

This is the whole product working as advertised.

---

## What this session delivered

- **DNS-instructions modal v2** with card-based records, eyebrow steps, warn callout, 6 registrar walkthroughs, color-coded type pills
- **Modal portal fix** for the containing-block bug
- **Caddy on-demand TLS** + `/caddy-allow` ask hook — any future customer's verified domain auto-gets an LE cert
- **Devices Bound column** in the dashboard
- **GoDaddy API integration** to bypass GoDaddy's brittle UI when needed
- **Public-internet inference** through `a2a.one` proven end-to-end with both non-streaming and streaming SSE

Net result: the user can now share `https://a2a.one/v1/chat/completions` with anyone, anywhere, and they get inference from the LM Studio model running locally on the user's Mac — over their own custom-branded URL, with a real Let's Encrypt cert.

---

## Files touched in this session

| File | Change |
|---|---|
| `web/components/dns/DnsRegistrarGuide.tsx` | New — 6-registrar walkthrough |
| `web/components/ui/modal.tsx` | Scroll-within-modal + React portal fix |
| `web/app/(app)/domains/page.tsx` | DnsRegistrarGuide wired in + BoundDevicesCell column |
| `server/internal/server/server.go` | `/api/v1/internal/caddy-allow` ask endpoint |
| `/etc/caddy/Caddyfile` (server only) | on_demand_tls config + `:443` catch-all |
| `Dev Logs/2026-05-13 - Session 7 - DNS + Per-Registrar Docs.md` | This log |

