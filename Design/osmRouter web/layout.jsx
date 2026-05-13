// App shell — Sidebar, Topbar, Layout

const NAV_USER = [
  { id: 'dashboard', label: 'Dashboard', icon: <IconHome size={16}/> },
  { id: 'domains', label: 'Domains', icon: <IconGlobe size={16}/> },
  { id: 'devices', label: 'Devices', icon: <IconDevice size={16}/> },
  { id: 'billing', label: 'Billing', icon: <IconCard size={16}/> },
  { id: 'settings', label: 'Settings', icon: <IconCog size={16}/> },
];

const NAV_ADMIN = [
  { id: 'admin.dashboard', label: 'Overview', icon: <IconChart size={16}/> },
  { id: 'admin.users', label: 'Users', icon: <IconUsers size={16}/> },
  { id: 'admin.network', label: 'Network', icon: <IconServer size={16}/> },
  { id: 'admin.plans', label: 'Plans', icon: <IconList size={16}/> },
  { id: 'admin.audit', label: 'Audit log', icon: <IconBook size={16}/> },
];

const Sidebar = ({ mode, route, navigate, impersonating, exitImpersonation }) => {
  const items = mode === 'admin' ? NAV_ADMIN : NAV_USER;
  const switchTo = mode === 'admin' ? 'user' : 'admin';
  return (
    <aside style={{
      width: 232, borderRight: '1px solid var(--border)', background: 'var(--bg-panel)',
      display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100vh', position: 'sticky', top: 0,
    }}>
      <div style={{ padding: '18px 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Wordmark size={14}/>
          {mode === 'admin' && <Badge tone="danger" dot>Admin</Badge>}
        </div>
      </div>

      {impersonating && (
        <div style={{ margin: '0 12px 10px', padding: '8px 10px', borderRadius: 8, background: 'var(--warn-soft)', border: '1px solid var(--warn-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconAlert size={14} style={{ color: 'var(--warn)' }}/>
          <div style={{ fontSize: 11.5, flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, color: 'var(--text)' }}>Impersonating</div>
            <div className="mono" style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{impersonating}</div>
          </div>
          <button onClick={exitImpersonation} style={{ background: 'transparent', border: 0, color: 'var(--warn)', cursor: 'pointer', fontSize: 11.5, fontWeight: 500 }}>Exit</button>
        </div>
      )}

      <nav style={{ padding: '4px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 10px 6px', fontFamily: 'var(--font-mono)' }}>
          {mode === 'admin' ? 'Admin' : 'Workspace'}
        </div>
        {items.map((it) => {
          const active = route === it.id;
          return (
            <button
              key={it.id}
              onClick={() => navigate(it.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 7,
                background: active ? 'var(--bg-soft)' : 'transparent', border: 0, cursor: 'pointer',
                color: active ? 'var(--text)' : 'var(--text-muted)', fontSize: 13.5, fontWeight: 500,
                width: '100%', textAlign: 'left', transition: 'all 100ms ease',
                position: 'relative',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-soft)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {active && <span style={{ position: 'absolute', left: -10, top: 8, bottom: 8, width: 2, background: 'var(--accent)', borderRadius: 999 }}/>}
              <span style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}>{it.icon}</span>
              <span>{it.label}</span>
            </button>
          );
        })}
      </nav>

      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => navigate(switchTo === 'admin' ? 'admin.dashboard' : 'dashboard')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
            fontSize: 12.5, color: 'var(--text-muted)', background: 'var(--bg-soft)',
            border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <IconRefresh size={13}/>
          <span>Switch to {switchTo}</span>
        </button>
      </div>
    </aside>
  );
};

const Topbar = ({ user, theme, toggleTheme, onLogout, onSearch }) => {
  const [q, setQ] = React.useState('');
  const [showNotif, setShowNotif] = React.useState(false);
  return (
    <header style={{
      height: 56, borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, position: 'sticky', top: 0, zIndex: 30,
    }}>
      <div style={{ flex: 1, maxWidth: 420 }}>
        <Input
          icon={<IconSearch size={14}/>}
          placeholder="Search domains, devices, settings…"
          value={q}
          onChange={(e) => { setQ(e.target.value); onSearch && onSearch(e.target.value); }}
          suffix={<span className="mono" style={{ padding: '1px 6px', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 10.5 }}>⌘K</span>}
          size="sm"
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
        <Button variant="ghost" size="sm" onClick={toggleTheme} icon={theme === 'dark' ? <IconSun size={14}/> : <IconMoon size={14}/>} />
        <div style={{ position: 'relative' }}>
          <Button variant="ghost" size="sm" onClick={() => setShowNotif(!showNotif)} icon={<IconBell size={14}/>}>
            <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, background: 'var(--accent)', borderRadius: 999 }}/>
          </Button>
          {showNotif && <NotifPanel onClose={() => setShowNotif(false)} />}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }}/>

        <Menu
          trigger={
            <button style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 4px', background: 'transparent', border: 0, borderRadius: 7, cursor: 'pointer' }}>
              <Avatar name={user.name} size={26} />
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{user.name.split(' ')[0]}</span>
              <IconChevD size={12} style={{ color: 'var(--text-faint)' }}/>
            </button>
          }
          items={[
            { icon: <IconCog size={14}/>, label: 'Settings' },
            { icon: <IconKey size={14}/>, label: 'API keys' },
            { icon: <IconBook size={14}/>, label: 'Documentation' },
            { divider: true },
            { icon: <IconLogout size={14}/>, label: 'Sign out', onClick: onLogout, danger: true },
          ]}
        />
      </div>
    </header>
  );
};

