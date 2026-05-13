#!/usr/bin/env bash
# compile-mac.sh — one-shot build of the osmRouter Mac app (v0.2 / Option D).
#
# What it does (in order):
#   1. Verify your operator root CA has been dropped into the embed slot.
#   2. Run the Go unit tests so a broken sidecar can't ship.
#   3. Cross-compile osm-agent for darwin/arm64 + darwin/amd64.
#   4. Run `osm-agent selftest` against each binary — must print
#      {"event":"selftest-ok"} or we bail.
#   5. Hash the binaries so Electron Main can integrity-check at spawn time.
#   6. `npm install` (workspace root) if node_modules is missing.
#   7. `electron-forge make` to produce the signed/unsigned .dmg.
#
# Run from the monorepo root:
#
#   ./scripts/compile-mac.sh
#
# Or invoke individual phases:
#
#   ./scripts/compile-mac.sh sidecar       # just the Go binary
#   ./scripts/compile-mac.sh check-ca      # just the CA gate
#   ./scripts/compile-mac.sh dmg           # assumes binaries are fresh
#
# Environment overrides:
#
#   OSM_SIGNING_IDENTITY="Developer ID Application: Foo (TEAMID)"
#     If set, electron-forge will codesign + notarize. Unset → unsigned.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT_DIR/apps/sidecar"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
EMBED_DIR="$SIDECAR_DIR/internal/embedded_ca"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
yel()   { printf "\033[33m%s\033[0m\n" "$*"; }

check_ca() {
  yel "▶ verifying embedded operator CA"
  if ! [ -s "$EMBED_DIR/root.pem" ]; then
    red "✗ $EMBED_DIR/root.pem is empty or missing"
    red "  → copy your operator root CA into it before building."
    red "  → see ../../To Upload V2/osmRouter/scripts/init-ca.sh on the cloud side."
    exit 1
  fi
  if grep -q "PLACEHOLDER" "$EMBED_DIR/root.pem"; then
    red "✗ Placeholder root.pem still in place."
    red "  → drop your operator CA into $EMBED_DIR/root.pem and rerun."
    exit 1
  fi
  # Quick PEM sanity check
  if ! head -n 1 "$EMBED_DIR/root.pem" | grep -q "BEGIN CERTIFICATE"; then
    red "✗ $EMBED_DIR/root.pem is not a PEM certificate (no BEGIN CERTIFICATE header)."
    exit 1
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl x509 -in "$EMBED_DIR/root.pem" -noout -subject -issuer -dates >/dev/null
  fi
  green "✓ operator CA looks well-formed"
}

go_tests() {
  yel "▶ running Go unit tests"
  ( cd "$SIDECAR_DIR" && go test ./... )
  green "✓ Go tests pass"
}

build_sidecar() {
  yel "▶ compiling osm-agent (darwin/arm64 + darwin/amd64)"
  mkdir -p "$DESKTOP_DIR/resources"
  ( cd "$SIDECAR_DIR" && \
    GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w" \
      -o "$DESKTOP_DIR/resources/osm-agent-darwin-arm64" ./cmd/osm-agent )
  ( cd "$SIDECAR_DIR" && \
    GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="-s -w" \
      -o "$DESKTOP_DIR/resources/osm-agent-darwin-amd64" ./cmd/osm-agent )
  green "✓ sidecar binaries built"

  yel "▶ selftest against built binary"
  # We can only selftest the binary matching our current arch. If we're on
  # arm64 we run the arm64 binary, etc.
  local host_arch
  host_arch="$(uname -m)"
  case "$host_arch" in
    arm64|aarch64) HOST_BIN="$DESKTOP_DIR/resources/osm-agent-darwin-arm64" ;;
    x86_64)        HOST_BIN="$DESKTOP_DIR/resources/osm-agent-darwin-amd64" ;;
    *)             red "✗ unknown host arch: $host_arch"; exit 1 ;;
  esac
  local out
  out="$("$HOST_BIN" selftest)"
  if [[ "$out" != *"selftest-ok"* ]]; then
    red "✗ selftest failed: $out"
    exit 1
  fi
  green "✓ selftest: $out"

  if command -v node >/dev/null 2>&1 && [ -f "$DESKTOP_DIR/scripts/hash-sidecar.mjs" ]; then
    yel "▶ writing integrity hashes"
    node "$DESKTOP_DIR/scripts/hash-sidecar.mjs"
    green "✓ sidecar-hash.json updated"
  fi
}

build_dmg() {
  yel "▶ installing JS deps (workspace root)"
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    ( cd "$ROOT_DIR" && npm install )
  else
    green "✓ node_modules present — skipping install"
  fi

  # Two things plugin-vite + npm-workspaces don't do for us, so we do them here:
  #
  # 1) Stage the Next.js renderer static export into resources/renderer/. The
  #    main process loads index.html from Contents/Resources/renderer/ at
  #    runtime (see forge.config extraResource). Without this step the app
  #    boots to "Renderer build not found".
  yel "▶ building Next.js renderer (static export)"
  ( cd "$DESKTOP_DIR/renderer" && npx next build )
  rm -rf "$DESKTOP_DIR/resources/renderer"
  cp -R "$DESKTOP_DIR/renderer/out" "$DESKTOP_DIR/resources/renderer"
  green "✓ renderer staged at $DESKTOP_DIR/resources/renderer ($(du -sh "$DESKTOP_DIR/resources/renderer" | cut -f1))"

  # 2) npm-workspaces hoists keytar to the monorepo root node_modules/. The
  #    forge.config afterCopy hook reads it from apps/desktop/node_modules/
  #    so we have to place a copy there. Pure-JS deps (pino, etc.) are
  #    bundled by Vite — only keytar (native) needs this.
  yel "▶ staging keytar locally for forge afterCopy"
  if [ -d "$ROOT_DIR/node_modules/keytar" ]; then
    mkdir -p "$DESKTOP_DIR/node_modules"
    rm -rf "$DESKTOP_DIR/node_modules/keytar"
    cp -R "$ROOT_DIR/node_modules/keytar" "$DESKTOP_DIR/node_modules/keytar"
    green "✓ keytar staged at $DESKTOP_DIR/node_modules/keytar"
  else
    red "✗ keytar not found at workspace root — npm install probably failed"
    exit 1
  fi

  yel "▶ electron-forge make"
  ( cd "$DESKTOP_DIR" && npx electron-forge make )
  green "✓ .dmg produced in $DESKTOP_DIR/out/make/"
}

main() {
  local cmd="${1:-all}"
  case "$cmd" in
    check-ca) check_ca ;;
    sidecar)  check_ca; go_tests; build_sidecar ;;
    dmg)      build_dmg ;;
    all)      check_ca; go_tests; build_sidecar; build_dmg ;;
    *)
      cat <<USAGE
usage: $0 [check-ca|sidecar|dmg|all]

  check-ca   verify operator CA is dropped into the embed slot
  sidecar    check-ca + go tests + compile osm-agent (both arches)
  dmg        npm install + electron-forge make
  all        all of the above (default)
USAGE
      exit 2
      ;;
  esac
}

main "$@"
