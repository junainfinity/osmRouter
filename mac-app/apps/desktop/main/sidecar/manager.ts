/**
 * @fileoverview Sidecar process manager — owns the lifecycle of the Go
 * `osm-agent` binary.
 *
 * Responsibilities:
 *   - Spawn the binary with the right args for a given binding.
 *   - Parse its JSON-line stdout into typed events.
 *   - Detect missing heartbeats and SIGKILL the offender.
 *   - Restart on unexpected exit, up to a crash limit.
 *   - Enter "diagnostic mode" if the crash limit trips.
 *   - Gracefully shut down all children on app quit / OS suspend.
 *
 * The manager extends `EventEmitter` and emits `"event"` with typed
 * {@link SidecarEvent} payloads. The Main process subscribes once and
 * fans those into renderer-bound IPC events.
 *
 * Implements (from {@link ../../../osmRouter/05 - Security Spec.md}):
 *   - **S5.4** — only spawns the binary from `process.resourcesPath`,
 *     never from `PATH` and never from a user-writable location. (Path
 *     validation happens in `main/index.ts` via
 *     {@link resolveSidecarPath}.)
 *   - **S9.1** — heartbeat watchdog. The sidecar emits a `heartbeat`
 *     event every ~2s. If we don't see one within `heartbeatToleranceMs`
 *     (default 10s), we SIGKILL the child.
 *   - **S9.2** — three crashes within `crashWindowMs` (default 5min)
 *     triggers diagnostic mode: the manager stops respawning and emits
 *     `diagnostic-mode` so the UI can surface a recovery modal.
 *
 * Implements (from PRD):
 *   - §1.1 — sidecar management
 *   - §4.3 — auto-restart on crash
 *   - §5   — watchdog
 *
 * @see ../../../osmRouter/01 - Vision and Architecture.md
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { OsmLogger } from "../logger/index.js";

/**
 * Discriminated union of every event the manager can emit on `"event"`.
 *
 * - `ready`             — the sidecar finished its TLS handshake and is
 *                         serving traffic.
 * - `telemetry`         — periodic bandwidth/latency snapshot.
 * - `request`           — one HTTP request was forwarded.
 * - `heartbeat`         — health beacon; resets the watchdog timer.
 * - `status`            — high-level status transition for one binding.
 * - `log`               — structured log line from the sidecar.
 * - `exit`              — the child process exited (clean or otherwise).
 * - `diagnostic-mode`   — crash limit exceeded; no more restarts.
 */
export type SidecarEvent =
  | { type: "ready"; pid: number }
  | { type: "telemetry"; domainId: string; inbound: number; outbound: number; latencyMs: number; activeConns: number }
  | { type: "request"; domainId: string; method: string; path: string; status: number; latencyMs: number; sizeBytes: number; remote: string }
  | { type: "heartbeat"; t: number }
  | { type: "status"; domainId: string; status: "active" | "starting" | "error" | "stopping" | "idle"; error?: string }
  | { type: "log"; level: "info" | "warn" | "error" | "debug"; msg: string }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { type: "diagnostic-mode"; reason: string; crashCount: number; windowSec: number };

/**
 * Arguments needed to start a tunnel. Mirrors the Go binary's CLI flags
 * 1:1, plus the `token` which is passed via `OSM_TOKEN` env var (not argv)
 * so it never shows up in `ps`.
 */
export interface SidecarStartArgs {
  /** Public FQDN this binding serves (e.g. `dev.example.com`). */
  domain: string;
  /** Local port the user's app is listening on (1–65535). */
  port: number;
  /** Application-layer protocol. TCP skips host-header parsing. */
  proto: "HTTP" | "HTTPS" | "TCP";
  /** Local target host. Default 127.0.0.1 (loopback). LAN bind requires UI consent. */
  target: string;
  /** Access token, scoped tunnel-exec. Never logged. Passed via env. */
  token: string;
  /** Cloud proxy endpoint (https://). */
  proxyUrl: string;
  /** Filesystem path to the pinned root CA PEM. */
  rootCaPath: string;
}

