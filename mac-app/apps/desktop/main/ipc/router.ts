/**
 * @fileoverview IPC router — the single chokepoint for renderer→main calls.
 *
 * This module is the trust boundary of the desktop client. Every call that
 * originates in the renderer (sandboxed Next.js process) flows through
 * `IpcRouter.dispatch()` before any side-effectful work happens. The router
 * enforces:
 *
 *   1. **Channel allow-listing** — only channels listed in
 *      {@link ALL_REQUEST_CHANNELS} can be invoked. Anything else is
 *      rejected with `forbidden-channel`. (Security control S3.4.)
 *
 *   2. **Payload validation** — every channel has a {@link REQUEST_SCHEMAS}
 *      entry. The router calls `schema.request.parse(payload)` before
 *      invoking the handler. Bad payloads are rejected with `validation`.
 *      (Security control S3.5.)
 *
 *   3. **Response validation** — the router also validates the handler's
 *      return value against `schema.response`. This catches drift between
 *      the handler implementation and the contract the renderer relies on.
 *      (Security control S3.5.)
 *
 *   4. **Error envelope** — handlers can throw, and the router wraps the
 *      throw into a structured `{ ok: false, error: { code, message } }`
 *      payload so the renderer can act without seeing internal stack traces.
 *
 * The router is deliberately decoupled from Electron's `ipcMain` instance:
 * `main/index.ts` registers a single `ipcMain.handle("osm:invoke", ...)`
 * that forwards into `dispatch`. This lets us unit-test the entire IPC
 * surface without spinning Electron (see
 * `tests/security/ipc-allowlist.spec.ts`).
 *
 * @see ../../osmRouter/05 - Security Spec.md — controls S3.1–S3.6
 * @see ../../osmRouter/04 - Tech Stack.md — IPC layer
 */

import { z } from "zod";
import {
  ALL_REQUEST_CHANNELS,
  type RequestChannel,
  REQUEST_SCHEMAS,
} from "@osmrouter/shared";
import type { OsmLogger } from "../logger/index.js";
import type { IpcError } from "@osmrouter/shared";

/**
 * Function shape every handler registered with the router must satisfy.
 *
 * @typeParam I — the *parsed and validated* input. By the time a handler
 *   sees its input, the Zod schema has already accepted it.
 * @typeParam O — the response shape the router will re-validate before
 *   returning it to the renderer.
 *
 * @param input — schema-validated payload
 * @param ctx — per-call context (channel name + scoped logger)
 * @returns the response payload (sync or async)
 */
export type IpcHandler<I = unknown, O = unknown> = (input: I, ctx: IpcContext) => Promise<O> | O;

/**
 * Per-call context handed to every handler invocation. Use the `logger` to
 * emit structured logs scoped to the current channel.
 */
export interface IpcContext {
  /** Channel the call came in on (one of {@link ALL_REQUEST_CHANNELS}). */
  channel: RequestChannel;
  /** Process-wide logger; safe to call from any handler. */
  logger: OsmLogger;
}

/**
 * Dependencies the router needs to function. Currently just a logger; this
 * shape exists so we can inject mocks in tests and add more deps later
 * (e.g. metrics) without breaking the constructor signature.
 */
export interface IpcRouterDeps {
  logger: OsmLogger;
}

/**
 * The IPC router. Holds a map of channel → handler and provides
 * `register` (build-time) and `dispatch` (run-time).
 *
 * Lifecycle:
 *   1. Construct one `IpcRouter` per app process.
 *   2. Wire handlers via {@link IpcRouter.register}. Channels NOT in the
 *      allow-list throw.
 *   3. Forward every renderer call into {@link IpcRouter.dispatch}.
 *
 * Thread-safety: this is JavaScript — there is no real thread. We rely on
 * the single-threaded event loop. Two `dispatch` calls can be in flight
 * concurrently (Promise-based), but handler registration is one-shot at
 * startup.
 *
 * @example
 * ```ts
 * const router = new IpcRouter({ logger });
 * router.register(REQUEST_CHANNELS.AUTH_STATUS, async () => auth.status());
 * ipcMain.handle("osm:invoke", (_e, ch, payload) =>
 *   router.dispatch(ch, payload)
 * );
 * ```
 */
