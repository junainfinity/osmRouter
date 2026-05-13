/**
 * @fileoverview Secure credential storage with keytar (primary) and
 * Electron `safeStorage` (fallback).
 *
 * The Yellow Paper §6 and Security Spec §S4 require that **no token, no
 * refresh token, no registrar key ever lands in plaintext on disk**. This
 * module is the single mechanism for token persistence. The renderer is
 * never given direct access to the store — only Main can read or write —
 * and tokens are never sent back to the renderer in IPC payloads.
 *
 * ## Three implementations, one interface
 *
 * - **keytar** — native binding to macOS Keychain (preferred). Tokens are
 *   stored as Keychain items with service `io.osmrouter.desktop` and the
 *   account name as their primary key. Encryption is delegated to the
 *   user's login keychain.
 *
 * - **safeStorage** — Electron's built-in API that wraps the same OS
 *   keychain but stores opaque encrypted bytes wherever the caller chooses.
 *   We persist `userData/credentials.enc` (mode 0600) as an atomic
 *   write-and-rename. This path is taken when keytar fails to load
 *   (corporate Macs with restricted node-gyp).
 *
 * - **memory** — last-resort, in-process only. Loses everything on quit.
 *   Used for tests and as a final fallback when neither secure backend
 *   is available; we still prefer "broken auth at next restart" to
 *   "plaintext on disk".
 *
 * Implements (from {@link ../../../osmRouter/05 - Security Spec.md}):
 *   - **S4.1** — tokens never logged (redaction in `main/logger`)
 *   - **S4.2** — tokens never sent to renderer (enforced in `main/auth/flow.ts`)
 *   - **S4.3** — Keychain via keytar (primary)
 *   - **S4.4** — safeStorage encrypted blob fallback
 *   - **S4.5** — tokens are scope-restricted server-side
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Uniform interface across all storage backends. Caller code never sees
 * the underlying impl — pick once at boot via {@link createKeychainStore}.
 */
export interface KeychainStore {
  /**
   * Store a token. Overwrites if the account already exists.
   *
   * @param account — keychain account key. We use suffixes like
   *   `"primary:access"`, `"primary:refresh"`, `"primary:email"` to keep
   *   credential groups together under one logical user.
   * @param token — the secret. Caller is responsible for any token-format
   *   policy (length, charset, etc.).
   */
  setToken(account: string, token: string): Promise<void>;
  /** Read a token. Returns `null` if not set. Never throws on missing. */
  getToken(account: string): Promise<string | null>;
  /** Delete a token. No-op if missing. */
  deleteToken(account: string): Promise<void>;
  /** List every account currently stored under our service. */
  listAccounts(): Promise<string[]>;
  /** Short identifier of which backend this instance uses ("keytar" | "safeStorage" | "memory"). */
  describe(): string;
}

/**
 * Keychain service identifier. macOS uses this as the primary grouping for
 * our credentials in Keychain Access.app — change it and all existing
 * credentials become unreachable. Treat as load-bearing.
 */
const SERVICE = "io.osmrouter.desktop";

/**
 * Minimal subset of keytar's API we depend on. Defined here rather than
 * imported so the keytar require can fail without breaking compilation.
 */
type Keytar = {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<{ account: string; password: string }[]>;
};

/**
 * Try to load keytar. Returns `null` if the native module isn't installed
 * or fails to load — we then fall back to safeStorage. The dynamic import
 * is wrapped in a Promise so a synchronous throw in the binding doesn't
 * crash the app boot.
 */
async function loadKeytar(): Promise<Keytar | null> {
  try {
    // Dynamic import so missing native module is recoverable.
    const mod = (await import("keytar").catch(() => null)) as { default?: Keytar } | Keytar | null;
    if (!mod) return null;
    return (mod as { default?: Keytar }).default ?? (mod as Keytar);
  } catch {
    return null;
  }
}

/**
 * Keytar-backed store. Each call delegates to the native module which
 * delegates to macOS Keychain. All operations are atomic in the OS.
 */
class KeytarStore implements KeychainStore {
  constructor(private readonly keytar: Keytar) {}
  setToken(account: string, token: string) {
    return this.keytar.setPassword(SERVICE, account, token);
  }
  getToken(account: string) {
    return this.keytar.getPassword(SERVICE, account);
  }
  async deleteToken(account: string) {
    await this.keytar.deletePassword(SERVICE, account);
  }
  async listAccounts() {
    const all = await this.keytar.findCredentials(SERVICE);
    return all.map((c) => c.account);
  }
  describe() {
    return "keytar";
  }
}

/**
 * Minimal surface of Electron's `safeStorage` that we depend on. Defined
 * as an interface so tests can substitute a fake (see
 * `tests/unit/keychain.spec.ts`).
 */
