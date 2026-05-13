// Auth & onboarding flow

// Signup screen
const Signup = ({ goto, completeAuth }) => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [agree, setAgree] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const passwordStrength = (() => {
    if (!password) return null;
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();

  const canSubmit = email.includes('@') && password.length >= 8 && agree;

  const submit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setTimeout(() => { setSubmitting(false); goto('otp'); }, 700);
  };

  return (
    <AuthShell tagline="Pin a public hostname to anything running locally." sideTone={1}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Create your account</h1>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6 }}>Start routing local services through your own domains in under 90 seconds.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16 }}>
        <OAuthButton label="osmAPI" onClick={() => { completeAuth(); }} />
        <OAuthButton label="Google" onClick={() => { completeAuth(); }} />
        <OAuthButton label="GitHub" onClick={() => { completeAuth(); }} />
        <OAuthButton label="Apple" onClick={() => { completeAuth(); }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
        or with email
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Email">
          <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint={password ? `${passwordStrength}/4` : null}>
          <Input type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          {password && (
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              {[1,2,3,4].map((n) => (
                <div key={n} style={{ flex: 1, height: 3, borderRadius: 999, background: n <= passwordStrength ? (passwordStrength <= 1 ? 'var(--danger)' : passwordStrength === 2 ? 'var(--warn)' : 'var(--success)') : 'var(--bg-sunken)' }}/>
              ))}
            </div>
          )}
        </Field>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--accent)' }}/>
          <span>I agree to the <a style={{ color: 'var(--text)', borderBottom: '1px solid var(--border-strong)' }}>Terms</a> and <a style={{ color: 'var(--text)', borderBottom: '1px solid var(--border-strong)' }}>Privacy Policy</a></span>
        </label>

        <Button type="submit" variant="primary" disabled={!canSubmit || submitting} full size="lg" style={{ marginTop: 8 }}>
          {submitting ? <><Spinner size={14}/> Creating account…</> : 'Create account'}
        </Button>
      </form>

      <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        Already have an account? <a onClick={() => completeAuth()} style={{ color: 'var(--text)', cursor: 'pointer', fontWeight: 500 }}>Sign in</a>
      </div>
    </AuthShell>
  );
};

const OAuthButton = ({ label, onClick }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 38, padding: '0 12px', background: 'var(--bg-panel)',
    border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
    fontSize: 13, fontWeight: 500, color: 'var(--text)',
    transition: 'all 120ms ease',
  }}
    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-soft)'}
    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}
  >
    <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--accent-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{label[0]}</span>
    Continue with {label}
  </button>
);

// OTP screen
const OtpScreen = ({ goto, completeAuth }) => {
  const [digits, setDigits] = React.useState(['', '', '', '', '', '']);
  const [timer, setTimer] = React.useState(45);
  const refs = React.useRef([]);
  const [verifying, setVerifying] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (timer <= 0) return;
    const t = setTimeout(() => setTimer((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  const setDigit = (i, val) => {
    if (!/^[0-9]?$/.test(val)) return;
    setError(false);
    const next = [...digits];
    next[i] = val;
    setDigits(next);
    if (val && i < 5) refs.current[i + 1]?.focus();
    if (next.every((d) => d) && !verifying) {
      setVerifying(true);
      setTimeout(() => {
        // Accept any 6-digit input for prototype
        goto('onboard');
      }, 800);
    }
  };

  const onPaste = (e) => {
    const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (txt.length === 6) {
      e.preventDefault();
      setDigits(txt.split(''));
      setVerifying(true);
      setTimeout(() => goto('onboard'), 800);
    }
  };

  return (
    <AuthShell tagline="A 6-digit code is on its way." sideTone={2}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Verify your email</h1>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6 }}>We sent a code to <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>you@example.com</span></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }} onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => refs.current[i] = el}
            value={d}
            onChange={(e) => setDigit(i, e.target.value.slice(-1))}
            onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }}
            maxLength={1}
            inputMode="numeric"
            disabled={verifying}
            style={{
              width: 50, height: 56, textAlign: 'center', fontSize: 22, fontWeight: 500,
              fontFamily: 'var(--font-mono)', background: 'var(--bg-panel)',
              border: `1px solid ${error ? 'var(--danger)' : d ? 'var(--accent-line)' : 'var(--border)'}`,
              borderRadius: 10, outline: 0, color: 'var(--text)',
              transition: 'all 120ms ease',
            }}
            onFocus={(e) => e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'}
            onBlur={(e) => e.target.style.boxShadow = ''}
          />
        ))}
      </div>

      {verifying && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent)', marginBottom: 12 }}>
          <Spinner size={12}/> Verifying…
        </div>
      )}

      <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        {timer > 0 ? (
          <>Didn't get it? Resend in <span className="mono">{timer}s</span></>
        ) : (
          <a style={{ cursor: 'pointer', color: 'var(--text)', fontWeight: 500 }} onClick={() => setTimer(45)}>Resend code</a>
        )}
      </div>

      <div style={{ marginTop: 28, textAlign: 'center', fontSize: 12.5, color: 'var(--text-faint)' }}>
        Wrong email? <a onClick={() => goto('signup')} style={{ color: 'var(--text)', cursor: 'pointer' }}>Go back</a>
      </div>
    </AuthShell>
  );
};

