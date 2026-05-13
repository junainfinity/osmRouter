"use client";
import { useState } from "react";
import { useApp } from "@/store/app-store";

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function Inspector() {
  const { requests, clearRequests } = useApp();
  const [paused, setPaused] = useState(false);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
        <button onClick={() => setPaused((p) => !p)} style={btnChip()}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={clearRequests} style={btnChip()}>Clear</button>
        <div style={{ flex: 1 }} />
        <span className="mono tnum" style={{ fontSize: 12, color: "var(--text-subtle)" }}>{requests.length} requests</span>
      </div>
      <div className="scroll" style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
            <tr style={{ color: "var(--text-subtle)", textAlign: "left" }}>
              {["Time", "Method", "Status", "Domain", "Path", "ms", "Size"].map((h, i) => (
                <th key={i} style={{ padding: "8px 12px", fontWeight: 500, fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {requests.slice(0, 200).map((r) => (
              <tr key={r.id}>
                <td className="mono tnum" style={{ padding: "5px 12px", color: "var(--text-subtle)", fontSize: 11.5 }}>{fmtTime(r.t)}</td>
                <td style={{ padding: "5px 12px" }}>
                  <span className="mono" style={{ fontSize: 11, padding: "1px 5px", borderRadius: 3, background: "var(--bg-chip)", color: "var(--text-muted)" }}>{r.method}</span>
                </td>
                <td className="mono tnum" style={{ padding: "5px 12px", color: r.status >= 500 ? "var(--error)" : r.status >= 400 ? "var(--warning)" : "var(--success)", fontWeight: 500 }}>
                  {r.status}
                </td>
                <td className="mono" style={{ padding: "5px 12px", color: "var(--text-muted)" }}>{r.domain}</td>
                <td className="mono" style={{ padding: "5px 12px", color: "var(--text)" }}>{r.path}</td>
                <td className="mono tnum" style={{ padding: "5px 12px", color: "var(--text-muted)", textAlign: "right" }}>{r.latency}</td>
                <td className="mono tnum" style={{ padding: "5px 12px", color: "var(--text-muted)", textAlign: "right" }}>{fmtBytes(r.size)}</td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-subtle)", fontSize: 12 }}>
                  No requests captured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function btnChip(): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 12,
    background: "var(--bg-chip)",
    border: "1px solid transparent",
    color: "var(--text)",
    borderRadius: 6,
    cursor: "pointer",
  };
}
