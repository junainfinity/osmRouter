// Shared UI primitives — buttons, cards, inputs, modals, badges, tables.

const cn = (...c) => c.filter(Boolean).join(' ');

// ---------- Button ----------
const Button = ({ variant = 'secondary', size = 'md', icon, iconRight, children, style, onClick, disabled, type = 'button', full, danger, ...rest }) => {
  const sizes = {
    sm: { padding: '4px 10px', height: 28, fontSize: 12.5, gap: 6, radius: 6 },
    md: { padding: '6px 12px', height: 34, fontSize: 13.5, gap: 7, radius: 7 },
    lg: { padding: '8px 16px', height: 40, fontSize: 14, gap: 8, radius: 8 },
  }[size];
  const variants = {
    primary: {
      background: 'var(--accent)', color: 'white', border: '1px solid transparent',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 1px 2px rgba(0,0,0,0.08)',
    },
    secondary: {
      background: 'var(--bg-panel)', color: 'var(--text)', border: '1px solid var(--border)',
      boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
    },
    ghost: { background: 'transparent', color: 'var(--text)', border: '1px solid transparent' },
    soft: { background: 'var(--bg-soft)', color: 'var(--text)', border: '1px solid var(--border)' },
    danger: { background: 'var(--danger)', color: 'white', border: '1px solid transparent' },
    dangerSoft: { background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid transparent' },
  };
  const v = danger ? variants.danger : variants[variant] || variants.secondary;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: sizes.height, padding: sizes.padding, fontSize: sizes.fontSize, gap: sizes.gap,
        borderRadius: sizes.radius, cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 500, transition: 'all 120ms ease', whiteSpace: 'nowrap', userSelect: 'none',
        opacity: disabled ? 0.5 : 1, width: full ? '100%' : 'auto',
        ...v, ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === 'primary' || danger) e.currentTarget.style.filter = 'brightness(1.08)';
        else if (variant === 'ghost') e.currentTarget.style.background = 'var(--bg-soft)';
        else e.currentTarget.style.background = 'var(--bg-soft)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = '';
        e.currentTarget.style.background = v.background;
      }}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
};

// ---------- Card / Panel ----------
const Card = ({ children, style, padding = 20, hover, ...rest }) => (
  <div
    style={{
      background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12,
      padding, boxShadow: 'var(--shadow-sm)', transition: 'border-color 120ms ease', ...style,
    }}
    onMouseEnter={hover ? (e) => e.currentTarget.style.borderColor = 'var(--border-strong)' : undefined}
    onMouseLeave={hover ? (e) => e.currentTarget.style.borderColor = 'var(--border)' : undefined}
    {...rest}
  >
    {children}
  </div>
);

const SectionHeader = ({ title, subtitle, action, style }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16, ...style }}>
    <div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--text)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</div>}
    </div>
    {action}
  </div>
);

const PageHeader = ({ title, subtitle, action, eyebrow }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 28 }}>
    <div>
      {eyebrow && <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>{eyebrow}</div>}
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, color: 'var(--text)' }}>{title}</h1>
      {subtitle && <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>{subtitle}</div>}
    </div>
    {action && <div style={{ display: 'flex', gap: 8 }}>{action}</div>}
  </div>
);

// ---------- Input ----------
const Input = ({ icon, prefix, suffix, style, fullWidth = true, size = 'md', ...rest }) => {
  const h = { sm: 30, md: 36, lg: 40 }[size];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '0 10px', height: h, transition: 'all 120ms ease',
      width: fullWidth ? '100%' : 'auto',
      ...style,
    }}
    onFocusCapture={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
    onBlurCapture={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = ''; }}
    >
      {icon && <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>{icon}</span>}
      {prefix && <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{prefix}</span>}
      <input
        style={{ border: 0, outline: 0, background: 'transparent', flex: 1, fontSize: 13.5, color: 'var(--text)', minWidth: 0 }}
        {...rest}
      />
      {suffix && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{suffix}</span>}
    </div>
  );
};

const Label = ({ children, hint, style }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, ...style }}>
    <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }}>{children}</label>
    {hint && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{hint}</span>}
  </div>
);

const Field = ({ label, hint, error, children }) => (
  <div>
    {label && <Label hint={hint}>{label}</Label>}
    {children}
    {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
  </div>
);

// ---------- Badge ----------
const Badge = ({ children, tone = 'neutral', dot, style }) => {
  const tones = {
    neutral: { bg: 'var(--bg-soft)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success)', dot: 'var(--success)' },
    warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)', dot: 'var(--warn)' },
    danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)', dot: 'var(--danger)' },
    accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)', dot: 'var(--accent)' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px',
      background: t.bg, color: t.fg, fontSize: 11.5, fontWeight: 500, borderRadius: 999,
      lineHeight: 1.5, whiteSpace: 'nowrap', ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: t.dot, display: 'inline-block', animation: tone === 'success' ? 'pulse 2s ease infinite' : '' }} />}
      {children}
    </span>
  );
};