/**
 * Construction-time options for the manager.
 */
export interface SidecarManagerOptions {
  /** Absolute path to the `osm-agent` binary. Resolved by Main. */
  binaryPath: string;
  /** Process logger; the manager creates child loggers from this. */
  logger: OsmLogger;
  /** How long without a heartbeat before SIGKILL. Default 10000 (S9.1). */
  heartbeatToleranceMs?: number;
  /** Max crashes within `crashWindowMs` before diagnostic mode. Default 3 (S9.2). */
  crashLimit?: number;
  /** Window for the crash counter. Default 300000 (5 minutes). */
  crashWindowMs?: number;
  /** Time source. Override in tests so we can freeze the clock. */
  clock?: () => number;
}

interface ChildInfo {
  child: ChildProcess;
  args: SidecarStartArgs;
  lastHeartbeat: number;
  domainId: string;
  startedAt: number;
}

/**
 * Per-process manager. Construct once on app boot, call {@link start} to
 * enable the watchdog timer, and use {@link startTunnel}/{@link stopTunnel}
 * to drive the lifecycle of individual bindings.
 *
 * @event "event" — emits a {@link SidecarEvent}. Subscribe with
 *   `mgr.on("event", e => ...)`.
 */
export class SidecarManager extends EventEmitter {
  private readonly opts: Required<SidecarManagerOptions>;
  /** Live children, keyed by `domainId`. */
  private readonly children = new Map<string, ChildInfo>();
  /** Per-binding crash timestamps. Used by {@link handleExit}. */
  private readonly crashTimes = new Map<string, number[]>();
  /** Bindings that have tripped the crash limit. */
  private readonly diagnosticMode = new Set<string>();
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(options: SidecarManagerOptions) {
    super();
    this.opts = {
      heartbeatToleranceMs: 10_000,
      crashLimit: 3,
      crashWindowMs: 300_000,
      clock: () => Date.now(),
      ...options,
    };
  }

