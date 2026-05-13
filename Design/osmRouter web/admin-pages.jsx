// Admin-side pages

// ============ ADMIN DASHBOARD ============
const AdminDashboard = ({ navigate }) => {
  const [range, setRange] = React.useState('24h');
  const tunnelsHist = React.useMemo(() => Array.from({ length: 48 }, (_, i) => 8200 + Math.sin(i / 4) * 1200 + Math.random() * 400), []);
  const throughputHist = React.useMemo(() => Array.from({ length: 48 }, (_, i) => 42 + Math.sin(i / 5 + 1) * 14 + Math.random() * 4), []);

  return (
    <>
      <PageHeader
        eyebrow="Superuser"
        title="Global telemetry"
        subtitle="Real-time fleet metrics across all edge nodes and tenants."
        action={
          <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 7 }}>
            {['1h', '24h', '7d', '30d'].map((t) => (
              <button key={t} onClick={() => setRange(t)} style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                background: range === t ? 'var(--bg-panel)' : 'transparent',
                color: range === t ? 'var(--text)' : 'var(--text-muted)',
                border: range === t ? '1px solid var(--border)' : '1px solid transparent',
                boxShadow: range === t ? 'var(--shadow-sm)' : 'none',
                fontWeight: 500,
              }}>{t}</button>
            ))}
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <Stat label="Active tunnels" value="8,742" delta="+4.2%" hint="across 1,284 tenants"/>
        <Stat label="Global throughput" value="58.4" suffix="Gb/s" delta="+1.8%" hint="vs. 24h ago"/>
        <Stat label="Avg edge latency" value="38" suffix="ms" delta="-2.1%" hint="p50 across 14 nodes"/>
        <Stat label="MRR" value="$214k" delta="+6.4%" hint="2,108 paid accounts"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <ChartCard title="Active tunnels" value="8,742" data={tunnelsHist} color="var(--accent)" yMax={12000} yMin={5000} unit=""/>
        <ChartCard title="Throughput" value="58.4 Gb/s" data={throughputHist} color="var(--success)" yMax={80} yMin={20} unit="Gb/s"/>
      </div>

      <SectionHeader title="Health" subtitle="Connection anomalies and node distribution" style={{ marginTop: 28 }}/>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <Card padding={22}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Inbound vs. outbound traffic</div>
          <DualBarChart/>
          <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--accent)', borderRadius: 2, marginRight: 6 }}/>Inbound web</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--success)', borderRadius: 2, marginRight: 6 }}/>Outbound tunnel</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text)' }}>Delta: <span className="num" style={{ color: 'var(--success)' }}>+0.3%</span> (nominal)</span>
          </div>
        </Card>
        <Card padding={22}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Geographic load · proxies</div>
          {[
            { reg: 'eu-fra1', load: 78, conn: '2.4k' },
            { reg: 'us-iad1', load: 64, conn: '1.9k' },
            { reg: 'us-sfo1', load: 52, conn: '1.5k' },
            { reg: 'ap-sin1', load: 38, conn: '1.1k' },
            { reg: 'sa-gru1', load: 22, conn: '0.6k' },
          ].map((r, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12.5 }}>
                <span className="mono" style={{ color: 'var(--text)' }}>{r.reg}</span>
                <span className="num" style={{ color: 'var(--text-muted)' }}>{r.conn} · {r.load}%</span>
              </div>
              <Progress value={r.load} tone={r.load > 75 ? 'warn' : 'accent'}/>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
};

const ChartCard = ({ title, value, data, color, yMax, yMin, unit }) => {
  const w = 480, h = 160, pad = 14;
  const max = yMax, min = yMin;
  const range = max - min;
  const points = data.map((v, i) => [pad + (i / (data.length - 1)) * (w - pad * 2), h - pad - ((v - min) / range) * (h - pad * 2)]);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`;
  return (
    <Card padding={22}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{title}</div>
          <div className="num" style={{ fontSize: 26, fontWeight: 500, marginTop: 4, letterSpacing: '-0.02em' }}>{value}</div>
        </div>
        <Badge tone="success" dot>Live</Badge>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`cg-${title}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#cg-${title})`}/>
        <path d={path} stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
      </svg>
    </Card>
  );
};

