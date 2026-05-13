"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark, IconHome, IconGlobe, IconDevice, IconCard, IconCog, IconUsers, IconServer, IconChart, IconList, IconBook, IconRefresh, IconAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

const NAV_USER = [
  { href: "/dashboard", label: "Dashboard", icon: <IconHome size={16} /> },
  { href: "/domains", label: "Domains", icon: <IconGlobe size={16} /> },
  { href: "/devices", label: "Devices", icon: <IconDevice size={16} /> },
  { href: "/billing", label: "Billing", icon: <IconCard size={16} /> },
  { href: "/settings", label: "Settings", icon: <IconCog size={16} /> },
];

const NAV_ADMIN = [
  { href: "/admin/overview", label: "Overview", icon: <IconChart size={16} /> },
  { href: "/admin/users", label: "Users", icon: <IconUsers size={16} /> },
  { href: "/admin/network", label: "Network", icon: <IconServer size={16} /> },
  { href: "/admin/plans", label: "Plans", icon: <IconList size={16} /> },
  { href: "/admin/audit", label: "Audit log", icon: <IconBook size={16} /> },
];

export function Sidebar({ mode, impersonating, onExitImpersonation }: { mode: "user" | "admin"; impersonating?: string; onExitImpersonation?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = mode === "admin" ? NAV_ADMIN : NAV_USER;
  const switchTo = mode === "admin" ? "user" : "admin";
  const switchTarget = mode === "admin" ? "/dashboard" : "/admin/overview";
  return (
    <aside className="w-[232px] border-r border-[var(--border)] bg-[var(--bg-panel)] flex flex-col shrink-0 h-screen sticky top-0">
      <div className="px-[18px] pt-[18px] pb-3.5">
        <div className="flex items-center justify-between">
          <Wordmark size={14} />
          {mode === "admin" && <Badge tone="danger" dot>Admin</Badge>}
        </div>
      </div>

      {impersonating && (
        <div className="mx-3 mb-2.5 px-2.5 py-2 rounded-lg bg-[var(--warn-soft)] border border-[var(--warn-soft)] flex items-center gap-2">
          <IconAlert size={14} style={{ color: "var(--warn)" }} />
          <div className="text-[11.5px] flex-1 min-w-0">
            <div className="font-medium text-[var(--text)]">Impersonating</div>
            <div className="mono text-[var(--text-muted)] truncate">{impersonating}</div>
          </div>
          <button
            onClick={onExitImpersonation}
            className="bg-transparent border-0 text-[var(--warn)] cursor-pointer text-[11.5px] font-medium"
          >
            Exit
          </button>
        </div>
      )}

      <nav className="px-2.5 py-1 flex-1 flex flex-col gap-px">
        <div className="text-[10.5px] text-[var(--text-faint)] uppercase tracking-[0.08em] px-2.5 pt-2 pb-1.5 mono">
          {mode === "admin" ? "Admin" : "Workspace"}
        </div>
        {items.map((it) => {
          const active = pathname?.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors text-[13.5px] font-medium relative",
                active ? "bg-[var(--bg-soft)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-soft)]",
              )}
            >
              {active && <span className="absolute -left-2.5 top-2 bottom-2 w-0.5 bg-[var(--accent)] rounded-full" />}
              <span className={active ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}>{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-2.5 border-t border-[var(--border)]">
        <button
          onClick={() => router.push(switchTarget)}
          className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[12.5px] text-[var(--text-muted)] bg-[var(--bg-soft)] border border-[var(--border)] rounded-md cursor-pointer hover:border-[var(--border-strong)]"
        >
          <IconRefresh size={13} />
          <span>Switch to {switchTo}</span>
        </button>
      </div>
    </aside>
  );
}
