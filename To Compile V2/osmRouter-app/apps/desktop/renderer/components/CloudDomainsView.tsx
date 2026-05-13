"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CloudBinding } from "@/lib/osm-api";
import { useApp } from "@/store/app-store";

/**
 * CloudDomainsView
 *
 * Replaces the legacy fake-data DomainsView once the user is signed in.
 * Pulls /api/v1/domains + /api/v1/domains/:id/subdomains via the Main
 * process (which authenticates with the stored device API key) and
 * renders one row per (domain × subdomain), or one placeholder row per
 * domain that's verified but unbound.
 *
 * Per-row actions:
 *   - "Bind to port" — for bindings not yet pointed at this device.
 *     Opens a small inline form (port + protocol), then calls
 *     `osmAPI.cloud.bindPort` which creates the subdomain on the server,
 *     binds it to THIS device, and spawns the local sidecar.
 *   - "Unbind" — for bindings already on this device. Tears down the
 *     sidecar and removes the binding row.
 *   - "On <device>" — pure-display when bound to a different device.
 */
export function CloudDomainsView() {
  const { signedIn } = useApp();
  const [bindings, setBindings] = useState<CloudBinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBindings = useCallback(async () => {
    if (!window.osmAPI) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await window.osmAPI.cloud.listBindings();
      setBindings(res.bindings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void fetchBindings();
    else setBindings(null);
  }, [signedIn, fetchBindings]);

  // Group rows by registrar-side root domain so the UI matches the
  // mental model: "I own a2a.one — here are its bindings."
  const grouped = useMemo(() => {
    const m = new Map<string, CloudBinding[]>();
    for (const b of bindings ?? []) {
      const list = m.get(b.bareDomain) ?? [];
      list.push(b);
      m.set(b.bareDomain, list);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [bindings]);

  if (!signedIn) {
    return (
      <div className="scroll" style={emptyWrap}>
        <div style={emptyTitle}>Not signed in</div>
        <div style={emptySub}>Sign in to see the domains you've verified on the web dashboard.</div>
      </div>
    );
  }

  if (bindings === null && !error) {
    return (
      <div className="scroll" style={emptyWrap}>
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading domains…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="scroll" style={emptyWrap}>
        <div style={emptyTitle}>Couldn't load domains</div>
        <div style={emptySub}>{error}</div>
        <button onClick={() => void fetchBindings()} style={primaryBtn}>Retry</button>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="scroll" style={emptyWrap}>
        <div style={emptyTitle}>No verified domains yet</div>
        <div style={emptySub}>
          Add a domain on the web dashboard and verify it via CNAME + TXT. Once verified, it appears here so you can bind it to any local port.
        </div>
        <button
          onClick={() => void window.osmAPI?.sys.openExternal("https://app.osmrouter.com/domains")}
          style={primaryBtn}
        >
          Open dashboard →
        </button>
      </div>
    );
  }

  return (
    <div className="scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
      <div style={headerRow}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Domains</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {grouped.length} verified · click "Bind to port" to expose a local service.
          </div>
        </div>
        <button
          onClick={() => void fetchBindings()}
          disabled={refreshing}
          style={ghostBtn}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {grouped.map(([bare, rows]) => (
          <DomainGroup key={bare} bareDomain={bare} rows={rows} onChanged={fetchBindings} />
        ))}
      </div>
    </div>
  );
}

function DomainGroup({
  bareDomain, rows, onChanged,
}: { bareDomain: string; rows: CloudBinding[]; onChanged: () => Promise<void> }) {
  // Order rows: apex first, then alphabetical prefix; placeholder last.
  const ordered = [...rows].sort((a, b) => {
    if (a.subdomainId == null && b.subdomainId != null) return 1;
    if (a.subdomainId != null && b.subdomainId == null) return -1;
    if (a.prefix === "" && b.prefix !== "") return -1;
    if (b.prefix === "" && a.prefix !== "") return 1;
    return (a.prefix ?? "").localeCompare(b.prefix ?? "");
  });
  return (
    <div style={card}>
      <div style={cardHeader}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, color: "var(--text)" }}>{bareDomain}</span>
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-subtle)" }}>verified</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ordered.map((row) => (
          <BindingRow
            key={(row.subdomainId ?? `placeholder-${row.domainId}`) + ":" + row.fqdn}
            row={row}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

function BindingRow({ row, onChanged }: { row: CloudBinding; onChanged: () => Promise<void> }) {
  const [showForm, setShowForm] = useState(false);
  const [port, setPort] = useState<string>(row.port ? String(row.port) : "1234");
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const isPlaceholder = row.subdomainId === null;
  const isApex = row.prefix === "";

  const submit = async () => {
    if (!window.osmAPI) return;
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      setRowError("Port must be 1–65535.");
      return;
    }
    setSubmitting(true);
    setRowError(null);
    try {
      // For the inline-bind on a placeholder row, prefix = "" (apex). For
      // future "add subdomain" we'd surface a prefix field; today the
      // common case (one tunnel per domain) is apex-only.
      await window.osmAPI.cloud.bindPort({
        domainId: row.domainId,
        prefix: isPlaceholder ? "" : (row.prefix ?? ""),
        port: p,
      });
      await onChanged();
      setShowForm(false);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const unbind = async () => {
    if (!window.osmAPI || !row.subdomainId) return;
    if (!confirm(`Unbind ${row.fqdn}? This stops the local tunnel.`)) return;
    setSubmitting(true);
    setRowError(null);
    try {
      await window.osmAPI.cloud.unbind(row.subdomainId);
      await onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: statusColor(row) }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>{row.fqdn}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginLeft: 4 }}>
          {isPlaceholder
            ? "no binding yet"
            : isApex
              ? "apex"
              : `subdomain "${row.prefix}"`}
        </span>
        <div style={{ flex: 1 }} />
        {row.boundToThisDevice && row.port && (
          <span style={pillActive}>→ 127.0.0.1:{row.port}</span>
        )}
        {!row.boundToThisDevice && !isPlaceholder && row.boundDeviceId && (
          <span style={pillOther}>on another device</span>
        )}
        <RowActions
          row={row}
          submitting={submitting}
          onBindClick={() => setShowForm((s) => !s)}
          onUnbindClick={unbind}
        />
      </div>
      {showForm && !row.boundToThisDevice && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Forward to</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>127.0.0.1 :</span>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={submitting}
            style={portInput}
            min={1}
            max={65535}
          />
          <button onClick={submit} disabled={submitting} style={primaryBtnSm}>
            {submitting ? "Binding…" : "Bind"}
          </button>
          <button onClick={() => setShowForm(false)} disabled={submitting} style={ghostBtnSm}>
            Cancel
          </button>
        </div>
      )}
      {rowError && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--error)" }}>{rowError}</div>
      )}
    </div>
  );
}

