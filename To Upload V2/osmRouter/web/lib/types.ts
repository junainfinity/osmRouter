export type User = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  plan_id: number;
  email_verified: boolean;
};

export type Domain = {
  id: string;
  user_id: string;
  fqdn: string;
  registrar: string;
  dns_status: "pending" | "verifying" | "verified" | "failed";
  cname_target: string;
  txt_token: string;
  verification_attempts: number;
  verified_at?: string | null;
  created_at: string;
};

export type Device = {
  id: string;
  user_id: string;
  hardware_uuid: string;
  name: string;
  os_type: string;
  last_seen_at?: string | null;
  last_seen_ip?: string;
  is_online: boolean;
  revoked_at?: string | null;
  created_at: string;
};

export type Subdomain = {
  id: string;
  parent_domain_id: string;
  prefix: string;
  target_port: number;
  bound_device_id?: string | null;
  bound_at?: string | null;
  created_at: string;
};

export type DashboardSummary = {
  domains_total: number;
  domains_verified: number;
  devices_total: number;
  devices_online: number;
  active_tunnels: number;
  bytes_transferred: number;
  recent_domains: Domain[];
  recent_devices: Device[];
};

export type NetworkStats = {
  active_tunnels: number;
  online_devices: number;
  domains_verified: number;
  global_throughput_gbps: number;
  edge_nodes: number;
  median_latency_ms: number;
};

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  plan_id: number;
  email_verified: boolean;
  created_at: string;
  devices: number;
  domains: number;
};

export type Plan = {
  id: number;
  slug: string;
  name: string;
  description: string;
  price_cents: number;       // minor units — e.g. paise for INR
  currency: string;          // ISO 4217 (default "INR")
  max_domains: number;
  max_subdomains: number;
  max_devices: number;
  bandwidth_gb: number;
  status: "active" | "coming_soon" | "archived";
  created_at: string;
  updated_at: string;
};

export type PlanUpdate = Partial<Omit<Plan, "id" | "slug" | "created_at" | "updated_at">>;

export type AuditEntry = {
  id: number;
  actor_user_id: string;
  target_user_id?: string;
  action: string;
  target_kind: string;
  target_id: string;
  metadata?: string;
  ip?: string;
  user_agent?: string;
  request_id?: string;
  created_at: string;
};
