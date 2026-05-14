// E2E smoke: launch Electron, assert the renderer loads, no security regressions.
//
// We don't put this under the integration project — it needs Electron's binary,
// not just Node, so we run it via Playwright's _electron.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..", "..");

test("[e2e] osmRouter boots, renderer paints the sidebar", async () => {
  const app = await electron.launch({
    args: [path.join(APP_ROOT, ".vite/build/main.js")],
    cwd: APP_ROOT,
    env: { ...process.env, NODE_ENV: "test", OSM_BUILD: "e2e" },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  // The placeholder or real renderer should show "osmRouter" text.
  const body = await win.textContent("body");
  expect(body).toContain("osmRouter");

  // Sandbox / Node-integration is OFF (S1.1–S1.5)
  const sandboxOn = await win.evaluate(() => {
    return typeof (globalThis as unknown as { require?: unknown }).require === "undefined";
  });
  expect(sandboxOn).toBe(true);

  const nodeProcessLeak = await win.evaluate(() => {
    return typeof (globalThis as unknown as { process?: { versions?: unknown } }).process?.versions === "undefined";
  });
  expect(nodeProcessLeak).toBe(true);

  // window.osmAPI is exposed (allow-listed bridge)
  const hasOsmAPI = await win.evaluate(() => typeof (window as unknown as { osmAPI?: unknown }).osmAPI === "object");
  expect(hasOsmAPI).toBe(true);

  await app.close();
});
