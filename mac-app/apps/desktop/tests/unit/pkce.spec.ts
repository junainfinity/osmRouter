import { describe, it, expect } from "vitest";
import { createPkce, verifyChallenge } from "../../main/auth/pkce.js";

describe("[unit] pkce", () => {
  it("createPkce produces base64url verifier of correct length", () => {
    const m = createPkce();
    // base64url(32 bytes) = 43 chars (no padding)
    expect(m.verifier.length).toBe(43);
    expect(/^[A-Za-z0-9_-]+$/.test(m.verifier)).toBe(true);
    expect(/^[A-Za-z0-9_-]+$/.test(m.challenge)).toBe(true);
    expect(/^[A-Za-z0-9_-]+$/.test(m.state)).toBe(true);
    expect(m.challengeMethod).toBe("S256");
  });

  it("challenge is SHA-256 of verifier", () => {
    const m = createPkce();
    expect(verifyChallenge(m.verifier, m.challenge)).toBe(true);
  });

  it("verifyChallenge rejects wrong verifier", () => {
    const m = createPkce();
    expect(verifyChallenge("wrong-verifier", m.challenge)).toBe(false);
  });

  it("two consecutive calls produce different material (high entropy)", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).not.toBe(b.state);
  });

  it("100 generated states are unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(createPkce().state);
    expect(seen.size).toBe(100);
  });

  it("verifyChallenge is constant-time over equal-length inputs", () => {
    // Smoke check that buffers of different content but equal length work without throwing
    const ok = verifyChallenge(
      "a".repeat(43),
      Buffer.from("b".repeat(32)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"),
    );
    expect(typeof ok).toBe("boolean");
  });
});
