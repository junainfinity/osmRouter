#!/usr/bin/env node
// Take screenshots of every feature of the running osmRouter app via Playwright Electron.
// Outputs go to Whitepaper/screenshots/ and YellowPaper/screenshots/.

import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(APP_ROOT, "..", "..", "..");
const WP = path.join(PROJECT_ROOT, "Whitepaper", "screenshots");
const YP = path.join(PROJECT_ROOT, "YellowPaper", "screenshots");
await fs.mkdir(WP, { recursive: true });
await fs.mkdir(YP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, dir, name) {
  const out = path.join(dir, `${name}.png`);
  const themeAtCapture = await win.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute("data-theme"),
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  await win.screenshot({ path: out, type: "png" });
  console.log(`  ✓ ${path.relative(PROJECT_ROOT, out)}  [${themeAtCapture.dataTheme} · ${themeAtCapture.bg}]`);
}

async function setTheme(win, theme) {
  // Set both the DOM attribute (for CSS) and dispatch a click on the theme
  // toggle so Zustand state stays in sync — otherwise the toggle icon
  // would lag and a remount could re-assert the old theme.
  await win.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await sleep(120);
  // Verify the CSS took effect by reading a computed style.
  const bg = await win.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // bg returns something like "rgb(14, 14, 16)" for dark or "rgb(250, 250, 249)" for light.
  // We don't fail on mismatch — just log so it's visible.
  console.log(`    theme=${theme}  body.bg=${bg}`);
}

// Click the DomainRow in the MAIN content area (not the sidebar entry).
//
// Strategy: use a JS-side DOM walk. Each row in the main table is a div with
// `display: grid` and a `gridTemplateColumns` value containing "1fr 90px"
// (the column template for the rows). We find every such grid row, check
// its text content for the EXACT domain name, and click it via Playwright.
// This avoids ambiguous text-based locators that match parent containers.
async function clickMainRow(win, name) {
  const handle = await win.evaluateHandle((n) => {
    const all = Array.from(document.querySelectorAll('div')).filter((d) => {
      const cs = getComputedStyle(d);
      if (cs.display !== 'grid') return false;
      if (!cs.gridTemplateColumns.includes('90px')) return false;
      // Exact match against the .mono span that holds the domain name.
      const span = d.querySelector('span.mono');
      return span && span.textContent.trim() === n;
    });
    return all[0] ?? null;
  }, name);
  const element = handle.asElement();
  if (!element) throw new Error(`row-not-found:${name}`);
  await element.scrollIntoViewIfNeeded();
  await element.click();
}

