"use client";
import { useMemo } from "react";
import { useApp } from "@/store/app-store";
import { Badge, I, IconBtn, StatusDot } from "./primitives";
import { BindingPanel } from "./BindingPanel";
import type { DomainRow } from "@/lib/osm-api";

function fmtUptime(s: number): string {
  if (!s || s <= 0) return "—";
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export function DomainsView() {
  const { domains, search, filter, sort, selectedId, selectDomain, patchDomain, openSignInModal } = useApp();

  const visible = useMemo(() => {
    const filterFn = (d: DomainRow) =>
      (!search || d.name.toLowerCase().includes(search.toLowerCase())) &&
      (filter === "all" || d.status === filter);
    const sortFn = (a: DomainRow, b: DomainRow) => {
      if (sort === "alpha") return a.name.localeCompare(b.name);
      if (sort === "recent") return b.added - a.added;
      const rank: Record<string, number> = { active: 0, starting: 1, error: 2, idle: 3, stopping: 4 };
      return ((rank[a.status] ?? 5) - (rank[b.status] ?? 5)) || a.name.localeCompare(b.name);
    };
    return domains.filter(filterFn).sort(sortFn);
  }, [domains, search, filter, sort]);

  const selected = domains.find((d) => d.id === selectedId) ?? null;

  const groups = useMemo(() => {
    const apps: Record<string, { name: string; stack: string | null; rows: DomainRow[] }> = {};
    const unassigned: DomainRow[] = [];
    const elsewhere: DomainRow[] = [];
    for (const d of visible) {
      if (d.locked === "unassigned") unassigned.push(d);
      else if (d.locked === "self") {
        const key = d.app ?? "Other";
        if (!apps[key]) apps[key] = { name: key, stack: d.stack, rows: [] };
        apps[key].rows.push(d);
      } else elsewhere.push(d);
    }
    const out: { id: string; kind: string; title: string; subtitle: string; rows: DomainRow[] }[] = [];
    for (const k of Object.keys(apps)) {
      const g = apps[k]!;
      out.push({ id: `app:${k}`, kind: "app", title: g.name + ".com", subtitle: (g.stack ?? "Custom") + " · " + g.rows.length + " domains", rows: g.rows });
    }
    if (unassigned.length) out.push({ id: "u", kind: "unassigned", title: "Unassigned", subtitle: `${unassigned.length} verified, awaiting device lock`, rows: unassigned });
    if (elsewhere.length) out.push({ id: "e", kind: "elsewhere", title: "Locked to other devices", subtitle: `${elsewhere.length} hidden from local binding`, rows: elsewhere });
    return out;
  }, [visible]);

  const onToggle = async (d: DomainRow) => {
    if (!window.osmAPI) return;
    if (d.status === "active") {
      try {
        await window.osmAPI.tunnel.stop({ domainId: d.id });
      } catch (e) {
        console.warn("stop failed", e);
      }
      patchDomain(d.id, { status: "idle", uptime: 0 });
    } else if (d.port) {
      patchDomain(d.id, { status: "starting" });
      try {
        await window.osmAPI.tunnel.start({
          domainId: d.id,
          port: d.port,
          proto: d.proto,
          target: d.target ?? "127.0.0.1",
          consentLanBind: false,
        });
      } catch (e) {
        patchDomain(d.id, { status: "error", error: (e as Error).message });
      }
    } else {
      selectDomain(d.id);
    }
  };

  if (!domains.length) {
    return (
      <div className="scroll" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: 14, padding: 40 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "var(--bg-chip)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-subtle)" }}>
          {I.globe}
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>No verified domains yet</div>
        <div style={{ fontSize: 12.5, maxWidth: 380, lineHeight: 1.5, textAlign: "center" }}>
          Domains are added and verified on the osmRouter web dashboard. Once a domain is verified, it appears here and you can bind local ports to its subdomains.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={() => void window.osmAPI?.sys.openExternal("https://app.osmrouter.com/domains")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              fontSize: 12.5,
              fontWeight: 500,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Add a domain on the web →
          </button>
          <button
            onClick={openSignInModal}
            style={{
              padding: "7px 14px",
              fontSize: 12.5,
              fontWeight: 500,
              background: "var(--bg-elev)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div className="scroll" style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 90px 110px 110px 32px",
            gap: 12,
            padding: "8px 16px",
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: "var(--text-subtle)",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: 0,
            background: "var(--bg)",
            zIndex: 1,
          }}
        >
          <span>Domain</span>
          <span>Status</span>
          <span>Binding</span>
          <span>Uptime</span>
          <span />
        </div>

        {groups.map((g) => (
          <div key={g.id}>
            <div
              style={{
                padding: "10px 16px",
                background: "var(--bg-sidebar)",
                borderBottom: "1px solid var(--border)",
                borderTop: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{g.title}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{g.subtitle}</span>
            </div>
            {g.rows.map((d) => (
              <DomainRowItem key={d.id} d={d} selected={selectedId === d.id} onClick={() => selectDomain(d.id)} onToggle={() => onToggle(d)} />
            ))}
          </div>
        ))}
      </div>
      {selected && <BindingPanel domain={selected} onClose={() => selectDomain(null)} />}
    </div>
  );
}

function DomainRowItem({ d, selected, onClick, onToggle }: { d: DomainRow; selected: boolean; onClick: () => void; onToggle: () => void }) {
  const STAT: Record<string, { tone: "success" | "neutral" | "error" | "info"; label: string; dot: "active" | "idle" | "error" | "starting" }> = {
    active: { tone: "success", label: "Active", dot: "active" },
    idle: { tone: "neutral", label: "Idle", dot: "idle" },
    error: { tone: "error", label: "Error", dot: "error" },
    starting: { tone: "info", label: "Starting…", dot: "starting" },
    stopping: { tone: "neutral", label: "Stopping…", dot: "idle" },
  };
  const s = STAT[d.status] ?? STAT.idle!;
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 90px 110px 110px 32px",
        alignItems: "center",
        gap: 12,
        padding: "11px 16px",
        cursor: "pointer",
        background: selected ? "var(--bg-active)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <StatusDot status={s.dot} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.name}
          </span>
          {d.status === "error" && (
            <span style={{ fontSize: 11, color: "var(--error)" }}>{d.error}</span>
          )}
        </div>
      </div>
      <div>
        <Badge tone={s.tone} soft={d.status === "active" || d.status === "error"}>
          {s.label}
        </Badge>
      </div>
      <div className="mono tnum" style={{ fontSize: 12, color: d.port ? "var(--text)" : "var(--text-subtle)" }}>
        {d.proto} {d.port ? `· :${d.port}` : ""}
      </div>
      <div className="mono tnum" style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtUptime(d.uptime)}</div>
      <div onClick={(e) => e.stopPropagation()}>
        {d.status === "active" ? (
          <IconBtn icon={I.stop} title="Stop tunnel" onClick={onToggle} style={{ color: "var(--error)" }} />
        ) : d.status === "error" ? (
          <IconBtn icon={I.refresh} title="Retry" onClick={onToggle} />
        ) : d.port ? (
          <IconBtn icon={I.play} title="Start tunnel" onClick={onToggle} style={{ color: "var(--success)" }} />
        ) : (
          <IconBtn icon={I.warn} title="Configure" />
        )}
      </div>
    </div>
  );
}
