"use client";

import { useState } from "react";
import { useCreateDomain, useDeleteDomain, useDomains, useForceVerifyDomain } from "@/lib/queries";
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
        <Modal open onClose={() => setDetail(null)} title={`DNS records · ${detail.fqdn}`} width={560}>
          <p className="text-[13px] text-[var(--text-muted)] m-0 mb-4">
            Add the two records below at your DNS provider. We&apos;ll detect them automatically — usually within a minute.
          </p>
          <Field label="CNAME (apex)">
            <Code>{detail.cname_target}</Code>
          </Field>
          <div className="mt-3">
            <Field label="TXT at _osm subdomain">
              <Code>{detail.txt_token}</Code>
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            <Button variant="primary" onClick={async () => { await verify.mutateAsync(detail.id); push({ title: "Verification queued", tone: "info" }); }}>
              Verify now
            </Button>
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
      key: "dns_status", label: "Status", width: "140px",
      render: (r) => (
        <Badge tone={r.dns_status === "verified" ? "success" : r.dns_status === "failed" ? "danger" : "warn"} dot>
          {r.dns_status}
        </Badge>
      ),
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
