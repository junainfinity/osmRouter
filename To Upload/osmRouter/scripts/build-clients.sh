#!/usr/bin/env bash
#
# Cross-compile the osmrouter-client binary for the platforms your users will
# run it on. Produces statically-linked binaries in `dist/clients/`.
#
# Distribute the binaries from `https://download.osmrouter.com/<version>/...`
# or attach them to a GitHub release.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="${VERSION:-$(git describe --tags --always 2>/dev/null || echo dev)}"
OUT="dist/clients/$VERSION"
mkdir -p "$OUT"

build() {
  local goos="$1" goarch="$2" ext="${3:-}"
  echo "building $goos/$goarch"
  (cd tunnel-client && \
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags="-s -w -X main.version=$VERSION" \
      -o "../$OUT/osmrouter-client-$goos-$goarch$ext" ./cmd/osmrouter-client)
}

build darwin   arm64
build darwin   amd64
build linux    amd64
build linux    arm64
build windows  amd64 .exe

(cd "$OUT" && shasum -a 256 osmrouter-client-* > SHA256SUMS)

echo
echo "Built into $OUT"
ls -lh "$OUT"
