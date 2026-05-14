/**
 * @fileoverview IPC channel constants — the single source of truth for the
 * names of every cross-process message in osmRouter.
 *
 * This file is imported by **both** the Main process (which registers
 * handlers) and the Preload script (which builds the renderer-facing
 * `osmAPI`). Centralising the names here means there's exactly one place
 * to add a new channel and exactly one place to discover what the
 * application can do.
 *
 * Naming convention: `<noun>:<verb>` (or `<noun>:<adjective>` for events).
 *   - `auth:startPkce`        — request channel (renderer → main)
 *   - `tunnel:statusUpdate`   — event channel (main → renderer push)
 *
 * SECURITY (S3.4): the Main process accepts invocations ONLY for channel
 * names listed in {@link ALL_REQUEST_CHANNELS}. Anything else is rejected
 * by the {@link IpcRouter} before reaching a handler. Adding a channel
 * here is a deliberate security-policy change.
 *
 * @see ../../osmRouter/05 - Security Spec.md § S3
 */

/**
 * Renderer→Main request/response channels. Each one has a schema entry in
 * `./schemas.ts` under {@link REQUEST_SCHEMAS}. The map below is the
 * allow-list — every value is a string the Main process will accept.
 */
export const REQUEST_CHANNELS = {
  // Auth
  AUTH_START_PKCE: "auth:startPkce",
  AUTH_STATUS: "auth:status",
  AUTH_SIGN_OUT: "auth:signOut",
  // Paste-API-key sign-in (the actually-working path). User generates a
  // device API key on the web dashboard and pastes it into the desktop app.
  AUTH_SIGN_IN_WITH_KEY: "auth:signInWithKey",

  // Domains
  DOMAINS_LIST: "domains:list",
  DOMAINS_ADD: "domains:add",
  // Cloud-backed domain operations (uses stored device API key as Bearer).
  CLOUD_LIST_BINDINGS: "cloud:listBindings",   // returns FlatBinding[] from the cloud
  CLOUD_BIND_PORT:     "cloud:bindPort",       // create subdomain + bind + start sidecar
  CLOUD_UNBIND:        "cloud:unbind",         // unbind subdomain + stop sidecar
  // Local service discovery (Services tab)
  SERVICES_SCAN:       "services:scan",        // probe well-known dev/AI ports
  SERVICES_PROBE_ONE:  "services:probeOne",    // probe one (host, port) for manual-add validation

  // Tunnels
  TUNNEL_START: "tunnel:start",
  TUNNEL_STOP: "tunnel:stop",
  TUNNEL_LIST: "tunnel:list",
  TUNNEL_PREFLIGHT_PORT: "tunnel:preflightPort",

  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",

  // Diagnostics
  DIAG_EXPORT_LOGS: "diag:exportLogs",
  DIAG_GET_INFO: "diag:getInfo",

  // System
  SYS_OPEN_EXTERNAL: "sys:openExternal",
  SYS_GET_VERSION: "sys:getVersion",
} as const;

/**
 * Main→Renderer push channels. Renderer subscribes via
 * `osmAPI.events.onXxx(callback)`. Each channel has a payload schema in
 * `./schemas.ts` under {@link EVENT_SCHEMAS}.
 */
export const EVENT_CHANNELS = {
  TUNNEL_STATUS_UPDATE: "tunnel:statusUpdate",
  TELEMETRY_TICK: "telemetry:tick",
  REQUEST_OBSERVED: "request:observed",
  NETWORK_STATE_CHANGE: "network:stateChange",
  AUTH_STATE_CHANGE: "auth:stateChange",
  SIDECAR_DIAGNOSTIC_MODE: "sidecar:diagnosticMode",
  INTEGRITY_VIOLATION: "system:integrityViolation",
} as const;

/** Union of every request channel name. */
export type RequestChannel = (typeof REQUEST_CHANNELS)[keyof typeof REQUEST_CHANNELS];
/** Union of every event channel name. */
export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS];

/** Array view of {@link REQUEST_CHANNELS} for cheap membership tests. */
export const ALL_REQUEST_CHANNELS: readonly RequestChannel[] = Object.values(REQUEST_CHANNELS);
/** Array view of {@link EVENT_CHANNELS} for cheap membership tests. */
export const ALL_EVENT_CHANNELS: readonly EventChannel[] = Object.values(EVENT_CHANNELS);

/** Type guard: is `s` an allow-listed request-channel name? */
export function isRequestChannel(s: string): s is RequestChannel {
  return (ALL_REQUEST_CHANNELS as readonly string[]).includes(s);
}

/** Type guard: is `s` an allow-listed event-channel name? */
export function isEventChannel(s: string): s is EventChannel {
  return (ALL_EVENT_CHANNELS as readonly string[]).includes(s);
}