const DualBarChart = () => {
  const n = 24;
  const inbound = Array.from({ length: n }, (_, i) => 30 + Math.sin(i / 3) * 14 + Math.random() * 8);
  const outbound = inbound.map((v) => v * (0.95 + Math.random() * 0.08));
  const max = Math.max(...inbound, ...outbound);
  return (
    <svg width="100%" height="160" viewBox={`0 0 ${n * 18} 160`} preserveAspectRatio="none">
      {inbound.map((v, i) => (
        <g key={i}>
          <rect x={i * 18 + 2} y={140 - (v / max) * 130} width="6" height={(v / max) * 130} fill="var(--accent)" opacity="0.85" rx="1.5"/>
          <rect x={i * 18 + 10} y={140 - (outbound[i] / max) * 130} width="6" height={(outbound[i] / max) * 130} fill="var(--success)" opacity="0.85" rx="1.5"/>
        </g>
      ))}
      <line x1="0" y1="140" x2={n * 18} y2="140" stroke="var(--border)"/>
    </svg>
  );
};

// ============ ADMIN USERS ============
const adminUsersData = [
  { id: 'u_8K3Lp', email: 'sasha@acme.co', name: 'Sasha Mendez', plan: 'Pro', domains: 14, devices: 4, status: 'active', mac: '40:cb:c0:8d:11:a4' },
  { id: 'u_2Mn9q', email: 'jake@stripe.engineering', name: 'Jake Lin', plan: 'Pro', domains: 28, devices: 8, status: 'active', mac: '40:cb:c0:8d:11:a8' },
  { id: 'u_F73qx', email: 'priya@n8n.io', name: 'Priya Kavanagh', plan: 'Free', domains: 1, devices: 1, status: 'active', mac: '40:cb:c0:8d:11:b2' },
  { id: 'u_R12kx', email: 'olu@vercel-platform.dev', name: 'Olu Adeyemi', plan: 'Pro', domains: 47, devices: 12, status: 'active', mac: '40:cb:c0:8d:11:c6' },
  { id: 'u_4Wp7v', email: 'maja@hetzner-cloud.de', name: 'Maja Sørensen', plan: 'Free', domains: 0, devices: 0, status: 'suspended', mac: '—' },
  { id: 'u_Q9hbn', email: 'theo@frigate.app', name: 'Theo Walsh', plan: 'Pro', domains: 6, devices: 2, status: 'active', mac: '40:cb:c0:8d:11:da' },
  { id: 'u_C1jzr', email: 'kenji@balena-iot.com', name: 'Kenji Park', plan: 'Pro', domains: 19, devices: 5, status: 'active', mac: '40:cb:c0:8d:11:ee' },
];

