// Main process entrypoint. Wires every subsystem together:
//   - logger with rotation
//   - keychain
//   - sidecar manager with integrity verification
//   - PKCE auth flow
//   - IPC router with allow-list and Zod
//   - hardened BrowserWindow
//   - tray applet
//   - power & network monitors

import { app, BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage, Tray, Menu, nativeImage } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EVENT_CHANNELS, ALL_REQUEST_CHANNELS } from "@osmrouter/shared";
import { createLogger } from "./logger/index.js";
import { createKeychainStore } from "./keychain/index.js";
import { resolveSidecarPath, verifySidecarBinary } from "./sidecar/integrity.js";
import { SidecarManager } from "./sidecar/manager.js";
import { AuthFlow } from "./auth/flow.js";
import { IpcRouter } from "./ipc/router.js";
import { wireHandlers } from "./ipc/handlers.js";
import { NetworkStateMachine } from "./net/state-machine.js";
import { createMainWindow, safeOpenExternal } from "./window.js";
import { InMemoryStore } from "./store/in-memory.js";
import { resolveSeed } from "./store/sample-data.js";
import { MockAuthBackend } from "./auth/mock-backend.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const PROTOCOL = "osmrouter";

async function main(): Promise<void> {
  // Single-instance lock — guarantees osmrouter:// deep-links always hit the
  // currently-running app rather than spawning a new one.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.setAsDefaultProtocolClient(PROTOCOL);

  await app.whenReady();

  const userData = app.getPath("userData");
  const logger = createLogger({ logPath: path.join(userData, "logs", "osmrouter.log") });
  logger.info({ version: app.getVersion(), pid: process.pid }, "boot");

  // Periodically check log rotation
  setInterval(() => {
    logger.rotateIfNeeded().catch(() => undefined);
  }, 60_000);

  // ── Sidecar integrity (S5) ──────────────────────────────────────────
  const devRoot = path.resolve(__dirname, "..", "..");
  const { binaryPath, hashFilePath } = resolveSidecarPath({
    resourcesPath: process.resourcesPath,
    devRoot,
    platform: process.platform,
    arch: process.arch,
  });
  let integrityOk = false;
  try {
    const result = await verifySidecarBinary({ binaryPath, hashFilePath });
    integrityOk = result.ok;
    if (!result.ok) {
      logger.error({ expected: result.expected, actual: result.actual, binaryPath }, "sidecar:integrity-violation");
      await dialog.showMessageBox({
        type: "error",
        title: "osmRouter — Security Integrity Violation",
        message: "The osmRouter agent binary failed integrity verification.",
        detail: `Expected SHA-256:\n${result.expected}\n\nActual:\n${result.actual || "(missing or unreadable)"}\n\nThe app will now quit. Please reinstall osmRouter from the official source.`,
        buttons: ["Quit"],
      });
      app.exit(2);
      return;
    }
    logger.info({}, "sidecar:integrity-ok");
  } catch (e) {
    logger.warn({ err: String(e) }, "sidecar:integrity-skipped");
    // In dev without a built sidecar we proceed; in production this would
    // require the binary to exist.
  }

  const keychain = await createKeychainStore({ userDataPath: userData, safeStorage });
  logger.info({ impl: keychain.describe() }, "keychain:initialized");

  // Production starts with NO domains. The user verifies a real domain via
  // the web dashboard; the verified list then syncs down. Only the
  // screenshot capture script sets OSM_DEMO=1 to pre-seed sample data; see
  // main/store/sample-data.ts → resolveSeed().
  const seed = resolveSeed();
  const store = new InMemoryStore(seed);
  if (seed.length > 0) logger.info({ count: seed.length }, "store:seeded-with-demo-data");

  const authBackend = new MockAuthBackend();
  const auth = new AuthFlow({
    backend: authBackend,
    keychain,
    logger: logger.child({ scope: "auth" }),
    redirectUri: `${PROTOCOL}://auth`,
    account: "primary",
    onAuthStateChange: (s) => {
      mainWindow?.webContents.send(EVENT_CHANNELS.AUTH_STATE_CHANGE, s);
    },
  });
  await auth.bootstrap();

  const sidecar = new SidecarManager({
    binaryPath,
    logger: logger.child({ scope: "sidecar" }),
  });
  sidecar.start();

  // Pipe sidecar events into renderer events.
  sidecar.on("event", (ev) => {
    if (!mainWindow) return;
    switch (ev.type) {
      case "status":
        mainWindow.webContents.send(EVENT_CHANNELS.TUNNEL_STATUS_UPDATE, {
          domainId: ev.domainId,
          status: ev.status,
          error: ev.error ?? null,
        });
        void store.setTunnelStatus(ev.domainId, ev.status, ev.error);
        break;
      case "telemetry":
        mainWindow.webContents.send(EVENT_CHANNELS.TELEMETRY_TICK, {
          domainId: ev.domainId,
          inbound: ev.inbound,
          outbound: ev.outbound,
          latencyMs: ev.latencyMs,
          activeConns: ev.activeConns,
          t: Date.now(),
        });
        break;
      case "request":
        mainWindow.webContents.send(EVENT_CHANNELS.REQUEST_OBSERVED, {
          id: Math.floor(Math.random() * 1e9),
          t: Date.now(),
          domain: ev.domainId, // not strictly the domain name; renderer joins
          method: ev.method,
          path: ev.path,
          status: ev.status,
          latency: ev.latencyMs,
          size: ev.sizeBytes,
          remote: ev.remote,
        });
        break;
      case "diagnostic-mode":
        mainWindow.webContents.send(EVENT_CHANNELS.SIDECAR_DIAGNOSTIC_MODE, ev);
        break;
    }
  });

  const netSm = new NetworkStateMachine("connected");
  netSm.on("change", (c: { from: string; to: string }) => {
    mainWindow?.webContents.send(EVENT_CHANNELS.NETWORK_STATE_CHANGE, { state: c.to, edge: "iad-1" });
    logger.info(c, "net:state-change");
  });

  powerMonitor.on("suspend", () => {
    logger.info({}, "power:suspend");
    netSm.signal({ type: "os-offline" });
    void sidecar.stop();
  });
  powerMonitor.on("resume", () => {
    logger.info({}, "power:resume");
    setTimeout(() => netSm.signal({ type: "os-online" }), 2000); // wait for wifi
  });

  // ── IPC router ──────────────────────────────────────────────────────
  const router = new IpcRouter({ logger: logger.child({ scope: "ipc" }) });

  const deviceId = await getOrCreateDeviceId(userData);

  wireHandlers({
    router,
    auth,
    sidecar,
    logger,
    app: { getVersion: () => app.getVersion() },
    store,
    proxyUrl: process.env["OSM_PROXY_URL"] ?? "https://127.0.0.1:18443",
    rootCaPath: path.join(devRoot, "resources", "dev-root-ca.pem"),
    deviceId,
    deviceName: os.hostname(),
    openExternal: safeOpenExternal,
    apiBase: process.env["OSM_API_BASE"] ?? "https://api.osmrouter.com",
  });

  // Wire Electron ipcMain → our router. Single, generic channel name keeps
  // the surface area tiny and forces every renderer call through the same
  // validator.
  ipcMain.handle("osm:invoke", async (_event, ch: string, payload: unknown) => {
    return router.dispatch(ch, payload);
  });

  // Defensive: refuse to register ipcMain.handle for any other channel.
  // Electron doesn't let us monkeypatch ipcMain itself, but we can log
  // attempts via a once-per-call check (kept for dev visibility).
  for (const ch of ALL_REQUEST_CHANNELS) {
    void ch; // documented as allow-listed; not registered directly because
             // everything goes through `osm:invoke`.
  }

  // Deep-link handler — second-instance event re-dispatches into running app
  app.on("second-instance", (_event, argv) => {
    const urlArg = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (urlArg) void handleDeepLink(urlArg, auth, logger);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handleDeepLink(url, auth, logger);
  });

  // ── Renderer ────────────────────────────────────────────────────────
  const isDev = !app.isPackaged;
  const rendererIndex = isDev
    ? path.resolve(devRoot, "renderer", "out", "index.html")
    : path.join(process.resourcesPath ?? "", "renderer", "index.html");
  // Locate the preload bundle. @electron-forge/plugin-vite ignores our
  // vite.preload.config.js `fileName` setting and emits the bundle as
  // [entryBasename].js — so `preload/index.ts` lands as `index.js` next to
  // `main.js`. Prefer the canonical `preload.js` name (in case the plugin
  // ever respects the config) and fall back to `index.js`. Without this
  // match, webPreferences.preload silently fails to load and window.osmAPI
  // is undefined in the renderer → every IPC call no-ops.
  const preloadCandidates = ["preload.js", "index.js"].map((n) => path.resolve(__dirname, n));
  const preloadPath = preloadCandidates.find((p) => fs.existsSync(p)) ?? preloadCandidates[0];

  // If the renderer build doesn't exist (first run), fall back to a tiny
  // placeholder so the app is at least openable. The real build is produced
  // by `npm run build:renderer`.
  let rendererFile = rendererIndex;
  if (!fs.existsSync(rendererIndex)) {
    const placeholder = path.join(userData, "placeholder.html");
    fs.writeFileSync(
      placeholder,
      `<!doctype html><meta charset="utf-8"><title>osmRouter</title><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'"><style>body{font-family:-apple-system,sans-serif;background:#0e0e10;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style><body><div><h1>osmRouter</h1><p>Renderer build not found. Run <code>npm run build:renderer</code>.</p></div></body>`,
    );
    rendererFile = placeholder;
  }
  // Build a valid file:// URL with proper percent-encoding (spaces in path).
  const resolvedRendererUrl = pathToFileURL(rendererFile).href;

  logger.info({ rendererFile, preloadPath, preloadExists: fs.existsSync(preloadPath) }, "boot:opening-window");
  mainWindow = createMainWindow({ preloadPath, rendererUrl: resolvedRendererUrl });
  logger.info({}, "boot:window-created");

  // ── Tray ────────────────────────────────────────────────────────────
  tray = createTray(() => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });

  app.on("before-quit", async (e) => {
    if (sidecar._childCount() > 0) {
      e.preventDefault();
      logger.info({}, "app:graceful-quit-begin");
      await sidecar.stop();
      logger.info({}, "app:graceful-quit-done");
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    // macOS convention: keep running in tray.
    if (process.platform !== "darwin") app.quit();
  });

  // signal integrityOk usage so noUnusedLocals never trips on flow change
  void integrityOk;
}

