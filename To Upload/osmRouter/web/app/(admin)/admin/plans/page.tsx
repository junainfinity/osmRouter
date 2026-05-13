"use client";

import { PageHeader, Card } from "@/components/ui/card";

export default function AdminPlansPage() {
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Plans" subtitle="Subscription tier configuration." />
      <Card>
        <div className="text-[13px] text-[var(--text-muted)]">
          Plan editing UI lands in v1.1. Seed plans (Free, Pro) are created on first DB migration.
        </div>
      </Card>
    </div>
  );
}
