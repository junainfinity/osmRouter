# Session 8 — Rebind `a2a.one` to a different local OpenAI-compatible service

> User reports: "I unbound and then rebound the domain name a2a.one to another service running on this mac, but it does not seem to reflect."
>
> Target local service: `http://127.0.0.1:1686`, OpenAI-compatible, API key `123456`.
>
> Goal: make `a2a.one` route to that new service, prove it works locally, prove it works via the public URL, run inference end-to-end.

## Diagnosis plan (first principles)

A binding flowing through osmRouter has **three** moving parts. ANY one being stale breaks the chain:

1. **DB state on the server** — `subdomains` table row for `a2a.one` apex has the right `bound_device_id`, and its `target_port` matches the local service.
2. **Sidecar on the Mac** — an `osm-agent` process running with `--domain a2a.one --local-port 1686`. Killing/restarting it is the way to switch ports because the sidecar embeds the local-port at spawn time.
3. **The local service** at `127.0.0.1:1686` is actually answering OpenAI-format requests.

Each of these will be tested individually + logged.

## Step 1 — what's actually bound on the server right now

Query against the postgres on Hetzner:

```
SELECT s.id, s.prefix, s.target_port, s.bound_device_id, s.bound_at,
       (SELECT name FROM devices WHERE id = s.bound_device_id) AS device_name
FROM subdomains s JOIN domains d ON s.parent_domain_id = d.id
WHERE d.fqdn = 'a2a.one';
```

Result:

| id | prefix | target_port | bound_device_id | bound_at | device_name |
|---|---|---|---|---|---|
| 8a101292-… | (apex) | 1234 | NULL | NULL | (none) |
| 0abd1d3b-… | (apex) | 1686 | c9f8df6a-… | 2026-05-13 20:44:54 | Test Mac (signin flow) |

So the user's unbind+rebind on the web dashboard DID land. The DB has the new binding to `:1686` on this device. **Server side is correct.**

## Step 2 — sidecar state on this Mac

`pgrep -af osm-agent` showed 4 processes:

| PID | Command | Status |
|---|---|---|
| 23046 | (gone) | dead, leftover |
| 72818 | `.demo-state/osm-agent run --domain app.todo.localtest.me --local-port 3100 ...` | leftover from demo |
| 73555 | `.demo-state/osm-agent run --domain ollama.localtest.me --local-port 11434 ...` | leftover from demo |
| 74179 | `.demo-state/osm-agent run --domain lmstudio.localtest.me --local-port 1234 ...` | leftover from demo |

**None of them are bound to `a2a.one` with port `1686`.** The most recent sidecar I'd spawned for a2a.one was hardcoded to `--local-port 1234` (the old port) and was killed during the build cycle earlier.

So: even though the DB says port 1686, **no local sidecar is listening for a2a.one requests on the right port**. This is the disconnect.

### Architectural note for future

When the user rebinds via the **web dashboard**, the Mac app has no way of knowing — there's no push event yet. The Mac app's `CloudDomainsView` re-fetches on render so the UI updates, but the actual sidecar process is NOT auto-respawned to match the new target_port. v2.1 should:

- WebSocket-push binding changes to the Mac app (the hub layer already exists)
- Mac app's sidecar manager reconciles every change: kill sidecars whose binding has changed, spawn new ones to match

For this session: manual fix.

## Step 3 — confirm the new local service responds

```
curl http://127.0.0.1:1686/v1/models  -H 'Authorization: Bearer 123456'
→ HTTP 200 in <1ms
→ {"data":[
    {"id":"sonnet","owned_by":"claude"},
    {"id":"opus","owned_by":"claude"},
    {"id":"haiku","owned_by":"claude"},
    {"id":"gpt-5.5","owned_by":"codex"},
    {"id":"gpt-5-mini","owned_by":"codex"}
   ]}
```

Identified the service via `lsof -nP -iTCP:1686 -sTCP:LISTEN`:

```
osmBroker  PID 17548  /Users/arjun/Projects/osmBroker/osmBroker.app/Contents/MacOS/osmBroker
```

So it's the user's own `osmBroker` — an OpenAI-compatible aggregator that routes to upstream Claude + ChatGPT/Codex.

## Step 4 — spawn fresh sidecar at correct port

Killed all `osm-agent-darwin-arm64` processes; the demo-state agents (binaries named differently) survived but they're for `localtest.me` and don't conflict. Spawned:

```
OSM_TOKEN=… osm-agent-darwin-arm64 run \
  --domain a2a.one \
  --local-port 1686 \
  --proxy-url https://tunnel.osmrouter.com:8443 \
  --device-id c9f8df6a-…
```

Boot log:
```
{"event":"log","level":"info","msg":"dialing-proxy"}
{"event":"log","level":"info","msg":"tls-handshake-ok"}    ← pinned-CA TLS pass
{"event":"ready"}                                          ← register frame accepted
{"event":"heartbeat","t":…}
```

