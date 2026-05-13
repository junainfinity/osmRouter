// App root — router, auth state, theme, tweaks.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accentHue": 252,
  "compact": false,
  "startRoute": "dashboard"
}/*EDITMODE-END*/;

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [authed, setAuthed] = React.useState(true); // start signed in for fast review
  const [authStep, setAuthStep] = React.useState('marketing'); // marketing | signup | otp | onboard
  const [route, setRoute] = React.useState(t.startRoute || 'dashboard');
  const [impersonating, setImpersonating] = React.useState(null);

  // Apply theme
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.theme);
  }, [t.theme]);

  // Apply accent hue
  React.useEffect(() => {
    const lightLightness = t.theme === 'dark' ? 72 : 62;
    document.documentElement.style.setProperty('--accent', `oklch(${lightLightness}% 0.19 ${t.accentHue})`);
    document.documentElement.style.setProperty('--accent-soft', `oklch(${lightLightness}% 0.19 ${t.accentHue} / ${t.theme === 'dark' ? 0.14 : 0.10})`);
    document.documentElement.style.setProperty('--accent-line', `oklch(${lightLightness}% 0.19 ${t.accentHue} / ${t.theme === 'dark' ? 0.35 : 0.30})`);
  }, [t.accentHue, t.theme]);

  const mode = route.startsWith('admin.') ? 'admin' : 'user';
  const user = impersonating
    ? { name: impersonating.name, email: impersonating.email }
    : { name: 'Sasha Mendez', email: 'sasha@acme.co' };

  const toggleTheme = () => setTweak('theme', t.theme === 'dark' ? 'light' : 'dark');

  const onImpersonate = (u) => {
    setImpersonating(u);
    setRoute('dashboard');
  };

  const exitImpersonation = () => {
    setImpersonating(null);
    setRoute('admin.users');
  };

  // Not authenticated → marketing / auth flow
  if (!authed) {
    if (authStep === 'marketing') return <Marketing onSignIn={() => { setAuthed(true); setRoute('dashboard'); }} onSignUp={() => setAuthStep('signup')} />;
    if (authStep === 'signup') return <Signup goto={setAuthStep} completeAuth={() => { setAuthed(true); setRoute('dashboard'); }}/>;
    if (authStep === 'otp') return <OtpScreen goto={setAuthStep} completeAuth={() => { setAuthed(true); setRoute('dashboard'); }}/>;
    if (authStep === 'onboard') return <Onboarding completeAuth={() => { setAuthed(true); setRoute('dashboard'); }}/>;
  }

  // Authenticated app
  return (
    <AppShell
      mode={mode}
      route={route}
      navigate={(r) => setRoute(r)}
      user={user}
      theme={t.theme}
      toggleTheme={toggleTheme}
      onLogout={() => { setAuthed(false); setAuthStep('marketing'); }}
      impersonating={impersonating?.email}
      exitImpersonation={exitImpersonation}
    >
      {route === 'dashboard' && <UserDashboard navigate={setRoute}/>}
      {route === 'domains' && <Domains navigate={setRoute}/>}
      {route === 'devices' && <Devices navigate={setRoute}/>}
      {route === 'billing' && <Billing/>}
      {route === 'settings' && <Settings/>}
      {route === 'admin.dashboard' && <AdminDashboard navigate={setRoute}/>}
      {route === 'admin.users' && <AdminUsers onImpersonate={onImpersonate}/>}
      {route === 'admin.network' && <AdminNetwork/>}
      {route === 'admin.plans' && <AdminPlans/>}
      {route === 'admin.audit' && <AdminAudit/>}
    </AppShell>
  );
};

// Tweaks panel ----
const ROUTE_LABELS = {
  marketing: 'Marketing landing',
  signup: 'Auth · Sign up',
  otp: 'Auth · OTP verify',
  onboard: 'Auth · Onboarding',
  dashboard: 'User · Dashboard',
  domains: 'User · Domains',
  devices: 'User · Devices',
  billing: 'User · Billing',
  settings: 'User · Settings',
  'admin.dashboard': 'Admin · Overview',
  'admin.users': 'Admin · Users',
  'admin.network': 'Admin · Network',
  'admin.plans': 'Admin · Plans',
  'admin.audit': 'Admin · Audit log',
};

