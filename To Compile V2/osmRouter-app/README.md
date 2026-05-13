# osmRouter Mac — To Compile V2

> The customer-facing desktop client, rebuilt against the Option D wire
> protocol. Companion bundle to **To Upload V2** (cloud side).

This folder is what you hand to a colleague (or to your own build box)
to produce the `.dmg` your customers install. It contains the full Go
sidecar + Electron + Next.js source — **plus** an embed slot at
`apps/sidecar/internal/embedded_ca/root.pem` where you drop your operator
root CA before compiling.

## What changed vs v0.1

| Layer | v0.1 | **v0.2 (this)** |
|---|---|---|
| Wire protocol to cloud proxy | TLS + WebSocket + JSON frames | TLS 1.3 + role-inverted HTTP/2 |
| Operator CA distribution | flag `--root-ca path/to/file.pem` | **embedded at compile time** (`//go:embed`) |
| `--root-ca` flag | required | **optional** (falls back to embed) |
| Local-HTTP client | 30 s wall-clock timeout, 5 s response header | **no wall-clock**, 30 s header, 5 min idle |
| SSE / token streaming | buffered (4 MB cap) | unbounded, per-chunk flush |
| Long inference (> 30 s) | 504 at wall-clock | survives until visitor or cloud cancels |
| Register / handshake | implicit on dial | **explicit register frame** (single JSON line, v1) |
| `selftest` subcommand | hostcheck only | hostcheck + embedded-CA validation |
| Sidecar binary version | `0.1.0-dev` | `0.2.0-dev` |

## Quick start

```bash
# 0. Drop your operator root CA into the embed slot
cp /opt/osmRouter/ca/root.pem apps/sidecar/internal/embedded_ca/root.pem

# 1. One-shot build (CA gate → go tests → cross-compile → selftest → .dmg)
./scripts/compile-mac.sh
```

The `.dmg` lands in `apps/desktop/out/make/`. Distribute that.

If you only want to refresh the Go binary inside the existing Electron
shell (faster inner loop):

```bash
./scripts/compile-mac.sh sidecar
```

## Layout

```
osmRouter-app/
├── README.md              ← this file
├── COMPILE.md             ← full build walkthrough + signing notes
├── package.json           ← workspace root
├── apps/
│   ├── desktop/           ← Electron Main + preload + Next.js renderer
│   │   ├── main/          ← lifecycle, IPC, keychain, store
│   │   ├── preload/       ← bridge to window.osmAPI
│   │   ├── renderer/      ← Next.js 15 static export
│   │   ├── resources/     ← sidecar binaries land here at build time
│   │   ├── tests/         ← unit / security / integration / e2e
│   │   └── forge.config.js
│   └── sidecar/           ← Go binary (osm-agent)
│       ├── cmd/osm-agent/main.go
│       ├── internal/
│       │   ├── embedded_ca/     ← **NEW** — drop root.pem here before build
│       │   ├── hostcheck/       ← Host header validator (S7.4)
│       │   ├── pinned_tls/      ← TLS 1.3 + pinned-root config
│       │   ├── telemetry/       ← JSON-line events to stdout
│       │   ├── tunnel/          ← dial-serve-reconnect loop (register frame!)
│       │   └── mockproxy/       ← test double that speaks v2 protocol
│       ├── go.mod / go.sum
│       └── testdata/
├── packages/shared/       ← Zod IPC schemas + channel constants
└── scripts/
    └── compile-mac.sh     ← **NEW** — end-to-end build orchestrator
```

## Safety: the placeholder gate

The repo ships with a *placeholder* `root.pem` whose contents literally
contain `PLACEHOLDER`. Both layers of the build refuse to proceed
against it:

- **`compile-mac.sh check-ca`** — `grep -q PLACEHOLDER` → exit 1 with
  a red message pointing at the embed slot.
- **`osm-agent selftest`** — `embedded_ca.Validate()` returns
  `ErrPlaceholder` → exit 1, the build script bails before producing
  a `.dmg`.

The unit test `embedded_ca_test.go` asserts both halves of this gate so
a regression that lets the placeholder slip through fails CI.

## Three-tier process model (unchanged from v0.1)

- **Main** (Node.js/TypeScript) — sidecar lifecycle, IPC gatekeeper, keychain.
- **Renderer** (Next.js sandboxed) — UI; talks to main only via `window.osmAPI.*`.
- **Sidecar** (Go) — TLS-pinned, multiplexed tunnel; one process per active binding.

## Compatibility

A v0.2 binary will not connect to a v0.1 cloud proxy (the register
frame is rejected). A v0.1 binary will not connect to a v0.2 cloud
proxy (no register frame ever arrives; the proxy times out). Plan the
rollout so customers update before you flip the cloud proxy.

## See also

- `../../To Upload V2/osmRouter/README.md` — cloud side
- `../../To Upload V2/osmRouter/DEPLOY.md` §3 (mint the CA) and §9 (hand
  customers the Mac app)
- `../../osmRouter/Planning/13 - Option D - Master Plan.md` (Obsidian vault)
