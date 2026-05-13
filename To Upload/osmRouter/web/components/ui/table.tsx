"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  label: string;
  width?: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
};

export function Table<T>({
  columns,
  rows,
  empty = "No results.",
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: ReactNode;
  onRowClick?: (row: T, i: number) => void;
}) {
  const gridCols = columns.map((c) => c.width ?? "1fr").join(" ");
  return (
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div
        className="grid px-[18px] py-3 text-[11.5px] text-[var(--text-muted)] uppercase tracking-[0.06em] font-medium border-b border-[var(--border)] bg-[var(--bg)] mono"
        style={{ gridTemplateColumns: gridCols }}
      >
        {columns.map((c, i) => (
          <div key={i} className={cn(c.align === "right" && "text-right", c.align === "center" && "text-center")}>
            {c.label}
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="py-16 px-6 text-center text-[var(--text-faint)] text-[13px]">{empty}</div>
      ) : (
        rows.map((row, i) => (
          <div
            key={i}
            onClick={onRowClick ? () => onRowClick(row, i) : undefined}
            className={cn(
              "grid px-[18px] py-4 text-[13.5px] items-center transition-colors",
              i < rows.length - 1 && "border-b border-[var(--border)]",
              onRowClick && "cursor-pointer hover:bg-[var(--bg-soft)]",
            )}
            style={{ gridTemplateColumns: gridCols }}
          >
            {columns.map((c, j) => (
              <div key={j} className={cn("min-w-0", c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                {c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as ReactNode)}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
