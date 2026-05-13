"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAdminPlans, useUpdatePlan } from "@/lib/queries";
import { useToasts } from "@/lib/store";
import type { Plan, PlanUpdate } from "@/lib/types";

/**
 * Admin → Plans
 *
 * Lets the admin tweak each subscription tier's limits and pricing without a
 * redeploy. Every plan row is independent — saving one doesn't touch the
 * others. All money is in ₹ (paise stored, rupees shown).
 */
export default function AdminPlansPage() {
  const { data: plans, isLoading } = useAdminPlans();
  const update = useUpdatePlan();
  const push = useToasts((s) => s.push);

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Plans"
        subtitle="Subscription tiers. Edits apply immediately — everyone on the free tier picks up new limits on their next request."
      />

      {isLoading && (
        <Card>
          <div className="text-[13px] text-[var(--text-muted)]">Loading plans…</div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {plans?.map((p) => (
          <PlanEditor
            key={p.id}
            plan={p}
            onSave={async (patch) => {
              try {
                await update.mutateAsync({ id: p.id, patch });
                push({ title: `${p.name || p.slug} updated`, tone: "success" });
              } catch (err) {
                const msg = err instanceof Error ? err.message : "Update failed";
                push({ title: msg, tone: "danger" });
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PlanEditor({ plan, onSave }: { plan: Plan; onSave: (patch: PlanUpdate) => Promise<void> }) {
  // Local edit state — we re-seed from props when the server data refreshes.
  const [name, setName] = useState(plan.name || plan.slug);
  const [description, setDescription] = useState(plan.description || "");
  // Show prices in rupees (whole-rupee precision is fine for tier pricing).
  const [priceRupees, setPriceRupees] = useState(String(Math.round(plan.price_cents / 100)));
  const [maxDomains, setMaxDomains] = useState(String(plan.max_domains));
  const [maxSubdomains, setMaxSubdomains] = useState(String(plan.max_subdomains));
  const [maxDevices, setMaxDevices] = useState(String(plan.max_devices));
  const [bandwidthGb, setBandwidthGb] = useState(String(plan.bandwidth_gb));
  const [status, setStatus] = useState<Plan["status"]>(plan.status);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(plan.name || plan.slug);
    setDescription(plan.description || "");
    setPriceRupees(String(Math.round(plan.price_cents / 100)));
    setMaxDomains(String(plan.max_domains));
    setMaxSubdomains(String(plan.max_subdomains));
    setMaxDevices(String(plan.max_devices));
    setBandwidthGb(String(plan.bandwidth_gb));
    setStatus(plan.status);
  }, [plan.id, plan.updated_at]);

  const dirty =
    name !== (plan.name || plan.slug) ||
    description !== (plan.description || "") ||
    Number(priceRupees) !== Math.round(plan.price_cents / 100) ||
    Number(maxDomains) !== plan.max_domains ||
    Number(maxSubdomains) !== plan.max_subdomains ||
    Number(maxDevices) !== plan.max_devices ||
    Number(bandwidthGb) !== plan.bandwidth_gb ||
    status !== plan.status;

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: PlanUpdate = {
        name,
        description,
        price_cents: Math.max(0, Math.round(Number(priceRupees) || 0) * 100),
        max_domains: Math.max(0, Math.round(Number(maxDomains) || 0)),
        max_subdomains: Math.max(0, Math.round(Number(maxSubdomains) || 0)),
        max_devices: Math.max(0, Math.round(Number(maxDevices) || 0)),
        bandwidth_gb: Math.max(0, Math.round(Number(bandwidthGb) || 0)),
        status,
      };
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  };

  const statusTone =
    status === "active" ? "success" : status === "coming_soon" ? "warn" : "neutral";

  return (
    <Card>
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[15px] font-semibold text-[var(--text)]">{plan.name || plan.slug}</span>
            <span className="text-[11.5px] mono text-[var(--text-faint)]">/{plan.slug}</span>
            <Badge tone={statusTone}>{status.replace("_", " ")}</Badge>
          </div>
          <div className="text-[12.5px] text-[var(--text-muted)]">{plan.description || "—"}</div>
        </div>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* Rename row — kept full-width so it's the most obvious affordance.
          The slug (e.g. "free") stays immutable because it's hardcoded in
          back-end queries; only the human-readable name changes. */}
      <div className="mb-3 pb-3 border-b border-[var(--border)]">
        <Field label="Plan name" hint="Shown to users on the pricing page and in their account">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            placeholder={plan.slug}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Field label="Price (₹/month)" hint="0 = free">
          <Input type="number" min={0} value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} />
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Plan["status"])}
            className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text)] text-[13px] px-3"
          >
            <option value="active">active</option>
            <option value="coming_soon">coming soon</option>
            <option value="archived">archived</option>
          </select>
        </Field>
        <Field label="Bandwidth (GB / month)">
          <Input type="number" min={0} value={bandwidthGb} onChange={(e) => setBandwidthGb(e.target.value)} />
        </Field>
        <Field label="Max domains">
          <Input type="number" min={0} value={maxDomains} onChange={(e) => setMaxDomains(e.target.value)} />
        </Field>
        <Field label="Max subdomains">
          <Input type="number" min={0} value={maxSubdomains} onChange={(e) => setMaxSubdomains(e.target.value)} />
        </Field>
        <Field label="Max devices">
          <Input type="number" min={0} value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} />
        </Field>
        <Field label="Description" hint="One-line pitch shown under the plan name">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
        </Field>
      </div>
    </Card>
  );
}
