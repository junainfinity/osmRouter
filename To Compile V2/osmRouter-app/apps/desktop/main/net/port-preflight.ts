/**
 * @fileoverview TCP pre-flight check.
 *
 * Before we ask the sidecar to forward traffic to `localhost:<port>`, we
 * try to open a TCP connection there ourselves. If the connection refuses
 * (ECONNREFUSED), the user's app isn't listening yet and we can surface a
 * helpful "We don't see anything running on port N" message instead of
 * letting the public domain serve 502s.
 *
 * Why a TCP connect and not an HTTP request? Because the user's local
 * service might be HTTPS with a self-signed cert, raw TCP (MongoDB), or
 * a binary protocol — anything that accepts a connection counts as
 * "running". The transport is the right level of detail.
 *
 * Latency budget: 700ms by default. The user has clicked **Start tunnel**
 * and is staring at the UI; we owe them a verdict fast enough to feel
 * synchronous.
 *
 * Implements PRD §3.3.2 (pre-flight check) and surfaces the conflict
 * modal logic described in Security Spec §S5.1 (port collision).
 */

import net from "node:net";

/**
 * Result of a single pre-flight probe. `reachable: true` means the port
 * accepted our TCP connection; everything else categorises the failure.
 */
export interface PreflightResult {
  reachable: boolean;
  reason?: "timeout" | "refused" | "host-unreachable" | "other";
  /** OS-level error code (e.g. ECONNREFUSED) when available. */
  details?: string;
}

/**
 * Try to open a TCP connection to `host:port` and immediately close it.
 *
 * @param opts.host       — IPv4 string (we currently only support v4 here)
 * @param opts.port       — 1..65535
 * @param opts.timeoutMs  — defaults to 700ms; tighter than network timeouts
 *   on purpose so the UI hot path stays snappy.
 */
export async function preflightPort(opts: { host: string; port: number; timeoutMs?: number }): Promise<PreflightResult> {
  const timeoutMs = opts.timeoutMs ?? 700;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    /** Idempotent resolve + cleanup. Multiple events can fire on a socket; we settle on the first. */
    const done = (r: PreflightResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* swallow — destroying a destroyed socket throws on some Node versions */
      }
      resolve(r);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done({ reachable: true }));
    socket.once("timeout", () => done({ reachable: false, reason: "timeout" }));
    socket.once("error", (err: NodeJS.ErrnoException) => {
      const code = err.code ?? "other";
      if (code === "ECONNREFUSED") return done({ reachable: false, reason: "refused", details: code });
      if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return done({ reachable: false, reason: "host-unreachable", details: code });
      done({ reachable: false, reason: "other", details: code });
    });

    try {
      socket.connect({ host: opts.host, port: opts.port });
    } catch (e) {
      done({ reachable: false, reason: "other", details: String(e) });
    }
  });
}
