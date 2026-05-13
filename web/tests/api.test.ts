import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, setCSRFToken } from "@/lib/api";

const realFetch = global.fetch;

beforeEach(() => {
  setCSRFToken("");
});
afterEach(() => {
  global.fetch = realFetch;
});

describe("api()", () => {
  it("includes credentials and Content-Type on POST", async () => {
    const calls: { url: RequestInfo | URL; init: RequestInit | undefined }[] = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await api("/foo", { method: "POST", body: { x: 1 } });
    expect(calls[0].init?.credentials).toBe("include");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("attaches X-CSRF-Token on writes when token is set", async () => {
    setCSRFToken("abcdef");
    const calls: { url: RequestInfo | URL; init: RequestInit | undefined }[] = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await api("/foo", { method: "POST" });
    expect((calls[0].init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("abcdef");
  });

  it("throws ApiError on non-2xx", async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "bad email" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
    await expect(api("/x")).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED", message: "bad email" });
  });
});