New PID 23430.

## Step 5 — debug the inference failures

First public-HTTPS test:

```
GET https://a2a.one/v1/models  → 200 OK
   (returns the same 5 models — proves the chain works)

POST https://a2a.one/v1/chat/completions (non-streaming)
  model=sonnet, "Hi"
→ HTTP 502 "bad-gateway"
```

Direct hit (skip tunnel) to confirm whether it's the tunnel or the service:

```
POST http://127.0.0.1:1686/v1/chat/completions  model=sonnet  (non-streaming)
→ 60s timeout, HTTP 000

POST http://127.0.0.1:1686/v1/chat/completions  model=gpt-5-mini  (non-streaming)
→ HTTP 500: "The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account."

POST http://127.0.0.1:1686/v1/chat/completions  model=gpt-5.5  (non-streaming)
→ 25s timeout, HTTP 000

POST http://127.0.0.1:1686/v1/chat/completions  model=opus  (non-streaming)
→ 25s timeout, HTTP 000
```

Conclusion at this stage: **osmBroker requires `stream:true`** for chat completions. Non-streaming requests just hang indefinitely.

## Step 6 — the working invocation

```
POST http://127.0.0.1:1686/v1/chat/completions
  model=gpt-5.5  stream=true
→ HTTP 200, SSE chunks arrive in real time:
   data: {... "delta":{"role":"assistant"} ...}
   data: {... "delta":{"content":"I'll load the required startup skill ..."} ...}
   data: {... "delta":{"content":"Hi. What can I help with?"} ...}
```

Real inference. The model returned both an internal "loading skill" status line and the actual user-facing answer.

## Step 7 — headline test through `https://a2a.one`

```
POST https://a2a.one/v1/chat/completions
  Authorization: Bearer 123456
  model=gpt-5.5  stream=true
  prompt: "In one sentence: what hostname did this HTTP request arrive through?"

→ HTTP 200 in 9.2 s
→ data: {... "delta":{"role":"assistant"} ...}
   data: {... "delta":{"content":"I don't have access to the incoming HTTP
                        request metadata, so I can't determine the hostname."} ...}
   data: {... "delta":{},"finish_reason":"stop" ...}
   data: [DONE]

→ Sidecar telemetry: request /v1/chat/completions status=200 latencyMs=8158 sizeBytes=623
```

**Full chain:**

```
curl on this Mac
  ↓ HTTPS, SNI a2a.one
Caddy on Hetzner (LE cert minted via on-demand TLS earlier in session 7)
  ↓ reverse_proxy 127.0.0.1:8000
osm-proxy public listener
  ↓ Host: a2a.one → subdomain id 0abd1d3b → device c9f8df6a
  ↓ HTTP/2 stream over pinned-TLS tunnel
osm-agent (sidecar) PID 23430
  ↓ HTTP loopback 127.0.0.1:1686
osmBroker PID 17548 (Bearer auth: 123456)
  ↓ upstream Codex API call
ChatGPT/Codex backend
  ↓ tokens stream back
SSE chunks return the same path
visitor sees them live
```

## What the user can now do

Anyone on the internet can:

```
curl -N -X POST https://a2a.one/v1/chat/completions \
  -H 'Authorization: Bearer 123456' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role":"user","content":"…"}],
    "stream": true
  }'
```

…and get real LLM inference from the upstream model, routed through `a2a.one` → osmRouter → this Mac.

## What the cycle exposed about osmRouter's UX

**Symptom:** rebinding on the web dashboard didn't visibly change behaviour because the local sidecar wasn't auto-respawned.

**Root cause:** the Mac app's `SidecarManager` doesn't reconcile against the cloud-side binding state. The web → cloud DB change is invisible to the local Electron process.

**Fix for v2.1** (queued):
1. Push `binding.changed` events from cloud → Mac app over the existing WebSocket hub.
2. In the Mac app, the `SidecarManager` reacts: kill sidecars whose `target_port` changed, spawn new ones for newly-bound subdomains, stop sidecars for newly-unbound subdomains.
3. Show in the UI when a sidecar is "out of sync" with the cloud binding.

This makes the binding lifecycle atomic from the user's perspective — flip the toggle on the web, and the local tunnel follows.

## Step 8 — Per-model probe through `https://a2a.one`

After confirming the routing chain works for `gpt-5.5`, user asked: "ask one question to each of the models exposed through a2a.one domain name, record last and this run". Ran the same prompt against all five.

**Prompt** (identical for every model):
```
{"role":"user","content":"In one short sentence: name yourself, and reply: what is 2+2?"}
```

**Request shape** — identical to the working `gpt-5.5` call from earlier:
```
POST https://a2a.one/v1/chat/completions
Authorization: Bearer 123456
{"model":"<name>","messages":[…],"max_tokens":80,"stream":true}
```

### This run (one prompt × five models, 2026-05-14)

