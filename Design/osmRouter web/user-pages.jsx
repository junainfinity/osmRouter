// User-side pages: Dashboard, Domains, Devices, Billing, Settings

// ============ DASHBOARD ============
const UserDashboard = ({ navigate }) => {
  const sparkData = React.useMemo(() => Array.from({ length: 30 }, () => 20 + Math.random() * 80), []);
  const activities = [
    { t: '2m ago', type: 'DNS verified', ent: 'api.acme.co', status: 'success' },
    { t: '14m ago', type: 'Device connected', ent: 'mac-studio-01', status: 'success' },
    { t: '1h ago', type: 'Tunnel established', ent: 'staging.acme.co → :8080', status: 'success' },
    { t: '3h ago', type: 'Subdomain added', ent: 'docs.acme.co', status: 'success' },
    { t: '5h ago', type: 'Device disconnected', ent: 'thinkpad-x1', status: 'warn' },
    { t: '8h ago', type: 'DNS verification', ent: 'preview.acme.co', status: 'warn' },
    { t: '1d ago', type: 'API key rotated', ent: 'ci-deploy', status: 'neutral' },
    { t: '2d ago', type: 'Device revoked', ent: 'old-laptop', status: 'danger' },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Real-time overview of your tunnels, devices, and traffic."
        action={<><Button variant="secondary" icon={<IconDownload size={13}/>}>Download client</Button><Button variant="primary" icon={<IconPlus size={13}/>} onClick={() => navigate('domains')}>Add domain</Button></>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
        <Stat label="Active tunnels" value="7" suffix="/ 10" delta="+2" hint="2 added this week"/>
        <Stat label="Bandwidth · 30d" value="312" suffix="GB" delta="+18%" hint="of 500 GB monthly quota"/>
        <Stat label="Domains" value="14" delta="+1" hint="3 subdomains pending"/>
        <Stat label="Connected devices" value="4" suffix="/ 10" hint="2 idle · 2 routing"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card padding={0}>
          <div style={{ padding: '20px 22px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Traffic · last 30 days</div>
              <div className="num" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.025em', marginTop: 6 }}>312.4 GB</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['24h', '7d', '30d'].map((t) => (
                <button key={t} style={{
                  padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                  background: t === '30d' ? 'var(--bg-soft)' : 'transparent',
                  color: t === '30d' ? 'var(--text)' : 'var(--text-muted)',
                  border: t === '30d' ? '1px solid var(--border)' : '1px solid transparent',
                }}>{t}</button>
              ))}
            </div>
          </div>
          <TrafficChart data={sparkData}/>
        </Card>

        <Card padding={22}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Top routes</div>
            <a style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => navigate('domains')}>View all</a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { d: 'api.acme.co', bw: 142, pct: 78 },
              { d: 'staging.acme.co', bw: 84, pct: 46 },
              { d: 'docs.acme.co', bw: 53, pct: 28 },
              { d: 'webhook.acme.co', bw: 28, pct: 15 },
            ].map((r, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--text)' }}>{r.d}</span>
                  <span className="num" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.bw} GB</span>
                </div>
                <Progress value={r.pct} max={100}/>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SectionHeader title="Activity" subtitle="Most recent events across your workspace" style={{ marginTop: 28 }}/>
      <Card padding={0}>
        {activities.map((a, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '90px 1fr auto auto', gap: 16, alignItems: 'center',
            padding: '14px 20px', borderBottom: i < activities.length - 1 ? '1px solid var(--border)' : 0,
          }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>{a.t}</span>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>{a.type}</div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{a.ent}</div>
            </div>
            <Badge tone={a.status} dot={a.status === 'success'}>{a.status === 'success' ? 'OK' : a.status === 'warn' ? 'Warning' : a.status === 'danger' ? 'Revoked' : 'Info'}</Badge>
            <button style={{ background: 'transparent', border: 0, color: 'var(--text-faint)', cursor: 'pointer', padding: 4 }}><IconChevR size={14}/></button>
          </div>
        ))}
      </Card>
    </>
  );
};