// ---------- KPI Stat ----------
const Stat = ({ label, value, suffix, delta, hint, accent, big }) => (
  <div style={{ padding: '20px 22px', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12 }}>
    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{label}</span>
      {delta && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: delta.startsWith('-') ? 'var(--danger)' : 'var(--success)', fontFamily: 'var(--font-mono)' }}>
          {delta.startsWith('-') ? <IconArrowDn size={11}/> : <IconArrowUp size={11}/>}
          {delta.replace('-', '')}
        </span>
      )}
    </div>
    <div className="num" style={{ fontSize: big ? 38 : 32, fontWeight: 500, letterSpacing: '-0.025em', marginTop: 8, color: accent ? 'var(--accent)' : 'var(--text)' }}>
      {value}
      {suffix && <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>{suffix}</span>}
    </div>
    {hint && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>{hint}</div>}
  </div>
);

// ---------- Modal ----------
const Modal = ({ open, onClose, title, children, footer, width = 480, danger }) => {
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel)', borderRadius: 14, width, maxWidth: 'calc(100vw - 32px)',
          boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)',
          animation: 'fadeIn 200ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div style={{ padding: '18px 22px 0 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {danger && <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconWarn size={16}/></div>}
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, padding: 4, cursor: 'pointer', color: 'var(--text-faint)', borderRadius: 6 }}>
            <IconX size={16}/>
          </button>
        </div>
        <div style={{ padding: '14px 22px 18px' }}>{children}</div>
        {footer && (
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', background: 'var(--bg)', borderRadius: '0 0 14px 14px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------- Table ----------
const Table = ({ columns, rows, empty, onRowClick }) => (
  <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
    <div style={{
      display: 'grid', gridTemplateColumns: columns.map(c => c.width || '1fr').join(' '),
      padding: '12px 18px', fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase',
      letterSpacing: '0.06em', fontWeight: 500, borderBottom: '1px solid var(--border)', background: 'var(--bg)',
      fontFamily: 'var(--font-mono)',
    }}>
      {columns.map((c, i) => (
        <div key={i} style={{ textAlign: c.align || 'left' }}>{c.label}</div>
      ))}
    </div>
    {rows.length === 0 ? (
      <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>{empty || 'No results.'}</div>
    ) : rows.map((row, i) => (
      <div
        key={i}
        onClick={onRowClick ? () => onRowClick(row, i) : undefined}
        style={{
          display: 'grid', gridTemplateColumns: columns.map(c => c.width || '1fr').join(' '),
          padding: '16px 18px', fontSize: 13.5, borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 0,
          alignItems: 'center', cursor: onRowClick ? 'pointer' : 'default', transition: 'background 100ms ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-soft)'}
        onMouseLeave={(e) => e.currentTarget.style.background = ''}
      >
        {columns.map((c, j) => (
          <div key={j} style={{ textAlign: c.align || 'left', minWidth: 0 }}>{c.render ? c.render(row) : row[c.key]}</div>
        ))}
      </div>
    ))}
  </div>
);

// ---------- Sparkline ----------
const Sparkline = ({ data, height = 36, color = 'var(--accent)', fill = true }) => {
  const w = 120, h = height;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => [i / (data.length - 1) * w, h - ((v - min) / range) * (h - 4) - 2]);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={area} fill={color} opacity="0.10" />}
      <path d={path} stroke={color} strokeWidth="1.4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// ---------- Code block ----------
const Code = ({ children, onCopy, copyable }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    if (typeof children === 'string') navigator.clipboard?.writeText(children).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
    onCopy && onCopy();
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8,
      fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text)', overflow: 'hidden',
    }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {copyable !== false && (
        <button onClick={handleCopy} style={{ background: 'transparent', border: 0, padding: 4, cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-faint)', borderRadius: 4, display: 'inline-flex' }}>
          {copied ? <IconCheck size={14}/> : <IconCopy size={14}/>}
        </button>
      )}
    </div>
  );
};

// ---------- Progress ----------
const Progress = ({ value, max = 100, tone = 'accent', height = 6 }) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const toneColor = { accent: 'var(--accent)', success: 'var(--success)', warn: 'var(--warn)', danger: 'var(--danger)' }[tone];
  return (
    <div style={{ height, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: toneColor, borderRadius: 999, transition: 'width 320ms ease' }} />
    </div>
  );
};