const Avatar = ({ name = '', size = 32, color }) => {
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color || `oklch(70% 0.10 ${hue})`,
      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 600, flexShrink: 0, letterSpacing: '-0.01em',
    }}>{initials}</div>
  );
};

const NotifPanel = ({ onClose }) => {
  const items = [
    { t: '2m ago', icon: <IconCheckCircle size={14} style={{ color: 'var(--success)' }}/>, title: 'DNS verified for api.acme.co', body: 'Tunnel is active' },
    { t: '1h ago', icon: <IconAlert size={14} style={{ color: 'var(--warn)' }}/>, title: 'mac-studio-01 went offline', body: 'Reconnect failed after 3 attempts' },
    { t: '3h ago', icon: <IconBolt size={14} style={{ color: 'var(--accent)' }}/>, title: 'You used 80% of monthly bandwidth' },
  ];
  return (
    <div onClick={(e) => e.stopPropagation()} className="fade-in" style={{
      position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 340,
      background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10,
      boxShadow: 'var(--shadow-lg)', zIndex: 50,
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 0, padding: 0, color: 'var(--text-faint)', fontSize: 12, cursor: 'pointer' }}>Mark all read</button>
      </div>
      <div style={{ padding: 4 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: '10px 12px', display: 'flex', gap: 10, borderRadius: 7, cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-soft)'}
            onMouseLeave={(e) => e.currentTarget.style.background = ''}
          >
            <div style={{ marginTop: 1 }}>{it.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>{it.title}</div>
              {it.body && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{it.body}</div>}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{it.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const AppShell = ({ children, mode, route, navigate, user, theme, toggleTheme, onLogout, impersonating, exitImpersonation }) => (
  <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
    <Sidebar mode={mode} route={route} navigate={navigate} impersonating={impersonating} exitImpersonation={exitImpersonation}/>
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Topbar user={user} theme={theme} toggleTheme={toggleTheme} onLogout={onLogout}/>
      <main style={{ flex: 1, padding: '32px 40px 64px', maxWidth: 1280, width: '100%', margin: '0 auto' }} key={route}>
        <div className="fade-in">{children}</div>
      </main>
    </div>
  </div>
);

Object.assign(window, { Sidebar, Topbar, AppShell, Avatar, NAV_USER, NAV_ADMIN });
