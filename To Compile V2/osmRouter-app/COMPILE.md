# Compile Walkthrough — osmRouter Mac v0.2

> Build the `.dmg` from a clean clone. Assumes you've already run
> `init-ca.sh` on the cloud side and have `ca/root.pem` in hand.

## 0. Prereqs

```bash
# macOS 13+ on the build host (cross-compiling to darwin/arm64 + amd64 is fine
# from either arch — Go does fat-binary cross natively).

brew install go node@20
node -v  # >= 20.11
go version  # >= 1.23

# Optional: for signing + notarization
xcode-select --install   # gives you /usr/bin/codesign + notarytool
```

## 1. Drop your operator CA into the embed slot

```bash
cp /opt/osmRouter/ca/root.pem \
   apps/sidecar/internal/embedded_ca/root.pem
```

That file is the **only** trust anchor the sidecar will use at runtime.
The macOS system trust store is deliberately not consulted, so a
captive portal / corporate / state MITM with a "trusted" intermediate
cannot break into the tunnel.

The placeholder shipped in source control is rejected by
`embedded_ca.Validate()`. The build script also `grep`s for
`PLACEHOLDER` and refuses to compile.

## 2. Verify the CA without compiling

```bash
./scripts/compile-mac.sh check-ca
# ✓ operator CA looks well-formed
```

You can sanity-check the cert any time:

```bash
openssl x509 -in apps/sidecar/internal/embedded_ca/root.pem \
  -noout -subject -issuer -dates
```

## 3. Build the Go sidecar only

```bash
./scripts/compile-mac.sh sidecar
```

This:

1. Runs the CA gate.
2. Runs `go test ./...` across all sidecar packages.
3. Cross-compiles `osm-agent` for `darwin/arm64` and `darwin/amd64`,
   writing both binaries into `apps/desktop/resources/`.
4. Runs `osm-agent selftest` against the host-arch binary, requiring
   `{"event":"selftest-ok"}` on stdout.
5. Updates `apps/desktop/resources/sidecar-hash.json` (SHA-256 over
   each binary) so Electron Main can integrity-check at spawn time.

Resulting binaries (~6.4 MB each, stripped):

```
apps/desktop/resources/
  osm-agent-darwin-arm64
  osm-agent-darwin-amd64
  sidecar-hash.json
```

## 4. Build the .dmg

```bash
./scripts/compile-mac.sh dmg
# or: ./scripts/compile-mac.sh    (runs everything end-to-end)
```

This:

1. `npm install` at the workspace root if `node_modules` is missing.
2. `npx electron-forge make` from `apps/desktop/`.
3. Drops a `.dmg` (and a `.zip` for auto-update later) into
   `apps/desktop/out/make/`.

## 5. Sign & notarize (production only)

`forge.config.js` already wires `@electron/notarize`. To activate:

```bash
export OSM_SIGNING_IDENTITY="Developer ID Application: Your Co (TEAMID)"
export APPLE_ID="releases@your-co.com"
export APPLE_ID_PASSWORD="@keychain:AC_PASSWORD"   # app-specific password
export APPLE_TEAM_ID="TEAMID"

./scripts/compile-mac.sh dmg
```

The first launch on a fresh Mac should not show the "unidentified
developer" Gatekeeper warning if notarization succeeded. Verify with:

```bash
spctl --assess --type execute --verbose=4 \
  apps/desktop/out/osmRouter-darwin-arm64/osmRouter.app
# → "accepted ... source=Notarized Developer ID"
```

## 6. Sanity-test the .dmg locally

```bash
open apps/desktop/out/make/*.dmg
# Drag to Applications, eject, launch.
```

In the app:

1. Paste an API key from the dashboard.
2. The renderer should land on the "Welcome" screen and show your
   bindings.
3. Bind a local port (`1234` for LM Studio, `11434` for Ollama, or your
   own dev server) to a subdomain you've already verified on the
   dashboard.
4. From any browser: `https://<subdomain>.<your-domain>` →
   tokens stream through.

The Diagnostic HUD ("⚠︎" icon, top-right) surfaces connection state and
the live JSON-line events from `osm-agent`. If TLS pinning rejects the
proxy you'll see `tls-handshake: certificate signed by unknown
authority` here — that means the running binary was built against a
different operator CA than the proxy is presenting.

## 7. Rotate the embedded CA

The operator's root CA outlives every leaf. When you do eventually
rotate it (years from now, or on incident):

1. Run `init-ca.sh --rotate-root` on the cloud side.
2. Drop the new `ca/root.pem` into this folder's embed slot.
3. Rebuild & redistribute the Mac app.
4. During a multi-week overlap window the cloud proxy serves **both**
   roots so old clients keep working. After the overlap, retire the
   old root from the proxy config.

See `../../To Upload V2/osmRouter/DEPLOY.md` §13 for the matching
cloud-side rotation steps.

## 8. Troubleshooting

**Build fails with `embedded-ca:placeholder PEM detected`**
→ You forgot Step 1. Drop your real `root.pem` into the embed slot.

**`forge make` fails with code-signing errors and you didn't want signing**
→ Unset `OSM_SIGNING_IDENTITY` (and the Apple env vars) for an unsigned
build. Fine for internal testing.

**`tls-handshake: certificate signed by unknown authority` at runtime**
→ The running binary's embedded CA doesn't match the proxy's leaf
chain. Confirm `openssl verify -CAfile root.pem proxy-leaf.pem`
returns OK on the cloud side.

**`register-rejected: BAD_TOKEN` at runtime**
→ The API key in the keychain was revoked or rotated. Sign in again
on the dashboard, copy the new key into the app's Settings screen.
