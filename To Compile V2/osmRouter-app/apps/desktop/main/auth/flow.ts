/**
 * @fileoverview The PKCE authorization-code flow orchestrator.
 *
 * The user clicks "Sign in" → we generate {@link PkceMaterial}, open the
 * system browser to the authorization URL, wait for the browser to
 * redirect to `osmrouter://auth?code=…&state=…`, validate, exchange code
 * for tokens, persist tokens to the keychain.
 *
 * The renderer never touches a token directly. The only thing it learns
 * about the auth state is `{ signedIn: boolean, email?: string,
 * workspace?: string }`. Any RPC requiring authentication
 * (`tunnel:start`, `domains:list`, …) calls {@link AuthFlow.getAccessToken}
 * inside the Main process and forwards the bearer header to the Go
 * sidecar (also entirely on the Main side).
 *
 * Implements (from {@link ../../../osmRouter/05 - Security Spec.md}):
 *   - **S4.2** — tokens never crossed the IPC boundary back to the renderer
 *   - **S6.4** — pending PKCE material is in-memory only
 *   - **S6.5** — state mismatch aborts the flow with `auth-state-mismatch`
 *   - **S6.6** — code exchange is server-to-server (HTTPS only)
 *   - **S6.7** — pending material reference is dropped on completion or abort
 */

import type { OsmLogger } from "../logger/index.js";
import type { KeychainStore } from "../keychain/index.js";
import { createPkce, type PkceMaterial } from "./pkce.js";

/**
 * The interface every auth backend must implement. The mock backend in
 * `mock-backend.ts` satisfies this; the real production backend would
 * speak the same shape over HTTPS to `https://osmrouter.com/auth/...`.
 */
export interface AuthBackend {
  /**
   * Exchange an authorization code for tokens. The verifier proves the
   * client is the same one that initiated the flow.
   */
  exchange(args: {
    code: string;
    verifier: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; refreshToken: string; email: string; workspace: string }>;
  /** Refresh an expired access token. Refresh token rotation is optional. */
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }>;
  /** Build the browser-facing URL the user clicks "Sign in" into. */
  authorizeUrl(args: { challenge: string; state: string; redirectUri: string }): string;
}

/**
 * The slice of auth state safe to send across IPC. Never contains a token.
 */
export interface AuthState {
  signedIn: boolean;
  email?: string;
  workspace?: string;
}

/**
 * Constructor options for the flow orchestrator.
 */
export interface AuthFlowOptions {
  /** Pluggable backend implementation (real or mock). */
  backend: AuthBackend;
  /** Where tokens persist. Tokens never leave this object. */
  keychain: KeychainStore;
  logger: OsmLogger;
  /** Must match the protocol scheme we registered: `osmrouter://auth`. */
  redirectUri: string;
  /** Logical account key. Allows multi-tenant in the future; today always `"primary"`. */
  account: string;
  /** Optional callback fired after `signed-in` / `signed-out`. Use to push IPC events. */
  onAuthStateChange?: (state: AuthState) => void;
}

/**
 * One-instance-per-process state machine for the PKCE flow. Construct on
 * boot, call {@link AuthFlow.bootstrap} once to hydrate from the keychain,
 * then route user actions through {@link AuthFlow.begin} /
 * {@link AuthFlow.handleCallback} / {@link AuthFlow.signOut}.
 */
export class AuthFlow {
  /** PKCE material for an in-flight flow. Always null when no flow is pending. */
  private pending: PkceMaterial | null = null;
  /** Last-known auth state. Returned by {@link AuthFlow.status}. */
  private current: AuthState = { signedIn: false };

  constructor(private readonly opts: AuthFlowOptions) {}

  /**
   * Rehydrate state from the keychain on app boot. If we have an access
   * token + email under our account key, treat the user as signed in.
   *
   * @returns the current auth state (always — never throws on missing).
   */
  async bootstrap(): Promise<AuthState> {
    const token = await this.opts.keychain.getToken(`${this.opts.account}:access`);
    const email = await this.opts.keychain.getToken(`${this.opts.account}:email`);
    const workspace = await this.opts.keychain.getToken(`${this.opts.account}:workspace`);
    if (token && email) {
      const next: AuthState = { signedIn: true, email };
      if (workspace) next.workspace = workspace;
      this.current = next;
    }
    return this.current;
  }

  /** Current state. Cheap; safe to call from IPC handlers. */
  status(): AuthState {
    return this.current;
  }

  /**
   * The cloud-side device id that the signed-in API key resolves to.
   * THIS is the id binding-lookups must compare against. The locally-
   * generated `deps.deviceId` in main/index.ts is just a placeholder for
   * the pre-auth state; once the user signs in with an API key, the
   * key's true device id (returned by exchange-device-key) takes over.
   */
  async getCloudDeviceId(): Promise<string | null> {
    return this.opts.keychain.getToken(`${this.opts.account}:deviceId`);
  }

  /**
   * Start a fresh PKCE flow. Returns the URL the caller should open in
   * the system browser. The browser will eventually redirect to
   * `osmrouter://auth?code=…&state=…`, which the Main process catches via
   * its protocol handler and feeds into {@link AuthFlow.handleCallback}.
   */
  begin(): { authUrl: string } {
    const m = createPkce();
    this.pending = m;
    const authUrl = this.opts.backend.authorizeUrl({
      challenge: m.challenge,
      state: m.state,
      redirectUri: this.opts.redirectUri,
    });
    this.opts.logger.info({ challengeMethod: m.challengeMethod }, "auth:pkce-begin");
    return { authUrl };
  }