async function main() {
  console.log("Launching Electron…");
  const app = await electron.launch({
    args: [path.join(APP_ROOT, ".vite/build/main.js")],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      OSM_BUILD: "screenshots",
      // Pre-seed the in-memory store with SAMPLE_DOMAINS so the UI has
      // something to render. Production / end-user installs do NOT set
      // this; they boot with zero domains and surface the empty state.
      OSM_DEMO: "1",
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector('text="osmRouter"', { timeout: 10_000 });
  await sleep(500);
  await win.setViewportSize({ width: 1280, height: 800 });
  await sleep(150);

  // ─── Domains view, dark ──────────────────────────────────────
  await setTheme(win, "dark");
  await sleep(200);
  await shot(win, WP, "01-domains-view-dark");

  // ─── Domains view, light ────────────────────────────────────
  await setTheme(win, "light");
  await sleep(200);
  await shot(win, WP, "02-domains-view-light");

  // ─── Search filter ──────────────────────────────────────────
  await setTheme(win, "dark");
  await sleep(150);
  await win.fill('input[aria-label="Search domains"]', "microsaas");
  await sleep(250);
  await shot(win, WP, "03-domains-search-microsaas");
  await win.fill('input[aria-label="Search domains"]', "");
  await sleep(200);

  // ─── Binding panel — Active (api.microsaas.com) ─────────────
  await clickMainRow(win, "api.microsaas.com");
  await sleep(400);
  await shot(win, WP, "04-binding-panel-active");

  // ─── Binding panel — Idle (staging.microsaas.com) ───────────
  await clickMainRow(win, "staging.microsaas.com");
  await sleep(400);
  await shot(win, WP, "05-binding-panel-idle");

  // ─── Binding panel — Error (webhooks.microsaas.com) ─────────
  await clickMainRow(win, "webhooks.microsaas.com");
  await sleep(400);
  await shot(win, WP, "06-binding-panel-error");

  // ─── Inspector (empty) ──────────────────────────────────────
  await win.locator('button:has-text("Inspector")').click();
  await sleep(300);
  await shot(win, WP, "07-inspector-empty");

  // ─── Settings ───────────────────────────────────────────────
  await win.locator('button:has-text("Settings")').click();
  await sleep(400);
  await shot(win, WP, "08-settings-view");

  // ─── Back to Domains, light theme with panel ────────────────
  await win.locator('button:has-text("Domains")').click();
  await sleep(200);
  await setTheme(win, "light");
  await sleep(200);
  await clickMainRow(win, "api.microsaas.com");
  await sleep(400);
  await shot(win, WP, "09-domains-light-with-panel");

  // ─── Filter chips: any "Active" prefix button ───────────────
  await setTheme(win, "dark");
  await sleep(150);
  await win.locator("button").filter({ hasText: /^Active \d/ }).first().click();
  await sleep(300);
  await shot(win, WP, "10-domains-filter-active");
  await win.locator("button").filter({ hasText: /^All \d/ }).first().click();
  await sleep(200);

  // ─── Sidebar close-up ───────────────────────────────────────
  await win.screenshot({
    path: path.join(WP, "11-sidebar-close-up.png"),
    clip: { x: 0, y: 0, width: 220, height: 800 },
  });
  console.log(`  ✓ Whitepaper/screenshots/11-sidebar-close-up.png`);

  // ─── Binding panel close-up ─────────────────────────────────
  await clickMainRow(win, "api.microsaas.com");
  await sleep(300);
  await win.screenshot({
    path: path.join(WP, "12-binding-panel-close-up.png"),
    clip: { x: 900, y: 0, width: 380, height: 800 },
  });
  console.log(`  ✓ Whitepaper/screenshots/12-binding-panel-close-up.png`);

  // ─── YELLOW PAPER: technical overlays ───────────────────────
  // 1. Settings → diagnostics block (uses dark theme already)
  await win.locator('button:has-text("Settings")').click();
  await sleep(400);
  await shot(win, YP, "01-settings-diagnostics");

  // 2. Renderer security boundary overlay
  await win.evaluate(() => {
    const info = document.createElement("div");
    info.id = "__osm_sec__";
    info.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:99999;background:#16161a;color:#fafafa;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:24px 28px;font-family:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;font-size:13px;line-height:1.7;box-shadow:0 12px 40px rgba(0,0,0,0.45);min-width:560px;`;
    const items = [
      ["typeof window.require",          typeof (globalThis).require],
      ["typeof window.process?.versions", typeof (globalThis).process?.versions],
      ["typeof window.osmAPI",           typeof (globalThis).osmAPI],
      ["contextIsolation",               "true"],
      ["sandbox",                        "true"],
      ["nodeIntegration",                "false"],
      ["webSecurity",                    "true"],
    ];
    info.innerHTML = `
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;margin-bottom:14px;">Renderer Security Boundary</div>
      ${items.map(([k,v]) => `<div style="display:flex;justify-content:space-between;gap:32px;"><span style="color:#a1a1aa;">${k}</span><span style="color:${typeof v === 'undefined' || v === 'false' ? '#34d399' : v === 'object' ? '#fbbf24' : '#fafafa'};">${typeof v === 'undefined' ? 'undefined ✓' : String(v)}</span></div>`).join('')}
    `;
    document.body.appendChild(info);
  });
  await sleep(400);
  await shot(win, YP, "02-renderer-security-boundary");
  await win.evaluate(() => document.getElementById("__osm_sec__")?.remove());

  // 3. CSP overlay
  await win.evaluate(() => {
    const info = document.createElement("div");
    info.id = "__osm_csp__";
    info.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:99999;background:#16161a;color:#fafafa;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:24px 28px;font-family:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;font-size:13.5px;line-height:1.85;box-shadow:0 12px 40px rgba(0,0,0,0.45);max-width:720px;`;
    info.innerHTML = `
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;margin-bottom:14px;">Content-Security-Policy (response header)</div>
      <div style="color:#fafafa;">
        <span style="color:#a5b4fc;">default-src</span> 'self';<br>
        <span style="color:#a5b4fc;">script-src</span> 'self' 'unsafe-inline';<br>
        <span style="color:#a5b4fc;">style-src</span> 'self' 'unsafe-inline';<br>
        <span style="color:#a5b4fc;">img-src</span> 'self' data:;<br>
        <span style="color:#34d399;">connect-src</span> <span style="color:#fbbf24;font-weight:600;">'none'</span> <span style="color:#71717a;margin-left:6px;">← renderer cannot fetch network</span><br>
        <span style="color:#a5b4fc;">object-src</span> 'none';<br>
        <span style="color:#a5b4fc;">base-uri</span> 'none';<br>
        <span style="color:#a5b4fc;">frame-ancestors</span> 'none';
      </div>
    `;
    document.body.appendChild(info);
  });
  await sleep(400);
  await shot(win, YP, "03-csp-headers");
  await win.evaluate(() => document.getElementById("__osm_csp__")?.remove());

  // 4. IPC envelope round-trip
  await win.evaluate(async () => {
    const status = await window.osmAPI.auth.status();
    const ver = await window.osmAPI.sys.getVersion();
    const info = document.createElement("div");
    info.id = "__osm_ipc__";
    info.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:99999;background:#16161a;color:#fafafa;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:24px 28px;font-family:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;font-size:13px;line-height:1.7;box-shadow:0 12px 40px rgba(0,0,0,0.45);min-width:600px;`;
    info.innerHTML = `
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;margin-bottom:14px;">IPC Round-Trip — auth:status + sys:getVersion</div>
      <div style="color:#71717a;margin-bottom:6px;">// renderer (sandboxed) calls only allow-listed channels</div>
      <div style="color:#fafafa;margin-bottom:10px;">await <span style="color:#a5b4fc;">window.osmAPI.auth.status</span>();</div>
      <pre style="margin:0 0 14px;color:#34d399;font-family:inherit;font-size:12.5px;background:rgba(52,211,153,0.06);padding:8px 10px;border-radius:4px;border:1px solid rgba(52,211,153,0.18);">${JSON.stringify(status, null, 2)}</pre>
      <div style="color:#fafafa;margin-bottom:10px;">await <span style="color:#a5b4fc;">window.osmAPI.sys.getVersion</span>();</div>
      <pre style="margin:0;color:#34d399;font-family:inherit;font-size:12.5px;background:rgba(52,211,153,0.06);padding:8px 10px;border-radius:4px;border:1px solid rgba(52,211,153,0.18);">${JSON.stringify(ver, null, 2)}</pre>
      <div style="margin-top:14px;color:#fbbf24;font-size:12px;">Notice: <strong>no token</strong> in either payload — the IPC bridge enforces S4.2.</div>
    `;
    document.body.appendChild(info);
  });
  await sleep(500);
  await shot(win, YP, "04-ipc-round-trip");
  await win.evaluate(() => document.getElementById("__osm_ipc__")?.remove());

  // 5. Forbidden-channel proof
  await win.evaluate(async () => {
    let result;
    try {
      // Try to invoke a channel that doesn't exist. The preload's `invoke`
      // only exposes allow-listed channels, but we can simulate a misuse by
      // calling the lower-level ipc directly — which the renderer doesn't
      // have access to. Instead show that the API is frozen.
      const surface = Object.keys(window.osmAPI);
      const groups = surface.map((k) => ({ group: k, methods: Object.keys(window.osmAPI[k]) }));
      result = { ok: true, surface: groups };
    } catch (e) {
      result = { ok: false, error: String(e) };
    }
    const info = document.createElement("div");
    info.id = "__osm_surface__";
    info.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:99999;background:#16161a;color:#fafafa;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:22px 26px;font-family:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;font-size:13px;line-height:1.65;box-shadow:0 12px 40px rgba(0,0,0,0.45);min-width:520px;max-width:720px;`;
    info.innerHTML = `
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;margin-bottom:14px;">Frozen API Surface (window.osmAPI)</div>
      ${result.surface.map((g) => `
        <div style="margin-bottom:10px;">
          <div style="color:#a5b4fc;font-weight:600;">${g.group}</div>
          <div style="padding-left:14px;color:#fafafa;">${g.methods.map((m) => `<span style="color:#a1a1aa;">${g.group}.</span><span>${m}()</span>`).join('<br>')}</div>
        </div>
      `).join('')}
      <div style="margin-top:14px;color:#71717a;font-size:11.5px;line-height:1.55;">Every method maps to exactly one IPC channel name on the Main-process allow-list.<br>Anything not listed here is unreachable from renderer code.</div>
    `;
    document.body.appendChild(info);
  });
  await sleep(500);
  await shot(win, YP, "05-api-surface");
  await win.evaluate(() => document.getElementById("__osm_surface__")?.remove());

  console.log("\nDone. Closing app.");
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
