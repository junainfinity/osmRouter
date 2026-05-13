// S1.1–S1.5 — assert the security-critical defaults are baked into window.ts.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "../../main/window.ts");

describe("[sec S1] hardened BrowserWindow defaults — source inspection", () => {
  it("source enables contextIsolation, sandbox, webSecurity; disables nodeIntegration", async () => {
    const src = await fs.readFile(SRC, "utf8");
    expect(src).toMatch(/contextIsolation:\s*true/);
    expect(src).toMatch(/sandbox:\s*true/);
    expect(src).toMatch(/webSecurity:\s*true/);
    expect(src).toMatch(/nodeIntegration:\s*false/);
    expect(src).toMatch(/allowRunningInsecureContent:\s*false/);
    expect(src).toMatch(/experimentalFeatures:\s*false/);
  });

  it("denies window.open and routes only allow-listed hosts via shell.openExternal", async () => {
    const src = await fs.readFile(SRC, "utf8");
    expect(src).toMatch(/setWindowOpenHandler/);
    expect(src).toMatch(/action: "deny"/);
    expect(src).toMatch(/ALLOWED_HOSTS/);
  });

  it("sets a strict CSP via response headers", async () => {
    const src = await fs.readFile(SRC, "utf8");
    expect(src).toMatch(/Content-Security-Policy/);
    expect(src).toMatch(/default-src 'self'/);
    // connect-src is the most important: blocks the renderer from making
    // arbitrary network calls — every request must go through IPC.
    expect(src).toMatch(/connect-src 'none'/);
    expect(src).toMatch(/frame-ancestors 'none'/);
    expect(src).toMatch(/object-src 'none'/);
    expect(src).toMatch(/base-uri 'none'/);
  });

  it("blocks navigation to external origins and re-routes via the allow-list", async () => {
    const src = await fs.readFile(SRC, "utf8");
    expect(src).toMatch(/will-navigate/);
  });
});