  /**
   * Enable the watchdog timer. Idempotent. The watchdog ticks every 1s
   * and inspects {@link children} for stale heartbeats.
   */
  start(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => this.tickWatchdog(), 1_000);
  }

  /**
   * Graceful shutdown: stop the watchdog and request graceful exit of every
   * running child. Awaits each child up to 5s before SIGKILL.
   *
   * Called on `app.on("before-quit")` and on power-suspend events so cloud
   * proxies are notified the device is going away.
   */
  async stop(): Promise<void> {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    const all = Array.from(this.children.keys());
    await Promise.all(all.map((id) => this.stopTunnel(id, "manager-stop")));
  }

  /**
   * Whether a given binding has tripped the crash limit and is locked out
   * from restarts until {@link resetDiagnostic} is called.
   */
  isInDiagnosticMode(domainId: string): boolean {
    return this.diagnosticMode.has(domainId);
  }

  /**
   * Clear diagnostic mode for a binding so it can be started again.
   * Typically wired to the "Try again" button in the diagnostic modal.
   */
  resetDiagnostic(domainId: string): void {
    this.diagnosticMode.delete(domainId);
    this.crashTimes.delete(domainId);
  }

  /**
   * Start a tunnel for the given binding.
   *
   * @throws `in-diagnostic-mode` if the binding has tripped the crash
   *   limit. Call {@link resetDiagnostic} first.
   * @throws `tunnel-already-running` if a child is already alive for this
   *   `domainId`. Stop the existing tunnel first.
   * @throws `sidecar-spawn-failed` if the binary failed to spawn.
   */
  async startTunnel(domainId: string, args: SidecarStartArgs): Promise<void> {
    if (this.diagnosticMode.has(domainId)) {
      throw new Error("in-diagnostic-mode");
    }
    if (this.children.has(domainId)) {
      throw new Error("tunnel-already-running");
    }
    await this.spawnFor(domainId, args);
  }

  /**
   * Stop a tunnel. Sends SIGTERM, waits up to 5s, then SIGKILL if needed.
   * No-op if no child is running for this `domainId`.
   *
   * @param reason — free-form label that ends up in logs. Useful for
   *   distinguishing user-initiated stops from system-driven ones.
   */
  async stopTunnel(domainId: string, reason: string = "user-stop"): Promise<void> {
    const info = this.children.get(domainId);
    if (!info) return;
    this.opts.logger.info({ domainId, reason }, "sidecar:stop-requested");
    info.child.kill("SIGTERM");
    // Wait up to 5s for graceful exit
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (!info.child.killed) {
          this.opts.logger.warn({ domainId }, "sidecar:sigterm-timeout-sigkill");
          info.child.kill("SIGKILL");
        }
        resolve();
      }, 5_000);
      info.child.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    this.children.delete(domainId);
  }

  /**
   * Internal: spawn the Go binary for a given binding and wire up its
   * stdout/stderr to typed events. The token is passed via env var so it
   * never appears in argv (visible to other local processes via `ps`).
   */
  private async spawnFor(domainId: string, args: SidecarStartArgs): Promise<void> {
    const child = spawn(
      this.opts.binaryPath,
      [
        "run",
        "--domain", args.domain,
        "--local-port", String(args.port),
        "--proto", args.proto,
        "--target", args.target,
        "--proxy-url", args.proxyUrl,
        "--root-ca", args.rootCaPath,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          // S4.2: token via env, NOT argv (argv is visible to any local
          // process via `ps auxe` and shell history). Env is per-process
          // and not visible outside our parent/child relationship on macOS.
          OSM_TOKEN: args.token,
          OSM_HEARTBEAT_MS: "2000",
        },
      },
    );

    if (!child.pid) {
      throw new Error("sidecar-spawn-failed");
    }

    const info: ChildInfo = {
      child,
      args,
      lastHeartbeat: this.opts.clock(),
      domainId,
      startedAt: this.opts.clock(),
    };
    this.children.set(domainId, info);

    const rlOut = readline.createInterface({ input: child.stdout! });
    rlOut.on("line", (line) => this.handleStdoutLine(domainId, line));

    const rlErr = readline.createInterface({ input: child.stderr! });
    rlErr.on("line", (line) => {
      this.opts.logger.warn({ domainId, line }, "sidecar:stderr");
    });

    child.on("exit", (code, signal) => {
      rlOut.close();
      rlErr.close();
      this.children.delete(domainId);
      this.emit("event", { type: "exit", code, signal } as SidecarEvent);
      this.opts.logger.warn({ domainId, code, signal }, "sidecar:exit");
      this.handleExit(domainId, info.args, code);
    });

    this.opts.logger.info({ domainId, pid: child.pid }, "sidecar:spawned");
  }

  /**
   * Internal: parse a single JSON-line from the sidecar's stdout and
   * translate it into a typed {@link SidecarEvent}. Unknown events are
   * logged at debug level and ignored — forward compatible by design.
   */
  private handleStdoutLine(domainId: string, line: string): void {
    if (!line.trim()) return;
    let event: SidecarEvent | null = null;
    try {
      const obj = JSON.parse(line) as { event?: string } & Record<string, unknown>;
      switch (obj.event) {
        case "ready":
          event = { type: "ready", pid: this.children.get(domainId)?.child.pid ?? 0 };
          this.emit("event", { type: "status", domainId, status: "active" } as SidecarEvent);
          break;
        case "telemetry":
          event = {
            type: "telemetry",
            domainId,
            inbound: Number(obj.inbound ?? 0),
            outbound: Number(obj.outbound ?? 0),
            latencyMs: Number(obj.latencyMs ?? 0),
            activeConns: Number(obj.activeConns ?? 0),
          };
          break;
        case "heartbeat":
          event = { type: "heartbeat", t: this.opts.clock() };
          {
            const info = this.children.get(domainId);
            if (info) info.lastHeartbeat = this.opts.clock();
          }
          break;
        case "request":
          event = {
            type: "request",
            domainId,
            method: String(obj.method ?? ""),
            path: String(obj.path ?? ""),
            status: Number(obj.status ?? 0),
            latencyMs: Number(obj.latencyMs ?? 0),
            sizeBytes: Number(obj.sizeBytes ?? 0),
            remote: String(obj.remote ?? ""),
          };
          break;
        case "error":
          event = {
            type: "status",
            domainId,
            status: "error",
            error: String(obj.message ?? "unknown"),
          };
          break;
        case "log":
          event = {
            type: "log",
            level: (obj.level as "info" | "warn" | "error" | "debug") ?? "info",
            msg: String(obj.msg ?? ""),
          };
          break;
        default:
          this.opts.logger.debug({ domainId, line }, "sidecar:unknown-event");
      }
    } catch (e) {
      this.opts.logger.debug({ domainId, line, err: String(e) }, "sidecar:bad-json");
    }
    if (event) this.emit("event", event);
  }

  /**
   * Internal: react to an unexpected sidecar exit. A clean stop (`code 0`)
   * is a no-op. A non-zero exit feeds the crash counter and either
   * respawns the binary or trips diagnostic mode.
   *
   * The crash window is a sliding window — crashes older than
   * `crashWindowMs` fall out of the count, so a sidecar that has been
   * running for hours and then has one bad day doesn't get permanently
   * blacklisted.
   */
  private handleExit(domainId: string, args: SidecarStartArgs, code: number | null): void {
    if (code === 0) return; // clean stop
    const times = this.crashTimes.get(domainId) ?? [];
    const now = this.opts.clock();
    const fresh = times.filter((t) => now - t < this.opts.crashWindowMs);
    fresh.push(now);
    this.crashTimes.set(domainId, fresh);

    if (fresh.length >= this.opts.crashLimit) {
      this.diagnosticMode.add(domainId);
      this.opts.logger.error(
        { domainId, crashCount: fresh.length, windowSec: this.opts.crashWindowMs / 1000 },
        "sidecar:diagnostic-mode",
      );
      this.emit("event", {
        type: "diagnostic-mode",
        reason: "Sidecar crashed too many times. The tunnel has been stopped.",
        crashCount: fresh.length,
        windowSec: this.opts.crashWindowMs / 1000,
      } as SidecarEvent);
      this.emit("event", {
        type: "status",
        domainId,
        status: "error",
        error: "diagnostic-mode",
      } as SidecarEvent);
      return;
    }
    // Restart with a 500ms back-off. Far short of the network state machine
    // back-off because the sidecar process itself restarting is cheap and
    // we want fast recovery from transient crashes.
    this.opts.logger.warn({ domainId, attempt: fresh.length }, "sidecar:restart");
    this.emit("event", { type: "status", domainId, status: "starting" } as SidecarEvent);
    setTimeout(() => {
      this.spawnFor(domainId, args).catch((err) => {
        this.opts.logger.error({ domainId, err: String(err) }, "sidecar:respawn-failed");
      });
    }, 500);
  }

  /**
   * Internal: the watchdog tick. Runs every 1s; for every running child
   * it checks how long since the last heartbeat and SIGKILLs anyone past
   * the tolerance window. (S9.1)
   */
  private tickWatchdog(): void {
    const now = this.opts.clock();
    for (const [domainId, info] of this.children) {
      const age = now - info.lastHeartbeat;
      if (age > this.opts.heartbeatToleranceMs) {
        this.opts.logger.error({ domainId, ageMs: age }, "sidecar:heartbeat-missed-sigkill");
        try {
          info.child.kill("SIGKILL");
        } catch (e) {
          this.opts.logger.error({ err: String(e) }, "sidecar:sigkill-failed");
        }
      }
    }
  }

  /** @internal Test helper — inject a fake child record. */
  _injectChild(domainId: string, info: ChildInfo) {
    this.children.set(domainId, info);
  }
  /** @internal Test helper — count of live children. */
  _childCount() {
    return this.children.size;
  }
}

/** @internal Re-exports for the tests. Not part of the public API. */
export const __test = { fileURLToPath, path };
