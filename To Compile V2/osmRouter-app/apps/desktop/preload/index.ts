/**
 * @fileoverview Preload script — the secure bridge between the sandboxed
 * renderer and the Main process.
 *
 * This file runs ONCE per BrowserWindow, BEFORE any renderer code. It
 * lives in a privileged context that has access to a curated subset of
 * Electron's APIs (just `contextBridge` and `ipcRenderer` here), and uses
 * `contextBridge.exposeInMainWorld` to publish a frozen object onto the
 * renderer's `window` global.
 *
 * The renderer NEVER imports anything else from Electron, Node, or this
 * file. Its entire surface area for talking to the system is
 * `window.osmAPI.*`. Everything below is allow-listed by name.
 *
 * Implements (from {@link ../../osmRouter/05 - Security Spec.md}):
 *   - **S3.1** — single named global (`osmAPI`)
 *   - **S3.2** — one channel per method; names live in the shared package
 *               and are the single source of truth on both sides
 *   - **S3.6** — outbound events use named topics; renderer subscribes via
 *               typed wrappers, not raw `ipcRenderer.on`
 *
 * Architecture note: under the hood every `osmAPI.<group>.<method>` call
 * goes through ONE Electron channel name (`"osm:invoke"`) carrying
 * `(channel: string, payload: unknown)`. The Main-process `IpcRouter`
 * dispatches on `channel`. This keeps Electron's `ipcMain.handle`
 * registration surface tiny while letting us version, validate, and
 * extend the protocol freely.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
  REQUEST_CHANNELS,
  EVENT_CHANNELS,
  isEventChannel,
  type RequestChannel,
  type EventChannel,
  type AuthStatusOut,
  type DomainsListOut,
  type TunnelStartIn,
  type TunnelStartOut,
  type TunnelPreflightOut,
  type DiagInfoOut,
} from "@osmrouter/shared";

/**
 * Envelope shape the router returns. We unwrap before resolving the
 * caller's Promise; on `ok: false` we synthesize an `Error` whose
 * `.code` is the error code from the envelope (so callers can branch on
 * it without parsing the message string).
 */
type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/**
 * Internal: invoke one of the allow-listed channels via the single
 * `osm:invoke` super-channel, unwrap the envelope, surface errors as
 * thrown `Error` with a `.code` property.
 */
async function invoke<T>(channel: RequestChannel, payload: unknown): Promise<T> {
  const resp = (await ipcRenderer.invoke("osm:invoke", channel, payload)) as IpcEnvelope<T>;
  if (resp.ok) return resp.data;
  const err = new Error(`${resp.error.code}: ${resp.error.message}`);
  (err as Error & { code?: string }).code = resp.error.code;
  throw err;
}

/**
 * Internal: subscribe to a Main-pushed event. Returns an unsubscribe
 * function — call it on `useEffect` cleanup to avoid leaks.
 */