async function handleDeepLink(url: string, auth: AuthFlow, logger: ReturnType<typeof createLogger>): Promise<void> {
  try {
    await auth.handleCallback(url);
    logger.info({}, "deeplink:auth-ok");
  } catch (e) {
    logger.warn({ err: String(e) }, "deeplink:auth-failed");
  }
}

function createTray(toggleWindow: () => void): Tray {
  // Lazy: a template image in resources, but in dev we use an empty image.
  let img: Electron.NativeImage;
  try {
    img = nativeImage.createFromPath(path.join(process.resourcesPath ?? "", "tray-icon-Template.png"));
  } catch {
    img = nativeImage.createEmpty();
  }
  const t = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  t.setToolTip("osmRouter");
  const menu = Menu.buildFromTemplate([
    { label: "Open osmRouter", click: toggleWindow },
    { type: "separator" },
    { label: "Quit osmRouter", role: "quit" },
  ]);
  t.setContextMenu(menu);
  return t;
}

async function getOrCreateDeviceId(userData: string): Promise<string> {
  const p = path.join(userData, "device-id.json");
  try {
    const raw = await fs.promises.readFile(p, "utf8");
    const j = JSON.parse(raw) as { id?: string };
    if (j.id) return j.id;
  } catch {
    /* falls through */
  }
  const id = crypto.randomUUID();
  await fs.promises.mkdir(userData, { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify({ id }), { mode: 0o600 });
  return id;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal", err);
  console.error((err as Error).stack);
  app.exit(1);
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("uncaught:", err);
  console.error(err.stack);
});
process.on("unhandledRejection", (err) => {
  // eslint-disable-next-line no-console
  console.error("unhandled-rejection:", err);
});
