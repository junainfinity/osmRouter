"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useUI } from "@/lib/store";
import { fetchCSRF } from "@/lib/api";
import { ToastViewport } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  const setTheme = useUI((s) => s.setTheme);

  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("theme")) as "light" | "dark" | null;
    if (stored) setTheme(stored);
    // Best-effort: prime CSRF token; ignore errors (user may not be logged in yet)
    void fetchCSRF().catch(() => {});
  }, [setTheme]);

  return (
    <QueryClientProvider client={client}>
      {children}
      <ToastViewport />
    </QueryClientProvider>
  );
}
