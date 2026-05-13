import type { ReactNode } from "react";

export function Empty({ icon, title, subtitle, action }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-16 px-6 bg-[var(--bg-panel)] border border-dashed border-[var(--border-strong)] rounded-xl">
      {icon && (
        <div className="inline-flex p-3 bg-[var(--bg-soft)] rounded-xl mb-3.5 text-[var(--text-muted)]">
          {icon}
        </div>
      )}
      <div className="text-[15px] font-semibold text-[var(--text)] mb-1.5">{title}</div>
      {subtitle && <div className="text-[13px] text-[var(--text-muted)] mb-4 max-w-[380px] mx-auto">{subtitle}</div>}
      {action}
    </div>
  );
}
