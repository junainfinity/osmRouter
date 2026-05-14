/**
 * @fileoverview In-process domain & settings store.
 *
 * In production this is a thin local cache hydrated from the cloud backend
 * (which is the source of truth for verified domains and device locks).
 * In v0.1 the cloud sync is not yet wired, so the store starts EMPTY on a
 * fresh install — the user sees the "No verified domains yet" empty state
 * until they sign in and the dashboard syncs their domains down.
 *
 * The constructor takes an explicit seed (no default). This is deliberate:
 *   - Production: `new InMemoryStore([])` (see `main/index.ts`).
 *   - Tests: `new InMemoryStore(SAMPLE_DOMAINS)` (see `main/store/sample-data.ts`).
 *   - Screenshot script: gated by `OSM_DEMO_DATA=1` env var in main.
 *
 * Forcing the caller to pass a seed makes it impossible for the demo
 * fixtures to leak into a production build by accident.
 */

import type { Domain, Settings } from "@osmrouter/shared";
import type { AppDataStore } from "../ipc/handlers.js";

export class InMemoryStore implements AppDataStore {
  private domains: Domain[];
  private settings: Settings = {
    launchAtLogin: true,
    autoUpdate: true,
    desktopNotifications: false,
    theme: "system",
  };

  /**
   * Construct a store. `seed` MUST be passed explicitly — pass `[]` for a
   * fresh-install experience, or pass `SAMPLE_DOMAINS` from `sample-data.ts`
   * for tests and demos.
   */
  constructor(seed: Domain[]) {
    this.domains = seed.map((d) => ({ ...d }));
  }

  async listDomains(): Promise<Domain[]> {
    return this.domains.map((d) => ({ ...d }));
  }

  async upsertDomain(d: Domain): Promise<Domain> {
    const idx = this.domains.findIndex((x) => x.id === d.id);
    if (idx >= 0) this.domains[idx] = d;
    else this.domains.unshift(d);
    return { ...d };
  }

  async getDomain(id: string): Promise<Domain | null> {
    const d = this.domains.find((x) => x.id === id);
    return d ? { ...d } : null;
  }

  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async updateSettings(partial: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...partial };
    return { ...this.settings };
  }

  async setTunnelStatus(domainId: string, status: Domain["status"], error?: string | null): Promise<void> {
    const idx = this.domains.findIndex((d) => d.id === domainId);
    if (idx < 0) return;
    const dom = this.domains[idx];
    if (!dom) return;
    this.domains[idx] = {
      ...dom,
      status,
      error: error ?? null,
      uptime: status === "active" ? dom.uptime : 0,
    };
  }
}
