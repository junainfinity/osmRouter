"use client";
import { useApp } from "@/store/app-store";
import { I, StatusDot } from "./primitives";

const CONN: Record<string, { dot: "active" | "starting" | "error"; label: string }> = {
  connected: { dot: "active", label: "Connected" },
  reconnecting: { dot: "starting", label: "Reconnecting…" },
  flicker: { dot: "starting", label: "Flicker" },
  roaming: { dot: "starting", label: "Roaming…" },
  offline: { dot: "error", label: "Offline" },
};

export function Sidebar() {
  const { tab, setTab, domains, theme, setTheme, network, edge, email, selectDomain, openSignInModal } = useApp();
  const items = [
    { id: "services" as const, label: "Services", icon: I.services, count: null },
    { id: "domains" as const, label: "Domains", icon: I.list, count: domains.length },
    { id: "inspector" as const, label: "Inspector", icon: I.inspector, count: null },
    { id: "settings" as const, label: "Settings", icon: I.settings, count: null },
  ];
  const conn = CONN[network] ?? CONN.connected;
  const actives = domains.filter((d) => d.status === "active");
  // The Electron window uses `titleBarStyle: "hiddenInset"`, which places the
  // traffic-light controls (close/min/max) ~12px from the top-left of the
  // window over the first 78px width. We reserve a 38px top region in the
  // sidebar so the logo never sits underneath them.
  const logoSrc = theme === "dark" ? "./logos/logo-for-dark.png" : "./logos/logo-for-light.png";
  return (
    <div
      style={{
        width: 220,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Reserved space for macOS traffic-light controls. Acts as a drag
          region (the rest of the toolbar inherits `-webkit-app-region` from
          BrowserWindow defaults). */}
      <div
        style={{
          height: 28,
          flexShrink: 0,
          // @ts-expect-error — non-standard CSS prop recognised by Electron/Chromium
          WebkitAppRegion: "drag",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 14px 12px",
          // @ts-expect-error — non-standard CSS prop recognised by Electron/Chromium
          WebkitAppRegion: "drag",
        }}
      >
        <img
          src={logoSrc}
          alt="osmRouter"
          width={28}
          height={28}
          draggable={false}
          style={{ display: "block", flexShrink: 0, objectFit: "contain", imageRendering: "auto" }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            lineHeight: 1.15,
            // @ts-expect-error — child controls must opt back out of drag
            WebkitAppRegion: "no-drag",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>osmRouter</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-subtle)" }}>v0.1.0</span>
        </div>
      </div>

      <div style={{ padding: "4px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {items.map((it) => {
          const sel = tab === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "6px 9px",
                border: "none",
                background: sel ? "var(--bg-active)" : "transparent",
                color: sel ? "var(--text)" : "var(--text-muted)",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: sel ? 500 : 400,
                textAlign: "left",
              }}
            >
              <span style={{ color: sel ? "var(--accent)" : "var(--text-subtle)", display: "flex" }}>{it.icon}</span>
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.count !== null && (
                <span className="mono tnum" style={{ fontSize: 11, color: "var(--text-subtle)" }}>{it.count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: "16px 14px 4px",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.4,
          color: "var(--text-subtle)",
          textTransform: "uppercase",
        }}
      >
        Active tunnels
      </div>
      <div className="scroll" style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 1, flex: 1, overflowY: "auto" }}>
        {actives.length === 0 ? (
          <div style={{ padding: "8px 9px", fontSize: 12, color: "var(--text-subtle)", fontStyle: "italic" }}>No tunnels running</div>
        ) : (
          actives.map((d) => (
            <button
              key={d.id}
              onClick={() => { setTab("domains"); selectDomain(d.id); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 9px",
                borderRadius: 5,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <StatusDot status="active" size={6} />
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.name}
              </span>
              <span className="mono tnum" style={{ fontSize: 10.5, color: "var(--text-subtle)" }}>:{d.port}</span>
            </button>
          ))
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot status={conn?.dot ?? "active"} />
          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>{conn?.label ?? "Connected"}</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-subtle)" }}>{edge}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Avatar + sign-in chip: clickable when not signed in — opens the web
              dashboard in the system browser. Signup + domain mgmt happen there. */}
          <button
            onClick={() => {
              if (email) return; // already signed in — no-op
              openSignInModal();
            }}
            title={email ? "Signed in" : "Sign in with a device API key"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: 1,
              minWidth: 0,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: email ? "default" : "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "linear-gradient(135deg, oklch(0.7 0.13 268), oklch(0.55 0.18 318))",
                color: "#fff",
                fontSize: 10.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {(email ?? "??").slice(0, 2).toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: email ? "var(--text-muted)" : "var(--accent)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: email ? 400 : 500 }}>
              {email ?? "Sign in →"}
            </span>
          </button>
          <button
            data-testid="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              width: 26,
              height: 22,
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              color: "var(--text-muted)",
              borderRadius: 6,
              padding: 0,
              cursor: "pointer",
            }}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </div>
    </div>
  );
}
