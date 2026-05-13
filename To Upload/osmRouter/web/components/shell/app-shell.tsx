"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useMe, useHealth } from "@/lib/queries";
import { Spinner } from "@/components/ui/spinner";

export function AppShell({ mode, children }: { mode: "user" | "admin"; children: ReactNode }) {
  const router = useRouter();
  const { data: me, isLoading, isError } = useMe();
  const { data: health } = useHealth();

  useEffect(() => {
    if (!isLoading && (isError || !me)) router.replace("/login");
  }, [isLoading, isError, me, router]);

  useEffect(() => {
    if (mode === "admin" && me && me.role !== "admin") router.replace("/dashboard");
  }, [mode, me, router]);

  if (isLoading || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      <Sidebar mode={mode} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        {health?.mode === "readonly" && (
          <div className="bg-[var(--warn-soft)] border-b border-[var(--warn-soft)] text-[var(--warn)] text-[12.5px] px-6 py-2 text-center mono">
            ⚠ Read-only mode — database unavailable. Writes are temporarily disabled.
          </div>
        )}
        <main className="flex-1 px-10 pt-8 pb-16 max-w-[1280px] w-full mx-auto">
          <div className="fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
