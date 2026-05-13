"use client";

import { useToasts } from "@/lib/store";
import { IconAlert, IconBell, IconCheckCircle } from "@/components/icons";

export function ToastViewport() {
  const items = useToasts((s) => s.items);
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[100]">
      {items.map((t) => {
        const Icon = t.tone === "success" ? IconCheckCircle : t.tone === "danger" ? IconAlert : IconBell;
        const color = t.tone === "success" ? "text-[var(--success)]" : t.tone === "danger" ? "text-[var(--danger)]" : "text-[var(--accent)]";
        return (
          <div key={t.id} className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl px-3.5 py-3 min-w-[280px] max-w-[380px] shadow-[var(--shadow-lg)] flex items-start gap-2.5 fade-in">
            <div className={`inline-flex mt-px ${color}`}>
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-[var(--text)]">{t.title}</div>
              {t.body && <div className="text-[12.5px] text-[var(--text-muted)] mt-0.5">{t.body}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
