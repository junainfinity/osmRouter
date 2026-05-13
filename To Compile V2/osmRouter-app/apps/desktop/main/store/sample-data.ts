/**
 * @fileoverview Demo/fixture data for the in-memory store.
 *
 * This file holds the example domains the screenshot script and the
 * integration test suite use to exercise the UI and the IPC handlers.
 *
 * **This is NOT loaded into the production app.** The Main process
 * (`main/index.ts`) constructs the store with an empty seed. A fresh
 * install therefore starts with zero domains and surfaces the
 * "No verified domains yet" empty state, prompting the user to verify
 * a real domain through the web dashboard.
 *
 * The fixture is opt-in via the `OSM_DEMO=1` environment variable. The
 * screenshot capture script sets this env var so it can render the demo
 * UI; nothing else does.
 */

import type { Domain } from "@osmrouter/shared";

/**
 * Demo set of domains used by the screenshot script and integration
 * tests. Mirrors the JSX prototype's seed so the rendered screenshots
 * stay in lock-step with the design canvas.
 *
 * Two real demo "apps" are represented:
 *   - GlobalAINews.com — self-hosted WordPress (LAMP)
 *   - MicroSaaS.com    — MEAN stack
 *
 * Plus a handful of unassigned domains and domains locked to other
 * devices, so the UI's three states (`self`, `unassigned`, foreign-lock)
 * are all exercised.
 */
export const SAMPLE_DOMAINS: Domain[] = [
  { id: "g1", name: "globalainews.com", app: "GlobalAINews", stack: "WordPress", proto: "HTTP", port: 8080, target: "127.0.0.1", status: "active", uptime: 432109, locked: "self", added: 14, error: null },
  { id: "g2", name: "www.globalainews.com", app: "GlobalAINews", stack: "WordPress", proto: "HTTP", port: 8080, target: "127.0.0.1", status: "active", uptime: 432020, locked: "self", added: 14, error: null },
  { id: "g3", name: "cdn.globalainews.com", app: "GlobalAINews", stack: "WordPress", proto: "HTTPS", port: 8443, target: "127.0.0.1", status: "active", uptime: 86340, locked: "self", added: 12, error: null },
  { id: "g4", name: "wp-admin.globalainews.com", app: "GlobalAINews", stack: "WordPress", proto: "HTTP", port: 8080, target: "127.0.0.1", status: "idle", uptime: 0, locked: "self", added: 12, error: null },
  { id: "m1", name: "microsaas.com", app: "MicroSaaS", stack: "Angular (Node)", proto: "HTTP", port: 4200, target: "127.0.0.1", status: "active", uptime: 12603, locked: "self", added: 6, error: null },
  { id: "m2", name: "app.microsaas.com", app: "MicroSaaS", stack: "Angular (Node)", proto: "HTTP", port: 4200, target: "127.0.0.1", status: "active", uptime: 12603, locked: "self", added: 6, error: null },
  { id: "m3", name: "api.microsaas.com", app: "MicroSaaS", stack: "Express (Node)", proto: "HTTP", port: 3001, target: "127.0.0.1", status: "active", uptime: 12598, locked: "self", added: 6, error: null },
  { id: "m4", name: "db.microsaas.com", app: "MicroSaaS", stack: "MongoDB", proto: "TCP", port: 27017, target: "127.0.0.1", status: "active", uptime: 91204, locked: "self", added: 5, error: null },
  { id: "m5", name: "webhooks.microsaas.com", app: "MicroSaaS", stack: "Express (Node)", proto: "HTTP", port: 3002, target: "127.0.0.1", status: "error", uptime: 0, locked: "self", added: 4, error: "No local service on :3002" },
  { id: "m6", name: "staging.microsaas.com", app: "MicroSaaS", stack: "Angular (Node)", proto: "HTTPS", port: 4201, target: "127.0.0.1", status: "idle", uptime: 0, locked: "self", added: 4, error: null },
  { id: "u1", name: "preview.microsaas.com", app: null, stack: null, proto: "HTTP", port: null, target: "127.0.0.1", status: "idle", uptime: 0, locked: "unassigned", added: 1, error: null },
  { id: "u2", name: "blog.globalainews.com", app: null, stack: null, proto: "HTTP", port: null, target: "127.0.0.1", status: "idle", uptime: 0, locked: "unassigned", added: 0, error: null },
  { id: "x1", name: "ai.globalainews.com", app: null, stack: null, proto: "HTTP", port: null, target: "127.0.0.1", status: "idle", uptime: 0, locked: "Eshaan's-Mac-Studio", added: 9, error: null },
  { id: "x2", name: "edge.globalainews.com", app: null, stack: null, proto: "HTTPS", port: null, target: "127.0.0.1", status: "idle", uptime: 0, locked: "ci-runner-prod", added: 8, error: null },
  { id: "x3", name: "admin.microsaas.com", app: null, stack: null, proto: "HTTP", port: null, target: "127.0.0.1", status: "idle", uptime: 0, locked: "Eshaan's-Mac-Studio", added: 7, error: null },
];

/**
 * Resolve which seed to use at boot time.
 *
 * The production default is an empty array — a fresh install of
 * osmRouter should show no domains until the user verifies one through
 * the web dashboard.
 *
 * Setting `OSM_DEMO=1` in the environment causes the seed to be
 * SAMPLE_DOMAINS. The screenshot capture script uses this. End-users
 * never have this env var set, so a fresh install always boots empty.
 *
 * @returns the array of seed domains to hydrate the store with
 */
export function resolveSeed(): Domain[] {
  if (process.env["OSM_DEMO"] === "1") return SAMPLE_DOMAINS;
  return [];
}
