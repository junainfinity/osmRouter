import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// The API origin the dashboard fetches from. In Docker production we proxy via
// Caddy at https://api.<brand>.com, so the browser-side fetch must be allowed
// in `connect-src` — without this CSP rule the browser blocks every fetch()
// with a "Failed to fetch" before the request even leaves.
const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
const apiOrigin = (() => {
  try { return new URL(apiBase).origin; } catch { return apiBase; }
})();
const apiWsOrigin = apiOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

// CSP. Next.js emits inline bootstrap scripts; production-strict CSP requires
// a nonce middleware. v1 allows 'unsafe-inline'; nonce-based CSP is on the
// v1.1 hardening list (documented in HANDOFF.md).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ""}`.trim(),
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
  "font-src 'self' fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ws: wss: http://localhost:8080 ws://localhost:8080 ${apiOrigin} ${apiWsOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
