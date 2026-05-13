"use client";

import { cn } from "@/lib/cn";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix" | "size"> {
  icon?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  sizeVariant?: "sm" | "md" | "lg";
}

const heights = { sm: "h-[30px]", md: "h-9", lg: "h-10" };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, prefix, suffix, className, sizeVariant = "md", ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg px-2.5 w-full transition-all",
        "focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--accent-soft)]",
        heights[sizeVariant],
        className,
      )}
    >
      {icon && <span className="text-[var(--text-faint)] inline-flex">{icon}</span>}
      {prefix && <span className="text-[var(--text-faint)] mono text-[13px]">{prefix}</span>}
      <input
        ref={ref}
        className="border-0 outline-none bg-transparent flex-1 text-[13.5px] text-[var(--text)] min-w-0 placeholder:text-[var(--text-faint)]"
        {...rest}
      />
      {suffix && <span className="text-[var(--text-faint)] text-xs">{suffix}</span>}
    </div>
  );
});

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex justify-between mb-1.5">
      <label className="text-[12.5px] font-medium text-[var(--text)]">{children}</label>
      {hint && <span className="text-xs text-[var(--text-faint)]">{hint}</span>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {label && <Label hint={hint}>{label}</Label>}
      {children}
      {error && <div className="text-xs text-[var(--danger)] mt-1.5">{error}</div>}
    </div>
  );
}
