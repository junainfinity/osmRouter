/**
 * @fileoverview PKCE (Proof Key for Code Exchange, RFC 7636) primitives.
 *
 * PKCE replaces the `client_secret` field of classical OAuth in public
 * clients (mobile apps, desktop apps, SPAs) where shipping a secret would
 * make it trivially extractable. The client generates a random
 * `verifier`, sends `challenge = SHA-256(verifier)` to the auth server up
 * front, then proves possession of the verifier when redeeming the code.
 *
 * We additionally bind the flow to an opaque `state` value to defend
 * against authorization-code injection (a malicious app on the same
 * machine receiving a stolen `osmrouter://` redirect).
 *
 * Implements (from {@link ../../../osmRouter/05 - Security Spec.md}):
 *   - **S6.2** — verifier from `crypto.randomBytes` (32 bytes → base64url)
 *   - **S6.3** — challenge is `base64url(SHA-256(verifier))`
 *   - **S6.4** — state is 32 random bytes, in-memory only
 *   - **S6.5** — state mismatch aborts the flow
 *   - **S6.7** — verifier and state references dropped on completion
 *
 * @see RFC 7636 — https://datatracker.ietf.org/doc/html/rfc7636
 */

import crypto from "node:crypto";

/**
 * The material produced once per PKCE flow. The {@link AuthFlow} holds
 * exactly one of these in memory between `begin()` and `handleCallback()`,
 * then drops the reference.
 */
export interface PkceMaterial {
  /** 32 bytes of CSPRNG output, base64url-encoded → 43 chars. */
  verifier: string;
  /** `base64url(SHA-256(verifier))`. Sent to the auth server up front. */
  challenge: string;
  /** Always `"S256"` for us — RFC allows `"plain"`, we do not. */
  challengeMethod: "S256";
  /** 32 bytes of CSPRNG output, base64url-encoded → 43 chars. */
  state: string;
}

/**
 * Convert raw bytes to base64url. Differs from base64 in three swaps:
 *   - `+` → `-`
 *   - `/` → `_`
 *   - trailing `=` padding removed
 *
 * RFC 7636 §4.1 requires this exact encoding for both the verifier and the
 * challenge.
 */
function base64Url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Generate a fresh set of PKCE material. Call once per sign-in attempt.
 *
 * Entropy: 32 bytes from `crypto.randomBytes` for both `verifier` and
 * `state`. That is 256 bits — well past any reasonable brute-force
 * resistance threshold and matches RFC 7636 §7.1's recommendation.
 *
 * @returns the {@link PkceMaterial} the caller should hold in memory for
 *   the duration of the flow. Drop the reference as soon as
 *   `handleCallback` resolves.
 */
export function createPkce(): PkceMaterial {
  // 32 random bytes → 43-char base64url; per RFC 7636 §4.1.
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(32));
  return { verifier, challenge, challengeMethod: "S256", state };
}

/**
 * Verify a challenge against a candidate verifier in constant time.
 *
 * Used by the mock auth backend (the real one runs server-side). The
 * caller would call this with the verifier received from a code-exchange
 * request and the challenge stored alongside the issued code.
 *
 * @param verifier — the candidate verifier
 * @param challenge — the previously-recorded base64url challenge
 * @returns true if `SHA-256(verifier)` matches `challenge`; false otherwise
 */
export function verifyChallenge(verifier: string, challenge: string): boolean {
  const expected = base64Url(crypto.createHash("sha256").update(verifier).digest());
  // Length-different inputs can short-circuit safely because the leak
  // ("got the length wrong") is not useful to an attacker. Equal-length
  // inputs go through `timingSafeEqual` so the comparison time does not
  // depend on where the first mismatching byte lies.
  if (expected.length !== challenge.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(challenge));
}

/**
 * Documentation marker. JavaScript strings are immutable, so this can't
 * actually zero the byte representation in V8 — but we keep the call site
 * to (a) signal intent and (b) act as a grep target if we ever switch
 * secret handling to `Buffer` (where `Buffer.fill(0)` does work).
 *
 * For real secrets that need active scrubbing, use `Buffer` end-to-end
 * and call `.fill(0)` at the caller.
 */
export function zeroOut(_s: string): void {
  // no-op in JS, kept for intent + greppability
}
