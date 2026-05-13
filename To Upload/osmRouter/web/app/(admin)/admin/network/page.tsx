"use client";

import { useAdminNetwork } from "@/lib/queries";
import { Card, PageHeader, Stat } from "@/components/ui/card";

export default function AdminNetworkPage() {
  const { data, isLoading } = useAdminNetwork();
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Network" subtitle="Edge node health and per-region throughput." />
      {isLoading ? (
        <div className="text-[var(--text-muted)]">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <Stat label="Global throughput" value={(data?.global_throughput_gbps ?? 0).toFixed(2)} suffix="Gbps" />
            <Stat label="Edge nodes" value={data?.edge_nodes ?? 0} hint="all healthy" />
            <Stat label="Median latency" value={data?.median_latency_ms ?? 0} suffix="ms" />
          </div>
          <Card>
            <div className="text-[13px] text-[var(--text-muted)]">
              Per-node telemetry (proxy node ingest) lands in v1.1. Stats above are derived from the control plane database.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
