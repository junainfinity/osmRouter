// S6.5 — state mismatch must abort auth.

import { describe, it, expect } from "vitest";
import { createLogger } from "../../main/logger/index.js";
import { createKeychainStore } from "../../main/keychain/index.js";
import { AuthFlow } from "../../main/auth/flow.js";
import { MockAuthBackend } from "../../main/auth/mock-backend.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-sm-"));
  const logger = createLogger({ logPath: path.join(dir, "log.log") });
  const kc = await createKeychainStore({ userDataPath: dir, forceImpl: "memory" });
  const auth = new AuthFlow({ backend: new MockAuthBackend(), keychain: kc, logger, redirectUri: "osmrouter://auth", account: "primary" });
  return { auth, kc };
}

describe("[sec S6.5] auth state mismatch", () => {
  it("rejects callback whose state does not match the pending flow", async () => {
    const { auth, kc } = await setup();
    const { authUrl } = auth.begin();
    const challenge = new URL(authUrl).searchParams.get("code_challenge")!;
    // Tamper the state.
    const cb = `osmrouter://auth?code=${encodeURIComponent(challenge)}&state=ATTACKER-STATE`;
    await expect(auth.handleCallback(cb)).rejects.toThrow(/auth-state-mismatch/);
    expect(await kc.getToken("primary:access")).toBeNull();
  });

  it("rejects callback with no pending flow at all", async () => {
    const { auth, kc } = await setup();
    const cb = `osmrouter://auth?code=ANY&state=ANY`;
    await expect(auth.handleCallback(cb)).rejects.toThrow(/auth-no-pending-flow/);
    expect(await kc.getToken("primary:access")).toBeNull();
  });

  it("rejects callback with wrong protocol", async () => {
    const { auth } = await setup();
    auth.begin();
    await expect(auth.handleCallback("https://attacker.com/auth?code=x&state=y")).rejects.toThrow(/auth-bad-protocol/);
  });

  it("clears pending state after a failed callback (no replay)", async () => {
    const { auth, kc } = await setup();
    auth.begin();
    await expect(auth.handleCallback("osmrouter://auth?code=ANY&state=ATTACKER")).rejects.toThrow();
    // Second attempt with anything must now fail with auth-no-pending-flow.
    await expect(auth.handleCallback("osmrouter://auth?code=ANY&state=ATTACKER")).rejects.toThrow(/auth-no-pending-flow/);
    expect(await kc.getToken("primary:access")).toBeNull();
  });

  it("accepts a fresh flow after the rejected one", async () => {
    const { auth, kc } = await setup();
    auth.begin();
    await expect(auth.handleCallback("osmrouter://auth?code=BAD&state=BAD")).rejects.toThrow();
    const { authUrl } = auth.begin();
    const challenge = new URL(authUrl).searchParams.get("code_challenge")!;
    const state = new URL(authUrl).searchParams.get("state")!;
    const cb = `osmrouter://auth?code=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}`;
    await auth.handleCallback(cb);
    expect(await kc.getToken("primary:access")).toMatch(/^at_/);
  });
});
