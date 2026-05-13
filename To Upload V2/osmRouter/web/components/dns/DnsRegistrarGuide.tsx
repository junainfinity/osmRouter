"use client";

/**
 * Per-registrar DNS instructions.
 *
 * Redesigned for max readability per customer feedback:
 *   - Records are CARDS, not table rows — each card explicitly labels
 *     Type / Name / Value / TTL with one copy button per cell.
 *   - The registrar tab strip is bigger and sticky to the top of the modal.
 *   - Steps use prominent circled numbers and short single-action sentences.
 *   - The Name / TTL conventions are pulled OUT of prose into a tiny key-value
 *     card so they catch the eye.
 *   - The "Watch out" line gets its own warning-tinted card with an icon.
 *   - Format per user spec: <Type> — <Name> — <Value> — <TTL>.
 */

import { useMemo, useState } from "react";
import type { Domain } from "@/lib/types";

const SERVER_IPV4 = "157.180.124.246";

type Registrar = {
  id: string;
  name: string;
  steps: string[];
  hostHint: string;
  ttlHint?: string;
  caveat?: string;
};

const REGISTRARS: Registrar[] = [
  {
    id: "godaddy",
    name: "GoDaddy",
    steps: [
      "Sign in at **godaddy.com** and open **My Products**.",
      "Find your domain in the list and click **DNS** (or the three-dot menu → **Manage DNS**).",
      "Scroll to the **DNS Records** table.",
      "Click **Add New Record** and fill in the first row below. Click **Save** for that row, then repeat for the other two rows.",
      "**Important:** after all three are added, GoDaddy shows a top-right **Save** button — click it. GoDaddy does not autosave.",
    ],
    hostHint: 'Type just `@` (apex) or just `_osm` (subdomain). GoDaddy appends the domain automatically.',
    ttlHint: 'GoDaddy\'s TTL dropdown shows hours/days. Pick **Custom (seconds)** → enter `600`.',
    caveat: 'If you previously had a parking page, GoDaddy may have left an A record at `@` pointing to its own IP (`184.168.x.x`) — delete that one first, otherwise your new record can be silently overridden.',
  },
  {
    id: "namecheap",
    name: "Namecheap",
    steps: [
      "Sign in at **namecheap.com** and open **Account → Domain List**.",
      "Click **Manage** next to your domain.",
      "Open the **Advanced DNS** tab.",
      "Under **Host Records**, click **Add New Record** for each row below.",
      "Each row has a green ✓ — click it to save that specific row.",
    ],
    hostHint: 'Type just `@` or `_osm` in the **Host** field. Namecheap auto-appends the domain.',
    ttlHint: 'Pick **Automatic** for fastest propagation, or **Custom** → `600`.',
    caveat: 'If Namecheap\'s default **URL Redirect** record on `@` is present, delete it first. It intercepts traffic before our A record can serve.',
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    steps: [
      "Sign in at **dash.cloudflare.com**.",
      "Click your domain → **DNS** in the left sidebar.",
      "Click **Add record**.",
      "For each row below, set **Type**, **Name**, and **IPv4 address** (or **Content** for TXT). Click **Save**.",
      "**Important:** set **Proxy status** to **DNS only (grey cloud)** for the A records. Orange-cloud proxying breaks our TLS termination.",
    ],
    hostHint: 'Type just `@` or `_osm` in the **Name** field. Cloudflare previews the full FQDN underneath.',
    ttlHint: 'Use **Auto** — Cloudflare smart-caches our records correctly.',
    caveat: 'If the cloud icon stays orange (proxied) after saving, click it to toggle to grey before continuing. Otherwise visitors hit Cloudflare\'s edge, not ours.',
  },
  {
    id: "hostinger",
    name: "Hostinger",
    steps: [
      "Sign in at **hpanel.hostinger.com**.",
      "Click **Domains** in the sidebar, then click your domain.",
      "Click **DNS / Nameservers** in the left menu.",
      "Click **Add new record** for each row below.",
      "Click **Add record** to save each. There is no bulk save.",
    ],
    hostHint: 'Type just `@` for apex, `_osm` for the verification record. Hostinger appends the domain automatically.',
    ttlHint: 'The TTL field accepts seconds directly — enter `600`.',
    caveat: 'Hostinger\'s default A record on `@` points to their parking page (`84.32.x.x`). Delete it first.',
  },
  {
    id: "squarespace",
    name: "Squarespace",
    steps: [
      "Sign in at **account.squarespace.com → Domains**.",
      "Click your domain → **DNS** (under Advanced Settings).",
      "Scroll to **Custom Records**.",
      "Click **Add Custom Record** (not Add Preset) for each row below.",
      "Set **Host**, **Type**, and **Data** (for A) or **Text value** (for TXT). Click **Add**.",
    ],
    hostHint: 'Squarespace uses **Host** for the name. Type just `@` or `_osm`.',
    ttlHint: 'Squarespace does not expose TTL — defaults to ~1 hour. Records still take effect.',
    caveat: 'If your account still shows Google Domains, follow Squarespace\'s migration prompt first. Domain admin moved in 2023.',
  },
  {
    id: "porkbun",
    name: "Porkbun",
    steps: [
      "Sign in at **porkbun.com** and open **Domain Management**.",
      "Click **Details** next to your domain.",
      "Click **DNS Records**.",
      "For each row below, fill **Type**, **Host**, and **Answer**, then click **Add**.",
      "Porkbun saves immediately on Add — there is no separate Save button.",
    ],
    hostHint: 'In the **Host** field, leave it **completely empty** for the apex (NOT `@`). Type `_osm` for the verification record.',
    ttlHint: 'TTL defaults to 600 — leave as is.',
    caveat: 'Porkbun is one of the few registrars where the apex Host must be left blank. Typing `@` creates a literal "@.your-domain.com" record. Easy to miss.',
  },
];

