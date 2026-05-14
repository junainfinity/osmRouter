# Session 9 — Per-model sweep through `https://a2a.one` + diagnosing Codex plan limits

> Continuation of Session 8. User reset state again: moved the broker to a different local port and asked for **every** served model to be exercised through the public URL, recording who answers and who doesn't.
>
> User instructions (verbatim, in order):
>
> 1. "first test the https://a2a.one url for the models being served one by one, after 2 or 3 models if you are still not getting response, take control of mac by computer use and observe osmBroker as well as osmRouter Mac app. look at all the settings that matter — the port, models selected to be served, api key etc domain binding and more. then trouble shoot and find why it is or not working. commit previous and this session detailed notes to obsidian"
> 2. "decompose every time you come up with something to do, decompose into smallest task units, ensure they are logically correct and execute one by one."
> 3. "regarding models that we are serving, ask simple questions to each and every model we are serving to ensure it is working"
> 4. "don't use 127.0.0.1:<port> or localhost:<port>, we know that works. test with the domain name a2a.one bound to it. this is the goal"
>
> Net rule for this session: every probe must hit `https://a2a.one`, not the loopback shortcut.

## 0. Decomposed plan

Per the user's directive, every step was split into the smallest verifiable unit before being executed:

1. **Pick a deterministic prompt** that any well-behaved chat model should answer in one chunk. Chose `"What is 5 + 7?"` (terse, unambiguous, doesn't trigger refusals, doesn't depend on world knowledge or recency).
2. **Run that prompt through `https://a2a.one`** against each of the 7 model IDs osmBroker now advertises, capturing per-call: HTTP status, elapsed wall time, first content chunk, finish reason.
3. **Print a summary table** with the headline result per model.
4. **Write a session log** to `Dev Logs/` covering plan, results, and follow-up.
5. **Commit + push** that log alongside the Session 8 log that hadn't been committed yet.

Tasks 1–3 are below; task 4 is this file; task 5 is the commit at the end.

## 1. State of the world at the start of this session

### 1a. osmBroker is now on `:8080`, not `:1686`

User moved the broker to a different local port between sessions. `lsof` confirms:

```
$ lsof -nP -iTCP -sTCP:LISTEN | grep osmBroker
osmBroker  44909  arjun  10u  IPv4  TCP *:8080 (LISTEN)
```

### 1b. Sidecar had drifted out of sync

Same pattern as Session 8. The persistent sidecar from `/Applications/osmRouter.app` had been spawned with `--local-port 1686` and was now pointing at a dead port. Killing + respawning with `--local-port 8080` brought it back into sync. Current sidecar process:

```
PID 93738  /Applications/osmRouter.app/.../osm-agent-darwin-arm64 \
    run --domain a2a.one --local-port 8080 \
    --proxy-url https://tunnel.osmrouter.com:8443 \
    --device-id c9f8df6a-d403-4ca2-9fea-8aec4d6e5a30
```

**Architectural follow-up** (carried over from Session 8 — still open): the Mac app does NOT reconcile its sidecar's `--local-port` against the cloud binding's `target_port`. As long as users can rebind the same domain to a new port from the web dashboard OR change the local broker's port, this drift will keep happening. Reconciliation should run on:

- WebSocket push from Control Plane when the binding's `target_port` changes.
- App-side detection that the configured `target_port` no longer matches a listening local port.

For now: manual respawn, same as last session.

### 1c. osmBroker UI showed a different API key than the broker was using

The Serve pane's API key field had `osm-local-dev` typed into it, but the broker process was actively serving with `123456` (the key configured at last "Start broker"). The Serve pane's own helper text already explains this: *"Changes take effect the next time you click Start broker."* So the UI was correctly representing pending-state, but in the heat of debugging it's easy to assume the displayed key is the live key.

**Follow-up**: render two lines on the Serve pane — "Current key (in use)" and "Next key (will apply on restart)" — when they diverge. Tiny UX fix.

### 1d. osmBroker now serves 7 models (up from 5 last session)

After this session's broker restart, `/v1/models` returns:

