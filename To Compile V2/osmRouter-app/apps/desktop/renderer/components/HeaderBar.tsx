"use client";
import { useApp } from "@/store/app-store";
import { Badge, Btn, I, IconBtn } from "./primitives";

export function HeaderBar() {
  const { tab, search, setSearch, filter, setFilter, sort, setSort, domains } = useApp();
  const total = domains.length;
  const totalCounts = {
    all: total,
    active: domains.filter((d) => d.status === "active").length,
    idle: domains.filter((d) => d.status === "idle").length,
    error: domains.filter((d) => d.status === "error").length,
  };

  if (tab !== "domains") {
    return (
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2 }}>
            {tab === "inspector" ? "Live request inspector" : "Settings"}
          </span>
          {tab === "inspector" && (
            <Badge tone="info" soft>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--info)", animation: "pulse-dot 1.4s ease-in-out infinite" }} />
              Streaming
            </Badge>
          )}
        </div>
      </div>
    );
  }
  return (
    <div style={headerStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flex: 1,
          maxWidth: 360,
          padding: "5px 9px",
          background: "var(--bg-elev)",
          border: "1px solid var(--border-input)",
          borderRadius: 6,
        }}
      >
        <span style={{ color: "var(--text-subtle)", display: "flex" }}>{I.search}</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search domains…"
          aria-label="Search domains"
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13, color: "var(--text)" }}
        />
        {search && <IconBtn icon={I.close} onClick={() => setSearch("")} />}
      </div>

      <Segmented
        value={filter}
        onChange={(v) => setFilter(v as typeof filter)}
        options={[
          { v: "all", l: `All ${totalCounts.all}` },
          { v: "active", l: `Active ${totalCounts.active}` },
          { v: "idle", l: `Idle ${totalCounts.idle}` },
          { v: "error", l: `Error ${totalCounts.error}` },
        ]}
      />

      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as typeof sort)}
        style={{
          padding: "4px 8px",
          fontSize: 12,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text-muted)",
        }}
      >
        <option value="status">Active first</option>
        <option value="alpha">Alphabetical</option>
        <option value="recent">Recently added</option>
      </select>

      <div style={{ flex: 1 }} />
      <Btn variant="secondary" size="sm" icon={I.power} danger>
        Disconnect all
      </Btn>
    </div>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div style={{ display: "inline-flex", padding: 2, background: "var(--bg-chip)", borderRadius: 6, gap: 1 }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 500,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            background: value === o.v ? "var(--bg-elev)" : "transparent",
            color: value === o.v ? "var(--text)" : "var(--text-muted)",
            boxShadow: value === o.v ? "var(--shadow-sm)" : "none",
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg)",
  flexShrink: 0,
  height: 52,
};
