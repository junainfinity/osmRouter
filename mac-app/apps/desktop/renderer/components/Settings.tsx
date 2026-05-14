"use client";
import { useEffect, useState } from "react";
import { Btn } from "./primitives";
import type { DiagInfo, Settings as S } from "@/lib/osm-api";

export function SettingsView() {
  const [settings, setSettings] = useState<S | null>(null);
  const [info, setInfo] = useState<DiagInfo | null>(null);

  useEffect(() => {
    void (async () => {
      if (!window.osmAPI) return;
      setSettings(await window.osmAPI.settings.get());
      setInfo(await window.osmAPI.diag.getInfo());
    })();
  }, []);

  const update = async (patch: Partial<S>) => {
    if (!window.osmAPI) return;
    const next = await window.osmAPI.settings.update(patch);
    setSettings(next);
  };

  return (
    <div className="scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 32px", maxWidth: 720 }}>
      <Section title="General">
        <Row label="Launch osmRouter at login" sub="Daemon starts on user login and restores active tunnels.">
          <Toggle value={settings?.launchAtLogin ?? true} onChange={(v) => update({ launchAtLogin: v })} />
        </Row>
        <Row label="Auto-update client" sub="Silently download and stage verified updates.">
          <Toggle value={settings?.autoUpdate ?? true} onChange={(v) => update({ autoUpdate: v })} />
        </Row>
        <Row label="Show desktop notifications" sub="Tunnel errors and reconnection events.">
          <Toggle value={settings?.desktopNotifications ?? false} onChange={(v) => update({ desktopNotifications: v })} />
        </Row>
      </Section>

      <Section title="Diagnostics">
        <Row label="Client version" sub={info ? `${info.version} · build ${info.build} · electron ${info.electron}` : "Loading…"}>
          <Btn variant="secondary" size="sm" onClick={() => window.osmAPI?.sys.getVersion()}>Check for updates</Btn>
        </Row>
        <Row label="Log file" sub={info ? `${info.logPath} · ${(info.logSizeBytes / 1024).toFixed(1)} KB` : "Loading…"}>
          <Btn variant="secondary" size="sm" onClick={() => window.osmAPI?.diag.exportLogs()}>Export logs</Btn>
        </Row>
        <Row label="Device ID" sub={info ? `${info.deviceId} · ${info.deviceName}` : "Loading…"}>
          <Btn variant="chip" size="sm" onClick={() => info && void navigator.clipboard?.writeText(info.deviceId)}>Copy</Btn>
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 10 }}>{title}</div>
      <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8 }}>{children}</div>
    </div>
  );
}
function Row({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 14, borderTop: "1px solid var(--border)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 28,
        height: 16,
        borderRadius: 8,
        padding: 2,
        background: value ? "var(--accent)" : "var(--border-strong)",
        border: "none",
        cursor: "pointer",
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fff", transform: value ? "translateX(12px)" : "translateX(0)", transition: "transform .15s" }} />
    </button>
  );
}
