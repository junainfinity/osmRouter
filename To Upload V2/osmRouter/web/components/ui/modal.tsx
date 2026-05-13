"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  // SSR-safe portal target. `document` doesn't exist during the static
  // export build, so wait for client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  // Render in a portal under <body> — bypasses any ancestor transform
  // / filter / will-change containing blocks that would otherwise turn
  // our `position: fixed` modal into `position: absolute` of that ancestor.
  // (Bug seen: an ancestor .fade-in element kept a matrix(1,0,0,1,0,0)
  // transform after the animation finished, breaking modal positioning.)
  return createPortal(modalBody(), document.body);

  function modalBody() {
    return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-panel)] rounded-2xl border border-[var(--border)] shadow-[var(--shadow-lg)] fade-in flex flex-col"
        style={{ width, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)" }}
      >
        {/* Header — sticky at top, never scrolls away */}
        <div className="px-[22px] pt-[18px] pb-3 flex justify-between items-start flex-shrink-0 border-b border-[var(--border)]">
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
        {/* Body — independently scrollable so tall content (DNS guide etc.)
            doesn't push the close/verify buttons off-screen. */}
        <div className="px-[22px] py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="px-[22px] py-3.5 border-t border-[var(--border)] bg-[var(--bg)] rounded-b-2xl flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
    );
  }
}
