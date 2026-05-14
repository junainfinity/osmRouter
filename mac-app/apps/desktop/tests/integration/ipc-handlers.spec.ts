// End-to-end IPC dispatch: wire the full handler tree against in-memory
// dependencies and dispatch each channel exactly as the renderer would.
// This exercises router + Zod validation + handlers + data store + auth +
// keychain together, without spinning Electron.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { IpcRouter } from "../../main/ipc/router.js";
import { wireHandlers } from "../../main/ipc/handlers.js";
import { createKeychainStore } from "../../main/keychain/index.js";
import { createLogger } from "../../main/logger/index.js";
import { AuthFlow } from "../../main/auth/flow.js";
import { MockAuthBackend } from "../../main/auth/mock-backend.js";
import { SidecarManager } from "../../main/sidecar/manager.js";
import { InMemoryStore } from "../../main/store/in-memory.js";
import { SAMPLE_DOMAINS } from "../../main/store/sample-data.js";
import { REQUEST_CHANNELS } from "@osmrouter/shared";

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-e2e-ipc-"));
  const logger = createLogger({ logPath: path.join(dir, "log.log") });
  const keychain = await createKeychainStore({ userDataPath: dir, forceImpl: "memory" });
  const router = new IpcRouter({ logger });
  const auth = new AuthFlow({
    backend: new MockAuthBackend(),
    keychain,
    logger,
    redirectUri: "osmrouter://auth",
    account: "primary",
  });
  // pre-seed signed-in state so tunnel.start can find an access token
  await keychain.setToken("primary:access", "at_test");
  await keychain.setToken("primary:email", "test@osmrouter.com");
  await auth.bootstrap();
  const sidecar = new SidecarManager({ binaryPath: "/nonexistent", logger });
  // Tests need a populated store to exercise the lock-state and lan-bind
  // branches; production constructs the store with an empty seed.
  const store = new InMemoryStore(SAMPLE_DOMAINS);
  wireHandlers({
    router, auth, sidecar, logger,
    app: { getVersion: () => "0.1.0-test" },
    store,
    proxyUrl: "https://127.0.0.1:9999",
    rootCaPath: "/tmp/nope",
    deviceId: "test-device",
    deviceName: "test-mac",
    openExternal: async () => undefined,
  });
  return { router, auth, store, keychain, sidecar, dir };
}

describe("[int] IPC handlers — auth/status round trip", () => {
  it("returns signedIn:true after bootstrap with pre-loaded keychain", async () => {
    const { router } = await setup();
    const r = await router.dispatch(REQUEST_CHANNELS.AUTH_STATUS, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { signedIn: boolean }).signedIn).toBe(true);
  });
});

describe("[int] IPC handlers — domains.list", () => {
  it("returns the seeded domain list", async () => {
    const { router } = await setup();
    const r = await router.dispatch(REQUEST_CHANNELS.DOMAINS_LIST, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      const data = r.data as { domains: unknown[] };
      expect(data.domains.length).toBeGreaterThan(5);
    }
  });
});

describe("[int] IPC handlers — settings get/update round trip", () => {
  it("update merges and persists settings shape", async () => {
    const { router } = await setup();
    const orig = await router.dispatch(REQUEST_CHANNELS.SETTINGS_GET, {});
    expect(orig.ok).toBe(true);
    const upd = await router.dispatch(REQUEST_CHANNELS.SETTINGS_UPDATE, { theme: "dark", desktopNotifications: true });
    expect(upd.ok).toBe(true);
    const after = await router.dispatch(REQUEST_CHANNELS.SETTINGS_GET, {});
    expect(after.ok).toBe(true);
    if (after.ok) {
      const s = after.data as { theme: string; desktopNotifications: boolean };
      expect(s.theme).toBe("dark");
      expect(s.desktopNotifications).toBe(true);
    }
  });
});

describe("[int] IPC handlers — tunnel.start failures", () => {
  it("rejects start on a domain locked to another device", async () => {
    const { router } = await setup();
    // x1 is locked to "Eshaan's-Mac-Studio" in the seed
    const r = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, {
      domainId: "x1",
      port: 3000,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/domain-not-locked-to-this-device/);
  });

  it("rejects start on unknown domainId", async () => {
    const { router } = await setup();
    const r = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, {
      domainId: "nonexistent",
      port: 3000,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects LAN bind without consent", async () => {
    const { router } = await setup();
    // m1 is locked: self
    const r = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, {
      domainId: "m1",
      port: 3000,
      proto: "HTTP",
      target: "192.168.1.10",
      consentLanBind: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/lan-bind-requires-consent/);
  });
});

describe("[int] IPC handlers — sys.openExternal allow-list", () => {
  it("invokes openExternalImpl only for allow-listed URLs", async () => {
    let opened: string | null = null;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-ext-"));
    const logger = createLogger({ logPath: path.join(dir, "log.log") });
    const keychain = await createKeychainStore({ userDataPath: dir, forceImpl: "memory" });
    const router = new IpcRouter({ logger });
    const auth = new AuthFlow({ backend: new MockAuthBackend(), keychain, logger, redirectUri: "osmrouter://auth", account: "primary" });
    const sidecar = new SidecarManager({ binaryPath: "/nonexistent", logger });
    wireHandlers({
      router, auth, sidecar, logger,
      app: { getVersion: () => "0.1.0-test" },
      store: new InMemoryStore(SAMPLE_DOMAINS),
      proxyUrl: "https://127.0.0.1:9999",
      rootCaPath: "/tmp/nope",
      deviceId: "id",
      deviceName: "name",
      openExternal: async (u) => {
        opened = u;
      },
    });
    const ok = await router.dispatch(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url: "https://osmrouter.com/" });
    expect(ok.ok).toBe(true);
    expect(opened).toBe("https://osmrouter.com/");
    const bad = await router.dispatch(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url: "https://evil.com/" });
    expect(bad.ok).toBe(false);
    expect(opened).toBe("https://osmrouter.com/"); // unchanged
  });
});

describe("[int] IPC handlers — diag.getInfo includes expected fields", () => {
  it("returns version, build, platform, deviceId, logPath, logSizeBytes", async () => {
    const { router } = await setup();
    const r = await router.dispatch(REQUEST_CHANNELS.DIAG_GET_INFO, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as Record<string, unknown>;
      expect(d.version).toBe("0.1.0-test");
      expect(d.platform).toBe(process.platform);
      expect(d.deviceId).toBe("test-device");
      expect(typeof d.logPath).toBe("string");
      expect(typeof d.logSizeBytes).toBe("number");
    }
  });
});
