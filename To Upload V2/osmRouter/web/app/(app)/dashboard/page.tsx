"use client";

import { useDashboard, useMe } from "@/lib/queries";
import { useRealtime } from "@/lib/websocket";
import { useToasts } from "@/lib/store";
import { Card, PageHeader, SectionHeader, Stat } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { IconArrowR, IconGlobe, IconDevice, IconBolt, IconPlus } from "@/components/icons";
import Link from "next/link";

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading } = useDashboard();
  const push = useToasts((s) => s.push);

  useRealtime((evt) => {
    if (evt.type === "domain.verified") {
      push({ title: "DNS verified", body: String(evt.data?.fqdn ?? ""), tone: "success" });
    }
    if (evt.type === "subdomain.bound") {
      push({ title: "Subdomain bound", body: String(evt.data?.host ?? ""), tone: "success" });
    }
    if (evt.type === "subdomain.unbound") {
      push({ title: "Subdomain unbound", body: String(evt.data?.host ?? ""), tone: "info" });
    }
  });

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title={`Welcome${me?.name ? `, ${me.name.split(" ")[0]}` : ""}`}
        subtitle="Live view of your domains, devices, and tunnels."
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-[var(--text-muted)]"><Spinner /> Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-8">
            <Stat label="Domains" value={data?.domains_total ?? 0} hint={`${data?.domains_verified ?? 0} verified`} />
            <Stat label="Devices online" value={data?.devices_online ?? 0} hint={`${data?.devices_total ?? 0} total`} />
            <Stat label="Active tunnels" value={data?.active_tunnels ?? 0} accent />
            <Stat label="Bytes routed" value={formatBytes(data?.bytes_transferred ?? 0)} suffix="all-time" />
          </div>

          <div className="grid grid-cols-2 gap-5 mb-8">
            <Card>
              <SectionHeader
                title={<span className="flex items-center gap-2"><IconGlobe size={16} /> Recent domains</span>}
                action={<Link href="/domains"><Button variant="ghost" size="sm" iconRight={<IconArrowR size={12} />}>View all</Button></Link>}
              />
              {data?.recent_domains.length ? (
                <div className="flex flex-col gap-1">
                  {data.recent_domains.map((d) => (
                    <Link key={d.id} href="/domains" className="flex items-center justify-between py-2.5 px-1.5 rounded-md hover:bg-[var(--bg-soft)]">
                      <span className="mono text-[13px] truncate">{d.fqdn}</span>
                      <Badge tone={d.dns_status === "verified" ? "success" : d.dns_status === "failed" ? "danger" : "warn"} dot>{d.dns_status}</Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<IconGlobe size={20} />}
                  title="No domains yet"
                  subtitle="Add a domain to get a public hostname for your local app."
                  action={<Link href="/domains"><Button variant="primary" size="sm" icon={<IconPlus size={13} />}>Add domain</Button></Link>}
                />
              )}
            </Card>

            <Card>
              <SectionHeader
                title={<span className="flex items-center gap-2"><IconDevice size={16} /> Recent devices</span>}
                action={<Link href="/devices"><Button variant="ghost" size="sm" iconRight={<IconArrowR size={12} />}>View all</Button></Link>}
              />
              {data?.recent_devices.length ? (
                <div className="flex flex-col gap-1">
                  {data.recent_devices.map((d) => (
                    <div key={d.id} className="flex items-center justify-between py-2.5 px-1.5 rounded-md">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px]">{d.name || "(unnamed)"}</span>
                        <span className="mono text-[11px] text-[var(--text-faint)]">{d.os_type}</span>
                      </div>
                      <StatusDot online={d.is_online} label={d.is_online ? "online" : "offline"} />
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<IconDevice size={20} />}
                  title="No devices yet"
                  subtitle="Install the desktop client to register your first device."
                  action={<Link href="/devices"><Button variant="primary" size="sm" icon={<IconPlus size={13} />}>Add device</Button></Link>}
                />
              )}
            </Card>
          </div>

          <Card>
            <SectionHeader title={<span className="flex items-center gap-2"><IconBolt size={16} /> Activity</span>} />
            <div className="text-[13px] text-[var(--text-muted)]">
              Live events appear here as they happen — DNS verifications, device handshakes, and tunnel state changes.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function formatBytes(b: number): string {
  if (b === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}
