import { cn } from "@/lib/cn";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ className, hover, children, style, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-sm)] transition-colors",
        hover && "hover:border-[var(--border-strong)]",
        className,
      )}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        <div className="text-[18px] font-semibold tracking-tight text-[var(--text)]">{title}</div>
        {subtitle && <div className="text-[13px] text-[var(--text-muted)] mt-1">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action, eyebrow }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 mb-7">
      <div>
        {eyebrow && <div className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.06em] mb-2 mono">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] m-0 text-[var(--text)]">{title}</h1>
        {subtitle && <div className="text-sm text-[var(--text-muted)] mt-1.5">{subtitle}</div>}
      </div>
      {action && <div className="flex gap-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, suffix, hint, delta, big, accent }: { label: string; value: ReactNode; suffix?: string; hint?: string; delta?: string; big?: boolean; accent?: boolean }) {
  return (
    <div className="px-[22px] py-5 bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl">
      <div className="text-[12.5px] text-[var(--text-muted)] flex items-center justify-between">
        <span>{label}</span>
        {delta && (
          <span className={cn("inline-flex items-center gap-1 text-[11.5px] mono", delta.startsWith("-") ? "text-[var(--danger)]" : "text-[var(--success)]")}>
            {delta}
          </span>
        )}
      </div>
      <div className={cn("num mt-2 font-medium tracking-[-0.025em]", big ? "text-[38px]" : "text-[32px]", accent ? "text-[var(--accent)]" : "text-[var(--text)]")}>
        {value}
        {suffix && <span className="text-sm text-[var(--text-muted)] font-normal ml-1">{suffix}</span>}
      </div>
      {hint && <div className="text-xs text-[var(--text-faint)] mt-1">{hint}</div>}
    </div>
  );
}

export function _typed(_x: CSSProperties) { /* type-export keepalive */ }
