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

// CSP for the dashboard (app/(app)/*, /login, /signup, /verify). Next.js emits
// inline bootstrap scripts; production-strict CSP requires a nonce middleware.
// v1 allows 'unsafe-inline'; nonce-based CSP is on the v1.1 hardening list
// (documented in HANDOFF.md).
const cspStrict = [
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

// CSP for the marketing landing page (served at `/` via the rewrite below, and
// directly at `/landing.html`). The new landing is a self-contained HTML file
// that loads React + ReactDOM + Babel-standalone from unpkg and compiles
// inline JSX at runtime — so it needs `unpkg.com` in script-src AND
// `'unsafe-eval'` for Babel-standalone's runtime transform.
//
// v1.1 follow-up: pre-compile the landing's JSX (Babel CLI build step) and
// self-host React+ReactDOM, so we can drop both `https://unpkg.com` and
// `'unsafe-eval'` from the landing's CSP. Tracked in HANDOFF.md.
const cspLanding = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
  "script-src-elem 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
  "font-src 'self' fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ws: wss: http://localhost:8080 ws://localhost:8080 ${apiOrigin} ${apiWsOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const commonHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async rewrites() {
    // `/` is now the marketing landing — served as a static HTML file from
    // `public/landing.html` (was previously rendered by app/page.tsx, now
    // removed). Direct hits to `/landing.html` continue to work too.
    return [
      { source: "/", destination: "/landing.html" },
    ];
  },
  async headers() {
    // Headers are matched in declaration order and merged per-key with
    // later entries overriding earlier ones for the same key. We set the
    // strict CSP for every path first, then override CSP only for `/` and
    // `/landing.html` (the marketing landing).
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspStrict },
          ...commonHeaders,
        ],
      },
      {
        source: "/",
        headers: [
          { key: "Content-Security-Policy", value: cspLanding },
        ],
      },
      {
        source: "/landing.html",
        headers: [
          { key: "Content-Security-Policy", value: cspLanding },
        ],
      },
    ];
  },
};

export default nextConfig;