// Onboarding wizard (3 steps)
const Onboarding = ({ completeAuth }) => {
  const [step, setStep] = React.useState(0);
  const steps = ['Download', 'Choose plan', 'Done'];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '20px 32px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Wordmark size={15}/>
        <Button variant="ghost" size="sm" onClick={completeAuth}>Skip for now</Button>
      </header>

      <div style={{ flex: 1, padding: '48px 32px', maxWidth: 720, width: '100%', margin: '0 auto' }}>
        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40, justifyContent: 'center' }}>
          {steps.map((s, i) => (
            <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: i < step ? 'var(--accent)' : i === step ? 'var(--accent-soft)' : 'var(--bg-soft)',
                  color: i < step ? 'white' : i === step ? 'var(--accent)' : 'var(--text-faint)',
                  fontSize: 12, fontWeight: 600, border: i === step ? '1px solid var(--accent-line)' : '1px solid var(--border)',
                  transition: 'all 200ms ease',
                }}>{i < step ? <IconCheck size={13}/> : i + 1}</div>
                <span style={{ fontSize: 13, fontWeight: 500, color: i <= step ? 'var(--text)' : 'var(--text-faint)' }}>{s}</span>
              </div>
              {i < steps.length - 1 && <div style={{ flex: '0 0 40px', height: 1, background: i < step ? 'var(--accent)' : 'var(--border)', transition: 'background 200ms ease' }}/>}
            </React.Fragment>
          ))}
        </div>

        {step === 0 && <OnboardDownload onNext={() => setStep(1)} />}
        {step === 1 && <OnboardPlan onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <OnboardDone onFinish={completeAuth} />}
      </div>
    </div>
  );
};

const OnboardDownload = ({ onNext }) => {
  const [os, setOs] = React.useState('mac');
  const platforms = [
    { id: 'mac', label: 'macOS', sub: 'Universal · 14.0+', cmd: 'brew install osmrouter' },
    { id: 'win', label: 'Windows', sub: 'x64 · 10/11', cmd: 'winget install osmrouter' },
    { id: 'linux', label: 'Linux', sub: 'x64 / arm64 · deb · rpm', cmd: 'curl -sSL osmrouter.dev/install | sh' },
  ];
  return (
    <div className="fade-in">
      <Card padding={32}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Install the desktop client</h2>
            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 4 }}>The client is what holds the tunnel open between your machine and the edge.</div>
          </div>
          <Badge tone="accent" dot>Detected: macOS</Badge>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
          {platforms.map((p) => (
            <button key={p.id} onClick={() => setOs(p.id)} style={{
              padding: '14px 14px', textAlign: 'left', cursor: 'pointer',
              background: os === p.id ? 'var(--accent-soft)' : 'var(--bg-panel)',
              border: `1px solid ${os === p.id ? 'var(--accent-line)' : 'var(--border)'}`,
              borderRadius: 10, transition: 'all 120ms ease',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: os === p.id ? 'var(--accent)' : 'var(--text)' }}>{p.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{p.sub}</div>
            </button>
          ))}
        </div>

        <Label>Install command</Label>
        <Code>{platforms.find((p) => p.id === os).cmd}</Code>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', gap: 12 }}>
          <IconCircle size={14} style={{ color: 'var(--text-faint)', marginTop: 2 }}/>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--text)' }}>Or download the installer</span> — get a signed binary you can run without a package manager.
          </div>
        </div>

        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant="ghost" size="sm" iconRight={<IconExternal size={12}/>}>Manual install docs</Button>
          <Button variant="primary" iconRight={<IconArrowR size={13}/>} onClick={onNext}>Continue</Button>
        </div>
      </Card>
    </div>
  );
};

