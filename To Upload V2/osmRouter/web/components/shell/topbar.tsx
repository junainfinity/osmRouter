"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconSearch, IconBell, IconSun, IconMoon, IconChevD, IconLogout, IconCog, IconKey, IconBook } from "@/components/icons";
import { useUI } from "@/lib/store";
import { useLogout, useMe } from "@/lib/queries";

export function Topbar() {
  const router = useRouter();
  const { data: me } = useMe();
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const logout = useLogout();

  return (
    <header className="h-14 border-b border-[var(--border)] bg-[var(--bg-panel)] flex items-center px-6 gap-4 sticky top-0 z-30">
      <div className="flex-1 max-w-[420px]">
        <Input
          icon={<IconSearch size={14} />}
          placeholder="Search domains, devices, settings…"
          suffix={<span className="mono px-1.5 py-px bg-[var(--bg-soft)] border border-[var(--border)] rounded text-[10.5px]">⌘K</span>}
          sizeVariant="sm"
        />
      </div>

      <div className="flex items-center gap-1 ml-auto">
        <Button variant="ghost" size="sm" icon={theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />} onClick={toggleTheme} />
        <Button variant="ghost" size="sm" icon={<IconBell size={14} />}>
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
        </Button>

        <div className="w-px h-5 bg-[var(--border)] mx-1" />

        <UserMenu name={me?.name ?? me?.email ?? "User"} onLogout={async () => {
          try { await logout.mutateAsync(); } catch { /* */ }
          router.push("/login");
        }} />
      </div>
    </header>
  );
}

function UserMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "U";
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 px-2 py-1 bg-transparent border-0 rounded-md cursor-pointer">
        <div className="w-[26px] h-[26px] rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center text-[11px] font-semibold">
          {initials}
        </div>
        <span className="text-[13px] text-[var(--text)] font-medium">{name.split(" ")[0]}</span>
        <IconChevD size={12} className="text-[var(--text-faint)]" />
      </button>
      {open && (
        <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-[calc(100%+4px)] bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-lg)] min-w-[200px] p-1 z-50 fade-in">
          <MenuItem icon={<IconCog size={14} />} label="Settings" onClick={() => { setOpen(false); }} />
          <MenuItem icon={<IconKey size={14} />} label="API keys" onClick={() => setOpen(false)} />
          <MenuItem icon={<IconBook size={14} />} label="Documentation" onClick={() => setOpen(false)} />
          <div className="h-px bg-[var(--border)] my-1 mx-0.5" />
          <MenuItem icon={<IconLogout size={14} />} label="Sign out" danger onClick={() => { setOpen(false); onLogout(); }} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] bg-transparent border-0 rounded text-left cursor-pointer ${
        danger ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]" : "text-[var(--text)] hover:bg-[var(--bg-soft)]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
