/**
 * @fileoverview Network connectivity state machine for the desktop client.
 *
 * The data plane (Go sidecar → cloud proxy TLS connection) is alive in
 * exactly one of five states at any moment. This module formalises the
 * transitions as a constant table so the spec is unit-testable without
 * touching real network.
 *
 *   ┌─────────────┐  jitter             ┌─────────┐
 *   │             │ ───────────────────▶│ flicker │
 *   │             │ ◀─────────── ok ────│         │
 *   │             │                     └────┬────┘
 *   │             │       stream-closed       │
 *   │  connected  │ ─────────────────▶ reconnecting ◀─── os-online ── offline
 *   │             │ ◀──────── ok ──────       ▲                       ▲
 *   │             │                           │                       │
 *   │             │       interface-change    │                       │
 *   │             │ ─────────────────▶ roaming┘                       │
 *   └─────┬───────┘ ◀──────── ok ──────                                │
 *         │                                                            │
 *         └────────────── os-offline ──────────────────────────────────┘
 *
 * Each transition is one row in {@link TRANSITION_TABLE}. The
 * {@link NetworkStateMachine.signal} method looks up the row for
 * (current_state, incoming_signal). If no row exists the signal is
 * ignored — that is by design, so e.g. an `ok` signal arriving while
 * already `connected` is a no-op.
 *
 * Implements PRD §4.1 (state table) and §4.2 (ISP blackout).
 */

import { EventEmitter } from "node:events";

/** All states the data plane can be in. */
export type NetState = "connected" | "flicker" | "reconnecting" | "offline" | "roaming";

/**
 * Inputs to the state machine. Most come from the Go sidecar's stdout
 * stream; `os-online` / `os-offline` come from Electron's `powerMonitor`
 * and `net.online` polling.
 */
export type NetSignal =
  | { type: "ok" }              // healthy heartbeat
  | { type: "jitter" }          // a single dropped heartbeat
  | { type: "stream-closed" }   // TCP stream closed
  | { type: "interface-change" }// wifi -> 5G etc.
  | { type: "os-online" }       // OS reports network up
  | { type: "os-offline" }      // OS reports network down
  | { type: "retry-tick"; attempt: number };

/** Row in the transition table. */
export interface StateTransition {
  from: NetState;
  on: NetSignal["type"];
  to: NetState;
}

/**
 * The transition table. Read each row as "in state `from`, when signal of
 * type `on` arrives, transition to `to`". Any (from, on) pair not in the
 * table is ignored — the state machine stays where it is.
 */
export const TRANSITION_TABLE: readonly StateTransition[] = [
  { from: "connected",    on: "jitter",            to: "flicker" },
  { from: "connected",    on: "stream-closed",     to: "reconnecting" },
  { from: "connected",    on: "interface-change",  to: "roaming" },
  { from: "connected",    on: "os-offline",        to: "offline" },

  { from: "flicker",      on: "ok",                to: "connected" },
  { from: "flicker",      on: "stream-closed",     to: "reconnecting" },
  { from: "flicker",      on: "os-offline",        to: "offline" },

  { from: "reconnecting", on: "ok",                to: "connected" },
  { from: "reconnecting", on: "os-offline",        to: "offline" },
  { from: "reconnecting", on: "interface-change",  to: "roaming" },

  { from: "roaming",      on: "ok",                to: "connected" },
  { from: "roaming",      on: "stream-closed",     to: "reconnecting" },
  { from: "roaming",      on: "os-offline",        to: "offline" },

  { from: "offline",      on: "os-online",         to: "reconnecting" },
];

/**
 * The state machine itself. Single instance per Main process. Subscribers
 * listen on `"change"` to be notified of every transition.
 *
 * @event "change" — payload: `{ from, to, signal }`. Fired iff the new
 *   state differs from the previous one.
 */
export class NetworkStateMachine extends EventEmitter {
  private state: NetState;

  constructor(initial: NetState = "connected") {
    super();
    this.state = initial;
  }

  /** Current state. Cheap; safe to call from event handlers. */
  current(): NetState {
    return this.state;
  }

  /**
   * Apply a signal. If a matching transition exists in
   * {@link TRANSITION_TABLE} and the result is a state change, emit
   * `"change"`. Otherwise, no-op.
   *
   * @returns the resulting state (same as before if the signal had no effect).
   */
  signal(s: NetSignal): NetState {
    const t = TRANSITION_TABLE.find((row) => row.from === this.state && row.on === s.type);
    if (!t) return this.state; // ignore non-applicable signals (e.g. ok in connected)
    const next = t.to;
    if (next !== this.state) {
      const prev = this.state;
      this.state = next;
      this.emit("change", { from: prev, to: next, signal: s });
    }
    return this.state;
  }
}

/**
 * Exponential backoff delay for reconnection attempts.
 *
 * Spec: `base * 2^attempt`, capped at `cap`. Attempts before zero are
 * treated as zero. Default: 1s, 2s, 4s, 8s, 16s, 32s, 60s (capped).
 *
 * PRD §4.1.4 — exponential backoff to "avoid hammering the cloud proxy".
 *
 * @example
 * ```ts
 * for (let attempt = 0; !connected; attempt++) {
 *   await sleep(backoffMs(attempt));
 *   try { await connect(); connected = true; } catch (e) {}
 * }
 * ```
 */
export function backoffMs(attempt: number, opts: { base?: number; cap?: number } = {}): number {
  const base = opts.base ?? 1000;
  const cap = opts.cap ?? 60_000;
  if (attempt < 0) return base;
  const v = base * Math.pow(2, attempt);
  return Math.min(v, cap);
}
