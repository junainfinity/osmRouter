// S4.1 (no token logs) + S4.2 (tokens never sent to renderer).

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger } from "../../main/logger/index.js";
import { createKeychainStore } from "../../main/keychain/index.js";
import { AuthFlow } from "../../main/auth/flow.js";
import { MockAuthBackend } from "../../main/auth/mock-backend.js";
import crypto from "node:crypto";

let logFile: string;
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-leak-"));
  logFile = path.join(dir, "log.log");
  const logger = createLogger({ logPath: logFile });
  const kc = await createKeychainStore({ userDataPath: dir, forceImpl: "memory" });
  const backend = new MockAuthBackend();
  const auth = new AuthFlow({ backend, keychain: kc, logger, redirectUri: "osmrouter://auth", account: "primary" });
  return { logger, kc, auth, backend, dir };
}

describe("[sec S4.1] no access/refresh tokens in log file", () => {
  it("complete PKCE flow does not write the token to disk logs", async () => {
    const { auth, logger } = await setup();
    const { authUrl } = auth.begin();
    const stateParam = new URL(authUrl).searchParams.get("state")!;
    // Construct the code = SHA256(verifier) — we extract verifier from the backend's expectation
    const challenge = new URL(authUrl).searchParams.get("code_challenge")!;
    // The MockAuthBackend rebuilds the code as base64url(SHA256(verifier))
    // so the "code" the IdP would issue equals the challenge.
    const code = challenge;
    const cb = `osmrouter://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(stateParam)}`;
    await auth.handleCallback(cb);
    logger.flush();
    await new Promise((r) => setTimeout(r, 50));
    const text = await fs.readFile(logFile, "utf8");
    expect(text).not.toMatch(/at_[a-f0-9]{32}/);
    expect(text).not.toMatch(/rt_[a-f0-9]{32}/);
  });

  it("explicit log call with token key is redacted", async () => {
    const { logger } = await setup();
    const token = `at_${crypto.randomBytes(16).toString("hex")}`;
    logger.info({ accessToken: token, refreshToken: token, token, harmless: 1 }, "evt");
    logger.flush();
    await new Promise((r) => setTimeout(r, 50));
    const text = await fs.readFile(logFile, "utf8");
    expect(text).not.toContain(token);
    expect(text).toMatch(/"harmless":1/);
  });
});

describe("[sec S4.2] keychain never exposes token to AuthState", () => {
  it("AuthState contains email/workspace but never a token field", async () => {
    const { auth, kc } = await setup();
    const { authUrl } = auth.begin();
    const stateParam = new URL(authUrl).searchParams.get("state")!;
    const challenge = new URL(authUrl).searchParams.get("code_challenge")!;
    const code = challenge;
    const cb = `osmrouter://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(stateParam)}`;
    const state = await auth.handleCallback(cb);
    expect(state.signedIn).toBe(true);
    expect((state as unknown as { accessToken?: string }).accessToken).toBeUndefined();
    expect((state as unknown as { refreshToken?: string }).refreshToken).toBeUndefined();
    // Token IS in keychain
    expect(await kc.getToken("primary:access")).toMatch(/^at_/);
  });
});
