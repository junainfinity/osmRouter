"use client";

import { useEffect, type ReactNode } from "react";
import { IconX, IconWarn } from "@/components/icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  danger?: boolean;
}

export function Modal({ open, onClose, title, children, footer, width = 480, danger }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-panel)] rounded-2xl border border-[var(--border)] shadow-[var(--shadow-lg)] fade-in"
        style={{ width, maxWidth: "calc(100vw - 32px)" }}
      >
        <div className="px-[22px] pt-[18px] pb-0 flex justify-between items-start">
          <div className="flex items-center gap-3">
            {danger && (
              <div className="w-8 h-8 rounded-lg bg-[var(--danger-soft)] text-[var(--danger)] flex items-center justify-center">
                <IconWarn size={16} />
              </div>
            )}
            <div className="text-[16px] font-semibold tracking-tight">{title}</div>
          </div>
          <button onClick={onClose} className="bg-transparent border-0 p-1 cursor-pointer text-[var(--text-faint)] rounded">
            <IconX size={16} />
          </button>
        </div>
        <div className="px-[22px] pt-3.5 pb-[18px]">{children}</div>
        {footer && (
          <div className="px-[22px] py-3.5 border-t border-[var(--border)] bg-[var(--bg)] rounded-b-2xl flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