const PrototypePanel = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // Talk to App by emitting custom navigation events
  const jump = (r) => {
    window.dispatchEvent(new CustomEvent('proto-jump', { detail: r }));
  };

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Theme">
        <TweakRadio
          tweak="theme" tweakKey="theme"
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={t.theme}
          onChange={(v) => setTweak('theme', v)}
        />
      </TweakSection>

      <TweakSection title="Accent hue">
        <TweakColor
          options={[
            'oklch(72% 0.19 252)', // blue
            'oklch(72% 0.18 158)', // green
            'oklch(72% 0.18 60)',  // amber
            'oklch(72% 0.20 320)', // magenta
          ]}
          value={`oklch(72% 0.19 ${t.accentHue})`}
          onChange={(v) => {
            const m = v.match(/oklch\([^)]*?(\d{1,3})\)/);
            if (m) setTweak('accentHue', +m[1]);
          }}
        />
      </TweakSection>

      <TweakSection title="Quick jump">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
          {Object.entries(ROUTE_LABELS).map(([k, v]) => (
            <button key={k}
              onClick={() => jump(k)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 9px', background: 'transparent', border: '1px solid transparent', borderRadius: 6,
                fontSize: 12.5, color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
            >
              <span>{v}</span>
              <IconArrowR size={11} style={{ color: 'var(--text-faint)' }}/>
            </button>
          ))}
        </div>
      </TweakSection>

      <TweakSection title="Reset">
        <TweakButton onClick={() => { window.dispatchEvent(new CustomEvent('proto-reset')); }}>
          Sign out & return to marketing
        </TweakButton>
      </TweakSection>
    </TweaksPanel>
  );
};

// Wrap App to handle proto-jump events
const Root = () => {
  return (
    <ToastProvider>
      <RoutableApp/>
      <PrototypePanel/>
    </ToastProvider>
  );
};

const RoutableApp = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [authed, setAuthed] = React.useState(true);
  const [authStep, setAuthStep] = React.useState('signup');
  const [route, setRoute] = React.useState(t.startRoute || 'dashboard');
  const [impersonating, setImpersonating] = React.useState(null);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.theme);
  }, [t.theme]);

  React.useEffect(() => {
    const lightL = t.theme === 'dark' ? 72 : 62;
    document.documentElement.style.setProperty('--accent', `oklch(${lightL}% 0.19 ${t.accentHue})`);
    document.documentElement.style.setProperty('--accent-soft', `oklch(${lightL}% 0.19 ${t.accentHue} / ${t.theme === 'dark' ? 0.14 : 0.10})`);
    document.documentElement.style.setProperty('--accent-line', `oklch(${lightL}% 0.19 ${t.accentHue} / ${t.theme === 'dark' ? 0.35 : 0.30})`);
  }, [t.accentHue, t.theme]);

  React.useEffect(() => {
    const onJump = (e) => {
      const r = e.detail;
      if (r === 'marketing') { setAuthed(false); setAuthStep('marketing'); return; }
      if (r === 'signup' || r === 'otp' || r === 'onboard') { setAuthed(false); setAuthStep(r); return; }
      setAuthed(true);
      setImpersonating(null);
      setRoute(r);
    };
    const onReset = () => { setAuthed(false); setAuthStep('marketing'); setImpersonating(null); };
    window.addEventListener('proto-jump', onJump);
    window.addEventListener('proto-reset', onReset);
    return () => { window.removeEventListener('proto-jump', onJump); window.removeEventListener('proto-reset', onReset); };
  }, []);

  const mode = route.startsWith('admin.') ? 'admin' : 'user';
  const user = impersonating
    ? { name: impersonating.name, email: impersonating.email }
    : { name: 'Sasha Mendez', email: 'sasha@acme.co' };

  const toggleTheme = () => setTweak('theme', t.theme === 'dark' ? 'light' : 'dark');

  const onImpersonate = (u) => { setImpersonating(u); setRoute('dashboard'); };
  const exitImpersonation = () => { setImpersonating(null); setRoute('admin.users'); };

  if (!authed) {
    if (authStep === 'marketing') return <Marketing onSignIn={() => { setAuthed(true); setRoute('dashboard'); }} onSignUp={() => setAuthStep('signup')} />;
    if (authStep === 'signup') return <Signup goto={setAuthStep} completeAuth={() => { setAuthed(true); setRoute('dashboard'); }}/>;
    if (authStep === 'otp') return <OtpScreen goto={setAuthStep} completeAuth={() => { setAuthed(true); setRoute('dashboard'); }}/>;
    if (authStep === 'onboard') return <Onboarding completeAuth={() => { setAuthed(true); setRoute('dashboard'); }}/>;
  }

  return (
    <AppShell
      mode={mode} route={route} navigate={(r) => { setRoute(r); }}
      user={user} theme={t.theme} toggleTheme={toggleTheme}
      onLogout={() => { setAuthed(false); setAuthStep('marketing'); }}
      impersonating={impersonating?.email}
      exitImpersonation={exitImpersonation}
    >
      {route === 'dashboard' && <UserDashboard navigate={setRoute}/>}
      {route === 'domains' && <Domains navigate={setRoute}/>}
      {route === 'devices' && <Devices navigate={setRoute}/>}
      {route === 'billing' && <Billing/>}
      {route === 'settings' && <Settings/>}
      {route === 'admin.dashboard' && <AdminDashboard navigate={setRoute}/>}
      {route === 'admin.users' && <AdminUsers onImpersonate={onImpersonate}/>}
      {route === 'admin.network' && <AdminNetwork/>}
      {route === 'admin.plans' && <AdminPlans/>}
      {route === 'admin.audit' && <AdminAudit/>}
    </AppShell>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
