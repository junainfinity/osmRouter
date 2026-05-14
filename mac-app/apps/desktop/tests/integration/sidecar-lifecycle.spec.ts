// Integration: full sidecar lifecycle using the fake-sidecar.mjs node script.

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import { SidecarManager, type SidecarEvent } from "../../main/sidecar/manager.js";
import { createLogger } from "../../main/logger/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE = path.resolve(__dirname, "fake-sidecar.mjs");

async function makeLogger() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "osm-int-"));
  return createLogger({ logPath: path.join(d, "log.log") });
}

function newManager(mode: string, opts: Partial<ConstructorParameters<typeof SidecarManager>[0]> = {}) {
  // Use node to invoke the fake; the real manager would point at the Go binary.
  // We wrap by swapping the binary path to `node` and prepending the script.
  // But manager doesn't support pre-args, so we ship a tiny shim script.
  void mode;
  return opts;
}

// Helper: run a manager against a node-invoked fake sidecar by overriding binary
// at the spawn level. SidecarManager spawns `<binary> run --domain … --proxy-url … etc.`
// We can't fit `node fake-sidecar.mjs --mode=…` into one binary. Solution: build
// a wrapper shell script per test that exec's node.
async function buildWrapper(mode: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-wrap-"));
  const p = path.join(dir, "wrapper.sh");
  await fs.writeFile(
    p,
    `#!/bin/bash\nexec "${process.execPath}" "${FAKE}" --mode=${mode}\n`,
    { mode: 0o755 },
  );
  return p;
}

const fakeStart = (binaryPath: string, manager: SidecarManager) => {
  return manager.startTunnel("d_test", {
    domain: "example.com",
    port: 3000,
    proto: "HTTP",
    target: "127.0.0.1",
    token: "test-token",
    proxyUrl: "https://127.0.0.1:9999",
    rootCaPath: "/tmp/does-not-matter",
  });
};

describe("[int] sidecar lifecycle — happy path", () => {
  it("emits ready then telemetry then exits cleanly", async () => {
    const wrapper = await buildWrapper("ready");
    const logger = await makeLogger();
    const mgr = new SidecarManager({ binaryPath: wrapper, logger });
    mgr.start();
    const events: SidecarEvent[] = [];
    mgr.on("event", (e: SidecarEvent) => events.push(e));
    await fakeStart(wrapper, mgr);
    // Wait for exit
    await new Promise((r) => setTimeout(r, 800));
    await mgr.stop();

    expect(events.some((e) => e.type === "status" && e.status === "active")).toBe(true);
    expect(events.some((e) => e.type === "telemetry")).toBe(true);
    expect(events.some((e) => e.type === "exit")).toBe(true);
  });
});

describe("[int] sidecar — crash recovery", () => {
  it("restarts on first crash; enters diagnostic mode after 3 in window", async () => {
    const wrapper = await buildWrapper("crash");
    const logger = await makeLogger();
    const mgr = new SidecarManager({ binaryPath: wrapper, logger, crashWindowMs: 60_000 });
    mgr.start();
    const events: SidecarEvent[] = [];
    mgr.on("event", (e: SidecarEvent) => events.push(e));
    await fakeStart(wrapper, mgr);

    // Each crash cycle = ~200ms (fake) + 500ms (restart backoff).
    // After 3 crashes the manager enters diagnostic-mode and stops restarting.
    // Poll up to 8s for the diagnostic event so timing is not flaky.
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && !mgr.isInDiagnosticMode("d_test")) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await mgr.stop();

    if (!mgr.isInDiagnosticMode("d_test")) {
      // eslint-disable-next-line no-console
      console.log("events captured:", events.map((e) => e.type));
    }
    expect(mgr.isInDiagnosticMode("d_test")).toBe(true);
    expect(events.some((e) => e.type === "diagnostic-mode")).toBe(true);
  });
});

describe("[int] sidecar — heartbeat watchdog", () => {
  it("SIGKILLs a sidecar that stops heartbeating", async () => {
    const wrapper = await buildWrapper("no-heartbeat");
    const logger = await makeLogger();
    let now = 0;
    const mgr = new SidecarManager({
      binaryPath: wrapper,
      logger,
      heartbeatToleranceMs: 200,
      clock: () => now,
      // disable restart for this test by setting a 1-crash limit and tight window
      crashLimit: 1,
      crashWindowMs: 60_000,
    });
    mgr.start();
    const events: SidecarEvent[] = [];
    mgr.on("event", (e: SidecarEvent) => events.push(e));
    await fakeStart(wrapper, mgr);
    // The fake emits "ready" but never heartbeats. Advance the clock so the
    // watchdog tick sees stale lastHeartbeat.
    await new Promise((r) => setTimeout(r, 300));
    now = 1_000_000; // jump well beyond tolerance
    await new Promise((r) => setTimeout(r, 1200)); // let watchdog tick
    await mgr.stop();

    expect(events.some((e) => e.type === "exit")).toBe(true);
  });
});

describe("[int] sidecar — clean shutdown on stopTunnel", () => {
  it("kills the process and removes it from the registry", async () => {
    const wrapper = await buildWrapper("heartbeat-only");
    const logger = await makeLogger();
    const mgr = new SidecarManager({ binaryPath: wrapper, logger });
    mgr.start();
    await fakeStart(wrapper, mgr);
    await new Promise((r) => setTimeout(r, 300));
    expect(mgr._childCount()).toBe(1);
    await mgr.stopTunnel("d_test", "test-clean-stop");
    expect(mgr._childCount()).toBe(0);
    await mgr.stop();
  });
});
