"use client";

import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/queries";

export default function BillingPage() {
  const { data: me } = useMe();
  const isPro = (me?.plan_id ?? 1) > 1;
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Billing" subtitle="Subscription, invoices, and payment method." />

      <div className="grid grid-cols-2 gap-5">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11.5px] mono uppercase tracking-[0.06em] text-[var(--text-muted)]">Current plan</div>
              <div className="text-[28px] font-semibold tracking-tight mt-1">{isPro ? "Pro" : "Free"}</div>
            </div>
            <Badge tone={isPro ? "accent" : "neutral"}>{isPro ? "Active" : "No charges"}</Badge>
          </div>
          <ul className="list-none p-0 my-4 flex flex-col gap-2 text-[13.5px]">
            <li>{isPro ? "Unlimited domains" : "1 custom domain"}</li>
            <li>{isPro ? "10 connected devices" : "1 connected device"}</li>
            <li>{isPro ? "500 GB / month" : "10 GB / month"}</li>
          </ul>
          {!isPro && <Button variant="primary">Upgrade to Pro</Button>}
        </Card>

        <Card>
          <div className="text-[11.5px] mono uppercase tracking-[0.06em] text-[var(--text-muted)]">Invoices</div>
          <div className="text-[13px] text-[var(--text-muted)] mt-3">No invoices yet. Once you upgrade, invoices appear here.</div>
        </Card>
      </div>

      <div className="mt-5 text-[12.5px] text-[var(--text-faint)] mono">
        Payment integration is stubbed in v1 — real Stripe wiring lands in a follow-up.
      </div>
    </div>
  );
}
