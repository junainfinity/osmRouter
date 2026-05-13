"use client";

import { useAdminAudit } from "@/lib/queries";
import { PageHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AuditEntry } from "@/lib/types";

export default function AdminAuditPage() {
  const { data: entries = [], isLoading } = useAdminAudit();
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Audit log" subtitle="Append-only record of every destructive action." />
      {isLoading ? (
        <div className="text-[var(--text-muted)]">Loading…</div>
      ) : (
        <Table<AuditEntry>
          columns={[
            { key: "when", label: "When", width: "200px", render: (r) => <span className="mono text-[12px]">{new Date(r.created_at).toLocaleString()}</span> },
            { key: "action", label: "Action", width: "220px", render: (r) => <Badge tone="accent">{r.action}</Badge> },
            { key: "target", label: "Target", render: (r) => <span className="mono text-[12px]">{r.target_kind}:{r.target_id.slice(0, 8)}</span> },
            { key: "actor", label: "Actor", width: "260px", render: (r) => <span className="mono text-[12px]">{r.actor_user_id.slice(0, 8)}</span> },
            { key: "ip", label: "IP", width: "140px", render: (r) => <span className="mono text-[12px]">{r.ip ?? ""}</span> },
          ]}
          rows={entries}
        />
      )}
    </div>
  );
}
