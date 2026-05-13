// The renderer-side type for `window.osmAPI`. Mirrors preload/index.ts.
// We can't directly import from preload (would pull `electron` into the
// renderer bundle), so we redeclare structurally.

export interface OsmAPI {
  auth: {
    startPkce: () => Promise<{ authUrl: string }>;
    status: () => Promise<{ signedIn: boolean; email?: string; workspace?: string }>;
    signOut: () => Promise<{ ok: true }>;
    signInWithKey: (
      apiKey: string,
    ) => Promise<
      | { ok: true; email: string; name?: string; role?: string }
      | { ok: false; error: string }
    >;
  };
  domains: {
    list: () => Promise<{ domains: DomainRow[] }>;
    add: (input: { name: string; app?: string; stack?: string; proto?: "HTTP" | "HTTPS" | "TCP"; port?: number }) => Promise<{ domain: DomainRow }>;
  };
  cloud: {
    listBindings: () => Promise<{ bindings: CloudBinding[] }>;
    bindPort: (input: { domainId: string; prefix: string; port: number }) => Promise<{ ok: true; subdomainId: string; fqdn: string }>;
    unbind: (subdomainId: string) => Promise<{ ok: true }>;
  };
  services: {
    scan: () => Promise<{ services: LocalService[] }>;
    probeOne: (host: string, port: number) => Promise<LocalService>;
  };
  tunnel: {
    start: (input: { domainId: string; port: number; proto: "HTTP" | "HTTPS" | "TCP"; target: string; consentLanBind: boolean }) => Promise<{ status: string }>;
    stop: (input: { domainId: string }) => Promise<{ status: string }>;
    list: () => Promise<{ tunnels: unknown[] }>;
    preflightPort: (input: { port: number; host?: string }) => Promise<{ reachable: boolean; reason?: string }>;
  };
  settings: {
    get: () => Promise<Settings>;
    update: (input: Partial<Settings>) => Promise<Settings>;
  };
  diag: {
    getInfo: () => Promise<DiagInfo>;
    exportLogs: () => Promise<{ path: string }>;
  };
  sys: {
    openExternal: (url: string) => Promise<{ ok: true }>;
    getVersion: () => Promise<{ version: string; build: string }>;
  };
  events: {
    onTunnelStatusUpdate: (cb: (p: { domainId: string; status: string; error?: string | null }) => void) => () => void;
    onTelemetryTick: (cb: (p: { domainId: string; inbound: number; outbound: number; latencyMs: number; activeConns: number; t: number }) => void) => () => void;
    onRequestObserved: (cb: (p: ReqObserved) => void) => () => void;
    onNetworkStateChange: (cb: (p: { state: string; edge?: string }) => void) => () => void;
    onAuthStateChange: (cb: (p: { signedIn: boolean; email?: string }) => void) => () => void;
    onDiagnosticMode: (cb: (p: { reason: string; crashCount: number; windowSec: number }) => void) => () => void;
    onIntegrityViolation: (cb: (p: { expected: string; actual: string; binaryPath: string }) => void) => () => void;
  };
}

export interface DomainRow {
  id: string;
  name: string;
  app: string | null;
  stack: string | null;
  proto: "HTTP" | "HTTPS" | "TCP";
  port: number | null;
  target: string;
  status: "idle" | "starting" | "active" | "error" | "stopping";
  uptime: number;
  locked: "self" | "unassigned" | string;
  added: number;
  error?: string | null;
}

/** Result of probing a local TCP port for a service. */
export interface LocalService {
  host: string;
  port: number;
  open: boolean;
  kind: string;
  title?: string;
  details?: string;
}

/**
 * One row per (domain × subdomain) on the user's cloud account. Domains
 * with no subdomains emit one placeholder row with subdomainId = null.
 */
export interface CloudBinding {
  domainId: string;
  subdomainId: string | null;
  fqdn: string;        // full hostname: "a2a.one" or "llm.tunnel.osmrouter.com"
  bareDomain: string;  // the verified registrar-side root: "a2a.one"
  prefix: string | null; // null = placeholder (no binding yet), "" = apex, "x" = subdomain
  port: number | null;
  dnsStatus: string;
  boundToThisDevice: boolean;
  boundDeviceId: string | null;
}

export interface Settings {
  launchAtLogin: boolean;
  autoUpdate: boolean;
  desktopNotifications: boolean;
  theme: "light" | "dark" | "system";
}

export interface DiagInfo {
  version: string;
  build: string;
  platform: string;
  arch: string;
  electron: string;
  node: string;
  deviceId: string;
  deviceName: string;
  logPath: string;
  logSizeBytes: number;
}

export interface ReqObserved {
  id: number;
  t: number;
  domain: string;
  method: string;
  path: string;
  status: number;
  latency: number;
  size: number;
  remote: string;
}

declare global {
  interface Window {
    osmAPI?: OsmAPI;
  }
}