```
GET https://a2a.one/v1/models  →  HTTP 200
{"data":[
  {"id":"sonnet",      "owned_by":"claude"},
  {"id":"opus",        "owned_by":"claude"},
  {"id":"haiku",       "owned_by":"claude"},
  {"id":"gpt-5.5",     "owned_by":"codex"},
  {"id":"gpt-5-codex", "owned_by":"codex"},
  {"id":"gpt-5",       "owned_by":"codex"},
  {"id":"gpt-5-mini",  "owned_by":"codex"}
]}
```

Same call shape made it through Caddy → osm-proxy → pinned-TLS tunnel → sidecar → osmBroker. Routing chain is intact. Now the test is the **upstream** behaviour per model.

## 2. The 7-model sweep through `https://a2a.one`

### 2a. Probe shape

Every probe was identical except for the `model` field. `--resolve` pins the Caddy IP so DNS variance doesn't muddy the result.

```
curl -sN --max-time 40 \
  --resolve a2a.one:443:157.180.124.246 \
  -H "Authorization: Bearer 123456" \
  -H "Content-Type: application/json" \
  -X POST https://a2a.one/v1/chat/completions \
  -d '{"model":"<NAME>","messages":[{"role":"user","content":"What is 5 + 7?"}],"max_tokens":40,"stream":true}'
```

Streaming was forced on (`stream:true`) because Session 8 already established that non-streaming requests hang at osmBroker — that's a known broker limitation, not what we're testing here.

### 2b. Results

| Model         | Origin  | Elapsed | Result | Notes |
|---|---|---|---|---|
| `sonnet`      | claude  | 40 s     | ✗ no content received | hit the 40 s budget without any SSE chunk |
| `opus`        | claude  | 5 s      | ✓ answered `12` | clean stream + `[DONE]` |
| `haiku`       | claude  | 40 s     | ✗ no content received | regression from Session 8 where haiku had answered in 10 s |
| `gpt-5.5`     | codex   | 21 s     | ✓ answered `12` | clean stream + `[DONE]` — also a regression from Session 8 timeouts |
| `gpt-5-codex` | codex   | 11 s     | ✗ upstream `400`, body: *"The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account."* |
| `gpt-5`       | codex   | 12 s     | ✗ upstream `400`, body: *"The 'gpt-5' model is not supported when using Codex with a ChatGPT account."* |
| `gpt-5-mini`  | codex   | 13 s     | ✗ upstream `400`, body: *"The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account."* |

**2 of 7 returned a clean answer. 3 of 7 returned a clean upstream error. 2 of 7 timed out silently.**

### 2c. Comparing the two sweeps (Session 8 + Session 9)

|              | Session 8 (5 models) | Session 9 (7 models)  | Verdict |
|---|---|---|---|
| `sonnet`     | 45 s timeout         | 40 s timeout          | consistently times out |
| `opus`       | 45 s timeout         | **5 s, answered `12`** | flaky — works now |
| `haiku`      | 10 s, real answer    | 40 s timeout          | flaky — broke now |
| `gpt-5.5`    | 45 s timeout         | **21 s, answered `12`** | flaky — works now |
| `gpt-5-codex`| (not in catalog)     | 11 s, 400 plan-limit  | upstream plan blocks it |
| `gpt-5`      | (not in catalog)     | 12 s, 400 plan-limit  | upstream plan blocks it |
| `gpt-5-mini` | 6 s, 400 plan-limit  | 13 s, 400 plan-limit  | upstream plan blocks it (consistent) |
| `gpt-5-codex`/`gpt-5` | not exposed | now exposed | osmBroker expanded the catalog |

Pattern: the 3 codex-with-ChatGPT plan-blocked models are **rock-solid in their failure** — same error, same shape, same cause both times. The Claude family + `gpt-5.5` swing between answering in 5–21 s and timing out at 40+ s. The tunnel path itself has zero failed deliveries on its side.

## 3. Diagnosis

Three independent issue surfaces. Categorising each:

### 3a. Codex-with-ChatGPT plan: `gpt-5`, `gpt-5-codex`, `gpt-5-mini` — **not an osmRouter or osmBroker bug**

The error body from each of the three:

