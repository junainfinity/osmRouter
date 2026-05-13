import type { ReactNode } from "react";
import { Wordmark } from "@/components/icons";

export function AuthShell({ children, tagline }: { children: ReactNode; tagline: ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-2 bg-[var(--bg)]">
      <div className="flex flex-col px-12 py-8 justify-between">
        <Wordmark size={15} />
        <div className="max-w-[380px] w-full mx-auto self-center">{children}</div>
        <div className="text-xs text-[var(--text-faint)]">© 2026 osmRouter</div>
      </div>
      <div className="bg-[var(--bg-soft)] border-l border-[var(--border)] relative overflow-hidden p-12 flex items-end">
        <svg width="100%" height="100%" className="absolute inset-0 opacity-50" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet" viewBox="0 0 400 600">
          <g opacity={0.7}>
            <circle cx="80" cy="120" r="4" fill="var(--accent)" />
            <circle cx="280" cy="180" r="3" fill="var(--text-muted)" />
            <circle cx="180" cy="280" r="6" fill="var(--accent)" opacity="0.6" />
            <circle cx="340" cy="340" r="3" fill="var(--text-muted)" />
            <circle cx="100" cy="420" r="4" fill="var(--accent)" />
            <circle cx="260" cy="480" r="3" fill="var(--text-muted)" />
            <path d="M80 120 L180 280 L340 340" stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="3 4" fill="none" />
            <path d="M180 280 L100 420 L260 480" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 4" fill="none" />
            <path d="M280 180 L180 280" stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="3 4" fill="none" />
          </g>
        </svg>
        <div className="relative z-10 max-w-[380px]">
          <div className="text-[11.5px] text-[var(--text-muted)] mono uppercase tracking-[0.08em] mb-3">osmRouter</div>
          <div className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--text)] leading-[1.2]">{tagline}</div>
        </div>
      </div>
    </div>
  );
}
