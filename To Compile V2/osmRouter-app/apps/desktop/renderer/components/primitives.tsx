"use client";
import React from "react";

export function StatusDot({ status, size = 8 }: { status: "active" | "idle" | "error" | "warn" | "starting" | "info"; size?: number }) {
  const COLOR: Record<string, string> = {
    active: "var(--success)",
    idle: "var(--text-subtle)",
    error: "var(--error)",
    warn: "var(--warning)",
    starting: "var(--info)",
    info: "var(--info)",
  };
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: COLOR[status] ?? COLOR.idle,
        flexShrink: 0,
        boxShadow: status === "active" ? `0 0 0 3px color-mix(in oklab, var(--success) 18%, transparent)` : "none",
        animation: status === "starting" ? "pulse-dot 1.2s ease-in-out infinite" : "none",
      }}
    />
  );
}

export function Badge({ tone = "neutral", soft = false, children }: { tone?: "neutral" | "success" | "error" | "warn" | "info" | "accent"; soft?: boolean; children: React.ReactNode }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: "var(--bg-chip)", fg: "var(--text-muted)" },
    success: { bg: soft ? "var(--success-soft)" : "var(--bg-chip)", fg: "var(--success)" },
    error: { bg: soft ? "var(--error-soft)" : "var(--bg-chip)", fg: "var(--error)" },
    warn: { bg: soft ? "var(--warning-soft)" : "var(--bg-chip)", fg: "var(--warning)" },
    info: { bg: soft ? "var(--info-soft)" : "var(--bg-chip)", fg: "var(--info)" },
    accent: { bg: "var(--accent-soft)", fg: "var(--accent)" },
  };
  const t = tones[tone] ?? tones.neutral!;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: t.bg,
        color: t.fg,
        padding: "2px 7px",
        borderRadius: 4,
        fontSize: 11.5,
        fontWeight: 500,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "1.5px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin .7s linear infinite",
      }}
    />
  );
}

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "chip";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  danger?: boolean;
}

export function Btn({ variant = "ghost", size = "md", icon, danger, children, style, ...rest }: BtnProps) {
  const pad = size === "sm" ? "4px 8px" : size === "lg" ? "8px 14px" : "6px 11px";
  const fs = size === "sm" ? 12 : 13;
  const bg = variant === "primary" ? (danger ? "var(--error)" : "var(--accent)") : variant === "secondary" ? "var(--bg-elev)" : variant === "chip" ? "var(--bg-chip)" : "transparent";
  const fg = variant === "primary" ? (danger ? "#fff" : "var(--accent-text)") : danger ? "var(--error)" : "var(--text)";
  return (
    <button
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: pad,
        fontSize: fs,
        fontWeight: 500,
        color: fg,
        background: bg,
        border: variant === "secondary" ? "1px solid var(--border-strong)" : "1px solid transparent",
        borderRadius: 6,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.5 : 1,
        transition: "all .12s ease",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconBtn({ icon, title, onClick, style }: { icon: React.ReactNode; title?: string; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26,
        height: 26,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        color: "var(--text-muted)",
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
        ...style,
      }}
    >
      {icon}
    </button>
  );
}

// Icon set
export const I = {
  search: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="4" />
      <path d="M9 9l3 3" />
    </svg>
  ),
  refresh: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6.5A5 5 0 1 0 12.7 9" />
      <path d="M12 3v3.5h-3" />
    </svg>
  ),
  power: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M7 2v5" />
      <path d="M4 4a4.5 4.5 0 1 0 6 0" />
    </svg>
  ),
  play: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <path d="M2 1.5v7l6-3.5z" />
    </svg>
  ),
  stop: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <rect x="2" y="2" width="6" height="6" rx="1" />
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  ),
  list: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 4h8M3 7h8M3 10h8" />
    </svg>
  ),
  services: (
    // Stack of squares — represents the local services / "cards" view.
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="4.5" height="4.5" rx="0.7" />
      <rect x="7.5" y="2" width="4.5" height="4.5" rx="0.7" />
      <rect x="2" y="7.5" width="4.5" height="4.5" rx="0.7" />
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="0.7" />
    </svg>
  ),
  inspector: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h10v8H2z" />
      <path d="M2 5.5h10M4 8h2M4 9.5h4" />
    </svg>
  ),
  settings: (
    // Proper cog/gear with notched teeth — the previous icon was straight
    // radial lines, indistinguishable from a sun. Customers reported
    // "settings icon looks like a theme toggle"; this fixes that.
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  ),
  lock: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <rect x="2" y="4.5" width="6" height="4.5" rx="1" />
      <path d="M3.5 4.5V3a1.5 1.5 0 0 1 3 0v1.5" />
    </svg>
  ),
  warn: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2l5 8.5H1z" />
      <path d="M6 5.5v2M6 9v.01" />
    </svg>
  ),
  globe: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="7" cy="7" r="5" />
      <path d="M2 7h10M7 2c1.5 2 1.5 8 0 10M7 2c-1.5 2-1.5 8 0 10" strokeLinecap="round" />
    </svg>
  ),
};
