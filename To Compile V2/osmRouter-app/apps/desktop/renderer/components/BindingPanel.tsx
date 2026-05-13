"use client";
import { useState, useEffect } from "react";
import { useApp } from "@/store/app-store";
import { Btn, I, IconBtn, Spinner, StatusDot } from "./primitives";
import type { DomainRow } from "@/lib/osm-api";

export function BindingPanel({ domain, onClose }: { domain: DomainRow; onClose: () => void }) {
  const { patchDomain } = useApp();
  const [port, setPort] = useState<string>(domain.port ? String(domain.port) : "");
  const [proto, setProto] = useState<"HTTP" | "HTTPS" | "TCP">(domain.proto);
  const [phase, setPhase] = useState<"idle" | "checking" | "error" | "success">(domain.status === "active" ? "success" : "idle");
  const [errMsg, setErrMsg] = useState(domain.error ?? "");

  useEffect(() => {
    setPort(domain.port ? String(domain.port) : "");
    setProto(domain.proto);
    setPhase(domain.status === "active" ? "success" : domain.status === "error" ? "error" : "idle");
    setErrMsg(domain.error ?? "");
  }, [domain.id, domain.status, domain.port, domain.proto, domain.error]);

  const isActive = domain.status === "active";
  const isStarting = domain.status === "starting";
  const locked = isActive || isStarting;

  const onStart = async () => {
    const p = parseInt(port, 10);
    if (!p || p < 1 || p > 65535) {
      setPhase("error");
      setErrMsg("Port must be between 1 and 65535");
      return;
    }
    if (!window.osmAPI) {
      setPhase("error");
      setErrMsg("osmAPI not available");
      return;
    }
    setPhase("checking");
    setErrMsg("");
    try {
      const pf = await window.osmAPI.tunnel.preflightPort({ port: p });
      if (!pf.reachable) {
        setPhase("error");
        setErrMsg(`No local service detected on :${p}. Start your local application.`);
        return;
      }
      await window.osmAPI.tunnel.start({
        domainId: domain.id,
        port: p,
        proto,
        target: "127.0.0.1",
        consentLanBind: false,
      });
      patchDomain(domain.id, { status: "starting", port: p, proto });
    } catch (e) {
      setPhase("error");
      setErrMsg((e as Error).message);
    }
  };

  const onStop = async () => {
    if (!window.osmAPI) return;
    try {
      await window.osmAPI.tunnel.stop({ domainId: domain.id });
      patchDomain(domain.id, { status: "idle", uptime: 0 });
    } catch (e) {
      setErrMsg((e as Error).message);
    }
  };

  return (
    <div
      className="scroll"
      style={{
        width: 380,
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-elev)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflowY: "auto",
        animation: "slide-in-right .2s ease",
      }}
    >
      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <StatusDot status={isActive ? "active" : isStarting ? "starting" : domain.status === "error" ? "error" : "idle"} />
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-muted)" }}>
              {isActive ? "Tunnel Active" : isStarting ? "Starting tunnel…" : domain.status === "error" ? "Error" : "Configure binding"}
            </span>
          </div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.3, wordBreak: "break-all" }}>
            {domain.name}
          </div>
        </div>
        <IconBtn icon={I.close} onClick={onClose} title="Close" />
      </div>

      <div style={{ padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Local port</span>
          <div style={{ display: "flex", alignItems: "center", background: locked ? "var(--bg-chip)" : "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 6, overflow: "hidden" }}>
            <span className="mono" style={{ padding: "0 10px", color: "var(--text-subtle)", fontSize: 12, borderRight: "1px solid var(--border)", height: "100%", display: "flex", alignItems: "center" }}>
              localhost
            </span>
            <span className="mono" style={{ padding: "0 4px 0 8px", color: "var(--text-muted)", fontSize: 13 }}>:</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="8080"
              disabled={locked}
              inputMode="numeric"
              data-testid="port-input"
              className="mono tnum"
              style={{ flex: 1, padding: "7px 10px 7px 2px", border: "none", outline: "none", background: "transparent", fontSize: 13, color: "var(--text)" }}
            />
          </div>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Protocol</span>
          <div style={{ display: "inline-flex", padding: 2, background: "var(--bg-chip)", borderRadius: 6, gap: 1 }}>
            {(["HTTP", "HTTPS", "TCP"] as const).map((o) => (
              <button
                key={o}
                onClick={() => !locked && setProto(o)}
                disabled={locked}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: "none",
                  borderRadius: 4,
                  cursor: locked ? "not-allowed" : "pointer",
                  background: proto === o ? "var(--bg-elev)" : "transparent",
                  color: proto === o ? "var(--text)" : "var(--text-muted)",
                  boxShadow: proto === o ? "var(--shadow-sm)" : "none",
                }}
              >
                {o}
              </button>
            ))}
          </div>
        </label>
      </div>

      {phase === "error" && errMsg && (
        <div
          style={{
            margin: "0 16px 12px",
            padding: "10px 12px",
            background: "var(--error-soft)",
            borderRadius: 6,
            border: "1px solid color-mix(in oklab, var(--error) 22%, transparent)",
            display: "flex",
            gap: 8,
          }}
        >
          <span style={{ color: "var(--error)", flexShrink: 0, marginTop: 1 }}>{I.warn}</span>
          <span style={{ fontSize: 12, color: "var(--error)", lineHeight: 1.45 }}>{errMsg}</span>
        </div>
      )}

      <div style={{ marginTop: "auto", padding: "12px 16px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
        {isActive ? (
          <Btn variant="primary" danger onClick={onStop} icon={I.stop} style={{ width: "100%", justifyContent: "center" }}>
            Stop tunnel
          </Btn>
        ) : isStarting || phase === "checking" ? (
          <Btn variant="primary" disabled icon={<Spinner />} style={{ width: "100%", justifyContent: "center" }}>
            Checking local socket…
          </Btn>
        ) : (
          <Btn variant="primary" onClick={onStart} icon={I.play} style={{ width: "100%", justifyContent: "center" }} data-testid="start-tunnel">
            Start tunnel
          </Btn>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-subtle)" }}>
          <span style={{ display: "inline-flex" }}>{I.lock}</span>
          Locked to this device
        </div>
      </div>
    </div>
  );
}
