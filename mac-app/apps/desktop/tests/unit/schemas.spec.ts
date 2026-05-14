import { describe, it, expect } from "vitest";
import {
  PortSchema,
  DomainNameSchema,
  TargetIpSchema,
  TunnelStartPayload,
  TunnelPreflightPortPayload,
  SysOpenExternalPayload,
  DomainSchema,
  REQUEST_SCHEMAS,
} from "@osmrouter/shared";

describe("[unit] schemas — primitives", () => {
  it("PortSchema accepts 1..65535 ints", () => {
    expect(PortSchema.safeParse(1).success).toBe(true);
    expect(PortSchema.safeParse(80).success).toBe(true);
    expect(PortSchema.safeParse(65535).success).toBe(true);
  });
  it("PortSchema rejects 0 / negative / > 65535 / floats / strings", () => {
    expect(PortSchema.safeParse(0).success).toBe(false);
    expect(PortSchema.safeParse(-1).success).toBe(false);
    expect(PortSchema.safeParse(65536).success).toBe(false);
    expect(PortSchema.safeParse(80.5).success).toBe(false);
    expect(PortSchema.safeParse("80").success).toBe(false);
    expect(PortSchema.safeParse(null).success).toBe(false);
  });

  it("DomainNameSchema accepts valid FQDNs", () => {
    expect(DomainNameSchema.safeParse("example.com").success).toBe(true);
    expect(DomainNameSchema.safeParse("api.microsaas.com").success).toBe(true);
    expect(DomainNameSchema.safeParse("a-b.c-d.org").success).toBe(true);
  });
  it("DomainNameSchema rejects bare hostnames / underscores / leading dots", () => {
    expect(DomainNameSchema.safeParse("localhost").success).toBe(false);
    expect(DomainNameSchema.safeParse(".example.com").success).toBe(false);
    expect(DomainNameSchema.safeParse("foo_bar.com").success).toBe(false);
    expect(DomainNameSchema.safeParse("").success).toBe(false);
  });

  it("TargetIpSchema accepts loopback + RFC1918", () => {
    expect(TargetIpSchema.safeParse("127.0.0.1").success).toBe(true);
    expect(TargetIpSchema.safeParse("10.0.0.5").success).toBe(true);
    expect(TargetIpSchema.safeParse("192.168.1.1").success).toBe(true);
    expect(TargetIpSchema.safeParse("172.16.0.1").success).toBe(true);
  });
  it("TargetIpSchema rejects 0.0.0.0 / multicast / public", () => {
    expect(TargetIpSchema.safeParse("0.0.0.0").success).toBe(false);
    expect(TargetIpSchema.safeParse("224.0.0.1").success).toBe(false);
    expect(TargetIpSchema.safeParse("8.8.8.8").success).toBe(false);
    expect(TargetIpSchema.safeParse("172.32.0.1").success).toBe(false);
  });
});

describe("[unit] schemas — TunnelStartPayload", () => {
  it("accepts a fully valid payload", () => {
    const r = TunnelStartPayload.safeParse({
      domainId: "d_abc",
      port: 3000,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.success).toBe(true);
  });
  it("rejects port out of range", () => {
    const r = TunnelStartPayload.safeParse({
      domainId: "d_abc",
      port: 70000,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.success).toBe(false);
  });
  it("rejects missing domainId", () => {
    const r = TunnelStartPayload.safeParse({
      port: 3000,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.success).toBe(false);
  });
  it("rejects unknown protocol", () => {
    const r = TunnelStartPayload.safeParse({
      domainId: "d_abc",
      port: 3000,
      proto: "SMTP",
      target: "127.0.0.1",
      consentLanBind: false,
    });
    expect(r.success).toBe(false);
  });
  it("strict mode rejects extra props", () => {
    const r = TunnelStartPayload.safeParse({
      domainId: "d_abc",
      port: 3000,
      proto: "HTTP",
      target: "127.0.0.1",
      consentLanBind: false,
      hacked: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("[unit] schemas — TunnelPreflightPortPayload", () => {
  it("defaults host to 127.0.0.1 when omitted", () => {
    const r = TunnelPreflightPortPayload.safeParse({ port: 8080 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.host).toBe("127.0.0.1");
  });
});

describe("[unit] schemas — SysOpenExternalPayload (allow-list)", () => {
  it("accepts allow-listed HTTPS URL", () => {
    const r = SysOpenExternalPayload.safeParse({ url: "https://osmrouter.com/dashboard" });
    expect(r.success).toBe(true);
  });
  it("rejects HTTP", () => {
    const r = SysOpenExternalPayload.safeParse({ url: "http://osmrouter.com/" });
    expect(r.success).toBe(false);
  });
  it("rejects non-allow-listed host", () => {
    const r = SysOpenExternalPayload.safeParse({ url: "https://attacker.com/" });
    expect(r.success).toBe(false);
  });
  it("rejects file:// and javascript:", () => {
    expect(SysOpenExternalPayload.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(SysOpenExternalPayload.safeParse({ url: "file:///etc/passwd" }).success).toBe(false);
  });
});

describe("[unit] schemas — DomainSchema", () => {
  it("normalizes target default to 127.0.0.1", () => {
    const r = DomainSchema.safeParse({
      id: "d_1",
      name: "example.com",
      proto: "HTTP",
      port: 80,
      status: "idle",
      locked: "self",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.target).toBe("127.0.0.1");
  });
});

describe("[unit] schemas — registry consistency", () => {
  it("every request channel has request and response schemas", () => {
    for (const [ch, pair] of Object.entries(REQUEST_SCHEMAS)) {
      expect(pair.request).toBeDefined();
      expect(pair.response).toBeDefined();
      expect(typeof ch).toBe("string");
    }
  });
});
