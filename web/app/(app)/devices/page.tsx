"use client";

import { useState } from "react";
import { useCreateDevice, useDevices, useRevokeDevice } from "@/lib/queries";
import { PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/badge";
import { Table, type Column } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import { Code } from "@/components/ui/code";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Empty } from "@/components/ui/empty";
import { useToasts } from "@/lib/store";
import { IconPlus, IconDevice, IconTrash } from "@/components/icons";
import type { ApiError } from "@/lib/api";
import type { Device } from "@/lib/types";

export default function DevicesPage() {
  const { data: devices = [], isLoading } = useDevices();
  const create = useCreateDevice();
  const revoke = useRevokeDevice();
  const push = useToasts((s) => s.push);

  const [addOpen, setAddOpen] = useState(false);
  const [apiKeyJustCreated, setApiKeyJustCreated] = useState<{ name: string; key: string } | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Devices"
        subtitle="Authenticated machines that can hold a tunnel open."
        action={<Button variant="primary" icon={<IconPlus size={13} />} onClick={() => setAddOpen(true)}>Add device</Button>}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-[var(--text-muted)]"><Spinner /> Loading…</div>
      ) : devices.length === 0 ? (
        <Empty
          icon={<IconDevice size={20} />}
          title="No devices registered"
          subtitle="Add a device record here to get an API key — paste it into the desktop client."
          action={<Button variant="primary" icon={<IconPlus size={13} />} onClick={() => setAddOpen(true)}>Add device</Button>}
        />
      ) : (
        <Table
          columns={deviceColumns({ onRevoke: revoke.mutateAsync, push })}
          rows={devices}
        />
      )}

      {addOpen && (
        <AddDeviceModal
          onClose={() => setAddOpen(false)}
          onCreate={async (body) => {
            try {
              const res = await create.mutateAsync(body);
              setAddOpen(false);
              setApiKeyJustCreated({ name: res.device.name || "Device", key: res.api_key });
            } catch (e) {
              push({ title: "Could not add device", body: (e as ApiError).message, tone: "danger" });
            }
          }}
          submitting={create.isPending}
        />
      )}

      {apiKeyJustCreated && (
        <Modal open onClose={() => setApiKeyJustCreated(null)} title="Save this API key" width={520} danger
          footer={<Button variant="primary" onClick={() => setApiKeyJustCreated(null)}>I&apos;ve saved it</Button>}
        >
          <p className="text-[13px] text-[var(--text-muted)] m-0 mb-3">
            This is the only time we&apos;ll show this key. Paste it into the osmRouter desktop client for <strong>{apiKeyJustCreated.name}</strong>.
          </p>
          <Code>{apiKeyJustCreated.key}</Code>
          <div className="mt-3 px-3 py-2.5 bg-[var(--warn-soft)] rounded-md text-[12.5px] text-[var(--warn)]">
            If you lose this key, you&apos;ll have to revoke the device and create a new one.
          </div>
        </Modal>
      )}
    </div>
  );
}

function deviceColumns({
  onRevoke, push,
}: {
  onRevoke: (id: string) => Promise<unknown>;
  push: (t: { title: string; body?: string; tone?: "info" | "success" | "danger" }) => void;
}): Column<Device>[] {
  return [
    { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name || "(unnamed)"}</span> },
    { key: "os_type", label: "OS", width: "120px", render: (r) => <span className="mono text-[12px]">{r.os_type || "—"}</span> },
    { key: "status", label: "Status", width: "160px", render: (r) => <StatusDot online={!!r.is_online} label={r.is_online ? "online" : "offline"} /> },
    { key: "last_seen", label: "Last seen", width: "180px", render: (r) => <span className="mono text-[12px]">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "never"}</span> },
    {
      key: "actions", label: "", width: "120px", align: "right",
      render: (r) => (
        <Button
          variant="ghost" size="sm" icon={<IconTrash size={12} />}
          onClick={async () => {
            if (!confirm(`Revoke ${r.name}? Active tunnels on this device will be killed.`)) return;
            try { await onRevoke(r.id); push({ title: "Device revoked", tone: "success" }); }
            catch (e) { push({ title: "Revoke failed", body: (e as ApiError).message, tone: "danger" }); }
          }}
        >
          Revoke
        </Button>
      ),
    },
  ];
}

function AddDeviceModal({ onClose, onCreate, submitting }: {
  onClose: () => void;
  onCreate: (body: { name: string; os_type: string; hardware_uuid?: string }) => Promise<void>;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [osType, setOsType] = useState("macos");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreate({ name, os_type: osType });
  };
  return (
    <Modal open onClose={onClose} title="Register a new device" width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !name}>
            {submitting ? <><Spinner size={12} /> Creating…</> : "Create device"}
          </Button>
        </>
      }>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Device name">
          <Input placeholder="MacBook M4 Max" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Operating system">
          <select
            value={osType}
            onChange={(e) => setOsType(e.target.value)}
            className="h-9 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] text-[13.5px] text-[var(--text)] outline-0"
          >
            <option value="macos">macOS</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
          </select>
        </Field>
      </form>
    </Modal>
  );
}