function on<T = unknown>(channel: EventChannel, cb: (payload: T) => void): () => void {
  if (!isEventChannel(channel)) {
    throw new Error(`forbidden-event-channel:${channel}`);
  }
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

/**
 * The `osmAPI` global. Frozen via `contextBridge` so the renderer cannot
 * mutate or extend it. Grouped by concern: auth / domains / tunnel /
 * settings / diag / sys / events. Every method maps to exactly one IPC
 * channel.
 */
const osmAPI = {
  /** Authentication: PKCE-driven sign-in and sign-out. */
  auth: {
    /** Begin a PKCE flow; returns the URL to open in the system browser. */
    startPkce: () => invoke<{ authUrl: string }>(REQUEST_CHANNELS.AUTH_START_PKCE, {}),
    /** Current sign-in status. Tokens never leak through this. */
    status: () => invoke<AuthStatusOut>(REQUEST_CHANNELS.AUTH_STATUS, {}),
    /** Sign out: stops tunnels, clears keychain. */
    signOut: () => invoke<{ ok: true }>(REQUEST_CHANNELS.AUTH_SIGN_OUT, {}),
    /** Sign in by pasting a device API key generated on the web dashboard. */
    signInWithKey: (apiKey: string) =>
      invoke<
        | { ok: true; email: string; name?: string; role?: string }
        | { ok: false; error: string }
      >(REQUEST_CHANNELS.AUTH_SIGN_IN_WITH_KEY, { apiKey }),
  },
  /** Domain inventory. */
  domains: {
    /** List the user's verified domains. */
    list: () => invoke<DomainsListOut>(REQUEST_CHANNELS.DOMAINS_LIST, {}),
    /** Add a new domain. Server-side device-lock is the source of truth. */
    add: (input: { name: string; app?: string; stack?: string; proto?: "HTTP" | "HTTPS" | "TCP"; port?: number }) =>
      invoke<{ domain: DomainsListOut["domains"][number] }>(REQUEST_CHANNELS.DOMAINS_ADD, input),
  },
  /** Cloud-truth domain + binding management. Uses the stored device key. */
  cloud: {
    /** List every verified domain on the user's account, flattened by binding. */
    listBindings: () =>
      invoke<{
        bindings: Array<{
          domainId: string;
          subdomainId: string | null;
          fqdn: string;
          bareDomain: string;
          prefix: string | null;
          port: number | null;
          dnsStatus: string;
          boundToThisDevice: boolean;
          boundDeviceId: string | null;
        }>;
      }>(REQUEST_CHANNELS.CLOUD_LIST_BINDINGS, {}),
    /** Create a subdomain binding (prefix="" for apex) and start the local sidecar. */
    bindPort: (input: { domainId: string; prefix: string; port: number }) =>
      invoke<{ ok: true; subdomainId: string; fqdn: string }>(REQUEST_CHANNELS.CLOUD_BIND_PORT, input),
    /** Unbind + stop the local sidecar. */
    unbind: (subdomainId: string) =>
      invoke<{ ok: true }>(REQUEST_CHANNELS.CLOUD_UNBIND, { subdomainId }),
  },
  /** Local-service discovery (Services tab). */
  services: {
    scan: () =>
      invoke<{ services: Array<{ host: string; port: number; open: boolean; kind: string; title?: string; details?: string }> }>(
        REQUEST_CHANNELS.SERVICES_SCAN,
        {},
      ),
    probeOne: (host: string, port: number) =>
      invoke<{ host: string; port: number; open: boolean; kind: string; title?: string; details?: string }>(
        REQUEST_CHANNELS.SERVICES_PROBE_ONE,
        { host, port },
      ),
  },
  /** Tunnel lifecycle and preflight. */
  tunnel: {
    /** Start a tunnel for a previously-added domain. */
    start: (input: TunnelStartIn) => invoke<TunnelStartOut>(REQUEST_CHANNELS.TUNNEL_START, input),
    /** Gracefully stop a running tunnel. */
    stop: (input: { domainId: string }) => invoke<{ status: string }>(REQUEST_CHANNELS.TUNNEL_STOP, input),
    /** Active-tunnel snapshot. Useful for the tray menu summary. */
    list: () => invoke<{ tunnels: unknown[] }>(REQUEST_CHANNELS.TUNNEL_LIST, {}),
    /** TCP probe of a local port. Tells the UI whether the user's app is up. */
    preflightPort: (input: { port: number; host?: string }) =>
      invoke<TunnelPreflightOut>(REQUEST_CHANNELS.TUNNEL_PREFLIGHT_PORT, { port: input.port, host: input.host ?? "127.0.0.1" }),
  },
  /** App-wide user settings (launch-at-login, theme, etc.). */
  settings: {
    get: () => invoke<unknown>(REQUEST_CHANNELS.SETTINGS_GET, {}),
    update: (input: Record<string, unknown>) => invoke<unknown>(REQUEST_CHANNELS.SETTINGS_UPDATE, input),
  },
  /** Diagnostics: info about this build and the log file. */
  diag: {
    getInfo: () => invoke<DiagInfoOut>(REQUEST_CHANNELS.DIAG_GET_INFO, {}),
    /** Returns a path the user can attach to a support email. */
    exportLogs: () => invoke<{ path: string }>(REQUEST_CHANNELS.DIAG_EXPORT_LOGS, {}),
  },
  /** Low-level system bridges. */
  sys: {
    /** Open a URL in the system browser. Allow-listed in Main. */
    openExternal: (url: string) => invoke<{ ok: true }>(REQUEST_CHANNELS.SYS_OPEN_EXTERNAL, { url }),
    /** App version/build for the UI footer. */
    getVersion: () => invoke<{ version: string; build: string }>(REQUEST_CHANNELS.SYS_GET_VERSION, {}),
  },
  /**
   * Subscription helpers for Main-pushed events. Each `onXxx` returns an
   * unsubscribe function. Always call the unsubscribe in your `useEffect`
   * cleanup to avoid leaked listeners on re-renders.
   */
  events: {
    onTunnelStatusUpdate: (cb: (p: { domainId: string; status: string; error?: string | null }) => void) =>
      on(EVENT_CHANNELS.TUNNEL_STATUS_UPDATE, cb),
    onTelemetryTick: (cb: (p: { domainId: string; inbound: number; outbound: number; latencyMs: number; activeConns: number; t: number }) => void) =>
      on(EVENT_CHANNELS.TELEMETRY_TICK, cb),
    onRequestObserved: (cb: (p: { id: number; t: number; domain: string; method: string; path: string; status: number; latency: number; size: number; remote: string }) => void) =>
      on(EVENT_CHANNELS.REQUEST_OBSERVED, cb),
    onNetworkStateChange: (cb: (p: { state: string; edge?: string }) => void) =>
      on(EVENT_CHANNELS.NETWORK_STATE_CHANGE, cb),
    onAuthStateChange: (cb: (p: { signedIn: boolean; email?: string }) => void) =>
      on(EVENT_CHANNELS.AUTH_STATE_CHANGE, cb),
    onDiagnosticMode: (cb: (p: { reason: string; crashCount: number; windowSec: number }) => void) =>
      on(EVENT_CHANNELS.SIDECAR_DIAGNOSTIC_MODE, cb),
    onIntegrityViolation: (cb: (p: { expected: string; actual: string; binaryPath: string }) => void) =>
      on(EVENT_CHANNELS.INTEGRITY_VIOLATION, cb),
  },
} as const;

contextBridge.exposeInMainWorld("osmAPI", osmAPI);

/** Type the renderer uses to declare `window.osmAPI`. See `renderer/lib/osm-api.d.ts`. */
export type OsmAPI = typeof osmAPI;