function RowActions({
  row, submitting, onBindClick, onUnbindClick,
}: {
  row: CloudBinding;
  submitting: boolean;
  onBindClick: () => void;
  onUnbindClick: () => void;
}) {
  if (row.boundToThisDevice && row.subdomainId) {
    return (
      <button onClick={onUnbindClick} disabled={submitting} style={dangerBtn}>
        Unbind
      </button>
    );
  }
  if (row.boundDeviceId && !row.boundToThisDevice) {
    return <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>—</span>;
  }
  return (
    <button onClick={onBindClick} disabled={submitting} style={primaryBtnSm}>
      Bind to port
    </button>
  );
}

function statusColor(row: CloudBinding): string {
  if (row.boundToThisDevice) return "var(--success)";
  if (row.boundDeviceId) return "var(--text-subtle)";
  return "var(--warn)";
}

// ── styles ────────────────────────────────────────────────────────────────
const emptyWrap: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  padding: 40,
};
const emptyTitle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "var(--text)" };
const emptySub: React.CSSProperties = { fontSize: 12.5, color: "var(--text-muted)", maxWidth: 420, lineHeight: 1.55, textAlign: "center" };
const headerRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 };
const card: React.CSSProperties = { background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" };
const cardHeader: React.CSSProperties = { display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border)" };
const pillActive: React.CSSProperties = { fontSize: 11.5, padding: "2px 8px", background: "color-mix(in oklab, var(--success) 15%, transparent)", color: "var(--success)", borderRadius: 999, fontFamily: "var(--font-mono)" };
const pillOther: React.CSSProperties = { fontSize: 11.5, padding: "2px 8px", background: "var(--bg-chip)", color: "var(--text-subtle)", borderRadius: 999 };
const primaryBtn: React.CSSProperties = { padding: "7px 14px", fontSize: 12.5, fontWeight: 500, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" };
const primaryBtnSm: React.CSSProperties = { padding: "5px 11px", fontSize: 12, fontWeight: 500, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { padding: "5px 11px", fontSize: 12, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer" };
const ghostBtnSm: React.CSSProperties = { padding: "5px 11px", fontSize: 12, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer" };
const dangerBtn: React.CSSProperties = { padding: "5px 11px", fontSize: 12, fontWeight: 500, background: "transparent", color: "var(--error)", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer" };
const portInput: React.CSSProperties = { width: 80, padding: "5px 8px", fontSize: 12, fontFamily: "var(--font-mono)", background: "var(--bg-panel)", color: "var(--text)", border: "1px solid var(--border-input)", borderRadius: 5, outline: "none" };