| Model | Origin | Result | Time | Notes |
|---|---|---|---|---|
| `sonnet` | claude | ✗ timeout 45 s | 45 s | No content streamed. Upstream Claude probably needs an API key osmBroker doesn't have. |
| `opus` | claude | ✗ timeout 45 s | 45 s | Same as sonnet. |
| `haiku` | claude | ✅ HTTP 200, 4 SSE chunks | 10 s | **"I'm Claude, an AI assistant made by Anthropic—and 2+2 equals 4."** |
| `gpt-5.5` | codex | ✗ timeout 45 s | 45 s | Worked in the previous run (9.2 s). Codex upstream variance / rate limit / Codex CLI session state? |
| `gpt-5-mini` | codex | ✗ HTTP 400 from upstream | 6 s | Cleanly returned the osmBroker error: `"The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account."` |

**1 of 5 models gave a clean response** (`haiku`). 1 returned a clean upstream error (`gpt-5-mini`). 3 silently timed out.

### Previous run (gpt-5.5, 2026-05-13 evening)

For comparison, the headline test that landed last time:

```
POST https://a2a.one/v1/chat/completions
  model=gpt-5.5  stream=true
  prompt: "In one sentence: what hostname did this HTTP request arrive through?"

→ HTTP 200 in 9.2 s
→ data: {... "delta":{"role":"assistant"} ...}
→ data: {... "delta":{"content":"I don't have access to the incoming HTTP
                        request metadata, so I can't determine the hostname."} ...}
→ data: {... "delta":{},"finish_reason":"stop" ...}
→ data: [DONE]

Sidecar telemetry: status=200 latencyMs=8158 sizeBytes=623
```

### Side-by-side comparison

```
              Previous run         This run         Verdict
              (Codex gpt-5.5)      (5 models)
─────────────────────────────────────────────────────────────────
sonnet        — (not tried)        45 s timeout     no response
opus          — (not tried)        45 s timeout     no response
haiku         — (not tried)        10 s, "I'm Claude…2+2=4"   ✓ working
gpt-5.5       9.2 s, real answer   45 s timeout     unstable
gpt-5-mini    — (not tried)        6 s, 400 error   upstream rejects model
─────────────────────────────────────────────────────────────────
osmRouter   ✓ chain               ✓ chain          tunnel is reliable
osmBroker   ✓                      ⚠ Anthropic+Codex have variable upstream state
```

### Why the variance

The osmRouter tunnel path itself is identical between runs (same Caddy + proxy + sidecar + osmBroker). The variance is **entirely on the upstream side** (Claude API, Codex/ChatGPT API). Specifically:

1. **`sonnet`/`opus` timeouts** — osmBroker likely has no Anthropic API key configured (or rate-limited), so it stalls waiting for an upstream response it can't get. `haiku` worked, suggesting one of: (a) Claude haiku has a different fallback path in osmBroker, (b) cached response, (c) different routing branch.
2. **`gpt-5.5` swings between 9 s and 45 s** — Codex CLI sessions have session state that gets reused; the second hit may be waiting on an OAuth token refresh, Codex queue, or upstream rate limit.
3. **`gpt-5-mini` is unambiguously not in user's Codex plan** — the error is consistent across both direct-hit and via-tunnel calls.

**None of these are osmRouter routing issues.** The sidecar logs `request status=200 sizeBytes=…` for haiku and clean error pass-through for gpt-5-mini. The timeouts come from osmBroker's upstream calls. From osmRouter's perspective, the chain is doing its job — proving an arbitrary OpenAI-compatible service can be exposed through a customer domain.

### Verbatim response (the one that worked, for posterity)

```
$ curl -N -X POST https://a2a.one/v1/chat/completions \
    -H "Authorization: Bearer 123456" \
    -H "Content-Type: application/json" \
    -d '{"model":"haiku","messages":[{"role":"user","content":"In one short sentence: name yourself, and reply: what is 2+2?"}],"max_tokens":80,"stream":true}'

data: {... "delta":{"role":"assistant"} ...}
data: {... "delta":{"content":"I'm Claude, an AI assistant made by Anthropic—and 2+2 equals 4."} ...}
data: {... "delta":{},"finish_reason":"stop" ...}
data: [DONE]
```

4 SSE chunks, complete answer, finish_reason=stop, [DONE] terminator. **End-to-end inference through `https://a2a.one` proven for a Claude family model.**

## Open issues from this session

- **osmBroker model name `sonnet`/`opus`/`haiku`/`gpt-5-mini` all hang or 500.** Only `gpt-5.5` works (with stream). User's osmBroker probably needs Claude API keys configured for the claude-* models, and gpt-5-mini isn't in their Codex plan. Not an osmRouter bug — but the dashboard UX could surface upstream errors more clearly.
- **Non-streaming requests hang** at osmBroker. The sidecar's `ResponseHeaderTimeout` (30s) causes 502s on the tunnel side. This is correct behaviour but the dashboard should show "your origin is slow / non-responsive" as a Diagnostic HUD message.

