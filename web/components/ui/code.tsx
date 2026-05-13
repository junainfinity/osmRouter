"use client";

import { useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "@/components/icons";

export function Code({ children, copyable = true }: { children: ReactNode; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = typeof children === "string" ? children : "";
  const handleCopy = () => {
    if (text && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => { /* no-op */ });
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-lg mono text-[12.5px] text-[var(--text)] overflow-hidden">
      <span className="flex-1 truncate">{children}</span>
      {copyable && (
        <button onClick={handleCopy} className={`bg-transparent border-0 p-1 cursor-pointer rounded inline-flex ${copied ? "text-[var(--success)]" : "text-[var(--text-faint)]"}`}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </button>
      )}
    </div>
  );
}