// ---------- Empty state ----------
const Empty = ({ icon, title, subtitle, action }) => (
  <div style={{ textAlign: 'center', padding: '64px 24px', background: 'var(--bg-panel)', border: '1px dashed var(--border-strong)', borderRadius: 12 }}>
    {icon && <div style={{ display: 'inline-flex', padding: 12, background: 'var(--bg-soft)', borderRadius: 12, marginBottom: 14, color: 'var(--text-muted)' }}>{icon}</div>}
    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
    {subtitle && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, maxWidth: 380, margin: '0 auto 16px' }}>{subtitle}</div>}
    {action}
  </div>
);

// ---------- Tabs ----------
const Tabs = ({ items, value, onChange, style }) => (
  <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 24, ...style }}>
    {items.map((it) => (
      <button
        key={it.value}
        onClick={() => onChange(it.value)}
        style={{
          padding: '10px 14px', background: 'transparent', border: 0, cursor: 'pointer',
          fontSize: 13.5, fontWeight: 500, color: value === it.value ? 'var(--text)' : 'var(--text-muted)',
          borderBottom: value === it.value ? '2px solid var(--accent)' : '2px solid transparent',
          marginBottom: -1, transition: 'all 120ms ease',
        }}
      >
        {it.label}{it.count != null && <span style={{ marginLeft: 6, fontSize: 11.5, color: 'var(--text-faint)' }}>{it.count}</span>}
      </button>
    ))}
  </div>
);

// ---------- Spinner ----------
const Spinner = ({ size = 14 }) => (
  <div style={{
    width: size, height: size, borderRadius: '50%',
    border: '1.5px solid var(--border-strong)', borderTopColor: 'var(--accent)',
    animation: 'spin 700ms linear infinite', display: 'inline-block',
  }} />
);

// ---------- Status dot ----------
const StatusDot = ({ online, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
    <span style={{
      width: 7, height: 7, borderRadius: 999,
      background: online ? 'var(--success)' : 'var(--text-faint)',
      boxShadow: online ? '0 0 0 3px var(--success-soft)' : 'none',
      animation: online ? 'pulse 2.4s ease-in-out infinite' : '',
    }} />
    {label && <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>}
  </span>
);

// ---------- Toast ----------
const ToastCtx = React.createContext({ toast: () => {} });
const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = React.useState([]);
  const toast = React.useCallback((opts) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.duration || 3000);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 100 }}>
        {toasts.map((t) => (
          <div key={t.id} className="fade-in" style={{
            background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '12px 14px', minWidth: 280, maxWidth: 380, boxShadow: 'var(--shadow-lg)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <div style={{ color: t.tone === 'success' ? 'var(--success)' : t.tone === 'danger' ? 'var(--danger)' : 'var(--accent)', display: 'inline-flex', marginTop: 1 }}>
              {t.tone === 'success' ? <IconCheckCircle size={16}/> : t.tone === 'danger' ? <IconAlert size={16}/> : <IconBell size={16}/>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{t.title}</div>
              {t.body && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};
const useToast = () => React.useContext(ToastCtx).toast;

// ---------- Menu (simple dropdown) ----------
const Menu = ({ trigger, items, align = 'right' }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <span onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{trigger}</span>
      {open && (
        <div className="fade-in" style={{
          position: 'absolute', [align]: 0, top: 'calc(100% + 4px)',
          background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: 'var(--shadow-lg)', minWidth: 200, padding: 4, zIndex: 60,
        }}>
          {items.map((it, i) => it.divider ? (
            <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
          ) : (
            <button
              key={i}
              onClick={() => { setOpen(false); it.onClick && it.onClick(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px',
                fontSize: 13, color: it.danger ? 'var(--danger)' : 'var(--text)', background: 'transparent',
                border: 0, borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = it.danger ? 'var(--danger-soft)' : 'var(--bg-soft)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {it.icon}<span>{it.label}</span>
              {it.shortcut && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{it.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------- Switch ----------
const Switch = ({ checked, onChange, label, hint }) => (
  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, borderRadius: 999, padding: 2, marginTop: 2,
        background: checked ? 'var(--accent)' : 'var(--border-strong)', border: 0, cursor: 'pointer',
        transition: 'all 160ms ease', flexShrink: 0,
      }}
    >
      <span style={{
        display: 'block', width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transform: checked ? 'translateX(14px)' : 'translateX(0)', transition: 'transform 160ms ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }} />
    </button>
    {label && (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
    )}
  </label>
);

Object.assign(window, {
  Button, Card, SectionHeader, PageHeader, Input, Label, Field, Badge, Stat, Modal, Table,
  Sparkline, Code, Progress, Empty, Tabs, Spinner, StatusDot, ToastProvider, useToast, Menu, Switch, cn,
});
