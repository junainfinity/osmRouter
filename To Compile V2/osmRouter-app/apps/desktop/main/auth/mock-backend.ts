/**
 * @fileoverview Mock implementation of {@link AuthBackend}.
 *
 * In production, the auth backend is a real HTTPS service at
 * `https://osmrouter.com/auth/...`. For v0.1 we ship this mock so the
 * full client-side PKCE flow can be exercised by tests and by manual
 * smoke runs without depending on the real service.
 *
 * Crucially, this mock still **validates PKCE correctness**: the
 * `exchange` step re-derives `SHA-256(verifier)` and refuses the
 * exchange if it doesn't match the `code` (which here is the challenge,
 * round-tripped). So a test that omits or tampers with the verifier
 * still fails — proving our state-mismatch and verifier-mismatch defences
 * fire.
 *
 * For production: a real backend would persist `code → challenge` (with
 * an expiry) in its database, lookup on exchange, and rotate
 * refresh-tokens per RFC 6749 §10.4 recommendations.
 */

import crypto from "node:crypto";
import type { AuthBackend } from "./flow.js";

/**
 * Local mock of the production auth backend. Deterministic enough for
 * tests, realistic enough to exercise the client's defences.
 */
export class MockAuthBackend implements AuthBackend {
  /**
   * Build the URL the user opens in their browser. In production this
   * would go to `https://osmrouter.com/auth/desktop?...` where the user
   * signs in; the mock returns the same shape so URL parsing in tests is
   * realistic.
   *
   * The challenge, state, and redirect URI are all echoed back to the
   * browser, which the real auth server would persist server-side. The
   * mock encodes the challenge as the eventual `code` (see {@link MockAuthBackend.exchange}).
   */
  authorizeUrl(args: { challenge: string; state: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: "desktop",
      code_challenge: args.challenge,
      code_challenge_method: "S256",
      state: args.state,
      redirect_uri: args.redirectUri,
    });
    return `https://osmrouter.com/auth/desktop?${params.toString()}`;
  }

  /**
   * Exchange a code+verifier pair for tokens.
   *
   * The mock treats the `code` as the verifier's challenge (since we
   * don't persist anything between authorize and exchange). It rederives
   * `base64url(SHA-256(verifier))` and refuses the exchange on mismatch
   * with `invalid-code-verifier`. This proves the client side of PKCE
   * still works against a *correct* server: tamper with the verifier and
   * exchange fails.
   *
   * On success it issues:
   *   - `accessToken` like `at_<32hex>` (scope: tunnel-exec)
   *   - `refreshToken` like `rt_<32hex>`
   *   - `email` + `workspace` for display in the UI
   */
  async exchange(args: { code: string; verifier: string; redirectUri: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    email: string;
    workspace: string;
  }> {
    const expected = crypto.createHash("sha256").update(args.verifier).digest("base64url");
    if (args.code !== expected) {
      throw new Error("invalid-code-verifier");
    }
    return {
      accessToken: `at_${crypto.randomBytes(16).toString("hex")}`,
      refreshToken: `rt_${crypto.randomBytes(16).toString("hex")}`,
      email: "arjun@aivf.io",
      workspace: "aivf-prod",
    };
  }

  /**
   * Refresh-token exchange. Validates only that the input has our prefix;
   * a real backend would look up the refresh token in its DB, check the
   * `not_before` claim, rotate, and possibly revoke.
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }> {
    if (!refreshToken.startsWith("rt_")) throw new Error("invalid-refresh-token");
    return { accessToken: `at_${crypto.randomBytes(16).toString("hex")}` };
  }
}
