"use client";

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "soft" | "danger" | "dangerSoft";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  full?: boolean;
}

const sizeMap: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md",
  md: "h-[34px] px-3 text-[13.5px] gap-1.5 rounded-md",
  lg: "h-10 px-4 text-sm gap-2 rounded-lg",
};

const variantMap: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-white border border-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(0,0,0,0.08)] hover:brightness-110",
  secondary: "bg-[var(--bg-panel)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-soft)]",
  ghost: "bg-transparent text-[var(--text)] border border-transparent hover:bg-[var(--bg-soft)]",
  soft: "bg-[var(--bg-soft)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-sunken)]",
  danger: "bg-[var(--danger)] text-white border border-transparent hover:brightness-110",
  dangerSoft: "bg-[var(--danger-soft)] text-[var(--danger)] border border-transparent hover:bg-[var(--danger-soft)]/80",
};

export function Button({ variant = "secondary", size = "md", icon, iconRight, full, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed",
        sizeMap[size],
        variantMap[variant],
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}
