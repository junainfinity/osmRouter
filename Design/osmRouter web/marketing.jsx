// Marketing landing page

const Marketing = ({ onSignIn, onSignUp }) => {
  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }}>
      {/* Nav */}
      <header style={{ position: 'sticky', top: 0, zIndex: 30, background: 'color-mix(in oklab, var(--bg) 80%, transparent)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 28 }}>
          <Wordmark size={15}/>
          <nav style={{ display: 'flex', gap: 22, marginLeft: 16 }}>
            {['Product', 'Docs', 'Pricing', 'Changelog'].map((l) => (
              <a key={l} href="#" style={{ fontSize: 13.5, color: 'var(--text-muted)', cursor: 'pointer' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >{l}</a>
            ))}
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="ghost" size="sm" onClick={onSignIn}>Sign in</Button>
            <Button variant="primary" size="sm" iconRight={<IconArrowR size={13}/>} onClick={onSignUp}>Start free</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '88px 32px 56px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 28 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' }}/>
          <span>v2.4 — Static IP edges & bring-your-own-domain</span>
          <IconArrowR size={12}/>
        </div>
        <h1 style={{ fontSize: 64, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.04, margin: 0, color: 'var(--text)' }}>
          Expose any local port.<br/>
          <span style={{ color: 'var(--text-muted)' }}>Behind your own domain.</span>
        </h1>
        <p style={{ fontSize: 17.5, color: 'var(--text-muted)', maxWidth: 580, margin: '20px auto 0', lineHeight: 1.55 }}>
          osmRouter pins a public hostname to a local process on your machine — through a persistent reverse tunnel that survives reboots, IP changes, and CGNAT.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 32 }}>
          <Button variant="primary" size="lg" iconRight={<IconArrowR size={14}/>} onClick={onSignUp}>Start for free</Button>
          <Button variant="secondary" size="lg" icon={<IconDownload size={14}/>}>Download client</Button>
        </div>
        <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--text-faint)' }}>
          No credit card · Free tier includes 1 domain, 1 device · 10 GB/mo
        </div>

        {/* CLI mock */}
        <div style={{ marginTop: 56, maxWidth: 720, margin: '56px auto 0', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', textAlign: 'left' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-soft)' }}>
            <div style={{ display: 'flex', gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: 999, background: '#ff5f57' }}/>
              <span style={{ width: 11, height: 11, borderRadius: 999, background: '#febc2e' }}/>
              <span style={{ width: 11, height: 11, borderRadius: 999, background: '#28c840' }}/>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 8 }}>~ / api.acme.co</span>
          </div>
          <div style={{ padding: '20px 24px', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7 }}>
            <div><span style={{ color: 'var(--accent)' }}>$</span> osmrouter expose <span style={{ color: 'var(--text)' }}>3000</span> <span style={{ color: 'var(--text-muted)' }}>--domain api.acme.co</span></div>
            <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>→ resolving DNS…</div>
            <div style={{ color: 'var(--text-muted)' }}>→ binding mac-studio-01 to api.acme.co</div>
            <div style={{ color: 'var(--success)', marginTop: 6 }}>✓ tunnel established · edge=fra1 · 42ms</div>
            <div style={{ marginTop: 12, color: 'var(--text)' }}>https://api.acme.co  →  localhost:3000</div>
            <div style={{ marginTop: 12, display: 'inline-block', width: 8, height: 14, background: 'var(--accent)', verticalAlign: 'middle', animation: 'pulse 1s steps(2) infinite' }}/>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 32px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            { icon: <IconGlobe size={18}/>, title: 'Your domain, your control', body: 'Point a CNAME at osmRouter once and forget about it. Subdomains provision instantly without touching your registrar again.' },
            { icon: <IconLock size={18}/>, title: 'Device-locked tunnels', body: 'Each domain binds to one authenticated device. Stolen laptop? Revoke the token and every tunnel terminates in milliseconds.' },
            { icon: <IconBolt size={18}/>, title: 'Edge-routed traffic', body: 'Connections terminate at the nearest of 14 edge nodes, then ride a persistent QUIC tunnel back to the device.' },
            { icon: <IconShield size={18}/>, title: 'mTLS by default', body: 'Mutual TLS between every client and edge. No shared secrets, no rotating certs, no plaintext anywhere on the path.' },
            { icon: <IconKey size={18}/>, title: 'Scoped API keys', body: 'Programmatic access with per-domain scopes. Generate, rotate, and revoke from the dashboard or CLI.' },
            { icon: <IconChart size={18}/>, title: 'Per-request telemetry', body: 'Every request gets latency, edge node, and device-side response time. Search 30 days of logs in milliseconds.' },
          ].map((f, i) => (
            <Card key={i} padding={22} hover>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>{f.icon}</div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em' }}>{f.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{f.body}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* Stats strip */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '32px' }}>
        <Card padding={0} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {[
            { v: '14', l: 'Edge regions' },
            { v: '42ms', l: 'Median edge latency' },
            { v: '99.98%', l: 'Tunnel uptime' },
            { v: '128 PB', l: 'Routed in 2025' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '28px 24px', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
              <div className="num" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.025em', color: 'var(--text)' }}>{s.v}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </Card>
      </section>

      {/* Pricing teaser */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 32px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.025em', margin: '0 0 12px' }}>Priced for solo devs and platform teams.</h2>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 40px' }}>Two plans. No seat tax. Cancel anytime.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, textAlign: 'left' }}>
          <PricingCard tier="Free" price="$0" features={['1 custom domain', '1 connected device', '10 GB/mo bandwidth', 'Community support']}/>
          <PricingCard tier="Pro" price="$12" featured features={['Unlimited domains', '10 connected devices', '500 GB/mo bandwidth', 'Static edge IPs', 'Priority support']}/>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '32px', textAlign: 'center', fontSize: 12.5, color: 'var(--text-faint)' }}>
        <div style={{ marginBottom: 8 }}><Wordmark size={13}/></div>
        © 2026 osmRouter · All systems normal · <span style={{ color: 'var(--success)' }}>●</span> edge: fra1, iad1, sfo1
      </footer>
    </div>
  );
};

const PricingCard = ({ tier, price, features, featured }) => (
  <Card padding={28} style={{ border: featured ? '1px solid var(--accent-line)' : '1px solid var(--border)', position: 'relative' }}>
    {featured && <Badge tone="accent" style={{ position: 'absolute', top: 16, right: 16 }}>Recommended</Badge>}
    <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>{tier}</div>
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span className="num" style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.03em' }}>{price}</span>
      <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/ month</span>
    </div>
    <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {features.map((f, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: 'var(--text)' }}>
          <IconCheck size={14} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }}/>
          {f}
        </li>
      ))}
    </ul>
    <Button variant={featured ? 'primary' : 'secondary'} full>Get started</Button>
  </Card>
);

Object.assign(window, { Marketing });
