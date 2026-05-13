// S3.1–S3.6 — IPC allow-list and payload validation.

import { describe, it, expect, beforeEach } from "vitest";
import { IpcRouter } from "../../main/ipc/router.js";
import { REQUEST_CHANNELS } from "@osmrouter/shared";
import { createLogger } from "../../main/logger/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function makeLogger() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "osm-sec-"));
  return createLogger({ logPath: path.join(d, "log.log") });
}

let router: IpcRouter;
beforeEach(async () => {
  router = new IpcRouter({ logger: await makeLogger() });
});

describe("[sec S3.4] IPC allow-list — unknown channel rejected", () => {
  it("dispatch returns forbidden-channel for unlisted name", async () => {
    const r = await router.dispatch("evil:exec", { cmd: "rm -rf /" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("forbidden-channel");
  });

  it("dispatch returns forbidden-channel even when handler not registered yet", async () => {
    const r = await router.dispatch("fs:readFile", { path: "/etc/passwd" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("forbidden-channel");
  });

  it("registering a handler for an unlisted channel throws", () => {
    expect(() =>
      // @ts-expect-error — channel intentionally invalid
      router.register("malicious-channel", () => "x"),
    ).toThrow(/forbidden-channel-register/);
  });

  it("registering duplicate handlers for the same channel throws", () => {
    router.register(REQUEST_CHANNELS.AUTH_STATUS, async () => ({ signedIn: false }));
    expect(() =>
      router.register(REQUEST_CHANNELS.AUTH_STATUS, async () => ({ signedIn: true })),
    ).toThrow(/duplicate-handler/);
  });
});

describe("[sec S3.5] Payload validation — bad input blocked", () => {
  beforeEach(() => {
    router.register(REQUEST_CHANNELS.TUNNEL_START, async () => ({ status: "starting" }));
  });

  it("rejects out-of-range port", async () => {
    const r = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, {
      domainId: "d_x",
      port: 99999,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation");
  });

  it("rejects extra properties (strict mode)", async () => {
    const r = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, {
      domainId: "d_x",
      port: 80,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
      __proto__: { evil: true },
      injected: "yes",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects null and undefined payloads", async () => {
    const r1 = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, null);
    expect(r1.ok).toBe(false);
    const r2 = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, undefined);
    expect(r2.ok).toBe(false);
  });

  it("rejects a string payload where object expected", async () => {
    const r = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, "rm -rf /");
    expect(r.ok).toBe(false);
  });

  it("rejects a payload with non-string domain", async () => {
    const r = await router.dispatch(REQUEST_CHANNELS.TUNNEL_START, {
      domainId: 12345,
      port: 80,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe("[sec S3.5] Open-external URL — host allow-list", () => {
  it("rejects http://", async () => {
    router.register(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, async () => ({ ok: true as const }));
    const r = await router.dispatch(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url: "http://osmrouter.com/" });
    expect(r.ok).toBe(false);
  });
  it("rejects javascript: pseudo-protocol", async () => {
    router.register(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, async () => ({ ok: true as const }));
    const r = await router.dispatch(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url: "javascript:alert(1)" });
    expect(r.ok).toBe(false);
  });
  it("rejects file://", async () => {
    router.register(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, async () => ({ ok: true as const }));
    const r = await router.dispatch(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url: "file:///etc/passwd" });
    expect(r.ok).toBe(false);
  });
  it("rejects unlisted host", async () => {
    router.register(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, async () => ({ ok: true as const }));
    const r = await router.dispatch(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url: "https://attacker.com/dashboard" });
    expect(r.ok).toBe(false);
  });
  it("accepts allow-listed osmrouter.com", async () => {
    router.register(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, async () => ({ ok: true as const }));
    const r = await router.dispatch(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url: "https://osmrouter.com/dashboard" });
    expect(r.ok).toBe(true);
  });
});

describe("[sec S3.5] Response shape mismatch is caught", () => {
  it("returns internal error if handler returns wrong shape", async () => {
    router.register(REQUEST_CHANNELS.AUTH_STATUS, async () => ({ totally: "wrong" } as unknown as { signedIn: boolean }));
    const r = await router.dispatch(REQUEST_CHANNELS.AUTH_STATUS, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("internal");
  });
});

describe("[sec S3.5] Handler-thrown errors return internal code, never leak stack", () => {
  it("internal error message present, stack absent", async () => {
    router.register(REQUEST_CHANNELS.AUTH_STATUS, async () => {
      throw new Error("nuclear");
    });
    const r = await router.dispatch(REQUEST_CHANNELS.AUTH_STATUS, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("internal");
      expect(r.error.message).toBe("nuclear");
      // No "at " stack frame leaks through
      expect((r.error as unknown as { stack?: string }).stack).toBeUndefined();
    }
  });
});
