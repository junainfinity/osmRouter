"use client";

import { useState } from "react";
import { useCreateDomain, useDeleteDomain, useDomains, useForceVerifyDomain, useSubdomains, useBindSubdomain, useUnbindSubdomain, useDevices } from "@/lib/queries";
import { DnsRegistrarGuide } from "@/components/dns/DnsRegistrarGuide";
import { PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, type Column } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import { Code } from "@/components/ui/code";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Empty } from "@/components/ui/empty";
import { useToasts } from "@/lib/store";
import { IconPlus, IconGlobe, IconRefresh, IconTrash } from "@/components/icons";
import type { Domain } from "@/lib/types";
import type { ApiError } from "@/lib/api";

export default function DomainsPage() {
  const { data: domains = [], isLoading } = useDomains();
  const create = useCreateDomain();
  const verify = useForceVerifyDomain();
  const del = useDeleteDomain();
  const push = useToasts((s) => s.push);

  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Domain | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Domains"
        subtitle="Custom hostnames pointed at osmRouter, with one-click verification."
        action={
          <Button variant="primary" icon={<IconPlus size={13} />} onClick={() => setAddOpen(true)}>
            Add domain
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-[var(--text-muted)]"><Spinner /> Loading…</div>
      ) : domains.length === 0 ? (
        <Empty
          icon={<IconGlobe size={20} />}
          title="No domains yet"
          subtitle="Add your first domain to get a CNAME target and start routing traffic."
          action={<Button variant="primary" icon={<IconPlus size={13} />} onClick={() => setAddOpen(true)}>Add domain</Button>}
        />
      ) : (
        <Table
          columns={domainsColumns({ onVerify: verify.mutateAsync, onDelete: del.mutateAsync, onDetail: setDetail, push })}
          rows={domains}
        />
      )}

      {/* Add modal */}
      <AddDomainModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={async (body) => {
          try {
            const created = await create.mutateAsync(body);
            push({ title: "Domain added", body: created.fqdn, tone: "success" });
            setAddOpen(false);
            setDetail(created);
          } catch (e) {
            push({ title: "Could not add domain", body: (e as ApiError).message, tone: "danger" });
          }
        }}
        submitting={create.isPending}
      />

      {/* DNS records detail modal */}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`${detail.fqdn}`} width={680}>
          {detail.dns_status === "verified" ? (
            <BindingsSection domain={detail} />
          ) : (
            <DnsRegistrarGuide domain={detail} />
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            {detail.dns_status !== "verified" && (
              <Button variant="primary" onClick={async () => { await verify.mutateAsync(detail.id); push({ title: "Verification queued", tone: "info" }); }}>
                Verify now
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function domainsColumns({
  onVerify, onDelete, onDetail, push,
}: {
  onVerify: (id: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onDetail: (d: Domain) => void;
  push: (t: { title: string; body?: string; tone?: "info" | "success" | "danger" }) => void;
}): Column<Domain>[] {
  return [
    { key: "fqdn", label: "Domain", render: (r) => <span className="mono">{r.fqdn}</span> },
    { key: "registrar", label: "Registrar", width: "160px", render: (r) => r.registrar || "—" },
    {
      key: "dns_status", label: "Status", width: "120px",
      render: (r) => (
        <Badge tone={r.dns_status === "verified" ? "success" : r.dns_status === "failed" ? "danger" : "warn"} dot>
          {r.dns_status}
        </Badge>
      ),
    },
    {
      key: "bindings", label: "Devices bound", width: "200px",
      render: (r) => <BoundDevicesCell domainId={r.id} />,
    },
    {
      key: "actions", label: "", width: "230px", align: "right",
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          <Button variant="ghost" size="sm" icon={<IconRefresh size={12} />} onClick={async () => {
            try { await onVerify(r.id); push({ title: "Verification queued", tone: "info" }); }
            catch (e) { push({ title: "Could not queue", body: (e as ApiError).message, tone: "danger" }); }
          }}>Verify</Button>
          <Button variant="ghost" size="sm" onClick={() => onDetail(r)}>Details</Button>
          <Button variant="ghost" size="sm" icon={<IconTrash size={12} />} onClick={async () => {
            if (!confirm(`Delete ${r.fqdn}?`)) return;
            try { await onDelete(r.id); push({ title: "Domain deleted", tone: "success" }); }
            catch (e) { push({ title: "Delete failed", body: (e as ApiError).message, tone: "danger" }); }
          }} />
        </div>
      ),
    },
  ];
}

function AddDomainModal({ open, onClose, onCreate, submitting }: {
  open: boolean;
  onClose: () => void;
  onCreate: (body: { fqdn: string; registrar?: string }) => Promise<void>;
  submitting: boolean;
}) {
  const [fqdn, setFqdn] = useState("");
  const [registrar, setRegistrar] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreate({ fqdn, registrar });
    setFqdn("");
    setRegistrar("");
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a domain" width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !fqdn}>
            {submitting ? <><Spinner size={12} /> Adding…</> : "Add domain"}
          </Button>
        </>
      }>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Fully-qualified domain name">
          <Input placeholder="api.mycoolstartup.com" value={fqdn} onChange={(e) => setFqdn(e.target.value)} required />
        </Field>
        <Field label="Registrar (optional)">
          <Input placeholder="Namecheap, GoDaddy, Cloudflare…" value={registrar} onChange={(e) => setRegistrar(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/**
 * DnsRecordsHelp
 *
 * Renders the two DNS records the user must add at their registrar, with the
 * exact Name + Value + Type + TTL for each, copy buttons, and a registrar tip.
 *
 * For a domain "example.com" the records are:
 *   CNAME   @       tunnel.osmrouter.com           (or: ALIAS / ANAME on apex-restricted registrars)
 *   TXT     _osm    <verification token>
 *
 * For a subdomain "tunnels.example.com" the names become "tunnels" and
 * "_osm.tunnels" respectively. The server's verifier handles both shapes.
 */
function DnsRecordsHelp({ domain }: { domain: Domain }) {
  // The "host" portion the user types into their DNS UI depends on where in
  // their zone they're adding the records. We can't know their zone for
  // certain, so we offer both interpretations: apex (most common) + subdomain.
  const labels = domain.fqdn.split(".");
  const isApex = labels.length <= 2; // a.b → apex; a.b.c → subdomain
  const cnameName = isApex ? "@" : labels.slice(0, -2).join(".");
  const txtName = isApex ? "_osm" : `_osm.${labels.slice(0, -2).join(".")}`;

  return (
    <>
      <p className="text-[13px] text-[var(--text-muted)] m-0 mb-4 leading-[1.55]">
        Open your DNS provider&apos;s control panel for{" "}
        <span className="mono text-[var(--text)]">{labels.slice(-2).join(".")}</span> and add the two
        records below. We&apos;ll detect them automatically — usually within a minute.
      </p>

      <DnsRecord
        type="CNAME"
        name={cnameName}
        value={domain.cname_target}
        ttl="600"
        explainer="Sends traffic for this hostname through osmRouter's edge."
      />

      <DnsRecord
        type="TXT"
        name={txtName}
        value={domain.txt_token}
        ttl="600"
        explainer="Proves you own the domain. The leading underscore is part of the name."
      />

      <div className="mt-4 p-3 rounded-md border border-[var(--border)] bg-[var(--bg-soft)]">
        <div className="text-[11.5px] mono uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1.5">
          Registrar tips
        </div>
        <ul className="m-0 pl-4 text-[12.5px] text-[var(--text-muted)] leading-[1.6] list-disc">
          <li>
            <b className="text-[var(--text)]">GoDaddy / Namecheap:</b> in the Name field type just{" "}
            <span className="mono text-[var(--text)]">{cnameName}</span> and{" "}
            <span className="mono text-[var(--text)]">{txtName}</span> — they auto-append your domain.
          </li>
          <li>
            <b className="text-[var(--text)]">Apex CNAME not supported?</b> Some registrars (GoDaddy)
            don&apos;t allow CNAME at <span className="mono text-[var(--text)]">@</span>. In that case,
            skip the CNAME — the TXT alone is enough to verify ownership, and you can put a wildcard{" "}
            <span className="mono text-[var(--text)]">*</span> CNAME for subdomain routing.
          </li>
          <li>
            <b className="text-[var(--text)]">Cloudflare:</b> set the record to <em>DNS only</em>{" "}
            (grey cloud, not orange) so traffic reaches osmRouter directly.
          </li>
          <li>
            <b className="text-[var(--text)]">TTL:</b> 600 (10 min) gives fast iteration during setup.
            Once verified you can bump to 3600 or higher.
          </li>
        </ul>
      </div>
    </>
  );
}

function DnsRecord({
  type, name, value, ttl, explainer,
}: {
  type: "CNAME" | "TXT" | "A";
  name: string;
  value: string;
  ttl: string;
  explainer: string;
}) {
  return (
    <div className="mt-3 p-3 rounded-md border border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="flex items-center gap-2 mb-2">
        <Badge tone={type === "CNAME" ? "accent" : "neutral"}>{type}</Badge>
        <span className="text-[12.5px] text-[var(--text-muted)]">{explainer}</span>
      </div>
      <div className="grid grid-cols-[64px_1fr] gap-y-1.5 gap-x-3 items-center">
        <span className="text-[11.5px] mono uppercase tracking-[0.06em] text-[var(--text-faint)]">Type</span>
        <span className="text-[13px] text-[var(--text)]">{type}</span>

        <span className="text-[11.5px] mono uppercase tracking-[0.06em] text-[var(--text-faint)]">Name</span>
        <Code>{name}</Code>

        <span className="text-[11.5px] mono uppercase tracking-[0.06em] text-[var(--text-faint)]">Value</span>
        <Code>{value}</Code>

        <span className="text-[11.5px] mono uppercase tracking-[0.06em] text-[var(--text-faint)]">TTL</span>
        <span className="text-[13px] text-[var(--text-muted)]">{ttl} (seconds)</span>
      </div>
    </div>
  );
}

/**
 * BindingsSection — shown inside the domain details modal once the domain
 * is verified. Lists every subdomain attached to the domain with the
 * device it's currently bound to, and lets the user unbind or rebind to a
 * different device. Detached subdomains can be re-attached to any of the
 * user's online devices.
 */
function BindingsSection({ domain }: { domain: Domain }) {
  const { data: subs = [] } = useSubdomains(domain.id);
  const { data: devices = [] } = useDevices();
  const bind = useBindSubdomain();
  const unbind = useUnbindSubdomain();
  const push = useToasts((s) => s.push);

  return (
    <div>
      <p className="text-[13px] text-[var(--text-muted)] m-0 mb-3">
        Subdomains under <span className="mono text-[var(--text)]">{domain.fqdn}</span>.
        Each row can be bound to one of your devices — or detached and re-bound elsewhere.
      </p>

      {subs.length === 0 ? (
        <div className="px-3 py-6 rounded-md border border-dashed border-[var(--border)] text-center text-[12.5px] text-[var(--text-muted)]">
          No subdomains yet. Customers can add bindings from their osmRouter desktop app.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {subs.map((s) => {
            const fqdn = s.prefix === "" ? domain.fqdn : `${s.prefix}.${domain.fqdn}`;
            const boundDev = devices.find((d) => d.id === s.bound_device_id);
            return (
              <div key={s.id} className="px-3 py-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-panel)]">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="mono text-[13px] text-[var(--text)]">{fqdn}</span>
                  <span className="text-[11.5px] text-[var(--text-muted)]">→ :{s.target_port || "—"}</span>
                  <div className="flex-1" />
                  {s.bound_device_id ? (
                    <Badge tone="success" dot>{boundDev?.name ?? "bound"}</Badge>
                  ) : (
                    <Badge tone="warn">detached</Badge>
                  )}
                </div>
                <div className="flex gap-2 items-center">
                  <select
                    value={s.bound_device_id ?? ""}
                    onChange={async (e) => {
                      const next = e.target.value;
                      try {
                        if (next === "") {
                          await unbind.mutateAsync(s.id);
                          push({ title: "Unbound", tone: "success" });
                        } else {
                          await bind.mutateAsync({ subdomainId: s.id, deviceId: next });
                          push({ title: `Bound to ${devices.find((d) => d.id === next)?.name ?? "device"}`, tone: "success" });
                        }
                      } catch (e) {
                        const msg = (e as { message?: string }).message ?? "Update failed";
                        push({ title: msg, tone: "danger" });
                      }
                    }}
                    className="text-[12.5px] px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text)] flex-1"
                  >
                    <option value="">— detached (no device) —</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.is_online ? "(online)" : "(offline)"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * BoundDevicesCell — renders the device(s) a domain is bound to, by joining
 * the domain's subdomains with the user's devices list. Shows:
 *   - "—" if the domain has no subdomain bindings
 *   - "<device name>" if all bindings are on one device
 *   - "<device name> +N more" if bindings span multiple devices
 *   - "detached" if all subdomains exist but none are bound to a device
 */
function BoundDevicesCell({ domainId }: { domainId: string }) {
  const { data: subs = [], isLoading: subsLoading } = useSubdomains(domainId);
  const { data: devices = [] } = useDevices();
  if (subsLoading) return <span className="text-[var(--text-faint)] text-[12px]">…</span>;
  const boundIds = Array.from(new Set(subs.map((s) => s.bound_device_id).filter((x): x is string => !!x)));
  if (subs.length === 0) return <span className="text-[var(--text-faint)]">—</span>;
  if (boundIds.length === 0) return <Badge tone="warn">{subs.length} detached</Badge>;
  const names = boundIds.map((id) => devices.find((d) => d.id === id)?.name ?? id.slice(0, 8));
  const first = names[0];
  const extra = names.length - 1;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Badge tone="success" dot>{first}</Badge>
      {extra > 0 && <span className="text-[11.5px] text-[var(--text-muted)]">+{extra} more</span>}
    </div>
  );
}
