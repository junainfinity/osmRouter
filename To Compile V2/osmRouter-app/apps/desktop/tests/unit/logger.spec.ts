import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger } from "../../main/logger/index.js";

async function tmpLog(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-log-"));
  return path.join(dir, "osmrouter.log");
}

async function waitForSize(p: string, atLeast: number, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const s = await fs.stat(p);
      if (s.size >= atLeast) return s.size;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return (await fs.stat(p)).size;
}

describe("[unit] logger", () => {
  it("writes JSON lines to the log file", async () => {
    const p = await tmpLog();
    const lg = createLogger({ logPath: p });
    lg.info({ a: 1 }, "hello");
    lg.warn({ b: 2 }, "warn");
    lg.flush();
    await waitForSize(p, 10);
    const content = await fs.readFile(p, "utf8");
    expect(content).toMatch(/"msg":"hello"/);
    expect(content).toMatch(/"msg":"warn"/);
  });

  it("redacts known sensitive keys (accessToken, refreshToken, token, password)", async () => {
    const p = await tmpLog();
    const lg = createLogger({ logPath: p });
    lg.info({ accessToken: "TOPSECRET", refreshToken: "ALSO", token: "T", password: "P", harmless: "ok" }, "evt");
    lg.flush();
    await waitForSize(p, 50);
    const content = await fs.readFile(p, "utf8");
    expect(content).not.toContain("TOPSECRET");
    expect(content).not.toContain("ALSO");
    expect(content).toMatch(/"harmless":"ok"/);
  });

  it("rotates when size exceeds the cap", async () => {
    const p = await tmpLog();
    const lg = createLogger({ logPath: p, maxSizeBytes: 4096, trimRatio: 0.5 });
    const big = "x".repeat(200);
    for (let i = 0; i < 50; i++) lg.info({ i, big }, "fill");
    lg.flush();
    await waitForSize(p, 4096);
    const before = (await fs.stat(p)).size;
    const rotated = await lg.rotateIfNeeded();
    expect(rotated).toBe(true);
    const after = (await fs.stat(p)).size;
    expect(after).toBeLessThan(before);
  });

  it("child() inherits redaction and path", async () => {
    const p = await tmpLog();
    const lg = createLogger({ logPath: p });
    const ch = lg.child({ scope: "test" });
    ch.info({ token: "DONOTLOG" }, "child");
    lg.flush();
    await waitForSize(p, 30);
    const content = await fs.readFile(p, "utf8");
    expect(content).not.toContain("DONOTLOG");
    expect(content).toMatch(/"scope":"test"/);
    expect(ch.getPath()).toBe(p);
  });
});
