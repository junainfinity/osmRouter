// Concrete IPC handlers. Wires each channel to the appropriate service:
// AuthFlow, KeychainStore, SidecarManager, etc.

import {
  REQUEST_CHANNELS,
  type Domain,
  type Settings,
} from "@osmrouter/shared";
import type { IpcRouter } from "./router.js";
import type { AuthFlow } from "../auth/flow.js";
import type { SidecarManager } from "../sidecar/manager.js";
import type { OsmLogger } from "../logger/index.js";
import { preflightPort } from "../net/port-preflight.js";
import * as cloud from "../cloud/api.js";
import { scanServices, probeOne } from "../services/scan.js";

export interface AppDataStore {
  listDomains(): Promise<Domain[]>;
  upsertDomain(d: Domain): Promise<Domain>;
  getDomain(id: string): Promise<Domain | null>;
  getSettings(): Promise<Settings>;
  updateSettings(partial: Partial<Settings>): Promise<Settings>;
  setTunnelStatus(domainId: string, status: Domain["status"], error?: string | null): Promise<void>;
}

export interface WireDeps {
  router: IpcRouter;
  auth: AuthFlow;
  sidecar: SidecarManager;
  logger: OsmLogger;
  app: { getVersion(): string };
  store: AppDataStore;
  proxyUrl: string;
  rootCaPath: string;
  deviceId: string;
  deviceName: string;
  openExternal: (url: string) => Promise<void>;
  /** Base URL of the cloud API (e.g. https://api.osmrouter.com). Used by paste-API-key sign-in. */
  apiBase: string;
}