export function DnsRegistrarGuide({ domain }: { domain: Domain }) {
  const [active, setActive] = useState<string>(REGISTRARS[0]!.id);
  const tab = useMemo(() => REGISTRARS.find((r) => r.id === active)!, [active]);

  const records = [
    {
      id: "a-apex",
      type: "A" as const,
      name: "@",
      data: SERVER_IPV4,
      ttl: "600",
      title: "Send the domain itself to osmRouter",
      caption: "When someone visits your-domain.com, this record points them at our edge.",
    },
    {
      id: "a-wildcard",
      type: "A" as const,
      name: "*",
      data: SERVER_IPV4,
      ttl: "600",
      title: "Route every subdomain too",
      caption: "Lets you bind app.your-domain.com, api.your-domain.com, anything.your-domain.com — without adding more DNS records later.",
    },
    {
      id: "txt-verify",
      type: "TXT" as const,
      name: "_osm",
      data: domain.txt_token,
      ttl: "600",
      title: "Prove you own the domain",
      caption: "We check this once. After verification it's just a harmless marker — leave it in place.",
    },
  ];

  return (
    <div className="text-[var(--text)]">
      {/* Records to add — primary content, most prominent */}
      <SectionHeading
        eyebrow="Step 1"
        title="Add these three records"
        subtitle={
          <>Copy each value into your registrar&apos;s DNS panel. Same three records, no matter which registrar you use.</>
        }
      />
      <div className="flex flex-col gap-3 mb-7">
        {records.map((r, i) => (
          <RecordCard key={r.id} index={i + 1} {...r} />
        ))}
      </div>

      {/* How to add them — secondary, per-registrar */}
      <SectionHeading
        eyebrow="Step 2"
        title="Open your registrar"
        subtitle="Pick yours below for click-by-click instructions."
      />
      <div className="flex flex-wrap gap-1.5 mb-4">
        {REGISTRARS.map((r) => (
          <button
            key={r.id}
            onClick={() => setActive(r.id)}
            className={`px-3 py-2 text-[13px] font-medium rounded-md border transition-all ${
              active === r.id
                ? "bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm"
                : "bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--border-strong)]"
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      <RegistrarPanel tab={tab} />

      {/* Final step */}
      <SectionHeading
        eyebrow="Step 3"
        title="Come back and click Verify"
        subtitle="Propagation is usually under 2 minutes. We re-check every 60 seconds automatically; the Verify button below forces an immediate check."
      />
    </div>
  );
}

// ─── records ────────────────────────────────────────────────────────────────

function RecordCard({
  index, type, name, data, ttl, title, caption,
}: {
  index: number;
  type: "A" | "TXT";
  name: string;
  data: string;
  ttl: string;
  title: string;
  caption: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-soft)]">
        <span className="w-6 h-6 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[12px] font-semibold flex items-center justify-center">
          {index}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] text-[var(--text)] font-medium">{title}</div>
          <div className="text-[12px] text-[var(--text-muted)] leading-[1.4]">{caption}</div>
        </div>
        <TypePill type={type} />
      </div>
      <div className="grid grid-cols-3 gap-px bg-[var(--border)]">
        <Field label="Name" value={name} mono />
        <Field label="Value" value={data} mono />
        <Field label="TTL (seconds)" value={ttl} />
      </div>
    </div>
  );
}

function TypePill({ type }: { type: "A" | "TXT" }) {
  const tone =
    type === "A"
      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
      : "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]";
  return (
    <span className={`px-2.5 py-1 text-[11px] font-bold mono tracking-[0.06em] rounded ${tone}`}>
      {type}
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div className="bg-[var(--bg-panel)] px-3.5 py-2.5">
      <div className="text-[10.5px] mono uppercase tracking-[0.08em] text-[var(--text-faint)] mb-1">{label}</div>
      <button
        onClick={onCopy}
        className={`group w-full text-left flex items-center gap-2 ${mono ? "mono" : ""} text-[13px] text-[var(--text)] hover:text-[var(--accent)]`}
        title={`Copy ${label}`}
      >
        <span className="truncate flex-1">{value}</span>
        <span className={`text-[10px] mono uppercase ${copied ? "text-[var(--success)]" : "text-[var(--text-faint)] opacity-0 group-hover:opacity-100"} transition-opacity`}>
          {copied ? "copied" : "copy"}
        </span>
      </button>
    </div>
  );
}

// ─── registrar panel ────────────────────────────────────────────────────────

function RegistrarPanel({ tab }: { tab: Registrar }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden mb-7">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-soft)]">
        <div className="text-[10.5px] mono uppercase tracking-[0.08em] text-[var(--text-faint)] mb-0.5">Steps for</div>
        <div className="text-[14.5px] font-semibold text-[var(--text)]">{tab.name}</div>
      </div>

      {/* Numbered steps */}
      <ol className="m-0 p-0 list-none">
        {tab.steps.map((s, i) => (
          <li
            key={i}
            className="flex gap-3.5 px-4 py-3 border-b border-[var(--border)] last:border-0"
          >
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--bg-elev)] border border-[var(--border-strong)] text-[var(--text)] text-[11.5px] font-semibold flex items-center justify-center mt-px">
              {i + 1}
            </span>
            <span
              className="text-[13px] text-[var(--text)] leading-[1.55]"
              dangerouslySetInnerHTML={{ __html: formatStep(s) }}
            />
          </li>
        ))}
      </ol>

      {/* Field conventions */}
      <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-soft)] grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] leading-[1.55]">
        <HintRow icon="Name" body={tab.hostHint} />
        {tab.ttlHint && <HintRow icon="TTL" body={tab.ttlHint} />}
      </div>

      {/* Watch out */}
      {tab.caveat && (
        <div className="px-4 py-3 border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] flex gap-3">
          <span className="text-[var(--warn)] text-[14px] leading-none mt-0.5">⚠</span>
          <span
            className="text-[12.5px] text-[var(--text)] leading-[1.55]"
            dangerouslySetInnerHTML={{ __html: `<b class="text-[var(--warn)]">Watch out</b> — ${formatStep(tab.caveat)}` }}
          />
        </div>
      )}
    </div>
  );
}

function HintRow({ icon, body }: { icon: string; body: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-[10.5px] mono uppercase tracking-[0.08em] text-[var(--text-faint)] pt-[3px] min-w-[40px]">{icon}</span>
      <span
        className="text-[12.5px] text-[var(--text-muted)] leading-[1.55] flex-1"
        dangerouslySetInnerHTML={{ __html: formatStep(body) }}
      />
    </div>
  );
}

// ─── section heading ────────────────────────────────────────────────────────

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <div className="text-[10.5px] mono uppercase tracking-[0.1em] text-[var(--accent)] mb-1">{eyebrow}</div>
      <div className="text-[15px] font-semibold text-[var(--text)] leading-tight">{title}</div>
      {subtitle && <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-[1.55]">{subtitle}</div>}
    </div>
  );
}

// ─── tiny markdown ──────────────────────────────────────────────────────────

function formatStep(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<span class="mono px-1 py-0.5 rounded bg-[var(--bg-elev)] text-[var(--text)] text-[12px]">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<b class="text-[var(--text)]">$1</b>');
}
