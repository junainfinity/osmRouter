import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { computeSha256, verifySidecarBinary, resolveSidecarPath } from "../../main/sidecar/integrity.js";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "osm-it-"));
}

describe("[unit] sidecar integrity", () => {
  it("computeSha256 matches openssl-style hex", async () => {
    const d = await tmpdir();
    const p = path.join(d, "bin");
    await fs.writeFile(p, "hello world");
    const got = await computeSha256(p);
    const want = crypto.createHash("sha256").update("hello world").digest("hex");
    expect(got).toBe(want);
  });

  it("verifySidecarBinary returns ok on matching hash", async () => {
    const d = await tmpdir();
    const binName = "osm-agent-darwin-arm64";
    const binPath = path.join(d, binName);
    await fs.writeFile(binPath, "the-binary-bytes");
    const hash = await computeSha256(binPath);
    const hashPath = path.join(d, "sidecar-hash.json");
    await fs.writeFile(hashPath, JSON.stringify({ binary: binName, algo: "sha256", hash, builtAt: new Date().toISOString() }));
    const result = await verifySidecarBinary({ binaryPath: binPath, hashFilePath: hashPath });
    expect(result.ok).toBe(true);
    expect(result.actual).toBe(hash);
  });

  it("verifySidecarBinary returns NOT ok when bytes were tampered with", async () => {
    const d = await tmpdir();
    const binName = "osm-agent-darwin-arm64";
    const binPath = path.join(d, binName);
    await fs.writeFile(binPath, "original-bytes");
    const originalHash = await computeSha256(binPath);
    const hashPath = path.join(d, "sidecar-hash.json");
    await fs.writeFile(hashPath, JSON.stringify({ binary: binName, algo: "sha256", hash: originalHash, builtAt: new Date().toISOString() }));
    // Tamper:
    await fs.writeFile(binPath, "tampered-bytes-attacker");
    const result = await verifySidecarBinary({ binaryPath: binPath, hashFilePath: hashPath });
    expect(result.ok).toBe(false);
    expect(result.expected).toBe(originalHash);
    expect(result.actual).not.toBe(originalHash);
  });

  it("verifySidecarBinary rejects when basename does not match", async () => {
    const d = await tmpdir();
    const wrongName = path.join(d, "osm-agent-wrong-name");
    await fs.writeFile(wrongName, "anything");
    const realHash = await computeSha256(wrongName);
    const hashPath = path.join(d, "sidecar-hash.json");
    await fs.writeFile(hashPath, JSON.stringify({ binary: "osm-agent-darwin-arm64", algo: "sha256", hash: realHash, builtAt: new Date().toISOString() }));
    const result = await verifySidecarBinary({ binaryPath: wrongName, hashFilePath: hashPath });
    expect(result.ok).toBe(false);
  });

  it("verifySidecarBinary throws on unsupported algo", async () => {
    const d = await tmpdir();
    const binPath = path.join(d, "osm-agent-darwin-arm64");
    await fs.writeFile(binPath, "data");
    const hashPath = path.join(d, "sidecar-hash.json");
    await fs.writeFile(hashPath, JSON.stringify({ binary: "osm-agent-darwin-arm64", algo: "md5", hash: "x", builtAt: "" }));
    await expect(verifySidecarBinary({ binaryPath: binPath, hashFilePath: hashPath })).rejects.toThrow(/unsupported-hash-algo/);
  });

  it("resolveSidecarPath builds platform-aware names", () => {
    const r1 = resolveSidecarPath({ resourcesPath: "/r", devRoot: "/dev", platform: "darwin", arch: "arm64" });
    expect(r1.binaryPath).toBe("/r/osm-agent-darwin-arm64");
    expect(r1.hashFilePath).toBe("/r/sidecar-hash.json");
    const r2 = resolveSidecarPath({ resourcesPath: undefined, devRoot: "/dev", platform: "win32", arch: "amd64" });
    expect(r2.binaryPath).toBe("/dev/resources/osm-agent-windows-amd64.exe");
  });
});
