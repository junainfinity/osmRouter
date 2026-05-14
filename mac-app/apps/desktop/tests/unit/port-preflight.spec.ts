import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { preflightPort } from "../../main/net/port-preflight.js";

describe("[unit] port preflight", () => {
  const servers: net.Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  async function listen(): Promise<number> {
    const s = net.createServer((sock) => sock.end());
    await new Promise<void>((res) => s.listen(0, "127.0.0.1", () => res()));
    servers.push(s);
    return (s.address() as net.AddressInfo).port;
  }

  it("returns reachable: true when something is listening", async () => {
    const port = await listen();
    const r = await preflightPort({ host: "127.0.0.1", port });
    expect(r.reachable).toBe(true);
  });

  it("returns refused when nothing is listening", async () => {
    // Use a high port unlikely to be in use
    const r = await preflightPort({ host: "127.0.0.1", port: 51999 });
    expect(r.reachable).toBe(false);
    expect(r.reason).toBe("refused");
  });

  it("returns timeout when the host blackholes", async () => {
    // 10.255.255.1 with a strict timeout is a reliable blackhole on most networks.
    // We use a short timeout so the test is fast.
    const r = await preflightPort({ host: "10.255.255.1", port: 80, timeoutMs: 250 });
    expect(r.reachable).toBe(false);
    // Either timeout or other reason depending on local routing — both are acceptable failures
    expect(["timeout", "host-unreachable", "other"]).toContain(r.reason);
  });
});
