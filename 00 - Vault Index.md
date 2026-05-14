# osmRouter Web — Vault Index

> **Mission:** Ship a sovereign, BYO-domain reverse-tunnel SaaS tuned for self-hosted LLM inference (LM Studio, Ollama, any OpenAI / Anthropic-compatible API). v2 = Option D: pinned-TLS + role-inverted HTTP/2, no third party in the data path.

## 🗺️ Map of the Vault

### Planning — Phase 1 (Control Plane)
- [[Planning/01 - Master Plan]]
- [[Planning/02 - Architecture]]
- [[Planning/03 - Task Breakdown]]  (major → mini → micro → atomic → nano)
- [[Planning/04 - Self-Critique & Reformed Plan]]
- [[Planning/05 - Risk Register]]
- [[Planning/06 - Component Stack Map]]

### Planning — Phase 2 (Data Plane v1, WebSocket frames)
- [[Planning/07 - Data Plane - Master Plan]]
- [[Planning/08 - Data Plane - Architecture]]
- [[Planning/09 - Data Plane - Task Breakdown]]
- [[Planning/10 - Data Plane - Self-Critique & Reform]]
- [[Planning/11 - Data Plane - Risk Register]]

### Planning — Operations & v1.1
- [[Planning/12 - Known Issues & v1.1 Backlog]]  — 10 issues mapped to fix locations + priorities

### Planning — Phase 3 (Option D, v2)
- [[Planning/13 - Option D - Master Plan]]  — CTO master plan, scope, build order, definition of done
- [[Planning/14 - Option D - Architecture]]  — wire protocol formal spec, Registry, Forwarder, ca package, security properties preserved
- [[Planning/15 - Option D - Self-Critique & Reform]]  — 10 critiques (DR-D5 byte-by-byte read, Director URL.Host, etc.), locked decisions
- [[Planning/16 - Option D - Risk Register]]  — 15 risks DR-D1 through DR-D15

### Testing
- [[Testing/00 - Test Strategy]]
- [[Testing/02 - Data Plane Test Strategy]]
- [[Testing/03 - Option D Test Strategy]]  — Phase 3 test plan + end-to-end flow + pass criteria

### Security
- [[Security/00 - Security Posture]]
- [[Security/01 - Threat Model]]
- [[Security/02 - Mitigation Checklist]]
- [[Security/03 - Data Plane Threat Model]]

### Dev Logs
- [[Dev Logs/2026-05-12 - Session 1]]  — Phase 1 (Control Plane)
- [[Dev Logs/2026-05-12 - Session 2 - Data Plane]]  — Phase 2 (Data Plane v1)
- [[Dev Logs/2026-05-12 - Session 3 - Live Demo & Papers]]  — Phase 3 (live demo, screenshots, papers)
- [[Dev Logs/2026-05-12 - Session 4 - Production Bundle]]  — Phase 4 (the `To Upload/` deployment bundle)
- [[Dev Logs/2026-05-12 - Session 5 - Option D Execution]]  — **Phase 5 (Option D pivot + V2 bundles)**
- [[Dev Logs/2026-05-12 - Session 6 - Mac App Signin First Principles]]  — Phase 6 (paste-key signin, cloud listing, services tab, web rebind UI)
- [[Dev Logs/2026-05-13 - Session 7 - DNS + Per-Registrar Docs]]  — **Phase 7 (per-registrar guide, modal portal fix, on-demand TLS, a2a.one live)**
- [[Dev Logs/2026-05-13 - Session 8 - Rebind a2a.one to Port 1686]]  — Phase 8 (rebind diagnosis, sidecar re-spawn, stream-only osmBroker inference via a2a.one)
- [[Dev Logs/2026-05-14 - Session 9 - Per-Model Sweep + Codex Plan Limits]]  — **Phase 9 (7-model sweep via a2a.one, Codex/ChatGPT plan limits diagnosed, osmBroker Serve pane shows live model IDs, code-signing fixed)**

### Papers
- [[Whitepaper/osmRouter-Whitepaper]]  (also rendered to `osmRouter-Whitepaper.html`)
- [[Yellow Paper/osmRouter-Yellow-Paper]]  (also rendered to `osmRouter-Yellow-Paper.html`)

