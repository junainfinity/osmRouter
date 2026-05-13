"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CloudBinding, LocalService } from "@/lib/osm-api";
import { useApp } from "@/store/app-store";

/**
 * ServicesView — discover local listeners on this Mac, identify each
 * (LM Studio, Ollama, Next.js, generic HTTP, …), render as cards, and
 * let the user bind any of them to a verified domain in their account.
 *
 * Also supports adding a manual (IP + port) entry — for services on the
 * LAN or running on a non-standard port we didn't probe.
 */
export function ServicesView() {
  const { signedIn } = useApp();
  const [services, setServices] = useState<LocalService[] | null>(null);
  const [manualServices, setManualServices] = useState<LocalService[]>([]);
  const [bindings, setBindings] = useState<CloudBinding[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const scan = useCallback(async () => {
    if (!window.osmAPI) return;
    setScanning(true);
    setError(null);
    try {
      const [scanRes, bindRes] = await Promise.all([
        window.osmAPI.services.scan(),
        signedIn ? window.osmAPI.cloud.listBindings() : Promise.resolve({ bindings: [] }),
      ]);
      setServices(scanRes.services);
      setBindings(bindRes.bindings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void scan();
  }, [scan]);

  // Build a map: port → list of bindings forwarding to it from this device
  const bindingsByPort = useMemo(() => {
    const m = new Map<number, CloudBinding[]>();
    for (const b of bindings) {
      if (b.boundToThisDevice && b.port) {
        const arr = m.get(b.port) ?? [];
        arr.push(b);
        m.set(b.port, arr);
      }
    }
    return m;
  }, [bindings]);

  const allShown = useMemo(() => {
    const seen = new Set<string>();
    const out: LocalService[] = [];
    for (const s of [...(services ?? []), ...manualServices]) {
      const key = `${s.host}:${s.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }, [services, manualServices]);

  return (
    <div className="scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
      <div style={headerRow}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Services</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            Local services we found on this Mac. Bind any of them to a verified domain in your account.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setAddOpen(true)} style={ghostBtn}>Add IP:port…</button>
          <button onClick={() => void scan()} disabled={scanning} style={primaryBtn}>
            {scanning ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, background: "var(--error-soft)", border: "1px solid var(--error)", borderRadius: 6, color: "var(--error)", fontSize: 12 }}>
          {error}
        </div>
      )}

      {services === null ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Scanning common ports…</div>
      ) : allShown.length === 0 ? (
        <div style={emptyWrap}>
          <div style={emptyTitle}>No local services detected</div>
          <div style={emptySub}>
            We probed common dev/AI ports (1234 LM Studio, 11434 Ollama, 3000/5173/8000/8080/8888…). Add a manual entry below if your service runs on a different port or IP.
          </div>
          <button onClick={() => setAddOpen(true)} style={primaryBtn}>Add IP:port…</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {allShown.map((s) => (
            <ServiceCard
              key={`${s.host}:${s.port}`}
              svc={s}
              bindings={bindingsByPort.get(s.port) ?? []}
              cloudBindings={bindings}
              signedIn={signedIn}
              onChanged={scan}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddManualModal
          onClose={() => setAddOpen(false)}
          onProbed={(svc) => {
            setManualServices((prev) => [...prev, svc]);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ServiceCard({
  svc, bindings, cloudBindings, signedIn, onChanged,
}: {
  svc: LocalService;
  bindings: CloudBinding[];
  cloudBindings: CloudBinding[];
  signedIn: boolean;
  onChanged: () => Promise<void>;
}) {
  const [bindOpen, setBindOpen] = useState(false);
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <KindBadge kind={svc.kind} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-muted)" }}>
          {svc.host}:{svc.port}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>
        {svc.title ?? "Unknown service"}
      </div>
      {svc.details && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45, marginBottom: 10 }}>
          {svc.details}
        </div>
      )}

      {bindings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, padding: 8, background: "color-mix(in oklab, var(--success) 8%, transparent)", border: "1px solid color-mix(in oklab, var(--success) 25%, transparent)", borderRadius: 5 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--success)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Exposed at
          </div>
          {bindings.map((b) => (
            <span key={b.subdomainId ?? b.fqdn} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
              https://{b.fqdn}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
        {signedIn ? (
          <button onClick={() => setBindOpen(true)} style={primaryBtnSm}>
            {bindings.length > 0 ? "Bind another domain…" : "Bind to a domain…"}
          </button>
        ) : (
          <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>Sign in to bind</span>
        )}
      </div>

      {bindOpen && (
        <BindPicker
          svc={svc}
          cloudBindings={cloudBindings}
          onClose={() => setBindOpen(false)}
          onDone={async () => {
            setBindOpen(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function BindPicker({
  svc, cloudBindings, onClose, onDone,
}: {
  svc: LocalService;
  cloudBindings: CloudBinding[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Show domains that are EITHER unbound OR bound to this device (we
  // can re-target). Group by registrar root.
  const eligible = useMemo(() => {
    const seen = new Set<string>();
    const out: { domainId: string; bareDomain: string }[] = [];
    for (const b of cloudBindings) {
      if (seen.has(b.domainId)) continue;
      seen.add(b.domainId);
      out.push({ domainId: b.domainId, bareDomain: b.bareDomain });
    }
    return out;
  }, [cloudBindings]);

  const submit = async (domainId: string, prefix: string) => {
    if (!window.osmAPI) return;
    setSubmitting(true);
    setErr(null);
    try {
      await window.osmAPI.cloud.bindPort({ domainId, prefix, port: svc.port });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div onMouseDown={onClose} style={modalBackdrop}>
      <div onMouseDown={(e) => e.stopPropagation()} style={modalCard}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          Bind {svc.host}:{svc.port} to a domain
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>
          Pick one of your verified domains. We'll create an apex binding pointing this device's port {svc.port} to it.
        </div>

        {eligible.length === 0 ? (
          <div style={emptySub}>
            You don't have any verified domains yet. Add one on the web dashboard first.
            <div style={{ marginTop: 8 }}>
              <button onClick={() => void window.osmAPI?.sys.openExternal("https://app.osmrouter.com/domains")} style={primaryBtnSm}>
                Open dashboard →
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {eligible.map((d) => (
              <button
                key={d.domainId}
                onClick={() => void submit(d.domainId, "")}
                disabled={submitting}
                style={domainPick}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>{d.bareDomain}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>apex → :{svc.port}</span>
              </button>
            ))}
          </div>
        )}
        {err && <div style={{ marginTop: 10, fontSize: 12, color: "var(--error)" }}>{err}</div>}
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={submitting} style={ghostBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AddManualModal({ onClose, onProbed }: { onClose: () => void; onProbed: (svc: LocalService) => void }) {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!window.osmAPI) return;
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      setErr("Port must be 1–65535.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const svc = await window.osmAPI.services.probeOne(host.trim(), p);
      if (!svc.open) {
        setErr(`Nothing listening on ${host}:${p}. Service must be running first.`);
        setBusy(false);
        return;
      }
      onProbed(svc);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div onMouseDown={onClose} style={modalBackdrop}>
      <div onMouseDown={(e) => e.stopPropagation()} style={modalCard}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Add a service manually</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>
          For services on a non-standard port or on your LAN (e.g. another machine).
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 2 }}>
            <Label>Host / IP</Label>
            <input value={host} onChange={(e) => setHost(e.target.value)} style={input} placeholder="127.0.0.1 or 192.168.1.42" />
          </div>
          <div style={{ flex: 1 }}>
            <Label>Port</Label>
            <input value={port} onChange={(e) => setPort(e.target.value)} style={input} placeholder="1234" type="number" />
          </div>
        </div>
        {err && <div style={{ marginTop: 6, fontSize: 12, color: "var(--error)" }}>{err}</div>}
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !port} style={primaryBtnSm}>
            {busy ? "Probing…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-subtle)", marginBottom: 4 }}>
      {children}
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  // Inline default so TS with noUncheckedIndexedAccess knows `c` is never undefined.
  const fallback = { bg: "var(--bg-chip)", fg: "var(--text-subtle)" };
  const colors: Record<string, { bg: string; fg: string }> = {
    "lm-studio": { bg: "color-mix(in oklab, oklch(0.7 0.18 30) 22%, transparent)", fg: "oklch(0.75 0.15 30)" },
    "ollama": { bg: "color-mix(in oklab, oklch(0.65 0.14 200) 22%, transparent)", fg: "oklch(0.75 0.13 200)" },
    "openai-compatible": { bg: "color-mix(in oklab, oklch(0.7 0.14 280) 22%, transparent)", fg: "oklch(0.75 0.13 280)" },
  };
  const c = colors[kind] ?? fallback;
  return (
    <span style={{ padding: "2px 7px", fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", background: c.bg, color: c.fg, borderRadius: 4 }}>
      {kind.replace("-", " ")}
    </span>
  );
}

// styles
const headerRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12 };
const card: React.CSSProperties = { background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 };
const emptyWrap: React.CSSProperties = { padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 };
const emptyTitle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "var(--text)" };
const emptySub: React.CSSProperties = { fontSize: 12.5, color: "var(--text-muted)", maxWidth: 420, lineHeight: 1.55 };
const primaryBtn: React.CSSProperties = { padding: "6px 12px", fontSize: 12.5, fontWeight: 500, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" };
const primaryBtnSm: React.CSSProperties = { padding: "5px 11px", fontSize: 12, fontWeight: 500, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { padding: "5px 11px", fontSize: 12, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer" };
const modalBackdrop: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 };
const modalCard: React.CSSProperties = { width: 460, maxWidth: "92vw", background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", boxShadow: "0 20px 50px rgba(0,0,0,0.45)", color: "var(--text)" };
const domainPick: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, cursor: "pointer", textAlign: "left" };
const input: React.CSSProperties = { width: "100%", padding: "6px 10px", fontSize: 12.5, background: "var(--bg-panel)", color: "var(--text)", border: "1px solid var(--border-input)", borderRadius: 5, outline: "none", boxSizing: "border-box" };