export interface SafeStorageLike {
  /** True iff the OS keychain is currently unlockable. */
  isEncryptionAvailable(): boolean;
  /** Encrypt a UTF-8 string using the OS keychain key. */
  encryptString(s: string): Buffer;
  /** Decrypt bytes previously returned by `encryptString`. */
  decryptString(b: Buffer): string;
}

/**
 * safeStorage-backed store. We keep an in-memory cache for performance and
 * persist the whole map atomically on every write. The on-disk file holds
 * an opaque ciphertext blob — never JSON, never plaintext.
 *
 * If the file becomes unreadable (e.g. user changed Mac, restored a TM
 * backup), we quarantine it under `.corrupt-<ts>` and start fresh. The
 * user will need to re-auth. We prefer that over any chance of returning
 * a half-decrypted value to a caller.
 */
class SafeStorageStore implements KeychainStore {
  private cache: Record<string, string> | null = null;
  constructor(private readonly safeStorage: SafeStorageLike, private readonly filePath: string) {}

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = {};
      return this.cache;
    }
    const buf = await fs.readFile(this.filePath);
    if (buf.length === 0) {
      this.cache = {};
      return this.cache;
    }
    try {
      const plain = this.safeStorage.decryptString(buf);
      const parsed = JSON.parse(plain) as Record<string, string>;
      this.cache = parsed;
      return parsed;
    } catch {
      // Corrupt file — quarantine and start fresh; we'd rather force
      // re-login than expose any chance of half-decrypted memory.
      await fs.rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      this.cache = {};
      return this.cache;
    }
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    const plain = JSON.stringify(this.cache);
    const enc = this.safeStorage.encryptString(plain);
    const tmp = `${this.filePath}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Atomic write: write to `.tmp`, then rename. Rename is atomic on
    // POSIX-conformant filesystems including APFS. Guarantees that a
    // crash mid-write doesn't truncate the credentials file.
    await fs.writeFile(tmp, enc, { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  async setToken(account: string, token: string) {
    const c = await this.load();
    c[account] = token;
    await this.save();
  }

  async getToken(account: string) {
    const c = await this.load();
    return c[account] ?? null;
  }

  async deleteToken(account: string) {
    const c = await this.load();
    delete c[account];
    await this.save();
  }

  async listAccounts() {
    const c = await this.load();
    return Object.keys(c);
  }

  describe() {
    return "safeStorage";
  }
}

/**
 * Options for {@link createKeychainStore}.
 */
export interface CreateKeychainOptions {
  /** Path under `app.getPath('userData')` where the safeStorage blob lives. */
  userDataPath: string;
  /** Electron `safeStorage`. Required for the `safeStorage` impl. */
  safeStorage?: SafeStorageLike;
  /** Force a specific impl. Used by tests; production code uses auto-detect. */
  forceImpl?: "keytar" | "safeStorage" | "memory";
}

/**
 * In-process memory store. Used for tests and as a final fallback. Loses
 * everything on quit. Worth it because we never trade memory loss for
 * plaintext-on-disk.
 */
class MemoryStore implements KeychainStore {
  private cache = new Map<string, string>();
  async setToken(account: string, token: string) {
    this.cache.set(account, token);
  }
  async getToken(account: string) {
    return this.cache.get(account) ?? null;
  }
  async deleteToken(account: string) {
    this.cache.delete(account);
  }
  async listAccounts() {
    return Array.from(this.cache.keys());
  }
  describe() {
    return "memory";
  }
}

/**
 * Construct a {@link KeychainStore}.
 *
 * Auto-mode selects the best available backend:
 *   1. keytar (preferred, real macOS Keychain via native binding)
 *   2. safeStorage (if `isEncryptionAvailable()`)
 *   3. memory (last resort)
 *
 * Pass `forceImpl` in tests to pin behavior.
 */
export async function createKeychainStore(opts: CreateKeychainOptions): Promise<KeychainStore> {
  if (opts.forceImpl === "memory") return new MemoryStore();
  if (opts.forceImpl === "keytar") {
    const kt = await loadKeytar();
    if (!kt) throw new Error("keytar-unavailable");
    return new KeytarStore(kt);
  }
  if (opts.forceImpl === "safeStorage") {
    if (!opts.safeStorage) throw new Error("safeStorage-required");
    return new SafeStorageStore(opts.safeStorage, path.join(opts.userDataPath, "credentials.enc"));
  }
  // Auto: prefer keytar, fall back to safeStorage.
  const kt = await loadKeytar();
  if (kt) return new KeytarStore(kt);
  if (opts.safeStorage?.isEncryptionAvailable()) {
    return new SafeStorageStore(opts.safeStorage, path.join(opts.userDataPath, "credentials.enc"));
  }
  // Last-resort in-process memory store. Will silently lose tokens on quit.
  return new MemoryStore();
}