const AdminUsers = ({ onImpersonate }) => {
  const [q, setQ] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [confirmAction, setConfirmAction] = React.useState(null);
  const toast = useToast();
  const filtered = adminUsersData.filter((u) =>
    !q || u.email.toLowerCase().includes(q.toLowerCase())
    || u.name.toLowerCase().includes(q.toLowerCase())
    || u.id.toLowerCase().includes(q.toLowerCase())
    || u.mac.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <PageHeader title="Users" subtitle={`${adminUsersData.length.toLocaleString()} accounts · search by email, ID, or MAC`}/>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, maxWidth: 420 }}>
          <Input icon={<IconSearch size={14}/>} placeholder="Search users, IDs, MAC addresses…" value={q} onChange={(e) => setQ(e.target.value)} size="sm"/>
        </div>
        <Button variant="secondary" size="sm" icon={<IconFilter size={13}/>}>Filter</Button>
        <Button variant="secondary" size="sm" icon={<IconDownload size={13}/>}>Export CSV</Button>
      </div>

      <Table
        columns={[
          { key: 'name', label: 'User', render: (r) => (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Avatar name={r.name} size={28}/>
              <div>
                <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{r.name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{r.email}</div>
              </div>
            </div>
          ) },
          { key: 'id', label: 'ID', width: '110px', render: (r) => <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.id}</span> },
          { key: 'plan', label: 'Plan', width: '80px', render: (r) => <Badge tone={r.plan === 'Pro' ? 'accent' : 'neutral'}>{r.plan}</Badge> },
          { key: 'domains', label: 'Domains', width: '90px', align: 'right', render: (r) => <span className="num">{r.domains}</span> },
          { key: 'devices', label: 'Devices', width: '90px', align: 'right', render: (r) => <span className="num">{r.devices}</span> },
          { key: 'status', label: 'Status', width: '110px', render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'danger'} dot={r.status === 'active'}>{r.status === 'active' ? 'Active' : 'Suspended'}</Badge> },
          { key: 'actions', label: '', width: '40px', render: (r) => (
            <Menu align="right" trigger={<button style={{ background: 'transparent', border: 0, padding: 6, cursor: 'pointer', color: 'var(--text-faint)', borderRadius: 6 }}><IconDots size={14}/></button>}
              items={[
                { icon: <IconUsers size={13}/>, label: 'Impersonate', onClick: () => onImpersonate(r) },
                { icon: <IconRefresh size={13}/>, label: 'Force password reset', onClick: () => setConfirmAction({ user: r, kind: 'reset' }) },
                { icon: <IconLock size={13}/>, label: 'Sever all device locks', onClick: () => setConfirmAction({ user: r, kind: 'sever' }) },
                { icon: <IconCard size={13}/>, label: 'Apply billing credit' },
                { divider: true },
                { icon: <IconAlert size={13}/>, label: 'Suspend account', danger: true, onClick: () => setConfirmAction({ user: r, kind: 'suspend' }) },
              ]}
            />
          ) },
        ]}
        rows={filtered}
        onRowClick={(r) => setSelected(r)}
        empty={`No users match "${q}"`}
      />

      {selected && <UserDetailDrawer user={selected} onClose={() => setSelected(null)} onImpersonate={onImpersonate}/>}

      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        danger
        title={
          confirmAction?.kind === 'suspend' ? 'Suspend account?' :
          confirmAction?.kind === 'sever' ? 'Sever all device locks?' :
          'Force password reset?'
        }
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</Button>
          <Button danger onClick={() => { toast({ title: 'Action executed', body: `Audit log entry created for ${confirmAction.user.email}`, tone: 'danger' }); setConfirmAction(null); }}>Confirm</Button>
        </>}
      >
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55 }}>
          {confirmAction?.kind === 'suspend' && <>This will <strong>immediately terminate all proxy tunnels</strong> associated with <span className="mono">{confirmAction?.user.email}</span> and prevent the account from authenticating.</>}
          {confirmAction?.kind === 'sever' && <>This will clear device bindings for all <span className="mono">{confirmAction?.user.domains}</span> domains owned by <span className="mono">{confirmAction?.user.email}</span>.</>}
          {confirmAction?.kind === 'reset' && <>This will invalidate the password for <span className="mono">{confirmAction?.user.email}</span> and email them a reset link.</>}
        </div>
        <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          This action will be recorded in the audit log.
        </div>
      </Modal>
    </>
  );
};

const UserDetailDrawer = ({ user, onClose, onImpersonate }) => {
  React.useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="fade-in" style={{
        position: 'fixed', right: 0, top: 0, height: '100vh', width: 480,
        background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={user.name} size={36}/>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{user.name}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user.email}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: 'var(--text-faint)', cursor: 'pointer', padding: 6 }}><IconX size={16}/></button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 22 }}>
            <Stat label="Plan" value={user.plan}/>
            <Stat label="MRR contrib" value={user.plan === 'Pro' ? '$12' : '$0'}/>
            <Stat label="Domains" value={user.domains}/>
            <Stat label="Devices" value={user.devices}/>
          </div>

          <SectionHeader title="Admin actions"/>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button variant="primary" full icon={<IconUsers size={13}/>} onClick={() => onImpersonate(user)}>Impersonate (audited)</Button>
            <Button variant="secondary" full icon={<IconRefresh size={13}/>}>Force password reset</Button>
            <Button variant="secondary" full icon={<IconCard size={13}/>}>Apply billing credit</Button>
            <Button variant="secondary" full icon={<IconLock size={13}/>}>Sever all device locks</Button>
            <Button variant="dangerSoft" full icon={<IconAlert size={13}/>}>Suspend account</Button>
          </div>

          <SectionHeader title="Identifiers" style={{ marginTop: 28 }}/>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <KV k="User ID" v={user.id}/>
            <KV k="Primary MAC" v={user.mac}/>
            <KV k="Created" v="2024-08-14"/>
            <KV k="Last login" v="3 minutes ago · 91.64.12.4 (Berlin)"/>
          </div>
        </div>
      </div>
    </div>
  );
};

