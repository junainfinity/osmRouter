// BrowserWindow factory. Encodes all S1.x security controls in one place.

import { BrowserWindow, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hosts the renderer is allowed to open in the system browser via
// shell.openExternal. Anything else is silently dropped by safeOpenExternal.
//   - app.*       → dashboard (login, signup, domain mgmt)
//   - api.*       → control plane API (rare, for support links)
//   - docs.*      → public docs
//   - download.*  → installer downloads
const ALLOWED_HOSTS = new Set([
  "osmrouter.com",
  "www.osmrouter.com",
  "app.osmrouter.com",
  "api.osmrouter.com",
  "docs.osmrouter.com",
  "download.osmrouter.com",
]);

export interface CreateWindowOptions {
  preloadPath: string;
  rendererUrl: string; // e.g. file:// path to next.js export or http://localhost:3000 in dev
}

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0e0e10",
    webPreferences: {
      // SECURITY (S1.1–S1.5)
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: opts.preloadPath,
      // Block embedded webview/iframe shenanigans
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      backgroundThrottling: false,
    },
  });

  // S1.6: deny all window.open / target=_blank; route allowed external links
  // via shell.openExternal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  // Block ALL navigation away from our static export — anything that tries
  // is treated as an external-link request and gated through the allow-list.
  win.webContents.on("will-navigate", (e, url) => {
    const target = new URL(url);
    const renderer = new URL(opts.rendererUrl);
    if (target.protocol !== renderer.protocol || target.host !== renderer.host) {
      e.preventDefault();
      safeOpenExternal(url).catch(() => undefined);
    }
  });

  // S2.2: CSP applied via response header for the file:// renderer.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // CSP for our own static renderer. Next.js 15's static export emits
        // a handful of inline <script> tags for chunk loading and hydration
        // data — these are part of our build output, not user content, so
        // 'unsafe-inline' here only authorises code we ship. The hard
        // boundaries that matter for our threat model are:
        //   - connect-src 'none'   → renderer cannot fetch network
        //   - object-src 'none'    → no plugins / Flash / SVG nasties
        //   - frame-ancestors 'none' → no clickjacking embeds
        //   - sandbox: true + nodeIntegration: false → no system access
        // See osmRouter vault → 05 - Security Spec § "CSP & content load".
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ],
        "X-Content-Type-Options": ["nosniff"],
        "Referrer-Policy": ["no-referrer"],
      },
    });
  });

  void win.loadURL(opts.rendererUrl);
  win.once("ready-to-show", () => win.show());

  return win;
}

export async function safeOpenExternal(url: string): Promise<void> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return;
    if (!ALLOWED_HOSTS.has(u.host)) return;
    await shell.openExternal(url);
  } catch {
    /* swallow */
  }
}

export const __test = { __dirname };
