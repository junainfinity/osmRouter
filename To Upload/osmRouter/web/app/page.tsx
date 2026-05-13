"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wordmark, IconArrowR, IconCheck, IconGlobe, IconLock, IconBolt, IconShield, IconKey, IconChart, IconDownload } from "@/components/icons";

export default function Landing() {
  return (
    <div className="bg-[var(--bg)] text-[var(--text)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--bg)]/80 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="max-w-[1200px] mx-auto px-8 py-3.5 flex items-center gap-7">
          <Wordmark size={15} />
          <nav className="flex gap-6 ml-4">
            {["Product", "Docs", "Pricing", "Changelog"].map((l) => (
              <a key={l} href="#" className="text-[13.5px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">{l}</a>
            ))}
          </nav>
          <div className="ml-auto flex gap-2 items-center">
            <Link href="/login"><Button variant="ghost" size="sm">Sign in</Button></Link>
            <Link href="/signup"><Button variant="primary" size="sm" iconRight={<IconArrowR size={13} />}>Start free</Button></Link>
          </div>
        </div>
      </header>

      <section className="max-w-[1100px] mx-auto px-8 pt-22 pb-14 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[var(--bg-panel)] border border-[var(--border)] rounded-full text-[12.5px] text-[var(--text-muted)] mb-7">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
          <span>v2.4 — Static IP edges & bring-your-own-domain</span>
          <IconArrowR size={12} />
        </div>
        <h1 className="text-6xl font-semibold tracking-[-0.04em] leading-[1.04] m-0 text-[var(--text)]">
          Expose any local port.<br />
          <span className="text-[var(--text-muted)]">Behind your own domain.</span>
        </h1>
        <p className="text-[17.5px] text-[var(--text-muted)] max-w-[580px] mx-auto mt-5 leading-[1.55]">
          osmRouter pins a public hostname to a local process on your machine — through a persistent reverse tunnel
          that survives reboots, IP changes, and CGNAT.
        </p>
        <div className="flex gap-2.5 justify-center mt-8">
          <Link href="/signup">
            <Button variant="primary" size="lg" iconRight={<IconArrowR size={14} />}>Start for free</Button>
          </Link>
          <Button variant="secondary" size="lg" icon={<IconDownload size={14} />}>Download client</Button>
        </div>
        <div className="mt-4 text-[12.5px] text-[var(--text-faint)]">
          No credit card · Free tier includes 1 domain, 1 device · 10 GB/mo
        </div>

        <div className="mt-14 max-w-[720px] mx-auto bg-[var(--bg-panel)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] overflow-hidden text-left">
          <div className="px-3.5 py-2.5 border-b border-[var(--border)] flex items-center gap-2 bg-[var(--bg-soft)]">
            <span className="flex gap-1.5">
              <span className="w-[11px] h-[11px] rounded-full bg-[#ff5f57]" />
              <span className="w-[11px] h-[11px] rounded-full bg-[#febc2e]" />
              <span className="w-[11px] h-[11px] rounded-full bg-[#28c840]" />
            </span>
            <span className="mono text-[11.5px] text-[var(--text-muted)] ml-2">~ / api.acme.co</span>
          </div>
          <div className="px-6 py-5 mono text-[13px] leading-[1.7]">
            <div><span className="text-[var(--accent)]">$</span> osmrouter expose <span className="text-[var(--text)]">3000</span> <span className="text-[var(--text-muted)]">--domain api.acme.co</span></div>
            <div className="text-[var(--text-muted)] mt-1.5">→ resolving DNS…</div>
            <div className="text-[var(--text-muted)]">→ binding mac-studio-01 to api.acme.co</div>
            <div className="text-[var(--success)] mt-1.5">✓ tunnel established · edge=fra1 · 42ms</div>
            <div className="mt-3 text-[var(--text)]">https://api.acme.co  →  localhost:3000</div>
          </div>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-8 py-8">
        <div className="grid grid-cols-3 gap-5">
          {[
            { icon: <IconGlobe size={18} />, title: "Your domain, your control", body: "Point a CNAME at osmRouter once and forget about it. Subdomains provision instantly without touching your registrar again." },
            { icon: <IconLock size={18} />, title: "Device-locked tunnels", body: "Each domain binds to one authenticated device. Stolen laptop? Revoke the token and every tunnel terminates in milliseconds." },
            { icon: <IconBolt size={18} />, title: "Edge-routed traffic", body: "Connections terminate at the nearest of 14 edge nodes, then ride a persistent QUIC tunnel back to the device." },
            { icon: <IconShield size={18} />, title: "mTLS by default", body: "Mutual TLS between every client and edge. No shared secrets, no rotating certs, no plaintext anywhere on the path." },
            { icon: <IconKey size={18} />, title: "Scoped API keys", body: "Programmatic access with per-domain scopes. Generate, rotate, and revoke from the dashboard or CLI." },
            { icon: <IconChart size={18} />, title: "Per-request telemetry", body: "Every request gets latency, edge node, and device-side response time. Search 30 days of logs in milliseconds." },
          ].map((f, i) => (
            <Card key={i} hover className="p-[22px]">
              <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center mb-4">{f.icon}</div>
              <div className="text-[14.5px] font-semibold text-[var(--text)] mb-1.5 tracking-tight">{f.title}</div>
              <div className="text-[13px] text-[var(--text-muted)] leading-[1.55]">{f.body}</div>
            </Card>
          ))}
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-8 py-8">
        <Card className="p-0 grid grid-cols-4">
          {[
            { v: "14", l: "Edge regions" },
            { v: "42ms", l: "Median edge latency" },
            { v: "99.98%", l: "Tunnel uptime" },
            { v: "128 PB", l: "Routed in 2025" },
          ].map((s, i) => (
            <div key={i} className={`py-7 px-6 ${i < 3 ? "border-r border-[var(--border)]" : ""}`}>
              <div className="num text-[30px] font-medium tracking-[-0.025em] text-[var(--text)]">{s.v}</div>
              <div className="text-[12.5px] text-[var(--text-muted)] mt-1">{s.l}</div>
            </div>
          ))}
        </Card>
      </section>

      <section className="max-w-[1100px] mx-auto px-8 py-16 text-center">
        <h2 className="text-[36px] font-semibold tracking-[-0.025em] m-0 mb-3">Priced for solo devs and platform teams.</h2>
        <p className="text-[15px] text-[var(--text-muted)] m-0 mb-10">Two plans. No seat tax. Cancel anytime.</p>
        <div className="grid grid-cols-2 gap-4 text-left">
          <PricingCard tier="Free" price="$0" features={["1 custom domain", "1 connected device", "10 GB/mo bandwidth", "Community support"]} />
          <PricingCard tier="Pro" price="$12" featured features={["Unlimited domains", "10 connected devices", "500 GB/mo bandwidth", "Static edge IPs", "Priority support"]} />
        </div>
      </section>

      <footer className="border-t border-[var(--border)] py-8 text-center text-[12.5px] text-[var(--text-faint)]">
        <div className="mb-2 flex justify-center"><Wordmark size={13} /></div>
        © 2026 osmRouter · All systems normal · <span className="text-[var(--success)]">●</span> edge: fra1, iad1, sfo1
      </footer>
    </div>
  );
}

function PricingCard({ tier, price, features, featured }: { tier: string; price: string; features: string[]; featured?: boolean }) {
  return (
    <Card className={`p-7 relative ${featured ? "border-[var(--accent-line)]" : ""}`}>
      {featured && <div className="absolute top-4 right-4"><Badge tone="accent">Recommended</Badge></div>}
      <div className="text-[13px] text-[var(--text-muted)] uppercase tracking-[0.08em] mono">{tier}</div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="num text-[44px] font-medium tracking-[-0.03em]">{price}</span>
        <span className="text-sm text-[var(--text-muted)]">/ month</span>
      </div>
      <ul className="list-none p-0 my-6 flex flex-col gap-2.5">
        {features.map((f, i) => (
          <li key={i} className="flex gap-2.5 text-[13.5px] text-[var(--text)]">
            <IconCheck size={14} className="text-[var(--accent)] mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <Link href="/signup">
        <Button variant={featured ? "primary" : "secondary"} full>Get started</Button>
      </Link>
    </Card>
  );
}
