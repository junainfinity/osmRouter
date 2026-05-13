import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warn" | "danger" | "accent";

const toneMap: Record<Tone, { bg: string; fg: string; dot: string; pulse?: boolean }> = {
  neutral: { bg: "bg-[var(--bg-soft)]", fg: "text-[var(--text-muted)]", dot: "bg-[var(--text-faint)]" },
  success: { bg: "bg-[var(--success-soft)]", fg: "text-[var(--success)]", dot: "bg-[var(--success)]", pulse: true },
  warn: { bg: "bg-[var(--warn-soft)]", fg: "text-[var(--warn)]", dot: "bg-[var(--warn)]" },
  danger: { bg: "bg-[var(--danger-soft)]", fg: "text-[var(--danger)]", dot: "bg-[var(--danger)]" },
  accent: { bg: "bg-[var(--accent-soft)]", fg: "text-[var(--accent)]", dot: "bg-[var(--accent)]" },
};

export function Badge({ children, tone = "neutral", dot }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  const t = toneMap[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-[2px] text-[11.5px] font-medium rounded-full leading-[1.5] whitespace-nowrap", t.bg, t.fg)}>
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full inline-block", t.dot, t.pulse && "animate-[pulse_2s_ease_infinite]")} />}
      {children}
    </span>
  );
}

export function StatusDot({ online, label }: { online: boolean; label?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "w-[7px] h-[7px] rounded-full",
          online ? "bg-[var(--success)] shadow-[0_0_0_3px_var(--success-soft)] animate-[pulse_2.4s_ease-in-out_infinite]" : "bg-[var(--text-faint)]",
        )}
      />
      {label && <span className="text-[13px] text-[var(--text)]">{label}</span>}
    </span>
  );
}
