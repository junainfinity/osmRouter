/**
 * @fileoverview Tiny HTTP client used by the Main process to call the
 * osmRouter cloud control plane. Authenticated with the device API key
 * stored in the macOS Keychain.
 *
 * Why this lives in Main and not in the renderer: the API key is a
 * bearer credential. Per S4.2 of the security spec, no credential
 * crosses the IPC boundary back to the renderer — only the *fact* of
 * being signed in plus the user's email. Every fetch happens here.
 */
import type { OsmLogger } from "../logger/index.js";

export interface CloudDeps {
  apiBase: string; // e.g. https://api.osmrouter.com
  getApiKey: () => Promise<string | null>; // pulled from keychain on each call
  logger: OsmLogger;
}

export interface CloudDomain {
  id: string;
  user_id: string;
  fqdn: string;
  dns_status: "pending" | "verifying" | "verified" | "failed";
  cname_target: string;
  txt_token: string;
  verified_at?: string | null;
  created_at: string;
}

export interface CloudSubdomain {
  id: string;
  parent_domain_id: string;
  prefix: string; // "" for apex
  target_port: number;
  bound_device_id?: string | null;
  bound_at?: string | null;
}

export interface CloudDevice {
  id: string;
  name: string;
  hardware_uuid: string;
  os_type: string;
  is_online: boolean;
  last_seen_at?: string | null;
}

/**
 * One pre-flattened row per (domain, subdomain). Domains without any
 * subdomains emit a single placeholder row (id = domain id, prefix = null)
 * so the user sees "you've verified this domain, but nothing's bound yet".
 */
export interface FlatBinding {
  domainId: string;
  subdomainId: string | null;
  fqdn: string; // e.g. "llm.a2a.one" or just "a2a.one"
  bareDomain: string; // always the user-owned root ("a2a.one")
  prefix: string | null; // null if placeholder, "" for apex binding
  port: number | null;
  dnsStatus: CloudDomain["dns_status"];
  boundToThisDevice: boolean;
  boundDeviceId: string | null;
}

/**
 * One round-trip to fetch user's domains. Caller is expected to map them
 * to renderer-friendly rows.
 */
export async function listDomains(deps: CloudDeps): Promise<CloudDomain[]> {
  const data = await call<{ domains: CloudDomain[] }>(deps, "GET", "/api/v1/domains");
  return data.domains;
}

export async function listSubdomains(deps: CloudDeps, domainId: string): Promise<CloudSubdomain[]> {
  const data = await call<{ subdomains: CloudSubdomain[] }>(
    deps,
    "GET",
    `/api/v1/domains/${encodeURIComponent(domainId)}/subdomains`,
  );
  return data.subdomains;
}

export async function createSubdomain(
  deps: CloudDeps,
  domainId: string,
  prefix: string,
  targetPort: number,
): Promise<CloudSubdomain> {
  return call<CloudSubdomain>(deps, "POST", `/api/v1/domains/${encodeURIComponent(domainId)}/subdomains`, {
    prefix,
    target_port: targetPort,
  });
}

export async function bindSubdomain(deps: CloudDeps, subdomainId: string, deviceId: string): Promise<void> {
  await call<{ status: string }>(deps, "POST", `/api/v1/subdomains/${encodeURIComponent(subdomainId)}/bind`, {
    device_id: deviceId,
  });
}

export async function unbindSubdomain(deps: CloudDeps, subdomainId: string): Promise<void> {
  await call<{ status: string }>(deps, "POST", `/api/v1/subdomains/${encodeURIComponent(subdomainId)}/unbind`, {});
}

export async function deleteSubdomain(deps: CloudDeps, subdomainId: string): Promise<void> {
  await call<{ status: string }>(deps, "DELETE", `/api/v1/subdomains/${encodeURIComponent(subdomainId)}`);
}

/**
 * Heartbeat — keep the device marked online so binding succeeds. The
 * Mac sidecar already does this when it's connected to the proxy, but
 * we call it on app boot too so the device is online BEFORE the user
 * has spawned any tunnel.
 */
export async function heartbeat(deps: CloudDeps): Promise<void> {
  await call<{ status: string }>(deps, "POST", "/api/v1/devices/heartbeat", {});
}

/**
 * Compose a flat list of bindings the renderer can iterate. Empty domains
 * (verified but with no subdomains) still emit one placeholder row.
 */
export async function listBindings(
  deps: CloudDeps,
  thisDeviceId: string,
): Promise<FlatBinding[]> {
  const domains = await listDomains(deps);
  const out: FlatBinding[] = [];
  for (const d of domains) {
    // Only show verified ones — pending/failed are still being set up on the web.
    if (d.dns_status !== "verified") continue;
    let subs: CloudSubdomain[] = [];
    try {
      subs = await listSubdomains(deps, d.id);
    } catch (err) {
      deps.logger.warn({ domainId: d.id, err: String(err) }, "cloud:listSubdomains-failed");
    }
    if (subs.length === 0) {
      out.push({
        domainId: d.id,
        subdomainId: null,
        fqdn: d.fqdn,
        bareDomain: d.fqdn,
        prefix: null,
        port: null,
        dnsStatus: d.dns_status,
        boundToThisDevice: false,
        boundDeviceId: null,
      });
      continue;
    }
    for (const s of subs) {
      const host = s.prefix === "" ? d.fqdn : `${s.prefix}.${d.fqdn}`;
      out.push({
        domainId: d.id,
        subdomainId: s.id,
        fqdn: host,
        bareDomain: d.fqdn,
        prefix: s.prefix,
        port: s.target_port || null,
        dnsStatus: d.dns_status,
        boundToThisDevice: !!(s.bound_device_id && s.bound_device_id === thisDeviceId),
        boundDeviceId: s.bound_device_id ?? null,
      });
    }
  }
  return out;
}

// ─── plumbing ──────────────────────────────────────────────────────────────

async function call<T>(deps: CloudDeps, method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = await deps.getApiKey();
  if (!apiKey) throw new Error("not-signed-in");
  const url = new URL(path, deps.apiBase);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("api-key-rejected");
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
  }
  if (!res.ok) {
    const code = (parsed as { error?: { code?: string; message?: string } })?.error?.code ?? `http-${res.status}`;
    throw new Error(`cloud-${code}`);
  }
  return parsed as T;
}
