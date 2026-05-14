import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createKeychainStore, type SafeStorageLike } from "../../main/keychain/index.js";

class FakeSafeStorage implements SafeStorageLike {
  isEncryptionAvailable() {
    return true;
  }
  encryptString(s: string): Buffer {
    // XOR with constant for round-trip integrity (NOT actually secure — just for round-trip test)
    const src = Buffer.from(s);
    const out = Buffer.alloc(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i]! ^ 0x5a;
    return out;
  }
  decryptString(b: Buffer): string {
    const out = Buffer.alloc(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b[i]! ^ 0x5a;
    return out.toString("utf8");
  }
}

let userData: string;
beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), "osm-kc-"));
});

describe("[unit] keychain — memory impl", () => {
  it("round-trips set/get/delete/list", async () => {
    const kc = await createKeychainStore({ userDataPath: userData, forceImpl: "memory" });
    expect(kc.describe()).toBe("memory");
    expect(await kc.getToken("primary")).toBeNull();
    await kc.setToken("primary", "tok-xyz");
    expect(await kc.getToken("primary")).toBe("tok-xyz");
    await kc.setToken("secondary", "tok-abc");
    expect(await kc.listAccounts()).toEqual(expect.arrayContaining(["primary", "secondary"]));
    await kc.deleteToken("primary");
    expect(await kc.getToken("primary")).toBeNull();
  });
});

describe("[unit] keychain — safeStorage impl", () => {
  it("encrypts blob on disk; never plaintext", async () => {
    const kc = await createKeychainStore({
      userDataPath: userData,
      forceImpl: "safeStorage",
      safeStorage: new FakeSafeStorage(),
    });
    expect(kc.describe()).toBe("safeStorage");
    await kc.setToken("primary", "tok-secret-12345");
    const filePath = path.join(userData, "credentials.enc");
    const buf = await fs.readFile(filePath);
    expect(buf.toString("utf8")).not.toContain("tok-secret-12345");
    expect(buf.toString("utf8")).not.toContain("primary");
  });

  it("survives process restart (cache cleared)", async () => {
    const ss = new FakeSafeStorage();
    const kc1 = await createKeychainStore({ userDataPath: userData, forceImpl: "safeStorage", safeStorage: ss });
    await kc1.setToken("primary", "persisted-token");
    const kc2 = await createKeychainStore({ userDataPath: userData, forceImpl: "safeStorage", safeStorage: ss });
    expect(await kc2.getToken("primary")).toBe("persisted-token");
  });

  it("writes the file with 0o600 perms", async () => {
    const kc = await createKeychainStore({ userDataPath: userData, forceImpl: "safeStorage", safeStorage: new FakeSafeStorage() });
    await kc.setToken("primary", "tok");
    const stat = await fs.stat(path.join(userData, "credentials.enc"));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("quarantines a corrupt file and starts fresh", async () => {
    const filePath = path.join(userData, "credentials.enc");
    await fs.writeFile(filePath, Buffer.from([0x00, 0x01, 0x02])); // garbage
    const kc = await createKeychainStore({ userDataPath: userData, forceImpl: "safeStorage", safeStorage: new FakeSafeStorage() });
    expect(await kc.getToken("primary")).toBeNull();
    const entries = await fs.readdir(userData);
    expect(entries.some((e) => e.startsWith("credentials.enc.corrupt-"))).toBe(true);
  });

  it("list returns the set of accounts", async () => {
    const kc = await createKeychainStore({ userDataPath: userData, forceImpl: "safeStorage", safeStorage: new FakeSafeStorage() });
    await kc.setToken("a", "1");
    await kc.setToken("b", "2");
    const accs = await kc.listAccounts();
    expect(new Set(accs)).toEqual(new Set(["a", "b"]));
  });
});