### Screenshots & UI review
- [[Screenshots/00 - Screenshot Analysis]]  — 23 v1 screenshots + 1 v2 evidence shot (`v2/24-v2-live-evidence.png`)

### 🚀 Production bundles

**v2 (current — Option D, pinned-TLS + role-inverted HTTP/2):**
- [[To Upload V2/osmRouter/README]]  — cloud side: server + dashboard + new proxy + Docker
- [[To Upload V2/osmRouter/DEPLOY]]  — full 15-section deployment guide (also `DEPLOY.html`)
- [[To Compile V2/osmRouter-app/README]]  — Mac side: tuned sidecar + embedded operator CA
- [[To Compile V2/osmRouter-app/COMPILE]]  — Mac-app build walkthrough + signing notes

**v1 (archived — WebSocket-frame proxy, kept for reference):**
- [[To Upload/osmRouter/README]]
- [[To Upload/osmRouter/DEPLOY]]

## 🧭 Source Documents (provided by user)

- `~/Downloads/osmRouter Web Tech PRD.pdf`
- `~/Downloads/osmRouter Web Security.pdf`
- `Design/osmRouter web/` — JSX prototype of the entire UI (port target)

## 🏗️ What Lives in this Repo (current)

```
osmRouter Web/
├── Design/              # JSX prototype (read-only reference)
├── Planning/            # 16 docs — Phase 1, 2, ops, Phase 3 (Option D)
├── Testing/             # 00, 02, 03 — strategies per phase
├── Security/            # Posture, threat models, mitigation checklist
├── Dev Logs/            # Sessions 1–5 chronological journal
├── Whitepaper/          # Business paper (MD + HTML)
├── Yellow Paper/        # Formal technical spec (MD + HTML w/ MathJax)
├── Screenshots/         # 23 v1 screenshots + Screenshots/v2/ for Option D evidence
├── server/              # Go Control Plane (Echo + GORM + Redis + WebSockets)
├── web/                 # Next.js 16 dashboard
├── proxy-node/          # Go Data Plane — Option D (TLS server + H2 client + ReverseProxy)
├── mac-app/             # Python to-do demo for the live walkthrough
├── deploy/              # Dockerfiles + docker-compose for Option D stack
├── scripts/             # init-ca.sh + generate-secrets.sh + demo_v2.sh
├── ca/                  # 🔐 Operator root CA + proxy leaf (gitignored secrets)
├── To Upload V2/        # 🚀 v2 cloud bundle (server + dashboard + new proxy + Docker)
├── To Compile V2/       # 🚀 v2 Mac-app bundle (tuned sidecar + embedded CA + build script)
├── _v1-archive/         # frozen WebSocket-frame proxy + tunnel-client for reference
├── To Upload/           # v1 production bundle (kept for now)
└── HANDOFF.md           # The dev handoff doc (V2-aware)
```

## 🎯 Definition of Done (v2 status — Option D)

Cloud + client built, tested, packaged, documented:
1. ✅ Auth, domain verification, device registration, subdomain binding all carry over from v1.
2. ✅ Pinned-TLS + role-inverted HTTP/2 wire protocol — no third party in data path.
3. ✅ Streaming SSE through tunnel — proven for Ollama + LM Studio + to-do app simultaneously.
4. ✅ Long inference (>30s) survives — no wall-clock timeout, only visitor-context cancellation.
5. ✅ Operator CA pinned at compile time via `//go:embed`; placeholder gate fails closed at three layers (build script, Go selftest, unit test).
6. ✅ Host-binding validated by Control Plane on every register frame (label-split bug fixed).
7. ✅ `To Upload V2/` cloud bundle — 4 commands to launch on a fresh server.
8. ✅ `To Compile V2/` Mac-app bundle — `./scripts/compile-mac.sh` end-to-end builds.
9. ✅ Five honest deferrals carried to v2.1 (Cloudflare-for-SaaS, Stripe webhook, WebAuthn admin MFA, per-node proxy mTLS, auto-rotation).
