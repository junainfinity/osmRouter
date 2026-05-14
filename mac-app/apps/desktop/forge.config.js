// Electron Forge configuration. PRD §2 and §8.
// In v0.1 we package without signing/notarization; the osxSign block is
// commented out and ready for Apple Developer ID credentials later.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * afterCopy hook: inject node_modules/keytar into the packaged app.
 *
 * Why: @electron-forge/plugin-vite only ships .vite/build/ + package.json
 * into app.asar, dropping node_modules entirely. keytar must be present at
 * runtime because main.js loads its native binding via require("keytar").
 * We copy it from apps/desktop/node_modules/keytar (placed there by
 * compile-mac.sh from the hoisted workspace root). The asar.unpack pattern
 * elsewhere in packagerConfig ensures the .node binary lands outside asar
 * so Node's dlopen() can load it.
 */
function injectKeytar(buildPath, _electronVersion, _platform, _arch, callback) {
  try {
    const src = path.resolve(__dirname, "node_modules/keytar");
    if (!fs.existsSync(src)) {
      return callback(new Error(`keytar not found at ${src} — run compile-mac.sh first`));
    }
    const dst = path.join(buildPath, "node_modules/keytar");
    fs.cpSync(src, dst, { recursive: true, dereference: true });
    callback();
  } catch (err) {
    callback(err);
  }
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    name: "osmRouter",
    executableName: "osmRouter",
    appBundleId: "io.osmrouter.desktop",
    asar: { unpack: "**/{node_modules/keytar/build,resources/osm-agent-*}/**" },
    // extraResource items land at Contents/Resources/<basename>/. The main
    // process loads the Next.js static export from Resources/renderer/index.html.
    extraResource: [
      "./resources/osm-agent-darwin-arm64",
      "./resources/sidecar-hash.json",
      "./resources/tray-icon-Template.png",
      "./resources/tray-icon-Template@2x.png",
      "./resources/renderer",
    ],
    // Disable prune: in an npm-workspaces monorepo, prune does `npm install --production`
    // which re-hoists deps to the workspace root and wipes our local apps/desktop/node_modules/keytar.
    // We manage what lands in node_modules manually instead (compile-mac.sh copies keytar).
    prune: false,
    // Inject keytar manually because plugin-vite drops node_modules from the package.
    afterCopy: [injectKeytar],
    // osxSign: { identity: "Developer ID Application: <Your Name> (XXXXXXXXXX)" },
    // osxNotarize: { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_ID_PASS, teamId: process.env.APPLE_TEAM_ID },
    icon: "./resources/icon",
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
    { name: "@electron-forge/maker-dmg", config: { format: "ULFO" } },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          { entry: "main/index.ts", config: "vite.main.config.js", target: "main" },
          { entry: "preload/index.ts", config: "vite.preload.config.js", target: "preload" },
        ],
        renderer: [],
      },
    },
  ],
};

export default config;