const KV = ({ k, v }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{k}</span>
    <span className="mono" style={{ fontSize: 12.5, color: 'var(--text)' }}>{v}</span>
  </div>
);

// ============ ADMIN NETWORK ============
const AdminNetwork = () => {
  const [nodes, setNodes] = React.useState([
    { id: 'edge-fra1-a', region: 'Frankfurt', ip: '185.62.190.4', cpu: 78, ram: 64, conn: 2412, status: 'active' },
    { id: 'edge-iad1-a', region: 'Ashburn', ip: '54.221.18.92', cpu: 64, ram: 58, conn: 1894, status: 'active' },
    { id: 'edge-iad1-b', region: 'Ashburn', ip: '54.221.18.93', cpu: 62, ram: 54, conn: 1782, status: 'active' },
    { id: 'edge-sfo1-a', region: 'San Francisco', ip: '99.83.224.18', cpu: 52, ram: 48, conn: 1488, status: 'active' },
    { id: 'edge-sin1-a', region: 'Singapore', ip: '13.250.94.7', cpu: 38, ram: 42, conn: 1102, status: 'draining' },
    { id: 'edge-gru1-a', region: 'São Paulo', ip: '177.71.207.4', cpu: 22, ram: 28, conn: 642, status: 'active' },
    { id: 'edge-syd1-a', region: 'Sydney', ip: '52.62.93.181', cpu: 18, ram: 22, conn: 514, status: 'active' },
    { id: 'edge-cdg1-a', region: 'Paris', ip: '13.36.142.4', cpu: 0, ram: 0, conn: 0, status: 'offline' },
  ]);

  const toast = useToast();

  const action = (n, kind) => {
    if (kind === 'drain') {
      setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, status: 'draining' } : x));
      toast({ title: 'Drain initiated', body: `New connections routing away from ${n.id}`, tone: 'success' });
    } else if (kind === 'reboot') {
      setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, status: 'offline', conn: 0, cpu: 0, ram: 0 } : x));
      toast({ title: 'Reboot scheduled', body: `${n.id} will return in ~90s`, tone: 'success' });
    }
  };

  return (
    <>
      <PageHeader title="Network" subtitle="Edge node fleet, anomaly detection, and IP banlist."/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <Stat label="Active nodes" value={nodes.filter((n) => n.status === 'active').length} suffix={`/ ${nodes.length}`}/>
        <Stat label="Avg CPU" value={Math.round(nodes.reduce((a, n) => a + n.cpu, 0) / nodes.length)} suffix="%"/>
        <Stat label="Concurrent connections" value={nodes.reduce((a, n) => a + n.conn, 0).toLocaleString()}/>
        <Stat label="DDoS mitigations · 24h" value="14" hint="2 active, 12 resolved"/>
      </div>

      <SectionHeader title="Edge nodes" subtitle="Drain traffic before maintenance" action={<Button variant="secondary" size="sm" icon={<IconDownload size={13}/>}>Deploy update</Button>}/>
      <Table
        columns={[
          { key: 'id', label: 'Node', render: (r) => (
            <div>
              <div className="mono" style={{ fontSize: 13.5, color: 'var(--text)' }}>{r.id}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{r.region}</div>
            </div>
          ) },
          { key: 'ip', label: 'IP', width: '140px', render: (r) => <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.ip}</span> },
          { key: 'cpu', label: 'CPU', width: '110px', render: (r) => <UtilBar v={r.cpu}/> },
          { key: 'ram', label: 'RAM', width: '110px', render: (r) => <UtilBar v={r.ram}/> },
          { key: 'conn', label: 'Conn.', width: '90px', align: 'right', render: (r) => <span className="num">{r.conn.toLocaleString()}</span> },
          { key: 'status', label: 'Status', width: '110px', render: (r) => (
            <Badge tone={r.status === 'active' ? 'success' : r.status === 'draining' ? 'warn' : 'neutral'} dot={r.status === 'active'}>
              {r.status === 'active' ? 'Active' : r.status === 'draining' ? 'Draining' : 'Offline'}
            </Badge>
          ) },
          { key: 'actions', label: '', width: '40px', render: (r) => (
            <Menu align="right" trigger={<button style={{ background: 'transparent', border: 0, padding: 6, cursor: 'pointer', color: 'var(--text-faint)', borderRadius: 6 }}><IconDots size={14}/></button>}
              items={[
                { icon: <IconArrowR size={13}/>, label: 'Drain traffic', onClick: () => action(r, 'drain') },
                { icon: <IconDownload size={13}/>, label: 'Deploy update' },
                { icon: <IconRefresh size={13}/>, label: 'Reboot', danger: true, onClick: () => action(r, 'reboot') },
              ]}/>
          ) },
        ]}
        rows={nodes}
      />

      <SectionHeader title="Security feeds" subtitle="Anomaly detection & banlist" style={{ marginTop: 32 }}/>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <Card padding={0}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>Anomaly log</div>
          {[
            { t: '2m ago', sev: 'warn', text: 'Volumetric spike on edge-iad1-a', detail: '142% of baseline · UDP 53' },
            { t: '18m ago', sev: 'danger', text: 'DDoS mitigation activated', detail: 'edge-fra1-a · 4.2 Gb/s scrubbed' },
            { t: '1h ago', sev: 'success', text: 'Mitigation cleared', detail: 'edge-sfo1-a returned to normal' },
            { t: '3h ago', sev: 'warn', text: 'Unusual auth velocity', detail: 'u_F73qx · 142 attempts / 60s' },
          ].map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr auto', gap: 14, padding: '12px 20px', borderBottom: i < 3 ? '1px solid var(--border)' : 0, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{a.t}</span>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>{a.text}</div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{a.detail}</div>
              </div>
              <Badge tone={a.sev}>{a.sev === 'danger' ? 'Critical' : a.sev === 'warn' ? 'Warning' : 'Cleared'}</Badge>
            </div>
          ))}
        </Card>
        <Card padding={22}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>IP banlist</div>
            <Button variant="ghost" size="sm" icon={<IconPlus size={11}/>}>Add IP</Button>
          </div>
          {[
            { ip: '178.62.214.4', reason: 'L7 abuse', expires: '23h' },
            { ip: '45.227.255.0/24', reason: 'Scanner', expires: 'Permanent' },
            { ip: '194.36.144.87', reason: 'Auth fuzzing', expires: '6d' },
            { ip: '103.245.18.0/24', reason: 'Volumetric', expires: 'Permanent' },
          ].map((b, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 0 }}>
              <div>
                <div className="mono" style={{ fontSize: 12.5, color: 'var(--text)' }}>{b.ip}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{b.reason} · {b.expires}</div>
              </div>
              <button style={{ background: 'transparent', border: 0, color: 'var(--text-faint)', cursor: 'pointer', padding: 4 }}><IconX size={13}/></button>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
};

