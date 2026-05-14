// S5.1–S5.4 — sidecar binary integrity at-spawn check.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { computeSha256, verifySidecarBinary } from "../../main/sidecar/integrity.js";

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-tamper-"));
  const binName = "osm-agent-darwin-arm64";
  const binPath = path.join(dir, binName);
  await fs.writeFile(binPath, "ORIGINAL-BYTES");
  const hashPath = path.join(dir, "sidecar-hash.json");
  const hash = await computeSha256(binPath);
  await fs.writeFile(hashPath, JSON.stringify({ binary: binName, algo: "sha256", hash, builtAt: new Date().toISOString() }));
  return { dir, binPath, hashPath, hash };
}

describe("[sec S5] sidecar tamper detection", () => {
  it("matching binary verifies", async () => {
    const { binPath, hashPath } = await fixture();
    const r = await verifySidecarBinary({ binaryPath: binPath, hashFilePath: hashPath });
    expect(r.ok).toBe(true);
  });

  it("flipped byte fails verification", async () => {
    const { binPath, hashPath } = await fixture();
    const buf = await fs.readFile(binPath);
    buf[0] = (buf[0]! ^ 0xff) as 0; // flip one bit
    await fs.writeFile(binPath, buf);
    const r = await verifySidecarBinary({ binaryPath: binPath, hashFilePath: hashPath });
    expect(r.ok).toBe(false);
  });

  it("entirely replaced binary fails verification", async () => {
    const { binPath, hashPath } = await fixture();
    await fs.writeFile(binPath, "ATTACKER-IMPLANT-PAYLOAD");
    const r = await verifySidecarBinary({ binaryPath: binPath, hashFilePath: hashPath });
    expect(r.ok).toBe(false);
  });

  it("missing binary fails verification cleanly", async () => {
    const { binPath, hashPath } = await fixture();
    await fs.unlink(binPath);
    await expect(verifySidecarBinary({ binaryPath: binPath, hashFilePath: hashPath })).rejects.toThrow();
  });

  it("missing hash file fails", async () => {
    const { binPath } = await fixture();
    await expect(verifySidecarBinary({ binaryPath: binPath, hashFilePath: "/tmp/does-not-exist.json" })).rejects.toThrow();
  });

  it("wrong-name binary fails (defends against renamed-binary attack)", async () => {
    const { dir, hashPath } = await fixture();
    const wrong = path.join(dir, "osm-agent-EVIL");
    await fs.writeFile(wrong, "ANYTHING");
    const r = await verifySidecarBinary({ binaryPath: wrong, hashFilePath: hashPath });
    expect(r.ok).toBe(false);
  });
});