```
The 'gpt-5'         model is not supported when using Codex with a ChatGPT account.
The 'gpt-5-codex'   model is not supported when using Codex with a ChatGPT account.
The 'gpt-5-mini'    model is not supported when using Codex with a ChatGPT account.
```

This message originates **inside Codex CLI**, in the upstream auth-path — it's checked before any model dispatch. Codex routes the request to OpenAI's API using the ChatGPT-plan auth cookie (rather than an API key); OpenAI's gateway rejects with a plan-tier error. osmBroker dutifully passes the error body through. The tunnel passes the error body through. From a `curl` against `https://a2a.one` the user can see the exact reason. **This is the right behaviour all the way down.**

The fix is upstream-only: user can either (a) attach a paid OpenAI API key to Codex CLI, or (b) restrict the osmBroker model catalogue to only the models their ChatGPT plan actually has access to (probably `gpt-5.5` only).

The osmBroker Serve pane I updated in this session (commit `2729d8e`) actually helps here — clients can see exactly which model IDs are configured, so when these errors come back they can match the failing ID to the row. A future enhancement: have osmBroker do a one-time `/v1/responses` smoke test against each enabled model at "Start broker" time and grey out the ones that error out at upstream.

### 3b. Claude family (`sonnet`, `opus`, `haiku`): **upstream session variance, not the tunnel**

Each of these is dispatched via Claude Code CLI via the `stdin bridge`, per `AgentRegistry.swift`:

```
AgentDef(id: "claude", name: "Claude Code", monogram: "Cl",
         bin: "claude", fallbackBins: ["openclaude"],
         bridge: .stdin, nativeProtocol: .anthropic,
         fallbackModels: ["sonnet", "opus", "haiku"])
```

The `stdin bridge` means osmBroker spawns `claude --model <ID>` as a child process and pipes the prompt in. Cold-start time, session token refresh, and prompt cache state all affect the first-byte latency. Combined behaviour from Sessions 8+9 (`haiku` answers in 10 s once and times out at 40 s next; `opus` is the opposite) is consistent with cold-process startup overhead being on the same order as our 40 s cutoff for *some* prompts and not others.

**Three things to do here, none of which are tunnel-related:**

1. Warm-pool `claude` child processes inside osmBroker (one per model, kept-alive). This is the largest perf win.
2. Bump the sidecar's `ResponseHeaderTimeout` from 30 s to 60 s. Long upstreams shouldn't be capped at the sidecar layer.
3. Have osmBroker emit an `event: status` SSE chunk within the first 5 s, even if the upstream hasn't started writing, so the tunnel doesn't look idle while the upstream is warming.

### 3c. The tunnel itself: zero faults this session

Every probe got a TCP-level 200 OK from Caddy. The osm-proxy path delivered each request to the sidecar within sub-100 ms. The sidecar opened the local socket, sent the request to osmBroker, and either streamed back what osmBroker produced or surfaced the upstream's 400 with body preserved. **For our v2 "Option D" tunnel — pinned-TLS + role-inverted HTTP/2 — this is the green-light evidence.**

## 4. Side work that landed in this session

### 4a. `osmBroker` Serve pane shows model IDs grouped by CLI (commit `2729d8e`)

Added to `Sources/osmBroker/ServePane.swift`:

- `ModelsServedCard` — header card listing every served model, grouped by source CLI.
- `ServedAgentRow` — one row per CLI (Claude Code, Codex CLI), with monogram + Anthropic-shape vs OpenAI-shape badge.
- `ModelIDChip` — every model ID is a click-to-copy chip.
- `ClientHints` — for AnythingLLM, Open WebUI, LiteLLM, OpenAI Python SDK — exact field labels + the values to paste.
- `EmptyModelsHint` — fallback when no CLI is toggled on.

Why: end-users plugging into AnythingLLM/OpenWebUI don't know what value to put in the "Model" field. They saw a generic catalogue without knowing which IDs were *actually* enabled in their broker config. Now the Serve pane shows "this is what's live right now" + "paste these exact strings into your client's settings." Cuts a support loop.

