"use client";
import { create } from "zustand";
import type { DomainRow, ReqObserved } from "@/lib/osm-api";

export type NetworkState = "connected" | "flicker" | "reconnecting" | "offline" | "roaming";
export type Tab = "services" | "domains" | "inspector" | "settings";

interface Store {
  // domains
  domains: DomainRow[];
  selectedId: string | null;
  setDomains: (d: DomainRow[]) => void;
  patchDomain: (id: string, fields: Partial<DomainRow>) => void;
  selectDomain: (id: string | null) => void;

  // requests buffer (capped)
  requests: ReqObserved[];
  pushRequest: (r: ReqObserved) => void;
  clearRequests: () => void;

  // ui
  tab: Tab;
  setTab: (t: Tab) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  search: string;
  setSearch: (s: string) => void;
  filter: "all" | "active" | "idle" | "error";
  setFilter: (f: "all" | "active" | "idle" | "error") => void;
  sort: "alpha" | "status" | "recent";
  setSort: (s: "alpha" | "status" | "recent") => void;

  // connection
  network: NetworkState;
  setNetwork: (s: NetworkState) => void;
  edge: string;
  setEdge: (e: string) => void;

  // auth
  signedIn: boolean;
  email: string | null;
  setAuth: (signedIn: boolean, email?: string | null) => void;
  signInModalOpen: boolean;
  openSignInModal: () => void;
  closeSignInModal: () => void;
}

export const useApp = create<Store>((set) => ({
  domains: [],
  selectedId: null,
  setDomains: (d) => set({ domains: d }),
  patchDomain: (id, fields) =>
    set((s) => ({ domains: s.domains.map((d) => (d.id === id ? { ...d, ...fields } : d)) })),
  selectDomain: (id) => set({ selectedId: id, tab: id ? "domains" : id === null ? "domains" : "domains" }),

  requests: [],
  pushRequest: (r) =>
    set((s) => ({ requests: [r, ...s.requests].slice(0, 500) })),
  clearRequests: () => set({ requests: [] }),

  tab: "services",
  setTab: (t) => set({ tab: t }),
  theme: "dark",
  setTheme: (t) => {
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", t);
    set({ theme: t });
  },
  search: "",
  setSearch: (s) => set({ search: s }),
  filter: "all",
  setFilter: (f) => set({ filter: f }),
  sort: "status",
  setSort: (s) => set({ sort: s }),

  network: "connected",
  setNetwork: (n) => set({ network: n }),
  edge: "iad-1",
  setEdge: (e) => set({ edge: e }),

  signedIn: false,
  email: null,
  setAuth: (signedIn, email = null) => set({ signedIn, email }),
  signInModalOpen: false,
  openSignInModal: () => set({ signInModalOpen: true }),
  closeSignInModal: () => set({ signInModalOpen: false }),
}));