  /**
   * Handle the deep-link callback from the browser.
   *
   * Validates:
   *   - There IS a pending flow (otherwise `auth-no-pending-flow`).
   *   - The URL parses (otherwise `auth-bad-callback-url`).
   *   - The protocol is `osmrouter:` (otherwise `auth-bad-protocol`).
   *   - Both `code` and `state` are present (otherwise `auth-missing-params`).
   *   - The state echoed back matches what we generated (otherwise
   *     `auth-state-mismatch` — the most security-sensitive case; a
   *     malicious app could otherwise inject a stolen code).
   *
   * On success: exchanges the code for tokens, persists access + refresh
   * + email + workspace, updates current state, and notifies the
   * `onAuthStateChange` callback.
   *
   * Cleanup: the pending PKCE material is dropped in a `finally` block,
   * regardless of outcome — so a failed callback can't be replayed.
   */
  async handleCallback(url: string): Promise<AuthState> {
    const m = this.pending;
    if (!m) {
      this.opts.logger.warn({}, "auth:callback-without-pending");
      throw new Error("auth-no-pending-flow");
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("auth-bad-callback-url");
    }
    if (parsed.protocol !== "osmrouter:") {
      throw new Error("auth-bad-protocol");
    }
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");
    if (!code || !state) throw new Error("auth-missing-params");
    if (state !== m.state) {
      this.opts.logger.error({}, "auth:state-mismatch");
      this.pending = null;
      throw new Error("auth-state-mismatch");
    }
    try {
      const tokens = await this.opts.backend.exchange({
        code,
        verifier: m.verifier,
        redirectUri: this.opts.redirectUri,
      });
      await this.opts.keychain.setToken(`${this.opts.account}:access`, tokens.accessToken);
      await this.opts.keychain.setToken(`${this.opts.account}:refresh`, tokens.refreshToken);
      await this.opts.keychain.setToken(`${this.opts.account}:email`, tokens.email);
      await this.opts.keychain.setToken(`${this.opts.account}:workspace`, tokens.workspace);
      this.current = { signedIn: true, email: tokens.email, workspace: tokens.workspace };
      this.opts.onAuthStateChange?.(this.current);
      this.opts.logger.info({ email: tokens.email }, "auth:signed-in");
      return this.current;
    } finally {
      // S6.7 — drop the pending material on every outcome so a failed
      // callback cannot be replayed. The next sign-in must start with a
      // fresh `begin()`.
      this.pending = null;
    }
  }

  /**
   * Paste-API-key sign-in.
   *
   * The user generates a device API key on the web dashboard, pastes it
   * into the desktop app's sign-in modal; the renderer forwards it here.
   * We POST it to the cloud's `/api/v1/auth/exchange-device-key` to
   * validate + look up the owning user, then persist the api_key (it IS
   * the bearer credential the sidecar will use) and update auth state.
   *
   * This bypasses PKCE entirely. PKCE makes sense for browser-based OAuth
   * with redirects; for a long-lived desktop client paired to a single
   * device, a copy-pasted scoped token is simpler, more secure (no
   * password ever leaves the user's keyboard), and trivially revocable
   * from the web dashboard.
   *
   * Returns the new {@link AuthState}. Throws on any validation failure
   * with a code the renderer can show.
   */
  async signInWithKey(args: { apiKey: string; apiBase: string }): Promise<AuthState> {
    const key = args.apiKey.trim();
    if (!key) throw new Error("api-key-empty");
    const url = new URL("/api/v1/auth/exchange-device-key", args.apiBase);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
      });
    } catch (err) {
      this.opts.logger.error({ err: String(err) }, "auth:exchange-fetch-failed");
      throw new Error("network-unreachable");
    }
    if (res.status === 401) throw new Error("api-key-invalid-or-revoked");
    if (!res.ok) throw new Error(`server-error-${res.status}`);
    const body = (await res.json()) as {
      email?: string;
      name?: string;
      role?: string;
      device_id?: string;
      device_name?: string;
    };
    if (!body.email) throw new Error("server-response-malformed");

    // Persist. The api_key itself goes into the access slot — the sidecar
    // will read it later when spawning. Email/role/device_id surface in
    // the UI; they are not sensitive on their own.
    await this.opts.keychain.setToken(`${this.opts.account}:access`, key);
    await this.opts.keychain.setToken(`${this.opts.account}:email`, body.email);
    if (body.name) await this.opts.keychain.setToken(`${this.opts.account}:name`, body.name);
    if (body.role) await this.opts.keychain.setToken(`${this.opts.account}:role`, body.role);
    if (body.device_id) await this.opts.keychain.setToken(`${this.opts.account}:deviceId`, body.device_id);

    this.current = { signedIn: true, email: body.email };
    this.opts.onAuthStateChange?.(this.current);
    this.opts.logger.info({ email: body.email }, "auth:signed-in-via-key");
    return this.current;
  }

  /**
   * Tear down the current session: delete all tokens, reset state,
   * notify the callback. Tunnels stop before this is called (see
   * `main/ipc/handlers.ts` AUTH_SIGN_OUT handler).
   */
  async signOut(): Promise<void> {
    for (const slot of ["access", "refresh", "email", "workspace", "name", "role", "deviceId"]) {
      await this.opts.keychain.deleteToken(`${this.opts.account}:${slot}`);
    }
    this.current = { signedIn: false };
    this.opts.onAuthStateChange?.(this.current);
    this.opts.logger.info({}, "auth:signed-out");
  }

  /**
   * Read the current access token. Used by Main-process services (e.g.
   * the sidecar manager spawn path) to attach a bearer header. Returns
   * `null` if the user is not signed in. The token is never returned to
   * the renderer.
   */
  async getAccessToken(): Promise<string | null> {
    return this.opts.keychain.getToken(`${this.opts.account}:access`);
  }
}
