"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { AdminUserRow, AuditEntry, DashboardSummary, Device, Domain, NetworkStats, Plan, PlanUpdate, Subdomain, User } from "./types";

export const qk = {
  me: ["me"] as const,
  health: ["health"] as const,
  dashboard: ["dashboard"] as const,
  domains: ["domains"] as const,
  domain: (id: string) => ["domains", id] as const,
  subdomains: (domainId: string) => ["domains", domainId, "subdomains"] as const,
  devices: ["devices"] as const,
  adminNetwork: ["admin", "network"] as const,
  adminUsers: (q?: string) => ["admin", "users", q ?? ""] as const,
  adminAudit: ["admin", "audit"] as const,
  adminPlans: ["admin", "plans"] as const,
};

// ---------- Auth ----------

export function useMe() {
  return useQuery<User>({
    queryKey: qk.me,
    queryFn: () => api<User>("/api/v1/auth/me"),
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => qc.clear(),
  });
}

// ---------- Health ----------

export function useHealth() {
  return useQuery<{ db: boolean; redis: boolean; mode: string }>({
    queryKey: qk.health,
    queryFn: () => api("/api/v1/health"),
    refetchInterval: 15000,
  });
}

// ---------- Dashboard ----------

export function useDashboard() {
  return useQuery<DashboardSummary>({
    queryKey: qk.dashboard,
    queryFn: () => api<DashboardSummary>("/api/v1/dashboard"),
  });
}

// ---------- Domains ----------

export function useDomains() {
  return useQuery<Domain[]>({
    queryKey: qk.domains,
    queryFn: async () => (await api<{ domains: Domain[] }>("/api/v1/domains")).domains,
  });
}

export function useCreateDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fqdn: string; registrar?: string }) =>
      api<Domain>("/api/v1/domains", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  });
}

export function useDeleteDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/v1/domains/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  });
}

export function useForceVerifyDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/v1/domains/${id}/verify`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  });
}

export function useSubdomains(domainId: string) {
  return useQuery<Subdomain[]>({
    queryKey: qk.subdomains(domainId),
    enabled: !!domainId,
    queryFn: async () =>
      (await api<{ subdomains: Subdomain[] }>(`/api/v1/domains/${domainId}/subdomains`)).subdomains,
  });
}

export function useCreateSubdomain(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { prefix: string; target_port: number }) =>
      api<Subdomain>(`/api/v1/domains/${domainId}/subdomains`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.subdomains(domainId) }),
  });
}

export function useBindSubdomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subdomainId, deviceId }: { subdomainId: string; deviceId: string }) =>
      api(`/api/v1/subdomains/${subdomainId}/bind`, { method: "POST", body: { device_id: deviceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.domains });
      qc.invalidateQueries({ queryKey: ["domains"] });
    },
  });
}

export function useUnbindSubdomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subdomainId: string) =>
      api(`/api/v1/subdomains/${subdomainId}/unbind`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["domains"] }),
  });
}

// ---------- Devices ----------

export function useDevices() {
  return useQuery<Device[]>({
    queryKey: qk.devices,
    queryFn: async () => (await api<{ devices: Device[] }>("/api/v1/devices")).devices,
  });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; os_type: string; hardware_uuid?: string }) =>
      api<{ device: Device; api_key: string }>("/api/v1/devices", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }),
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/v1/devices/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }),
  });
}

// ---------- Admin ----------

export function useAdminNetwork() {
  return useQuery<NetworkStats>({
    queryKey: qk.adminNetwork,
    queryFn: () => api<NetworkStats>("/api/v1/admin/network"),
    refetchInterval: 5000,
  });
}

export function useAdminUsers(q?: string) {
  return useQuery<AdminUserRow[]>({
    queryKey: qk.adminUsers(q),
    queryFn: async () =>
      (await api<{ users: AdminUserRow[] }>(`/api/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`)).users,
  });
}

export function useAdminAudit() {
  return useQuery<AuditEntry[]>({
    queryKey: qk.adminAudit,
    queryFn: async () => (await api<{ entries: AuditEntry[] }>("/api/v1/admin/audit")).entries,
    refetchInterval: 10000,
  });
}

export function useAdminPlans() {
  return useQuery<Plan[]>({
    queryKey: qk.adminPlans,
    queryFn: async () => (await api<{ plans: Plan[] }>("/api/v1/admin/plans")).plans,
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation<Plan, Error, { id: number; patch: PlanUpdate }>({
    // api() JSON-stringifies the body itself; pass the object, not a string.
    mutationFn: ({ id, patch }) =>
      api<Plan>(`/api/v1/admin/plans/${id}`, { method: "PATCH", body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.adminPlans }),
  });
}