export function wireHandlers(deps: WireDeps): void {
  const { router, auth, sidecar, logger, app, store, proxyUrl, rootCaPath } = deps;

  router.register(REQUEST_CHANNELS.AUTH_START_PKCE, () => auth.begin());
  router.register(REQUEST_CHANNELS.AUTH_STATUS, () => auth.status());
  router.register(REQUEST_CHANNELS.AUTH_SIGN_OUT, async () => {
    await sidecar.stop();
    await auth.signOut();
    return { ok: true as const };
  });

  // Paste-API-key sign-in (renderer's SignInModal calls this).
  router.register(REQUEST_CHANNELS.AUTH_SIGN_IN_WITH_KEY, async (raw: unknown) => {
    const input = raw as { apiKey: string };
    try {
      const state = await auth.signInWithKey({ apiKey: input.apiKey, apiBase: deps.apiBase });
      return {
        ok: true as const,
        email: state.email ?? "",
        name: undefined,
        role: undefined,
      };
    } catch (err) {
      const code = err instanceof Error ? err.message : "unknown";
      logger.warn({ code }, "auth:signInWithKey-failed");
      return { ok: false as const, error: code };
    }
  });

  router.register(REQUEST_CHANNELS.DOMAINS_LIST, async () => {
    // Kept for backward-compat with the local-only DomainsView. Cloud
    // truth lives behind CLOUD_LIST_BINDINGS — see below.
    const domains = await store.listDomains();
    return { domains };
  });

  // Cloud-truth domain list. Pulls everything the user has on the dashboard
  // via the device API key Bearer header. Renderer renders this directly.
  const cloudDeps: cloud.CloudDeps = {
    apiBase: deps.apiBase,
    getApiKey: () => auth.getAccessToken(),
    logger,
  };

  router.register(REQUEST_CHANNELS.CLOUD_LIST_BINDINGS, async () => {
    // Use the cloud-side device id (the one the pasted API key resolves to),
    // NOT the locally-generated deps.deviceId — they're unrelated.
    const cloudDeviceId = (await auth.getCloudDeviceId()) ?? deps.deviceId;
    const bindings = await cloud.listBindings(cloudDeps, cloudDeviceId);
    return { bindings };
  });

  router.register(REQUEST_CHANNELS.CLOUD_BIND_PORT, async (raw: unknown) => {
    const input = raw as { domainId: string; prefix: string; port: number };
    // 1) make sure the device is online on the control plane.
    try { await cloud.heartbeat(cloudDeps); } catch (err) {
      logger.warn({ err: String(err) }, "cloud:heartbeat-failed");
    }
    // 2) create the subdomain row (or reuse if it exists).
    const sub = await cloud.createSubdomain(cloudDeps, input.domainId, input.prefix, input.port);
    // 3) bind it to this device — use cloud-side device id.
    const cloudDeviceId = (await auth.getCloudDeviceId()) ?? deps.deviceId;
    await cloud.bindSubdomain(cloudDeps, sub.id, cloudDeviceId);
    // 4) spawn the local sidecar.
    const token = await auth.getAccessToken();
    if (!token) throw new Error("not-signed-in");
    const fqdn = await cloud.listDomains(cloudDeps).then((ds) => {
      const d = ds.find((x) => x.id === input.domainId);
      return d ? (input.prefix === "" ? d.fqdn : `${input.prefix}.${d.fqdn}`) : "";
    });
    if (!fqdn) throw new Error("domain-not-found");
    await sidecar.startTunnel(sub.id, {
      domain: fqdn,
      port: input.port,
      proto: "HTTP",
      target: "127.0.0.1",
      token,
      proxyUrl,
      rootCaPath,
    });
    logger.info({ subdomainId: sub.id, fqdn, port: input.port }, "cloud:bind-port-done");
    return { ok: true as const, subdomainId: sub.id, fqdn };
  });

  router.register(REQUEST_CHANNELS.CLOUD_UNBIND, async (raw: unknown) => {
    const input = raw as { subdomainId: string };
    try { await sidecar.stopTunnel(input.subdomainId, "ipc-unbind"); } catch { /* ok if not running */ }
    await cloud.unbindSubdomain(cloudDeps, input.subdomainId);
    return { ok: true as const };
  });

  router.register(REQUEST_CHANNELS.SERVICES_SCAN, async () => {
    const services = await scanServices({ logger });
    return { services };
  });

  router.register(REQUEST_CHANNELS.SERVICES_PROBE_ONE, async (raw: unknown) => {
    const input = raw as { host: string; port: number };
    return probeOne(input.host, input.port, logger);
  });

  router.register(REQUEST_CHANNELS.DOMAINS_ADD, async (raw: unknown) => {
    const input = raw as { name: string; app?: string; stack?: string; proto?: "HTTP" | "HTTPS" | "TCP"; port?: number };
    const newDom: Domain = {
      id: `d_${Date.now().toString(36)}`,
      name: input.name.toLowerCase(),
      app: input.app ?? null,
      stack: input.stack ?? null,
      proto: input.proto ?? "HTTP",
      port: input.port ?? null,
      target: "127.0.0.1",
      status: "idle",
      uptime: 0,
      locked: "self",
      added: Math.floor(Date.now() / 1000),
      error: null,
    };
    return { domain: await store.upsertDomain(newDom) };
  });

  router.register(REQUEST_CHANNELS.TUNNEL_PREFLIGHT_PORT, async (raw: unknown) => {
    const input = raw as { port: number; host: string };
    const result = await preflightPort({ host: input.host, port: input.port });
    return result.reason ? { reachable: result.reachable, reason: result.reason } : { reachable: result.reachable };
  });

  router.register(REQUEST_CHANNELS.TUNNEL_START, async (raw: unknown) => {
    const input = raw as { domainId: string; port: number; proto: "HTTP" | "HTTPS" | "TCP"; target: string; consentLanBind: boolean };
    const dom = await store.getDomain(input.domainId);
    if (!dom) throw new Error("domain-not-found");
    if (dom.locked !== "self") throw new Error("domain-not-locked-to-this-device");
    if (input.target !== "127.0.0.1" && !input.consentLanBind) {
      throw new Error("lan-bind-requires-consent");
    }
    const pf = await preflightPort({ host: input.target, port: input.port });
    if (!pf.reachable) {
      await store.setTunnelStatus(dom.id, "error", `No local service detected on :${input.port}`);
      throw new Error(`preflight-failed:${pf.reason ?? "unknown"}`);
    }
    const token = await auth.getAccessToken();
    if (!token) throw new Error("not-authenticated");
    if (sidecar.isInDiagnosticMode(dom.id)) throw new Error("in-diagnostic-mode");

    await store.setTunnelStatus(dom.id, "starting");
    await sidecar.startTunnel(dom.id, {
      domain: dom.name,
      port: input.port,
      proto: input.proto,
      target: input.target,
      token,
      proxyUrl,
      rootCaPath,
    });
    logger.info({ domainId: dom.id, name: dom.name, port: input.port }, "tunnel:start-issued");
    return { status: "starting" as const };
  });

  router.register(REQUEST_CHANNELS.TUNNEL_STOP, async (raw: unknown) => {
    const input = raw as { domainId: string };
    await sidecar.stopTunnel(input.domainId, "ipc-stop");
    await store.setTunnelStatus(input.domainId, "idle");
    return { status: "idle" as const };
  });

  router.register(REQUEST_CHANNELS.TUNNEL_LIST, async () => {
    const all = await store.listDomains();
    return {
      tunnels: all
        .filter((d) => d.status === "active" || d.status === "starting")
        .map((d) => ({
          domainId: d.id,
          domain: d.name,
          port: d.port ?? 0,
          status: d.status,
          uptimeSec: d.uptime,
        })),
    };
  });

  router.register(REQUEST_CHANNELS.SETTINGS_GET, () => store.getSettings());
  router.register(REQUEST_CHANNELS.SETTINGS_UPDATE, async (raw: unknown) => {
    return store.updateSettings(raw as Partial<Settings>);
  });

  router.register(REQUEST_CHANNELS.DIAG_GET_INFO, async () => ({
    version: app.getVersion(),
    build: process.env["OSM_BUILD"] ?? "dev",
    platform: process.platform,
    arch: process.arch,
    electron: process.versions["electron"] ?? "n/a",
    node: process.versions["node"] ?? "n/a",
    deviceId: deps.deviceId,
    deviceName: deps.deviceName,
    logPath: logger.getPath(),
    logSizeBytes: logger.getSizeBytes(),
  }));

  router.register(REQUEST_CHANNELS.DIAG_EXPORT_LOGS, async () => {
    logger.flush();
    return { path: logger.getPath() };
  });

  router.register(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, async (raw: unknown) => {
    const input = raw as { url: string };
    await deps.openExternal(input.url);
    return { ok: true as const };
  });

  router.register(REQUEST_CHANNELS.SYS_GET_VERSION, () => ({
    version: app.getVersion(),
    build: process.env["OSM_BUILD"] ?? "dev",
  }));
}