const UtilBar = ({ v }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <div style={{ flex: 1, maxWidth: 60, height: 4, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${v}%`, background: v > 80 ? 'var(--danger)' : v > 60 ? 'var(--warn)' : 'var(--accent)', borderRadius: 999 }}/>
    </div>
    <span className="num" style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, textAlign: 'right' }}>{v}%</span>
  </div>
);

// ============ ADMIN PLANS ============
const AdminPlans = () => {
  const [plans, setPlans] = React.useState([
    { id: 'free', name: 'Free', price: 0, bw: 10, tunnels: 1, devices: 1, domains: 1, mtls: true, staticIp: false, priority: false, subscribers: 9842 },
    { id: 'pro', name: 'Pro', price: 12, bw: 500, tunnels: 10, devices: 10, domains: 999, mtls: true, staticIp: true, priority: true, subscribers: 2108 },
  ]);
  const [active, setActive] = React.useState('pro');
  const [dirty, setDirty] = React.useState(false);
  const toast = useToast();
  const plan = plans.find((p) => p.id === active);

  const update = (key, val) => {
    setPlans((ps) => ps.map((p) => p.id === active ? { ...p, [key]: val } : p));
    setDirty(true);
  };

  return (
    <>
      <PageHeader title="Plans" subtitle="Edits propagate immediately to all subscribers on the tier."/>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)', marginBottom: 10, padding: '0 4px' }}>Tiers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {plans.map((p) => (
              <button key={p.id} onClick={() => setActive(p.id)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '10px 12px', border: '1px solid', borderColor: active === p.id ? 'var(--accent-line)' : 'var(--border)',
                background: active === p.id ? 'var(--accent-soft)' : 'var(--bg-panel)',
                borderRadius: 8, cursor: 'pointer', textAlign: 'left',
              }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: active === p.id ? 'var(--accent)' : 'var(--text)' }}>{p.name}</div>
                  <div className="num" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{p.subscribers.toLocaleString()} subscribers</div>
                </div>
                <div className="num" style={{ fontSize: 13.5, color: 'var(--text)' }}>${p.price}</div>
              </button>
            ))}
            <Button variant="ghost" size="sm" icon={<IconPlus size={12}/>} style={{ marginTop: 6, justifyContent: 'flex-start' }}>New tier</Button>
          </div>
        </div>

        <Card padding={28}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>{plan.name} tier</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}><span className="num">{plan.subscribers.toLocaleString()}</span> subscribers · changes apply to all</div>
            </div>
            {dirty && <Badge tone="warn" dot>Unsaved</Badge>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 8 }}>
            <Field label="Monthly price (USD)"><Input prefix="$" type="number" value={plan.price} onChange={(e) => update('price', +e.target.value)}/></Field>
            <Field label="Bandwidth quota"><Input suffix="GB / mo" type="number" value={plan.bw} onChange={(e) => update('bw', +e.target.value)}/></Field>
            <Field label="Max active tunnels"><Input type="number" value={plan.tunnels} onChange={(e) => update('tunnels', +e.target.value)}/></Field>
            <Field label="Max connected devices"><Input type="number" value={plan.devices} onChange={(e) => update('devices', +e.target.value)}/></Field>
            <Field label="Max custom domains"><Input type="number" value={plan.domains} onChange={(e) => update('domains', +e.target.value)}/></Field>
          </div>

          <div style={{ marginTop: 20, padding: 18, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>Feature flags</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Switch checked={plan.mtls} onChange={(v) => update('mtls', v)} label="mTLS authentication" hint="Mutual TLS between every client and edge"/>
              <Switch checked={plan.staticIp} onChange={(v) => update('staticIp', v)} label="Static edge IPs" hint="Pinned dedicated IPs per edge region"/>
              <Switch checked={plan.priority} onChange={(v) => update('priority', v)} label="Priority support" hint="4-hour response SLA"/>
            </div>
          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={() => { setDirty(false); toast({ title: 'Changes discarded' }); }}>Discard</Button>
            <Button variant="primary" disabled={!dirty} onClick={() => { setDirty(false); toast({ title: 'Tier updated', body: `Applied to ${plan.subscribers.toLocaleString()} accounts`, tone: 'success' }); }}>Save & propagate</Button>
          </div>
        </Card>
      </div>
    </>
  );
};

// ============ ADMIN AUDIT ============
const AdminAudit = () => {
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState('all');

  const logs = [
    { ts: '2026-05-12 14:32:08 UTC', admin: 'jordan@osmrouter.dev', action: 'user.impersonate', target: 'u_8K3Lp', ip: '173.245.49.18', sev: 'info' },
    { ts: '2026-05-12 14:18:42 UTC', admin: 'jordan@osmrouter.dev', action: 'plan.update', target: 'plan_pro · bandwidth 400→500', ip: '173.245.49.18', sev: 'info' },
    { ts: '2026-05-12 12:04:17 UTC', admin: 'morgan@osmrouter.dev', action: 'user.suspend', target: 'u_4Wp7v', ip: '54.221.18.92', sev: 'danger' },
    { ts: '2026-05-12 11:51:09 UTC', admin: 'morgan@osmrouter.dev', action: 'edge.reboot', target: 'edge-cdg1-a', ip: '54.221.18.92', sev: 'warn' },
    { ts: '2026-05-12 10:22:38 UTC', admin: 'jordan@osmrouter.dev', action: 'billing.credit_apply', target: 'u_R12kx · $50.00', ip: '173.245.49.18', sev: 'info' },
    { ts: '2026-05-12 09:14:01 UTC', admin: 'system', action: 'banlist.add', target: '178.62.214.4 · L7 abuse', ip: '127.0.0.1', sev: 'warn' },
    { ts: '2026-05-12 08:42:55 UTC', admin: 'morgan@osmrouter.dev', action: 'user.password_force_reset', target: 'u_C1jzr', ip: '54.221.18.92', sev: 'info' },
    { ts: '2026-05-11 22:18:32 UTC', admin: 'jordan@osmrouter.dev', action: 'edge.deploy', target: 'edge-fra1-a · v2.4.2', ip: '173.245.49.18', sev: 'info' },
    { ts: '2026-05-11 19:51:14 UTC', admin: 'jordan@osmrouter.dev', action: 'user.device_lock_clear', target: 'u_2Mn9q · 4 domains', ip: '173.245.49.18', sev: 'info' },
    { ts: '2026-05-11 17:32:09 UTC', admin: 'morgan@osmrouter.dev', action: 'billing.refund', target: 'INV-2026034 · $12.00', ip: '54.221.18.92', sev: 'warn' },
  ];

  const filtered = logs.filter((l) => {
    if (q && !l.action.includes(q.toLowerCase()) && !l.target.toLowerCase().includes(q.toLowerCase()) && !l.admin.includes(q.toLowerCase())) return false;
    if (filter !== 'all' && l.sev !== filter) return false;
    return true;
  });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Immutable chronological record of every admin action."/>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ flex: 1, maxWidth: 360 }}>
          <Input icon={<IconSearch size={14}/>} placeholder="Search actions, targets, admins…" value={q} onChange={(e) => setQ(e.target.value)} size="sm"/>
        </div>
        <Button variant="secondary" size="sm" icon={<IconFilter size={13}/>}>Date range</Button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <Button variant="secondary" size="sm" icon={<IconDownload size={12}/>}>CSV</Button>
          <Button variant="secondary" size="sm" icon={<IconDownload size={12}/>}>JSON</Button>
        </div>
      </div>

      <Tabs items={[
        { value: 'all', label: 'All', count: logs.length },
        { value: 'info', label: 'Info', count: logs.filter((l) => l.sev === 'info').length },
        { value: 'warn', label: 'Warn', count: logs.filter((l) => l.sev === 'warn').length },
        { value: 'danger', label: 'Critical', count: logs.filter((l) => l.sev === 'danger').length },
      ]} value={filter} onChange={setFilter}/>

      <Table
        columns={[
          { key: 'ts', label: 'Timestamp', width: '200px', render: (r) => <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.ts}</span> },
          { key: 'admin', label: 'Admin', width: '200px', render: (r) => <span className="mono" style={{ fontSize: 12.5 }}>{r.admin}</span> },
          { key: 'action', label: 'Action', render: (r) => <span className="mono" style={{ fontSize: 12.5, color: 'var(--accent)' }}>{r.action}</span> },
          { key: 'target', label: 'Target', render: (r) => <span className="mono" style={{ fontSize: 12.5, color: 'var(--text)' }}>{r.target}</span> },
          { key: 'ip', label: 'Origin IP', width: '130px', render: (r) => <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.ip}</span> },
          { key: 'sev', label: '', width: '90px', render: (r) => <Badge tone={r.sev === 'danger' ? 'danger' : r.sev === 'warn' ? 'warn' : 'neutral'}>{r.sev}</Badge> },
        ]}
        rows={filtered}
      />
    </>
  );
};

Object.assign(window, { AdminDashboard, AdminUsers, AdminNetwork, AdminPlans, AdminAudit });