export class IpcRouter {
  private readonly handlers = new Map<RequestChannel, IpcHandler>();
  constructor(private readonly deps: IpcRouterDeps) {}

  /**
   * Register a handler for a channel.
   *
   * @param channel — must be one of {@link ALL_REQUEST_CHANNELS}. This is
   *   enforced at runtime so typos in callsites are caught immediately.
   * @param handler — the function the router will invoke after schema
   *   validation succeeds.
   *
   * @throws `forbidden-channel-register:<channel>` if the channel is not on
   *   the shared allow-list.
   * @throws `duplicate-handler:<channel>` if a handler is already
   *   registered for this channel. We forbid override-on-register so the
   *   final wiring is always traceable to one file.
   */
  register<I, O>(channel: RequestChannel, handler: IpcHandler<I, O>): void {
    if (!(ALL_REQUEST_CHANNELS as readonly string[]).includes(channel)) {
      // Refuse to register a handler that isn't on the allow-list.
      // Catches typos and dev-only debug channels making it into prod.
      throw new Error(`forbidden-channel-register:${channel}`);
    }
    if (this.handlers.has(channel)) {
      throw new Error(`duplicate-handler:${channel}`);
    }
    this.handlers.set(channel, handler as IpcHandler);
  }

  /**
   * Whether a handler is registered for the given channel. Mainly useful
   * for tests that want to assert wiring without invoking the handler.
   */
  has(channel: string): boolean {
    return this.handlers.has(channel as RequestChannel);
  }

  /**
   * Dispatch an inbound IPC call.
   *
   * This is the security gate. The function:
   *   1. Rejects unknown channels (`forbidden-channel`).
   *   2. Validates the payload via Zod (`validation`).
   *   3. Invokes the registered handler.
   *   4. Validates the response shape (`internal`/`response-shape-mismatch`).
   *   5. Wraps any thrown error into the same envelope.
   *
   * It never throws; every outcome is a typed envelope. The renderer-side
   * preload unwraps the envelope and either resolves or rejects the
   * corresponding `osmAPI` Promise.
   *
   * @param channel — the channel name supplied by the renderer
   * @param rawPayload — anything; will be schema-validated before use
   * @returns either `{ ok: true, data }` with a schema-valid response, or
   *   `{ ok: false, error }` with a typed error envelope.
   */
  async dispatch(channel: string, rawPayload: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: IpcError }> {
    if (!(ALL_REQUEST_CHANNELS as readonly string[]).includes(channel)) {
      this.deps.logger.warn({ channel }, "ipc:forbidden-channel");
      return { ok: false, error: { code: "forbidden-channel", message: "unknown-channel" } };
    }
    const ch = channel as RequestChannel;
    const handler = this.handlers.get(ch);
    if (!handler) {
      this.deps.logger.warn({ channel: ch }, "ipc:no-handler-registered");
      return { ok: false, error: { code: "internal", message: "no-handler" } };
    }
    const schema = REQUEST_SCHEMAS[ch];
    let parsed: unknown;
    try {
      parsed = schema.request.parse(rawPayload);
    } catch (e) {
      const zErr = e instanceof z.ZodError ? e.errors.map((er) => er.message).join("; ") : String(e);
      this.deps.logger.warn({ channel: ch, err: zErr }, "ipc:validation-failed");
      return { ok: false, error: { code: "validation", message: zErr } };
    }
    try {
      const out = await handler(parsed, { channel: ch, logger: this.deps.logger });
      // Response validation — catches bugs where main returns the wrong shape.
      // Without this, the renderer might silently break on a value the
      // contract didn't promise. We pay the validation cost once per call
      // because correctness > microseconds.
      let validatedOut: unknown;
      try {
        validatedOut = schema.response.parse(out);
      } catch (e) {
        this.deps.logger.error({ channel: ch, err: String(e) }, "ipc:response-validation-failed");
        return { ok: false, error: { code: "internal", message: "response-shape-mismatch" } };
      }
      return { ok: true, data: validatedOut };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.deps.logger.error({ channel: ch, err: msg }, "ipc:handler-threw");
      return { ok: false, error: { code: "internal", message: msg } };
    }
  }
}
