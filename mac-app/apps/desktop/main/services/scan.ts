/**
 * @fileoverview Local-service discovery.
 *
 * The Mac app's "Services" tab needs to answer: "what's running on this
 * machine right now that I could expose through osmRouter?" We probe a
 * curated list of well-known dev ports + any extras the user has added
 * manually, identify the service by sniffing its HTTP response (LM
 * Studio, Ollama, generic dev servers), and return cards the renderer
 * can display + bind.
 *
 * We avoid a full nmap-style scan deliberately: that's slow, noisy in
 * the firewall logs, and a security smell. Curated probes are fast
 * (one connect + one HTTP req per port) and the user can add anything
 * we missed by hand.
 */
import { connect } from "node:net";
import type { OsmLogger } from "../logger/index.js";

export interface DiscoveredService {
  host: string;
  port: number;
  open: boolean;
  kind: ServiceKind;
  title?: string;
  details?: string;
}

export type ServiceKind =
  | "lm-studio"
  | "ollama"
  | "openai-compatible"
  | "next-dev"
  | "vite-dev"
  | "react-dev"
  | "rails"
  | "flask-fastapi"
  | "generic-http"
  | "unknown";

/** Default probe set — common dev/AI ports. */
export const DEFAULT_PORTS = [
  1234,  // LM Studio
  11434, // Ollama
  3000,  // Next.js / Express
  3001,  // Common alt port
  4000,  // Common alt
  5000,  // Flask
  5173,  // Vite
  5174,  // Vite alt
  8000,  // FastAPI / Django / Python -m http.server
  8080,  // Tomcat / various
  8888,  // Jupyter
  9000,  // Various
];

const CONNECT_TIMEOUT_MS = 250;
const HTTP_TIMEOUT_MS = 1200;

export interface ScanOpts {
  ports?: number[];
  host?: string;
  logger?: OsmLogger;
}

/** Scan a list of ports on 127.0.0.1 (or provided host). */
export async function scanServices(opts: ScanOpts = {}): Promise<DiscoveredService[]> {
  const host = opts.host ?? "127.0.0.1";
  const ports = opts.ports ?? DEFAULT_PORTS;
  const results = await Promise.all(ports.map((p) => probeOne(host, p, opts.logger)));
  // Keep only open ones; renderer ignores closed unless manually added.
  return results.filter((r) => r.open);
}

/** Probe one specific (host, port) — used for manual-add validation too. */
export async function probeOne(host: string, port: number, logger?: OsmLogger): Promise<DiscoveredService> {
  const open = await tcpOpen(host, port);
  if (!open) return { host, port, open: false, kind: "unknown" };

  // Sniff via HTTP. Try /v1/models first (OpenAI-compatible API),
  // then /api/tags (Ollama), then /. We return at the first signal.
  const v1Models = await httpProbe(host, port, "/v1/models");
  if (v1Models) {
    const ident = identifyOpenAICompat(v1Models);
    return { host, port, open: true, ...ident };
  }
  const apiTags = await httpProbe(host, port, "/api/tags");
  if (apiTags && /models?":\s*\[/.test(apiTags)) {
    return { host, port, open: true, kind: "ollama", title: "Ollama", details: parseOllama(apiTags) };
  }
  const root = await httpProbe(host, port, "/");
  if (root) return { host, port, open: true, ...identifyGeneric(root, port) };

  // Open but not HTTP — could be a TCP service. Show as generic.
  return { host, port, open: true, kind: "unknown", title: "TCP service" };
}

// ─── TCP + HTTP plumbing ─────────────────────────────────────────────────

function tcpOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(CONNECT_TIMEOUT_MS);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

async function httpProbe(host: string, port: number, path: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`http://${host}:${port}${path}`, {
      method: "GET",
      headers: { "User-Agent": "osmRouter-scanner/0.1", Accept: "application/json, text/html" },
      signal: ctl.signal,
    });
    // Read up to 32 KB — service-identification banners are tiny.
    const text = await res.text();
    return text.slice(0, 32 * 1024);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── service identification ──────────────────────────────────────────────

function identifyOpenAICompat(body: string): { kind: ServiceKind; title?: string; details?: string } {
  // Most OpenAI-compatible servers emit {"data":[{"id":"<model>",...}],"object":"list"}.
  // LM Studio echoes "owned_by":"organization_owner" and model names with mlx/gguf hints.
  const isLMStudio = /organization_owner|lm-studio|"object":"model"/i.test(body) && /mlx|gguf|\.q\d/i.test(body);
  const isOllama = /"models":\s*\[/i.test(body);
  const ids = [...body.matchAll(/"id":\s*"([^"]+)"/g)].map((m) => m[1]).slice(0, 3);
  const detail = ids.length ? ids.join(", ") + (ids.length === 3 ? "…" : "") : undefined;
  if (isLMStudio) return { kind: "lm-studio", title: "LM Studio", details: detail };
  if (isOllama) return { kind: "ollama", title: "Ollama", details: detail };
  if (/"data":\s*\[/.test(body)) return { kind: "openai-compatible", title: "OpenAI-compatible API", details: detail };
  return { kind: "openai-compatible", title: "OpenAI-style /v1/models" };
}

function parseOllama(body: string): string | undefined {
  const names = [...body.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]).slice(0, 3);
  return names.length ? names.join(", ") + (names.length === 3 ? "…" : "") : undefined;
}

function identifyGeneric(body: string, port: number): { kind: ServiceKind; title?: string; details?: string } {
  if (/__NEXT_DATA__|next\/script/i.test(body)) return { kind: "next-dev", title: "Next.js dev server" };
  if (/vite\b|<script type="module"[^>]*\/@vite/i.test(body)) return { kind: "vite-dev", title: "Vite dev server" };
  if (/react-refresh|react-dom\.development/i.test(body)) return { kind: "react-dev", title: "React dev server" };
  if (/rails|sprockets|csrf-param/i.test(body)) return { kind: "rails", title: "Rails server" };
  if (/Werkzeug|flask|uvicorn|fastapi/i.test(body)) return { kind: "flask-fastapi", title: "Python web server" };
  const titleMatch = body.match(/<title>([^<]{1,80})<\/title>/i);
  return {
    kind: "generic-http",
    title: titleMatch ? titleMatch[1].trim() : `HTTP service on :${port}`,
  };
}
