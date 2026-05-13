"use client";

import { useMe } from "@/lib/queries";
import { Card, PageHeader, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const { data: me } = useMe();
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Settings" subtitle="Profile, API access, and security preferences." />

      <Card className="mb-5">
        <SectionHeader title="Profile" />
        <div className="flex flex-col gap-3 max-w-[440px]">
          <Field label="Display name">
            <Input defaultValue={me?.name ?? ""} />
          </Field>
          <Field label="Email">
            <Input value={me?.email ?? ""} disabled />
          </Field>
          <div>
            <Button variant="primary">Save changes</Button>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <SectionHeader title="API keys" subtitle="Programmatic access for your scripts or CI." />
        <div className="text-[13px] text-[var(--text-muted)]">No API keys yet. Per-domain scoped keys ship in v1.1.</div>
      </Card>

      <Card>
        <SectionHeader title="Security" />
        <div className="text-[13px] text-[var(--text-muted)]">
          Two-factor authentication (WebAuthn) is planned. For now your account is protected by Argon2id-hashed passwords and rotating refresh tokens.
        </div>
      </Card>
    </div>
  );
}
