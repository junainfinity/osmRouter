"use client";

import { useAdminNetwork } from "@/lib/queries";
import { PageHeader, Stat } from "@/components/ui/card";

export default function AdminOverviewPage() {
  const { data, isLoading } = useAdminNetwork();
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Network overview" subtitle="Live telemetry across all edge nodes." />
      {isLoading ? (
        <div className="text-[var(--text-muted)]">Loading…</div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Active tunnels" value={data?.active_tunnels ?? 0} accent big />
          <Stat label="Online devices" value={data?.online_devices ?? 0} />
          <Stat label="Verified domains" value={data?.domains_verified ?? 0} />
          <Stat label="Edge nodes" value={data?.edge_nodes ?? 0} hint={`${data?.median_latency_ms ?? 0}ms median`} />
        </div>
      )}
    </div>
  );
}