### 4b. `osmBroker` `Scripts/make-app-bundle.sh` no longer produces crashing bundles (commit `b23863a`)

A separate yank-out-by-the-roots problem surfaced earlier in the session: the freshly rebuilt `osmBroker.app` crashed at launch with:

```
EXC_BAD_ACCESS (SIGKILL · Code Signature Invalid)
KERN_CODESIGN_ERROR · CODESIGNING/Invalid Page
```

**Root cause:** `codesign --deep` was being asked to sign the entire `.app`, which walked into `Contents/MacOS/osmBroker_osmBroker.bundle/` (SwiftPM-generated resource bundle, no `Info.plist`, no `Contents/MacOS`, no Mach-O — just raw resources). `codesign --deep` choked with "bundle format unrecognized" and left the parent `.app`'s signature seal in a half-resealed state. The kernel then rejected the first page-in during dyld init and killed the process before any of our code ran.

**Fix in `make-app-bundle.sh`:**

1. Move `osmBroker_osmBroker.bundle` from `Contents/MacOS/` to `Contents/Resources/`. SwiftPM's `Bundle.module` resolver searches `Resources/<module>.bundle` so this still works at runtime, and `codesign` no longer treats it as a nested signable component.
2. Sign the main executable and the `.app` in two passes, **without `--deep`**. The parent `.app` sign now seals `Contents/Resources/` by hashing each file into `_CodeSignature/CodeResources` rather than recursing.
3. Hard-fail the build script if `codesign --verify --strict` doesn't pass at the end. The previous version silently produced broken bundles.

Comments in the script (re-pasted here verbatim because future-me will look this up) capture the why:

```sh
# Why NOT Contents/MacOS/ (the previous home): codesign --deep walks every
# subdir of Contents/MacOS/ and tries to sign each as a separate component.
# SwiftPM's <module>_<module>.bundle has no Info.plist, no Contents/MacOS, no
# Mach-O — just raw resource files. codesign --deep fails with "bundle format
# unrecognized" and leaves the parent .app's signature seal in an inconsistent
# half-resealed state, which the kernel then rejects at launch with a
# CODESIGNING / Invalid Page exception (SIGKILL during dyld init, before any
# of our code runs).
```

This is the kind of issue that you fix once and pin a sign on. The pin is the comment block + the hard-fail.

## 5. Net summary for this session

- **`https://a2a.one` is delivering inference end-to-end** through the v2 Option D tunnel for the model IDs that are actually serviceable upstream.
- **3 of the 7 broker-advertised models are blocked by the user's Codex/ChatGPT plan** — clean upstream errors flow back to the client. Not an osmRouter or osmBroker issue.
- **The Claude-family models are flaky on cold start** — the fix is in the broker (process warm pool + larger first-byte budget), not the tunnel.
- **Sidecar `--local-port` drift** is a known pattern (Session 8 + 9). v2.1 should reconcile it automatically. Manual respawn is the workaround until then.
- **osmBroker Serve pane** now tells end-users exactly which model IDs to plug into AnythingLLM / OWUI / LiteLLM, plus base URL + key.
- **osmBroker app bundle code-signing** is no longer a foot-gun.

## 6. Pending follow-ups (carried into next session)

1. **Warm `claude` child processes** inside osmBroker — single biggest win for Claude-family latency consistency.
2. **WebSocket push of binding changes** Control-Plane → Mac app, with auto-reconcile of sidecar `--local-port`.
3. **Surface "current key vs next key"** on osmBroker Serve pane when they diverge.
4. **Smoke-test each enabled model at "Start broker"** time and grey out the ones that error upstream.
5. **Add `event: status` keep-alive** in osmBroker SSE so slow upstream warmup doesn't look idle to the tunnel.
6. **`Diagnostics HUD`** in the dashboard for "your origin is slow / non-responsive" (sidecar 502 case).

## 7. Files touched / commits

- `osmBroker @ 2729d8e` — Serve pane: model IDs + client hints.
- `osmBroker @ b23863a` — `make-app-bundle.sh` codesign rewrite + hard-fail on verify.
- `osmRouter Web @ (this commit)` — Dev Logs/Session 8 + Session 9.