const TrafficChart = ({ data }) => {
  const w = 800, h = 180, pad = 22;
  const max = Math.max(...data) * 1.15;
  const points = data.map((v, i) => [pad + (i / (data.length - 1)) * (w - pad * 2), h - pad - (v / max) * (h - pad * 2)]);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`;
  return (
    <div style={{ padding: '12px 22px 22px' }}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22"/>
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((y, i) => (
          <line key={i} x1={pad} y1={pad + (h - pad * 2) * y} x2={w - pad} y2={pad + (h - pad * 2) * y} stroke="var(--border)" strokeDasharray="2 3"/>
        ))}
        <path d={area} fill="url(#grad)"/>
        <path d={path} stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
        {points.filter((_, i) => i % 5 === 0).map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="var(--bg-panel)" stroke="var(--accent)" strokeWidth="1.4"/>
        ))}
      </svg>
    </div>
  );
};

// ============ DOMAINS ============
const initialDomains = [
  { id: 1, name: 'api.acme.co', status: 'active', device: 'mac-studio-01', port: 3000, traffic: 142.3 },
  { id: 2, name: 'staging.acme.co', status: 'active', device: 'mac-studio-01', port: 8080, traffic: 84.1 },
  { id: 3, name: 'docs.acme.co', status: 'active', device: 'mbp-m3-14', port: 4000, traffic: 53.0 },
  { id: 4, name: 'webhook.acme.co', status: 'active', device: 'mbp-m3-14', port: 9090, traffic: 28.4 },
  { id: 5, name: 'preview.acme.co', status: 'verifying', device: '—', port: null, traffic: 0 },
  { id: 6, name: 'admin.acme.co', status: 'paused', device: 'thinkpad-x1', port: 5173, traffic: 12.8 },
];

const Domains = ({ navigate }) => {
  const [domains, setDomains] = React.useState(initialDomains);
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [adding, setAdding] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(null);
  const toast = useToast();

  const filtered = domains.filter((d) => {
    if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter !== 'all' && d.status !== filter) return false;
    return true;
  });

  const tabs = [
    { value: 'all', label: 'All', count: domains.length },
    { value: 'active', label: 'Active', count: domains.filter((d) => d.status === 'active').length },
    { value: 'verifying', label: 'Verifying', count: domains.filter((d) => d.status === 'verifying').length },
    { value: 'paused', label: 'Paused', count: domains.filter((d) => d.status === 'paused').length },
  ];

  const onResetLock = (d) => {
    setDomains((ds) => ds.map((x) => x.id === d.id ? { ...x, device: '—', status: 'paused', port: null } : x));
    toast({ title: 'Device lock cleared', body: `${d.name} is now available in all clients`, tone: 'success' });
    setConfirmReset(null);
  };

  return (
    <>
      <PageHeader
        title="Domains"
        subtitle="Custom domains routed through osmRouter's reverse proxy."
        action={<Button variant="primary" icon={<IconPlus size={13}/>} onClick={() => setAdding(true)}>Add domain</Button>}
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <Input icon={<IconSearch size={14}/>} placeholder="Search domains…" value={q} onChange={(e) => setQ(e.target.value)} size="sm"/>
        </div>
        <Button variant="secondary" size="sm" icon={<IconFilter size={13}/>}>Filter</Button>
        <div style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-muted)' }}>{filtered.length} of {domains.length}</div>
      </div>

      <Tabs items={tabs} value={filter} onChange={setFilter}/>

      <Table
        columns={[
          { key: 'name', label: 'Domain', render: (r) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <DomainStatusIcon status={r.status}/>
              <div>
                <div className="mono" style={{ fontSize: 13.5, color: 'var(--text)' }}>{r.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                  {r.status === 'active' ? 'Routing' : r.status === 'verifying' ? 'Waiting for DNS' : 'Idle'}
                </div>
              </div>
            </div>
          ) },
          { key: 'status', label: 'Status', width: '120px', render: (r) => (
            <Badge tone={r.status === 'active' ? 'success' : r.status === 'verifying' ? 'warn' : 'neutral'} dot={r.status === 'active'}>
              {r.status === 'active' ? 'Active' : r.status === 'verifying' ? 'Verifying' : 'Paused'}
            </Badge>
          ) },
          { key: 'device', label: 'Bound device', width: '180px', render: (r) => (
            <span className="mono" style={{ fontSize: 12.5, color: r.device === '—' ? 'var(--text-faint)' : 'var(--text)' }}>{r.device}</span>
          ) },
          { key: 'port', label: 'Local port', width: '90px', align: 'right', render: (r) => (
            <span className="mono" style={{ fontSize: 12.5, color: r.port ? 'var(--text)' : 'var(--text-faint)' }}>{r.port ? `:${r.port}` : '—'}</span>
          ) },
          { key: 'traffic', label: '30d traffic', width: '110px', align: 'right', render: (r) => (
            <span className="num" style={{ fontSize: 12.5, color: 'var(--text)' }}>{r.traffic.toFixed(1)} GB</span>
          ) },
          { key: 'actions', label: '', width: '40px', render: (r) => (
            <Menu align="right" trigger={<button style={{ background: 'transparent', border: 0, padding: 6, cursor: 'pointer', color: 'var(--text-faint)', borderRadius: 6 }}><IconDots size={14}/></button>}
              items={[
                { icon: <IconList size={13}/>, label: 'Manage subdomains' },
                { icon: <IconGlobe size={13}/>, label: 'View DNS settings' },
                { icon: <IconRefresh size={13}/>, label: 'Reset device lock', onClick: () => setConfirmReset(r), danger: true },
                { divider: true },
                { icon: <IconTrash size={13}/>, label: 'Delete', danger: true },
              ]}
            />
          ) },
        ]}
        rows={filtered}
        empty={q ? `No domains match "${q}"` : 'No domains yet'}
      />

      {adding && <AddDomainFlow onClose={() => setAdding(false)} onAdded={(d) => { setDomains((ds) => [...ds, d]); setAdding(false); toast({ title: 'Domain added', body: `${d.name} is verifying`, tone: 'success' }); }}/>}

      <Modal
        open={!!confirmReset}
        onClose={() => setConfirmReset(null)}
        title="Reset device lock?"
        danger
        footer={<><Button variant="ghost" onClick={() => setConfirmReset(null)}>Cancel</Button><Button danger onClick={() => onResetLock(confirmReset)}>Reset lock</Button></>}
      >
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55 }}>
          This will <strong>sever the active tunnel</strong> for <span className="mono">{confirmReset?.name}</span> on <span className="mono">{confirmReset?.device}</span> and clear the device binding.
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.55 }}>
          The domain will become available in the dropdown of every authenticated client. You'll need to re-bind it from a device before traffic resumes.
        </div>
      </Modal>
    </>
  );
};

const DomainStatusIcon = ({ status }) => {
  const colors = { active: 'var(--success)', verifying: 'var(--warn)', paused: 'var(--text-faint)' };
  return (
    <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--bg-soft)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <IconGlobe size={14} style={{ color: colors[status] }}/>
    </div>
  );
};

const AddDomainFlow = ({ onClose, onAdded }) => {
  const [step, setStep] = React.useState(0);
  const [domain, setDomain] = React.useState('');
  const [registrar, setRegistrar] = React.useState(null);
  const [propagated, setPropagated] = React.useState(0);

  const detectRegistrar = (d) => {
    const r = ['Cloudflare', 'Namecheap', 'Route 53', 'Google Domains', 'GoDaddy'];
    return r[d.length % r.length];
  };

  const goToRecords = () => {
    setRegistrar(detectRegistrar(domain));
    setStep(1);
  };

  React.useEffect(() => {
    if (step !== 2) return;
    setPropagated(0);
    const i = setInterval(() => {
      setPropagated((p) => {
        if (p >= 100) { clearInterval(i); return 100; }
        return Math.min(100, p + 8 + Math.random() * 5);
      });
    }, 320);
    return () => clearInterval(i);
  }, [step]);

  React.useEffect(() => {
    if (propagated >= 100 && step === 2) setTimeout(() => setStep(3), 600);
  }, [propagated]);

  return (
    <Modal open={true} onClose={onClose} title="Add a new domain" width={560}
      footer={
        step === 0 ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!domain.includes('.')} onClick={goToRecords}>Detect & continue</Button></>
        : step === 1 ? <><Button variant="ghost" onClick={() => setStep(0)}>Back</Button><Button variant="primary" onClick={() => setStep(2)}>I've added the records</Button></>
        : step === 2 ? <Button variant="ghost" onClick={onClose}>Continue in background</Button>
        : <Button variant="primary" onClick={() => onAdded({ id: Date.now(), name: domain, status: 'verifying', device: '—', port: null, traffic: 0 })}>Done</Button>
      }
    >
      <StepIndicator steps={['Domain', 'DNS records', 'Verify', 'Done']} active={step}/>

      {step === 0 && (
        <div className="fade-in">
          <Field label="Domain to expose" hint="Apex or subdomain — we'll detect your registrar">
            <Input prefix="https://" placeholder="api.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} autoFocus/>
          </Field>
          <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>Tip</strong> — once your apex is verified, you can provision subdomains instantly without touching DNS again.
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="fade-in">
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Badge tone="accent" dot>Detected: {registrar}</Badge>
            <span style={{ color: 'var(--text-muted)' }}>· Add the following records at your registrar</span>
          </div>
          <DnsRow type="CNAME" name={domain.startsWith('www.') ? '@' : domain.split('.')[0]} value="edge.osmrouter.dev"/>
          <DnsRow type="TXT" name={`_osmrouter.${domain.split('.').slice(0, -2).join('.') || '@'}`} value="osm-verify=k7d9j2sn3hf8wf3"/>
          <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <IconClock size={13} style={{ marginTop: 2, flexShrink: 0 }}/>
            <span>DNS changes typically propagate in 1–10 minutes. We'll keep checking.</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="fade-in" style={{ padding: '12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '20px 0' }}>
            <PollingDots/>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 18 }}>Polling global DNS resolvers…</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{domain}</div>
          </div>
          <Progress value={propagated} max={100}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span>Checking 12 resolvers worldwide</span>
            <span className="num">{Math.round(propagated)}%</span>
          </div>
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {['1.1.1.1', '8.8.8.8', '9.9.9.9', '208.67.222.222'].map((r, i) => (
              <div key={i} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontFamily: 'var(--font-mono)', color: propagated > (i + 1) * 22 ? 'var(--success)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {propagated > (i + 1) * 22 ? <IconCheck size={11}/> : <Spinner size={10}/>}
                {r}
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="fade-in" style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <IconCheck size={24}/>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>DNS verified</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            <span className="mono">{domain}</span> is ready to bind to a device.
          </div>
        </div>
      )}
    </Modal>
  );
};

const DnsRow = ({ type, name, value }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1.4fr', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
    <Badge tone="neutral">{type}</Badge>
    <Code copyable>{name}</Code>
    <Code copyable>{value}</Code>
  </div>
);

const PollingDots = () => (
  <div style={{ display: 'flex', gap: 6 }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{
        width: 8, height: 8, borderRadius: 999, background: 'var(--accent)',
        animation: `dot-pulse 1.2s ease-in-out ${i * 0.18}s infinite`,
      }}/>
    ))}
  </div>
);

const StepIndicator = ({ steps, active }) => (
  <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
    {steps.map((s, i) => (
      <div key={i} style={{ flex: 1 }}>
        <div style={{ height: 3, borderRadius: 999, background: i <= active ? 'var(--accent)' : 'var(--bg-sunken)', transition: 'all 240ms ease' }}/>
        <div style={{ fontSize: 11, color: i === active ? 'var(--text)' : 'var(--text-faint)', marginTop: 6, fontWeight: i === active ? 500 : 400 }}>{s}</div>
      </div>
    ))}
  </div>
);

// ============ DEVICES ============
const initialDevices = [
  { id: 1, name: 'mac-studio-01', os: 'macOS 14.5', online: true, version: '2.4.1', tunnels: [{ d: 'api.acme.co', p: 3000 }, { d: 'staging.acme.co', p: 8080 }] },
  { id: 2, name: 'mbp-m3-14', os: 'macOS 14.5', online: true, version: '2.4.1', tunnels: [{ d: 'docs.acme.co', p: 4000 }, { d: 'webhook.acme.co', p: 9090 }] },
  { id: 3, name: 'thinkpad-x1', os: 'Ubuntu 24.04', online: false, version: '2.3.8', tunnels: [{ d: 'admin.acme.co', p: 5173 }] },
  { id: 4, name: 'win-desktop', os: 'Windows 11', online: false, version: '2.4.0', tunnels: [] },
];

const Devices = ({ navigate }) => {
  const [devices, setDevices] = React.useState(initialDevices);
  const [expanded, setExpanded] = React.useState(1);
  const [confirmRevoke, setConfirmRevoke] = React.useState(null);
  const [adding, setAdding] = React.useState(false);
  const toast = useToast();

  const onRevoke = (d) => {
    setDevices((ds) => ds.map((x) => x.id === d.id ? { ...x, online: false, tunnels: [] } : x));
    toast({ title: 'Device revoked', body: `${d.name} terminated · token invalidated`, tone: 'danger' });
    setConfirmRevoke(null);
  };

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Physical machines running the osmRouter desktop client."
        action={<Button variant="primary" icon={<IconPlus size={13}/>} onClick={() => setAdding(true)}>Connect device</Button>}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {devices.map((d) => (
          <Card key={d.id} padding={0} style={{ overflow: 'hidden' }}>
            <button
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
              style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr 140px 100px 100px 32px', gap: 16, alignItems: 'center',
                width: '100%', padding: '18px 22px', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--bg-soft)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <IconDevice size={16}/>
              </div>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)' }} className="mono">{d.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{d.os} · v{d.version}</div>
              </div>
              <StatusDot online={d.online} label={d.online ? 'Online' : 'Offline'}/>
              <div className="num" style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                {d.tunnels.length} {d.tunnels.length === 1 ? 'tunnel' : 'tunnels'}
              </div>
              <Menu align="right" trigger={<span style={{ display: 'inline-flex', padding: 6, color: 'var(--text-faint)' }} onClick={(e) => e.stopPropagation()}><IconDots size={14}/></span>}
                items={[
                  { icon: <IconRefresh size={13}/>, label: 'Restart client' },
                  { icon: <IconDownload size={13}/>, label: 'Update to 2.4.2' },
                  { divider: true },
                  { icon: <IconLogout size={13}/>, label: 'Revoke access', onClick: () => setConfirmRevoke(d), danger: true },
                ]}/>
              <IconChevD size={14} style={{ color: 'var(--text-faint)', transform: expanded === d.id ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 200ms ease' }}/>
            </button>

            {expanded === d.id && (
              <div className="fade-in" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                {d.tunnels.length === 0 ? (
                  <div style={{ padding: '20px 22px', fontSize: 13, color: 'var(--text-faint)', textAlign: 'center' }}>
                    No tunnels bound. {d.online ? 'Bind a domain to start routing.' : 'Device must be online.'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '10px 22px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border)' }}>
                      Active tunnels · {d.tunnels.length}
                    </div>
                    {d.tunnels.map((t, i) => (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16, alignItems: 'center',
                        padding: '12px 22px', borderBottom: i < d.tunnels.length - 1 ? '1px solid var(--border)' : 0,
                      }}>
                        <div className="mono" style={{ fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ color: 'var(--success)' }}>●</span>
                          {t.d}
                          <IconArrowR size={12} style={{ color: 'var(--text-faint)' }}/>
                          <span style={{ color: 'var(--text-muted)' }}>localhost:{t.p}</span>
                        </div>
                        <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>edge: fra1 · 42ms</span>
                        <button style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11.5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>Disconnect</button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {adding && <ConnectDeviceFlow onClose={() => setAdding(false)} onConnected={(name) => {
        setDevices((ds) => [...ds, { id: Date.now(), name, os: 'macOS 14.5', online: true, version: '2.4.1', tunnels: [] }]);
        setAdding(false);
        toast({ title: 'Device connected', body: `${name} is now authenticated`, tone: 'success' });
      }}/>}

      <Modal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        title="Revoke device access?"
        danger
        footer={<><Button variant="ghost" onClick={() => setConfirmRevoke(null)}>Cancel</Button><Button danger onClick={() => onRevoke(confirmRevoke)}>Revoke access</Button></>}
      >
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55 }}>
          This will <strong>invalidate the API token</strong> on <span className="mono">{confirmRevoke?.name}</span>, terminate all <span className="mono">{confirmRevoke?.tunnels.length}</span> active tunnels, and force re-authentication.
        </div>
      </Modal>
    </>
  );
};

const ConnectDeviceFlow = ({ onClose, onConnected }) => {
  const [stage, setStage] = React.useState(0);
  const stages = ['waiting', 'detected', 'connecting', 'connected'];
  React.useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 1800);
    const t2 = setTimeout(() => setStage(2), 3400);
    const t3 = setTimeout(() => setStage(3), 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <Modal open={true} onClose={onClose} title="Connect a new device" width={520}
      footer={stage === 3 ? <Button variant="primary" onClick={() => onConnected('mac-mini-02')}>Done</Button> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}
    >
      <div style={{ padding: '8px 0' }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 16 }}>
          Run the following on the machine you want to authenticate:
        </div>
        <Code>osmrouter login --pair-code A7-K2-9F</Code>
        <div style={{ marginTop: 24, padding: '20px 18px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {stage < 3 ? <Spinner size={16}/> : <div style={{ width: 18, height: 18, borderRadius: 999, background: 'var(--success)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconCheck size={11}/></div>}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
                {stage === 0 && 'Waiting for client…'}
                {stage === 1 && 'Client detected'}
                {stage === 2 && 'Verifying credentials…'}
                {stage === 3 && 'Connected'}
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                {stage === 0 && 'pair-code: A7-K2-9F'}
                {stage === 1 && 'mac-mini-02 · 192.168.1.42'}
                {stage === 2 && 'exchanging mTLS keys'}
                {stage === 3 && 'token issued · edge: fra1'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ============ BILLING ============
const Billing = () => {
  return (
    <>
      <PageHeader title="Billing" subtitle="Plan, payment methods, and invoices." action={<Button variant="secondary" icon={<IconDownload size={13}/>}>Export invoices</Button>}/>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 24 }}>
        <Card padding={24}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Current plan</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>Pro</span>
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>· $12 / month</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>Renews on <span className="mono" style={{ color: 'var(--text)' }}>Jun 04, 2026</span></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" size="sm">Downgrade</Button>
              <Button variant="secondary" size="sm">Upgrade</Button>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '8px 0 20px' }}/>

          {[
            { label: 'Bandwidth', used: 312, max: 500, unit: 'GB' },
            { label: 'Domains', used: 14, max: 'Unlimited', unit: '' },
            { label: 'Connected devices', used: 4, max: 10, unit: '' },
          ].map((q, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{q.label}</span>
                <span className="num" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{q.used}{q.unit} / {q.max}{q.unit && q.max !== 'Unlimited' ? q.unit : ''}</span>
              </div>
              <Progress value={typeof q.max === 'number' ? (q.used / q.max) * 100 : 20} tone={(typeof q.max === 'number' && q.used / q.max > 0.85) ? 'warn' : 'accent'}/>
            </div>
          ))}
        </Card>

        <Card padding={24}>
          <SectionHeader title="Payment method" action={<Button variant="ghost" size="sm">Edit</Button>}/>
          <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 28, borderRadius: 5, background: 'linear-gradient(135deg, #1a1f36, #314159)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}>VISA</div>
              <div>
                <div className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>•••• •••• •••• 4242</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Expires 09 / 28</div>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={<IconPlus size={12}/>} style={{ marginTop: 12 }}>Add method (UPI, ACH)</Button>
        </Card>
      </div>

      <SectionHeader title="Invoices" subtitle="Past 12 months"/>
      <Table
        columns={[
          { key: 'date', label: 'Date', width: '140px', render: (r) => <span className="mono" style={{ fontSize: 12.5 }}>{r.date}</span> },
          { key: 'num', label: 'Invoice', width: '140px', render: (r) => <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.num}</span> },
          { key: 'amount', label: 'Amount', width: '100px', align: 'right', render: (r) => <span className="num">${r.amount.toFixed(2)}</span> },
          { key: 'status', label: 'Status', width: '110px', render: () => <Badge tone="success" dot>Paid</Badge> },
          { key: 'action', label: '', width: '40px', render: () => <button style={{ background: 'transparent', border: 0, color: 'var(--text-faint)', cursor: 'pointer', padding: 6 }}><IconDownload size={14}/></button> },
        ]}
        rows={Array.from({ length: 8 }, (_, i) => {
          const d = new Date(2026, 4 - i, 4);
          return { date: d.toISOString().slice(0, 10), num: `INV-${String(2026100 - i).padStart(7, '0')}`, amount: 12 };
        })}
      />
    </>
  );
};

// ============ SETTINGS ============
const Settings = () => {
  const [tab, setTab] = React.useState('profile');
  return (
    <>
      <PageHeader title="Settings"/>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'profile', label: 'Profile' },
          { value: 'security', label: 'Security' },
          { value: 'sessions', label: 'Sessions' },
          { value: 'api', label: 'API keys' },
        ]}
      />
      {tab === 'profile' && <SettingsProfile/>}
      {tab === 'security' && <SettingsSecurity/>}
      {tab === 'sessions' && <SettingsSessions/>}
      {tab === 'api' && <SettingsApi/>}
    </>
  );
};

const SettingsProfile = () => (
  <Card padding={28} style={{ maxWidth: 720 }}>
    <SectionHeader title="Profile" subtitle="How you appear across osmRouter"/>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
      <Avatar name="Sasha Mendez" size={64}/>
      <div>
        <Button variant="secondary" size="sm">Upload photo</Button>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6 }}>PNG or JPG, max 2 MB</div>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
      <Field label="Name"><Input defaultValue="Sasha Mendez"/></Field>
      <Field label="Email"><Input defaultValue="sasha@acme.co"/></Field>
    </div>
    <Field label="Workspace"><Input defaultValue="acme-platform" prefix="osmrouter.dev /"/></Field>
    <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <Button variant="ghost">Cancel</Button>
      <Button variant="primary">Save changes</Button>
    </div>
  </Card>
);

const SettingsSecurity = () => {
  const [tfa, setTfa] = React.useState(false);
  const [setup, setSetup] = React.useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <Card padding={24}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Password</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>Last changed 3 months ago</div>
          </div>
          <Button variant="secondary" size="sm">Change password</Button>
        </div>
      </Card>
      <Card padding={24}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: tfa ? 20 : 0 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Two-factor authentication</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>Use a TOTP authenticator app (1Password, Authy, Google Authenticator)</div>
          </div>
          <Switch checked={tfa} onChange={(v) => { setTfa(v); setSetup(v); }}/>
        </div>
        {setup && (
          <div className="fade-in" style={{ marginTop: 14, padding: 20, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 24, alignItems: 'flex-start' }}>
              <div style={{ width: 120, height: 120, background: 'white', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
                <QrPattern/>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Scan with your authenticator</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>Or enter this code manually:</div>
                <Code>JBSWY3DPEHPK3PXP</Code>
                <div style={{ marginTop: 14 }}>
                  <Label>Verify with the 6-digit code from your app</Label>
                  <Input placeholder="000000" style={{ maxWidth: 160 }} fullWidth={false}/>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

const QrPattern = () => {
  const cells = React.useMemo(() => {
    const r = [];
    const seed = 42;
    let x = seed;
    for (let i = 0; i < 21 * 21; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      r.push((x & 1) === 1);
    }
    // Force corners
    const set = (r0, c0, on) => { r[r0 * 21 + c0] = on; };
    // 7x7 corner squares (top-left, top-right, bottom-left)
    [[0, 0], [0, 14], [14, 0]].forEach(([rr, cc]) => {
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        const onEdge = i === 0 || i === 6 || j === 0 || j === 6;
        const inner = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        set(rr + i, cc + j, onEdge || inner);
      }
    });
    return r;
  }, []);
  return (
    <svg width="100%" height="100%" viewBox="0 0 21 21" shapeRendering="crispEdges">
      <rect width="21" height="21" fill="white"/>
      {cells.map((on, i) => on && <rect key={i} x={i % 21} y={Math.floor(i / 21)} width="1" height="1" fill="black"/>)}
    </svg>
  );
};

const SettingsSessions = () => (
  <Card padding={0} style={{ maxWidth: 720 }}>
    <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Active sessions</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>Devices currently signed into your account</div>
    </div>
    {[
      { dev: 'MacBook Pro · Chrome 134', loc: 'Berlin, DE · 91.64.12.4', t: 'Current session', current: true },
      { dev: 'iPhone 16 · Safari', loc: 'Berlin, DE · 91.64.12.4', t: '2 hours ago' },
      { dev: 'Windows · Firefox 128', loc: 'Amsterdam, NL · 84.241.198.16', t: '3 days ago' },
    ].map((s, i) => (
      <div key={i} style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: i < 2 ? '1px solid var(--border)' : 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
            {s.dev}
            {s.current && <Badge tone="success" dot>Active</Badge>}
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{s.loc} · {s.t}</div>
        </div>
        {!s.current && <Button variant="ghost" size="sm">Revoke</Button>}
      </div>
    ))}
  </Card>
);

const SettingsApi = () => {
  const [keys, setKeys] = React.useState([
    { id: 1, name: 'ci-deploy', prefix: 'osm_live_K7d9', created: '2026-03-04', last: '2 hours ago' },
    { id: 2, name: 'monitoring', prefix: 'osm_live_X3jv', created: '2026-02-12', last: '5 minutes ago' },
  ]);
  const [showNew, setShowNew] = React.useState(null);
  const toast = useToast();

  return (
    <div style={{ maxWidth: 720 }}>
      <Card padding={0}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>API keys</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>Use these for programmatic access via the REST API or CLI</div>
          </div>
          <Button variant="primary" size="sm" icon={<IconPlus size={12}/>} onClick={() => setShowNew({ key: 'osm_live_' + Math.random().toString(36).slice(2, 18) + Math.random().toString(36).slice(2, 8) })}>New key</Button>
        </div>
        {keys.map((k, i) => (
          <div key={k.id} style={{ padding: '16px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 16, alignItems: 'center', borderBottom: i < keys.length - 1 ? '1px solid var(--border)' : 0 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{k.name}</div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{k.prefix}••••••••••••</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Created <span className="mono">{k.created}</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Used {k.last}</div>
            <Button variant="ghost" size="sm" danger onClick={() => { setKeys((ks) => ks.filter((x) => x.id !== k.id)); toast({ title: 'Key revoked', tone: 'danger' }); }}>Revoke</Button>
          </div>
        ))}
      </Card>

      <Modal open={!!showNew} onClose={() => setShowNew(null)} title="API key created" width={520}
        footer={<Button variant="primary" onClick={() => setShowNew(null)}>I've copied it</Button>}
      >
        <div style={{ padding: '12px 14px', background: 'var(--warn-soft)', border: '1px solid var(--warn-soft)', borderRadius: 8, fontSize: 12.5, color: 'var(--text)', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <IconWarn size={14} style={{ color: 'var(--warn)', marginTop: 2, flexShrink: 0 }}/>
          <div>This key will only be shown once. Copy it now and store it somewhere safe.</div>
        </div>
        <Label>Your new API key</Label>
        <Code>{showNew?.key}</Code>
      </Modal>
    </div>
  );
};

Object.assign(window, { UserDashboard, Domains, Devices, Billing, Settings });
