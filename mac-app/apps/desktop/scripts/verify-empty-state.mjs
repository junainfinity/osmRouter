#!/usr/bin/env node
// One-shot: launch the app WITHOUT OSM_DEMO and verify the empty state.
// Writes proof screenshots into Whitepaper/screenshots/ so the empty-state
// can be referenced in the docs if needed.

import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(APP_ROOT, "..", "..", "..");
const OUT = path.join(PROJECT_ROOT, "Whitepaper", "screenshots");
await fs.mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env, NODE_ENV: "test", OSM_BUILD: "verify-empty" };
delete env.OSM_DEMO; // explicit — make sure no demo data is injected

console.log("Launching Electron WITHOUT OSM_DEMO …");
const app = await electron.launch({
  args: [path.join(APP_ROOT, ".vite/build/main.js")],
  cwd: APP_ROOT,
  env,
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await sleep(800);
await win.setViewportSize({ width: 1280, height: 800 });

const counts = await win.evaluate(() => {
  return {
    domainCount: document.querySelectorAll('span.mono').length,
    bodyText: (document.body.textContent || "").slice(0, 1000),
  };
});

const dark = path.join(OUT, "13-empty-state-dark.png");
const light = path.join(OUT, "14-empty-state-light.png");

await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await sleep(200);
await win.screenshot({ path: dark, type: "png" });
console.log(`  ✓ ${path.relative(PROJECT_ROOT, dark)}`);

await win.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await sleep(200);
await win.screenshot({ path: light, type: "png" });
console.log(`  ✓ ${path.relative(PROJECT_ROOT, light)}`);

console.log("");
console.log("Snapshot of renderer text (first 1000 chars):");
console.log(counts.bodyText);

const hasEmptyMsg = counts.bodyText.includes("No verified domains yet");
const hasSampleDomain =
  counts.bodyText.includes("globalainews.com") ||
  counts.bodyText.includes("microsaas.com") ||
  counts.bodyText.includes("api.microsaas.com");

console.log("");
console.log(`empty-state copy present: ${hasEmptyMsg ? "YES ✓" : "NO ✗"}`);
console.log(`sample-domain text leaked: ${hasSampleDomain ? "YES ✗" : "NO ✓"}`);
console.log("");
const ok = hasEmptyMsg && !hasSampleDomain;
console.log(ok ? "RESULT: PRODUCTION BUILD STARTS CLEAN" : "RESULT: FAILED — sample data appears in production build");

await app.close();
process.exit(ok ? 0 : 1);