const OnboardPlan = ({ onNext, onBack }) => {
  const [plan, setPlan] = React.useState('free');
  return (
    <div className="fade-in">
      <Card padding={32}>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Pick a plan</h2>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 4, marginBottom: 24 }}>You can change this anytime from billing.</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {[
            { id: 'free', name: 'Free', price: '$0', features: ['1 custom domain', '1 device', '10 GB / mo'] },
            { id: 'pro', name: 'Pro', price: '$12', features: ['Unlimited domains', '10 devices', '500 GB / mo', 'Static edge IPs'] },
          ].map((p) => (
            <button key={p.id} onClick={() => setPlan(p.id)} style={{
              padding: 20, cursor: 'pointer', textAlign: 'left',
              background: 'var(--bg-panel)',
              border: `1.5px solid ${plan === p.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 12, transition: 'all 140ms ease', position: 'relative',
            }}>
              {plan === p.id && <div style={{ position: 'absolute', top: 14, right: 14, width: 18, height: 18, borderRadius: 999, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconCheck size={11} style={{ color: 'white' }}/></div>}
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{p.name}</div>
              <div className="num" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.025em', marginTop: 8 }}>{p.price}<span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> / mo</span></div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {p.features.map((f, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text)' }}>
                    <IconCheck size={13} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }}/>{f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {plan === 'pro' && (
          <div className="fade-in" style={{ marginTop: 20, padding: 16, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <Label>Payment method</Label>
            <Input prefix="●●●●  ●●●●  ●●●●" placeholder="4242" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Input placeholder="MM / YY" />
              <Input placeholder="CVC" />
            </div>
          </div>
        )}

        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button variant="primary" iconRight={<IconArrowR size={13}/>} onClick={onNext}>
            {plan === 'pro' ? 'Start 14-day Pro trial' : 'Continue with Free'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

const OnboardDone = ({ onFinish }) => (
  <div className="fade-in">
    <Card padding={48} style={{ textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <IconCheck size={28}/>
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>You're all set</h2>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8, maxWidth: 380, margin: '8px auto 0' }}>
        Run <span className="mono" style={{ background: 'var(--bg-soft)', padding: '1px 6px', borderRadius: 4 }}>osmrouter login</span> in your terminal to authenticate the client.
      </div>
      <div style={{ marginTop: 28 }}>
        <Button variant="primary" size="lg" iconRight={<IconArrowR size={14}/>} onClick={onFinish}>Open dashboard</Button>
      </div>
    </Card>
  </div>
);

const AuthShell = ({ children, tagline, sideTone = 0 }) => (
  <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--bg)' }}>
    <div style={{ display: 'flex', flexDirection: 'column', padding: '32px 48px', justifyContent: 'space-between' }}>
      <Wordmark size={15}/>
      <div style={{ maxWidth: 380, width: '100%', margin: '0 auto', alignSelf: 'center' }}>{children}</div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>© 2026 osmRouter</div>
    </div>
    <AuthSide tagline={tagline} tone={sideTone}/>
  </div>
);

const AuthSide = ({ tagline, tone }) => (
  <div style={{
    background: 'var(--bg-soft)', borderLeft: '1px solid var(--border)',
    position: 'relative', overflow: 'hidden', padding: 48,
    display: 'flex', alignItems: 'flex-end',
  }}>
    {/* Grid pattern */}
    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.5 }} preserveAspectRatio="none">
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)"/>
    </svg>
    {/* Decorative nodes */}
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet" viewBox="0 0 400 600">
      <g opacity="0.7">
        <circle cx="80" cy="120" r="4" fill="var(--accent)"/>
        <circle cx="280" cy="180" r="3" fill="var(--text-muted)"/>
        <circle cx="180" cy="280" r="6" fill="var(--accent)" opacity="0.6"/>
        <circle cx="340" cy="340" r="3" fill="var(--text-muted)"/>
        <circle cx="100" cy="420" r="4" fill="var(--accent)"/>
        <circle cx="260" cy="480" r="3" fill="var(--text-muted)"/>
        <path d="M80 120 L180 280 L340 340" stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="3 4" fill="none"/>
        <path d="M180 280 L100 420 L260 480" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 4" fill="none"/>
        <path d="M280 180 L180 280" stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="3 4" fill="none"/>
      </g>
    </svg>
    <div style={{ position: 'relative', zIndex: 1, maxWidth: 380 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>osmRouter</div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.2 }}>{tagline}</div>
    </div>
  </div>
);

Object.assign(window, { Signup, OtpScreen, Onboarding });
