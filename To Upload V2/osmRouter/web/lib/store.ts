"use client";

import { create } from "zustand";

type UIState = {
  theme: "light" | "dark";
  toggleTheme: () => void;
  setTheme: (t: "light" | "dark") => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
};

export const useUI = create<UIState>((set) => ({
  theme: "dark",
  toggleTheme: () => set((s) => {
    const next = s.theme === "dark" ? "light" : "dark";
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    }
    return { theme: next };
  }),
  setTheme: (t) => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem("theme", t);
    }
    set({ theme: t });
  },
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

type ToastItem = {
  id: string;
  title: string;
  body?: string;
  tone?: "info" | "success" | "danger";
};

type ToastState = {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
};

export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ items: [...s.items, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
    }, 3500);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));
