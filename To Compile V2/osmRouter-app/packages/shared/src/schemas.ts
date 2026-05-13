// Zod schemas for every IPC payload. Imported by both Main (for validation
// before dispatch) and Renderer (for type narrowing of responses).
//
// SECURITY: This is the trust boundary. The Main process must run every
// incoming payload through the schema for its channel before doing anything
// observable. See S3.5 in 05 - Security Spec.

import { z } from "zod";
import { REQUEST_CHANNELS, EVENT_CHANNELS, type RequestChannel, type EventChannel } from "./channels.js";

// ── primitives ─────────────────────────────────────────────────────────────

export const PortSchema = z.number().int().min(1).max(65535);

export const DomainNameSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, "invalid-fqdn");

export const ProtocolSchema = z.enum(["HTTP", "HTTPS", "TCP"]);

// IPv4 loopback or RFC1918; "0.0.0.0" and multicast are deliberately rejected.
// LAN bind is allowed but the renderer surfaces a consent modal (S8.1).
export const TargetIpSchema = z
  .string()
  .regex(/^(?:127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/, "invalid-target-ip");

export const TunnelStatusSchema = z.enum(["idle", "starting", "active", "error", "stopping"]);

export const DomainLockSchema = z.union([
  z.literal("self"),
  z.literal("unassigned"),
  // Locked to a named device elsewhere
  z.string().min(1).max(100),
]);

// ── domain entity ──────────────────────────────────────────────────────────

export const DomainSchema = z.object({
  id: z.string().min(1).max(64),
  name: DomainNameSchema,
  app: z.string().min(1).max(80).nullable().optional(),
  stack: z.string().min(1).max(40).nullable().optional(),
  proto: ProtocolSchema,
  port: PortSchema.nullable(),
  target: TargetIpSchema.default("127.0.0.1"),
  status: TunnelStatusSchema,
  uptime: z.number().int().nonnegative().default(0),
  locked: DomainLockSchema,
  added: z.number().int().nonnegative().default(0),
  error: z.string().max(500).nullable().optional(),
});

export type Domain = z.infer<typeof DomainSchema>;

// ── request payloads ───────────────────────────────────────────────────────

export const AuthStartPkcePayload = z.object({}).strict();
export const AuthStartPkceResponse = z.object({
  authUrl: z.string().url(),
});

export const AuthStatusPayload = z.object({}).strict();
export const AuthStatusResponse = z.object({
  signedIn: z.boolean(),
  email: z.string().email().optional(),
  workspace: z.string().optional(),
});

export const AuthSignOutPayload = z.object({}).strict();
export const AuthSignOutResponse = z.object({ ok: z.literal(true) });

// Paste-API-key sign-in. Renderer sends just the api_key; main process
// validates it against the server and returns the user profile on success.
export const AuthSignInWithKeyPayload = z
  .object({ apiKey: z.string().min(20).max(200) })
  .strict();
export const AuthSignInWithKeyResponse = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    email: z.string(),
    name: z.string().optional(),
    role: z.string().optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export const DomainsListPayload = z.object({}).strict();
export const DomainsListResponse = z.object({ domains: z.array(DomainSchema) });

export const DomainsAddPayload = z
  .object({
    name: DomainNameSchema,
    app: z.string().min(1).max(80).optional(),
    stack: z.string().min(1).max(40).optional(),
    proto: ProtocolSchema.default("HTTP"),
    port: PortSchema.optional(),
  })
  .strict();
export const DomainsAddResponse = z.object({ domain: DomainSchema });

export const TunnelStartPayload = z
  .object({
    domainId: z.string().min(1).max(64),
    port: PortSchema,
    proto: ProtocolSchema.default("HTTP"),
    target: TargetIpSchema.default("127.0.0.1"),
    consentLanBind: z.boolean().default(false),
  })
  .strict();
export const TunnelStartResponse = z.object({ status: TunnelStatusSchema });

export const TunnelStopPayload = z.object({ domainId: z.string().min(1).max(64) }).strict();
export const TunnelStopResponse = z.object({ status: TunnelStatusSchema });

export const TunnelListPayload = z.object({}).strict();
export const TunnelListResponse = z.object({
  tunnels: z.array(
    z.object({
      domainId: z.string(),
      domain: DomainNameSchema,
      port: PortSchema,
      status: TunnelStatusSchema,
      uptimeSec: z.number().nonnegative(),
    }),
  ),
});

export const TunnelPreflightPortPayload = z.object({ port: PortSchema, host: TargetIpSchema.default("127.0.0.1") }).strict();
export const TunnelPreflightPortResponse = z.object({
  reachable: z.boolean(),
  reason: z.string().optional(),
});

export const SettingsGetPayload = z.object({}).strict();
export const SettingsSchema = z.object({
  launchAtLogin: z.boolean().default(true),
  autoUpdate: z.boolean().default(true),
  desktopNotifications: z.boolean().default(false),
  theme: z.enum(["light", "dark", "system"]).default("system"),
});
export const SettingsGetResponse = SettingsSchema;
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdatePayload = SettingsSchema.partial().strict();
export const SettingsUpdateResponse = SettingsSchema;

export const DiagExportLogsPayload = z.object({}).strict();
export const DiagExportLogsResponse = z.object({ path: z.string().min(1) });

export const DiagGetInfoPayload = z.object({}).strict();
export const DiagGetInfoResponse = z.object({
  version: z.string(),
  build: z.string(),
  platform: z.string(),
  arch: z.string(),
  electron: z.string(),
  node: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  logPath: z.string(),
  logSizeBytes: z.number().nonnegative(),
});

// External URL must be HTTPS and on a known origin allow-list (S1.6).
// Mirror this list in main/window.ts → ALLOWED_HOSTS to keep both layers
// (IPC validation + shell.openExternal guard) in sync.
const ALLOWED_EXTERNAL_HOSTS = [
  "osmrouter.com",
  "www.osmrouter.com",
  "app.osmrouter.com",
  "api.osmrouter.com",
  "docs.osmrouter.com",
  "download.osmrouter.com",
];
export const SysOpenExternalPayload = z
  .object({ url: z.string().url() })
  .strict()
  .refine(
    (v) => {
      try {
        const u = new URL(v.url);
        return u.protocol === "https:" && ALLOWED_EXTERNAL_HOSTS.includes(u.host);
      } catch {
        return false;
      }
    },
    { message: "external-url-not-allowed" },
  );
export const SysOpenExternalResponse = z.object({ ok: z.literal(true) });

export const SysGetVersionPayload = z.object({}).strict();
export const SysGetVersionResponse = z.object({
  version: z.string(),
  build: z.string(),
});

// ── event payloads (main → renderer) ───────────────────────────────────────

export const TunnelStatusUpdateEvent = z.object({
  domainId: z.string(),
  status: TunnelStatusSchema,
  error: z.string().nullable().optional(),
});

export const TelemetryTickEvent = z.object({
  domainId: z.string(),
  inbound: z.number().nonnegative(),
  outbound: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  activeConns: z.number().int().nonnegative(),
  t: z.number(), // unix ms
});

export const RequestObservedEvent = z.object({
  id: z.number().int(),
  t: z.number(),
  domain: DomainNameSchema,
  method: z.string().max(10),
  path: z.string().max(2048),
  status: z.number().int().min(100).max(599),
  latency: z.number().nonnegative(),
  size: z.number().nonnegative(),
  remote: z.string().max(64),
});

export const NetworkStateChangeEvent = z.object({
  state: z.enum(["connected", "flicker", "reconnecting", "offline", "roaming"]),
  edge: z.string().max(40).optional(),
});

export const AuthStateChangeEvent = z.object({
  signedIn: z.boolean(),
  email: z.string().email().optional(),
});

export const SidecarDiagnosticModeEvent = z.object({
  reason: z.string().max(200),
  crashCount: z.number().int().positive(),
  windowSec: z.number().int().positive(),
});

export const IntegrityViolationEvent = z.object({
  expected: z.string(),
  actual: z.string(),
  binaryPath: z.string(),
});

// ── master maps ────────────────────────────────────────────────────────────

export const REQUEST_SCHEMAS: Record<
  RequestChannel,
  { request: z.ZodSchema; response: z.ZodSchema }
> = {
  [REQUEST_CHANNELS.AUTH_START_PKCE]: { request: AuthStartPkcePayload, response: AuthStartPkceResponse },
  [REQUEST_CHANNELS.AUTH_STATUS]: { request: AuthStatusPayload, response: AuthStatusResponse },
  [REQUEST_CHANNELS.AUTH_SIGN_OUT]: { request: AuthSignOutPayload, response: AuthSignOutResponse },
  [REQUEST_CHANNELS.AUTH_SIGN_IN_WITH_KEY]: {
    request: AuthSignInWithKeyPayload,
    response: AuthSignInWithKeyResponse,
  },
  [REQUEST_CHANNELS.DOMAINS_LIST]: { request: DomainsListPayload, response: DomainsListResponse },
  [REQUEST_CHANNELS.DOMAINS_ADD]: { request: DomainsAddPayload, response: DomainsAddResponse },
  [REQUEST_CHANNELS.CLOUD_LIST_BINDINGS]: {
    request: z.object({}).strict(),
    response: z.object({
      bindings: z.array(
        z.object({
          domainId: z.string(),
          subdomainId: z.string().nullable(),
          fqdn: z.string(),
          bareDomain: z.string(),
          prefix: z.string().nullable(),
          port: z.number().nullable(),
          dnsStatus: z.string(),
          boundToThisDevice: z.boolean(),
          boundDeviceId: z.string().nullable(),
        }),
      ),
    }),
  },
  [REQUEST_CHANNELS.CLOUD_BIND_PORT]: {
    request: z
      .object({
        domainId: z.string(),
        prefix: z.string().max(63), // "" = apex
        port: z.number().int().min(1).max(65535),
      })
      .strict(),
    response: z.object({ ok: z.literal(true), subdomainId: z.string(), fqdn: z.string() }),
  },
  [REQUEST_CHANNELS.CLOUD_UNBIND]: {
    request: z.object({ subdomainId: z.string() }).strict(),
    response: z.object({ ok: z.literal(true) }),
  },
  [REQUEST_CHANNELS.SERVICES_SCAN]: {
    request: z.object({}).strict(),
    response: z.object({
      services: z.array(
        z.object({
          host: z.string(),
          port: z.number(),
          open: z.boolean(),
          kind: z.string(),
          title: z.string().optional(),
          details: z.string().optional(),
        }),
      ),
    }),
  },
  [REQUEST_CHANNELS.SERVICES_PROBE_ONE]: {
    request: z.object({ host: z.string(), port: z.number().int().min(1).max(65535) }).strict(),
    response: z.object({
      host: z.string(),
      port: z.number(),
      open: z.boolean(),
      kind: z.string(),
      title: z.string().optional(),
      details: z.string().optional(),
    }),
  },
  [REQUEST_CHANNELS.TUNNEL_START]: { request: TunnelStartPayload, response: TunnelStartResponse },
  [REQUEST_CHANNELS.TUNNEL_STOP]: { request: TunnelStopPayload, response: TunnelStopResponse },
  [REQUEST_CHANNELS.TUNNEL_LIST]: { request: TunnelListPayload, response: TunnelListResponse },
  [REQUEST_CHANNELS.TUNNEL_PREFLIGHT_PORT]: {
    request: TunnelPreflightPortPayload,
    response: TunnelPreflightPortResponse,
  },
  [REQUEST_CHANNELS.SETTINGS_GET]: { request: SettingsGetPayload, response: SettingsGetResponse },
  [REQUEST_CHANNELS.SETTINGS_UPDATE]: { request: SettingsUpdatePayload, response: SettingsUpdateResponse },
  [REQUEST_CHANNELS.DIAG_EXPORT_LOGS]: { request: DiagExportLogsPayload, response: DiagExportLogsResponse },
  [REQUEST_CHANNELS.DIAG_GET_INFO]: { request: DiagGetInfoPayload, response: DiagGetInfoResponse },
  [REQUEST_CHANNELS.SYS_OPEN_EXTERNAL]: { request: SysOpenExternalPayload, response: SysOpenExternalResponse },
  [REQUEST_CHANNELS.SYS_GET_VERSION]: { request: SysGetVersionPayload, response: SysGetVersionResponse },
};

export const EVENT_SCHEMAS: Record<EventChannel, z.ZodSchema> = {
  [EVENT_CHANNELS.TUNNEL_STATUS_UPDATE]: TunnelStatusUpdateEvent,
  [EVENT_CHANNELS.TELEMETRY_TICK]: TelemetryTickEvent,
  [EVENT_CHANNELS.REQUEST_OBSERVED]: RequestObservedEvent,
  [EVENT_CHANNELS.NETWORK_STATE_CHANGE]: NetworkStateChangeEvent,
  [EVENT_CHANNELS.AUTH_STATE_CHANGE]: AuthStateChangeEvent,
  [EVENT_CHANNELS.SIDECAR_DIAGNOSTIC_MODE]: SidecarDiagnosticModeEvent,
  [EVENT_CHANNELS.INTEGRITY_VIOLATION]: IntegrityViolationEvent,
};

// Inferred I/O types
export type AuthStatusOut = z.infer<typeof AuthStatusResponse>;
export type DomainsListOut = z.infer<typeof DomainsListResponse>;
export type TunnelStartIn = z.infer<typeof TunnelStartPayload>;
export type TunnelStartOut = z.infer<typeof TunnelStartResponse>;
export type TunnelPreflightOut = z.infer<typeof TunnelPreflightPortResponse>;
export type DiagInfoOut = z.infer<typeof DiagGetInfoResponse>;
export type TunnelStatusUpdate = z.infer<typeof TunnelStatusUpdateEvent>;
export type TelemetryTick = z.infer<typeof TelemetryTickEvent>;
export type RequestObserved = z.infer<typeof RequestObservedEvent>;
export type NetworkStateChange = z.infer<typeof NetworkStateChangeEvent>;
export type AuthStateChange = z.infer<typeof AuthStateChangeEvent>;
export type SidecarDiagnosticMode = z.infer<typeof SidecarDiagnosticModeEvent>;
