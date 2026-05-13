"use client";

import { useState } from "react";
import { useAdminUsers } from "@/lib/queries";
import { PageHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, type Column } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconSearch } from "@/components/icons";
import type { AdminUserRow } from "@/lib/types";

function userColumns(): Column<AdminUserRow>[] {
  return [
    { key: "email", label: "Email" },
    { key: "name", label: "Name", width: "180px" },
    { key: "role", label: "Role", width: "120px", render: (r) => <Badge tone={r.role === "admin" ? "danger" : "neutral"}>{r.role}</Badge> },
    { key: "domains", label: "Domains", width: "100px" },
    { key: "devices", label: "Devices", width: "100px" },
    { key: "verified", label: "Verified", width: "120px", render: (r) => <Badge tone={r.email_verified ? "success" : "warn"}>{r.email_verified ? "yes" : "no"}</Badge> },
    { key: "actions", label: "", width: "140px", align: "right", render: () => <Button variant="ghost" size="sm">Impersonate</Button> },
  ];
}

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const { data: users = [], isLoading } = useAdminUsers(q);
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Users" subtitle="Search, audit, and impersonate." />
      <div className="mb-4 max-w-[400px]">
        <Input icon={<IconSearch size={14} />} placeholder="Search by email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading ? (
        <div className="text-[var(--text-muted)]">Loading…</div>
      ) : (
        <Table columns={userColumns()} rows={users} />
      )}
    </div>
  );
}
