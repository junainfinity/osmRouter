/**
 * @fileoverview Structured logger with file rotation.
 *
 * Writes JSON-line logs (one JSON object per line) to `userData/logs/
 * osmrouter.log`. JSON-line is pipe-friendly: support workflows can
 * `tail -F | jq` and the Export Logs feature can attach the file as-is.
 *
 * Implements (from {@link ../../../osmRouter/05 - Security Spec.md}):
 *   - **S4.1** — token redaction. The pino `redact` config strips
 *     `accessToken`, `refreshToken`, `token`, `password`, and any field
 *     ending in `.token` from log objects before they hit disk.
 *   - **S9.4** — log rotation. We cap at 100 MB by default; when the
 *     file exceeds the cap we keep the most-recent 50% and discard the
 *     older half in one atomic rewrite. The rotation guard runs on
 *     {@link OsmLogger.rotateIfNeeded} and on a 60s tick from
 *     `main/index.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { pino, type Logger as PinoLogger } from "pino";

/**
 * Construction options for {@link createLogger}.
 */
export interface LoggerOptions {
  /** Absolute path to the log file. Created with `mkdir -p` if missing. */
  logPath: string;
  /** Trigger rotation when the file exceeds this many bytes. Default 100 MB. */
  maxSizeBytes?: number;
  /** Fraction of bytes to discard during rotation. `0.5` keeps the newest 50%. */
  trimRatio?: number;
}

/**
 * The logger interface every Main-side module imports. Implementations
 * are wrapped pino loggers; `child` produces a logger with extra bound
 * fields (e.g. `{ scope: "sidecar" }`) but shares rotation state.
 */
export interface OsmLogger {
  /** Info-level log. `obj` is structured fields; `msg` is the message string. */
  info(obj: object | string, msg?: string): void;
  /** Warn-level log. Same shape as {@link OsmLogger.info}. */
  warn(obj: object | string, msg?: string): void;
  /** Error-level log. Same shape as {@link OsmLogger.info}. */
  error(obj: object | string, msg?: string): void;
  /** Debug-level log. Only emitted when `OSM_LOG_LEVEL=debug`. */
  debug(obj: object | string, msg?: string): void;
  /** Create a child logger with extra default fields baked in. */
  child(bindings: Record<string, unknown>): OsmLogger;
  /** Absolute on-disk path to the log file. */
  getPath(): string;
  /** Current log-file size in bytes (cheap stat). */
  getSizeBytes(): number;
  /** If the file exceeds the cap, rewrite keeping only the newest portion. Returns true iff rotation happened. */
  rotateIfNeeded(): Promise<boolean>;
  /** Force a buffered write to disk. */
  flush(): void;
}

const DEFAULT_MAX = 100 * 1024 * 1024;
const DEFAULT_TRIM = 0.5;

class FileLogger implements OsmLogger {
  private readonly logPath: string;
  private readonly maxSizeBytes: number;
  private readonly trimRatio: number;
  private readonly pinoLogger: PinoLogger;
  private readonly stream: fs.WriteStream;

  constructor(opts: LoggerOptions) {
    this.logPath = opts.logPath;
    this.maxSizeBytes = opts.maxSizeBytes ?? DEFAULT_MAX;
    this.trimRatio = opts.trimRatio ?? DEFAULT_TRIM;
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
    this.pinoLogger = pino(
      {
        level: process.env.OSM_LOG_LEVEL ?? "info",
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: {
          paths: ["accessToken", "refreshToken", "token", "*.token", "password", "code_verifier"],
          remove: true,
        },
      },
      this.stream,
    );
  }

  info(obj: object | string, msg?: string) {
    if (typeof obj === "string") this.pinoLogger.info(obj);
    else this.pinoLogger.info(obj, msg);
  }
  warn(obj: object | string, msg?: string) {
    if (typeof obj === "string") this.pinoLogger.warn(obj);
    else this.pinoLogger.warn(obj, msg);
  }
  error(obj: object | string, msg?: string) {
    if (typeof obj === "string") this.pinoLogger.error(obj);
    else this.pinoLogger.error(obj, msg);
  }
  debug(obj: object | string, msg?: string) {
    if (typeof obj === "string") this.pinoLogger.debug(obj);
    else this.pinoLogger.debug(obj, msg);
  }

  child(bindings: Record<string, unknown>): OsmLogger {
    const childPino = this.pinoLogger.child(bindings);
    return new ChildLogger(childPino, this);
  }

  getPath(): string {
    return this.logPath;
  }

  getSizeBytes(): number {
    try {
      return fs.statSync(this.logPath).size;
    } catch {
      return 0;
    }
  }

  async rotateIfNeeded(): Promise<boolean> {
    const size = this.getSizeBytes();
    if (size < this.maxSizeBytes) return false;
    return this.trimNow(size);
  }

  flush(): void {
    this.pinoLogger.flush?.();
  }

  // Trim oldest `trimRatio` bytes. We do this by reading bytes from the
  // (size * trimRatio) offset, finding the next newline, and rewriting the
  // file atomically.
  private async trimNow(size: number): Promise<boolean> {
    const fd = fs.openSync(this.logPath, "r");
    const cutBytes = Math.floor(size * this.trimRatio);
    // Find newline boundary so we don't split a JSON line.
    const probeSize = Math.min(4096, size - cutBytes);
    const probe = Buffer.alloc(probeSize);
    fs.readSync(fd, probe, 0, probeSize, cutBytes);
    let nlIdx = probe.indexOf(0x0a);
    if (nlIdx < 0) nlIdx = 0;
    const trueCut = cutBytes + nlIdx + 1;
    fs.closeSync(fd);

    const reader = fs.createReadStream(this.logPath, { start: trueCut });
    const tmpPath = `${this.logPath}.rotating`;
    const writer = fs.createWriteStream(tmpPath, { flags: "w" });
    await new Promise<void>((resolve, reject) => {
      reader.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", () => resolve());
      reader.pipe(writer);
    });
    // Replace original.
    fs.renameSync(tmpPath, this.logPath);
    return true;
  }
}

class ChildLogger implements OsmLogger {
  constructor(private readonly p: PinoLogger, private readonly parent: FileLogger) {}
  info(obj: object | string, msg?: string) {
    typeof obj === "string" ? this.p.info(obj) : this.p.info(obj, msg);
  }
  warn(obj: object | string, msg?: string) {
    typeof obj === "string" ? this.p.warn(obj) : this.p.warn(obj, msg);
  }
  error(obj: object | string, msg?: string) {
    typeof obj === "string" ? this.p.error(obj) : this.p.error(obj, msg);
  }
  debug(obj: object | string, msg?: string) {
    typeof obj === "string" ? this.p.debug(obj) : this.p.debug(obj, msg);
  }
  child(bindings: Record<string, unknown>) {
    return new ChildLogger(this.p.child(bindings), this.parent);
  }
  getPath() {
    return this.parent.getPath();
  }
  getSizeBytes() {
    return this.parent.getSizeBytes();
  }
  rotateIfNeeded() {
    return this.parent.rotateIfNeeded();
  }
  flush() {
    this.parent.flush();
  }
}

/**
 * Construct a process-wide logger.
 *
 * Call once on app boot. Hand the returned instance to every module that
 * needs to log; use `.child({ scope: "sidecar" })` to scope per-area.
 *
 * Caller is responsible for periodically invoking
 * {@link OsmLogger.rotateIfNeeded}; we don't run a timer inside the
 * logger to keep the impl framework-free.
 */
export function createLogger(opts: LoggerOptions): OsmLogger {
  return new FileLogger(opts);
}
