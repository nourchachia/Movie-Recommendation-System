'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Film,
  Sparkles,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────
type View = 'signin' | 'signup' | 'forgot';

// ────────────────────────────────────────────────────────────
// Reusable Input field
// ────────────────────────────────────────────────────────────
function InputField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  icon: Icon,
  rightEl,
  error,
  autoComplete,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon: React.ElementType;
  rightEl?: React.ReactNode;
  error?: string;
  autoComplete?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label
        htmlFor={id}
        style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.03em' }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        {/* Left icon */}
        <span
          style={{
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: error ? '#E50914' : 'var(--color-muted)',
            pointerEvents: 'none',
            display: 'flex',
          }}
        >
          <Icon size={16} />
        </span>

        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${error ? '#E50914' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '10px',
            padding: '13px 44px',
            color: 'var(--color-text)',
            fontSize: '15px',
            outline: 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#E50914';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(229,9,20,0.15)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? '#E50914' : 'rgba(255,255,255,0.1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />

        {/* Right element (e.g. show/hide password) */}
        {rightEl && (
          <span
            style={{
              position: 'absolute',
              right: '14px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
            }}
          >
            {rightEl}
          </span>
        )}
      </div>
      {error && (
        <p style={{ fontSize: '12px', color: '#E50914', marginTop: '2px' }}>{error}</p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Password strength indicator
// ────────────────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', '#E50914', '#F59E0B', '#3B82F6', '#22C55E'];

  if (!password) return null;

  return (
    <div style={{ marginTop: '6px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: '3px',
              borderRadius: '99px',
              background: i <= score ? colors[score] : 'rgba(255,255,255,0.1)',
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: '11px', color: score > 0 ? colors[score] : 'var(--color-muted)' }}>
        {labels[score] || ''}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────
export default function LoginPage() {
  const [view, setView] = useState<View>('signin');

  // ─── Sign In state ───
  const [siEmail, setSiEmail] = useState('');
  const [siPassword, setSiPassword] = useState('');
  const [siShowPw, setSiShowPw] = useState(false);
  const [siLoading, setSiLoading] = useState(false);
  const [siErrors, setSiErrors] = useState<{ email?: string; password?: string }>({});

  // ─── Sign Up state ───
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [suShowPw, setSuShowPw] = useState(false);
  const [suShowConfirm, setSuShowConfirm] = useState(false);
  const [suLoading, setSuLoading] = useState(false);
  const [suErrors, setSuErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [suDone, setSuDone] = useState(false);

  // ─── Forgot state ───
  const [fpEmail, setFpEmail] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpDone, setFpDone] = useState(false);
  const [fpError, setFpError] = useState('');

  // ─── Helpers ───
  const validateEmail = (v: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Please enter a valid email address.';

  // ─── Sign In submit ───
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: typeof siErrors = {};
    const emailErr = validateEmail(siEmail);
    if (emailErr) errors.email = emailErr;
    if (!siPassword) errors.password = 'Password is required.';
    if (Object.keys(errors).length) { setSiErrors(errors); return; }
    setSiErrors({});
    setSiLoading(true);
    // TODO: wire to real auth endpoint
    await new Promise((r) => setTimeout(r, 1500));
    setSiLoading(false);
  };

  // ─── Sign Up submit ───
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: typeof suErrors = {};
    if (!suName.trim() || suName.trim().length < 2) errors.name = 'Name must be at least 2 characters.';
    const emailErr = validateEmail(suEmail);
    if (emailErr) errors.email = emailErr;
    if (suPassword.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (suConfirm !== suPassword) errors.confirm = 'Passwords do not match.';
    if (Object.keys(errors).length) { setSuErrors(errors); return; }
    setSuErrors({});
    setSuLoading(true);
    // TODO: wire to real auth endpoint
    await new Promise((r) => setTimeout(r, 1500));
    setSuLoading(false);
    setSuDone(true);
  };

  // ─── Forgot Password submit ───
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(fpEmail);
    if (emailErr) { setFpError(emailErr); return; }
    setFpError('');
    setFpLoading(true);
    // TODO: wire to real auth endpoint
    await new Promise((r) => setTimeout(r, 1400));
    setFpLoading(false);
    setFpDone(true);
  };

  // ────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── Background cinematic blur blobs ── */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-15%',
            left: '-10%',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(229,9,20,0.18) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-20%',
            right: '-5%',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(229,9,20,0.12) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      {/* ── Left panel — branding (desktop only) ── */}
      <aside
        style={{
          display: 'none',
          flex: '1',
          background: 'linear-gradient(135deg, #0D0D0D 0%, #1a0000 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px',
          position: 'relative',
          overflow: 'hidden',
          zIndex: 1,
        }}
        className="auth-aside"
      >
        {/* logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <div style={{ position: 'relative', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, background: '#E50914', borderRadius: '6px' }} />
            <svg style={{ position: 'relative', zIndex: 1, width: '22px', height: '22px', color: 'white' }} viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="4" height="4" rx="0.5" fill="white" />
              <rect x="10" y="2" width="4" height="4" rx="0.5" fill="white" />
              <rect x="18" y="2" width="4" height="4" rx="0.5" fill="white" />
              <rect x="2" y="10" width="20" height="12" rx="1" fill="white" />
              <circle cx="12" cy="16" r="2.5" fill="#E50914" />
            </svg>
          </div>
          <span style={{ color: 'white', fontFamily: 'var(--font-display)', fontSize: '26px', fontWeight: 900, letterSpacing: '0.15em' }}>
            FLICKER
          </span>
        </Link>

        {/* Center illustration */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px', textAlign: 'center' }}>
          {/* big icon cluster */}
          <div style={{ position: 'relative', width: '160px', height: '160px' }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(circle, rgba(229,9,20,0.25) 0%, transparent 70%)',
              borderRadius: '50%',
            }} />
            <div style={{
              position: 'absolute', inset: '20px',
              border: '1px dashed rgba(229,9,20,0.3)',
              borderRadius: '50%',
              animation: 'spin 20s linear infinite',
            }} />
            <div style={{
              position: 'absolute',
              inset: '40px',
              background: 'rgba(229,9,20,0.15)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(229,9,20,0.3)',
            }}>
              <Film size={48} color="#E50914" />
            </div>
          </div>

          <div>
            <h1 style={{ color: 'white', fontSize: '32px', fontFamily: 'var(--font-display)', letterSpacing: '0.08em', marginBottom: '12px', lineHeight: 1.15 }}>
              YOUR PERFECT FILM<br />AWAITS YOU
            </h1>
            <p style={{ color: 'var(--color-muted)', fontSize: '15px', lineHeight: 1.65, maxWidth: '280px' }}>
              AI-powered recommendations tailored to your taste. Discover movies you'll love — every time.
            </p>
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
            {['Personalized picks', 'Smart watchlists', 'Trending now', 'Mood filters'].map((feat) => (
              <span
                key={feat}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '99px',
                  background: 'rgba(229,9,20,0.12)',
                  border: '1px solid rgba(229,9,20,0.2)',
                  color: '#FF6B6B',
                  fontSize: '12px',
                  fontWeight: 500,
                }}
              >
                <Sparkles size={11} />
                {feat}
              </span>
            ))}
          </div>
        </div>

        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
          © 2025 Flicker · All rights reserved
        </p>
      </aside>

      {/* ── Right panel — auth card ── */}
      <section
        style={{
          flex: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '440px',
          }}
        >
          {/* Mobile logo */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }} className="mobile-logo">
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
              <div style={{ position: 'relative', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ position: 'absolute', inset: 0, background: '#E50914', borderRadius: '5px' }} />
                <svg style={{ position: 'relative', zIndex: 1, width: '18px', height: '18px' }} viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="2" width="4" height="4" rx="0.5" fill="white" />
                  <rect x="10" y="2" width="4" height="4" rx="0.5" fill="white" />
                  <rect x="18" y="2" width="4" height="4" rx="0.5" fill="white" />
                  <rect x="2" y="10" width="20" height="12" rx="1" fill="white" />
                  <circle cx="12" cy="16" r="2.5" fill="#E50914" />
                </svg>
              </div>
              <span style={{ color: 'white', fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 900, letterSpacing: '0.15em' }}>
                FLICKER
              </span>
            </Link>
          </div>

          {/* Glass card */}
          <div
            className="glass"
            style={{
              borderRadius: '20px',
              padding: '40px 36px',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 32px 80px rgba(0,0,0,0.7)',
            }}
          >
            {view === 'signin' && (
              <SignInForm
                email={siEmail} setEmail={setSiEmail}
                password={siPassword} setPassword={setSiPassword}
                showPw={siShowPw} setShowPw={setSiShowPw}
                loading={siLoading}
                errors={siErrors}
                onSubmit={handleSignIn}
                onSignUp={() => { setSiErrors({}); setView('signup'); }}
                onForgot={() => { setSiErrors({}); setView('forgot'); }}
              />
            )}

            {view === 'signup' && (
              <SignUpForm
                name={suName} setName={setSuName}
                email={suEmail} setEmail={setSuEmail}
                password={suPassword} setPassword={setSuPassword}
                confirm={suConfirm} setConfirm={setSuConfirm}
                showPw={suShowPw} setShowPw={setSuShowPw}
                showConfirm={suShowConfirm} setShowConfirm={setSuShowConfirm}
                loading={suLoading}
                errors={suErrors}
                done={suDone}
                onSubmit={handleSignUp}
                onSignIn={() => { setSuErrors({}); setSuDone(false); setView('signin'); }}
              />
            )}

            {view === 'forgot' && (
              <ForgotForm
                email={fpEmail} setEmail={setFpEmail}
                loading={fpLoading}
                done={fpDone}
                error={fpError}
                onSubmit={handleForgot}
                onBack={() => { setFpDone(false); setFpError(''); setView('signin'); }}
              />
            )}
          </div>
        </div>
      </section>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .auth-form-anim { animation: fadeIn 0.35s ease both; }
        @media (min-width: 900px) {
          .auth-aside { display: flex !important; }
          .mobile-logo { display: none !important; }
        }
      `}</style>
    </main>
  );
}

// ────────────────────────────────────────────────────────────
// Sign In Form
// ────────────────────────────────────────────────────────────
function SignInForm({
  email, setEmail, password, setPassword,
  showPw, setShowPw, loading, errors, onSubmit, onSignUp, onForgot,
}: {
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  showPw: boolean; setShowPw: (v: boolean) => void;
  loading: boolean;
  errors: { email?: string; password?: string };
  onSubmit: (e: React.FormEvent) => void;
  onSignUp: () => void;
  onForgot: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="auth-form-anim" noValidate style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header */}
      <div>
        <h2 style={{ color: 'white', fontSize: '26px', fontWeight: 700, marginBottom: '6px' }}>Welcome back</h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '14px' }}>Sign in to continue to Flicker</p>
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <InputField
          id="si-email" label="Email address" type="email"
          value={email} onChange={setEmail} placeholder="you@example.com"
          icon={Mail} error={errors.email} autoComplete="email"
        />
        <InputField
          id="si-password" label="Password" type={showPw ? 'text' : 'password'}
          value={password} onChange={setPassword} placeholder="••••••••"
          icon={Lock} error={errors.password} autoComplete="current-password"
          rightEl={
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', padding: 0 }}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />
        <div style={{ textAlign: 'right', marginTop: '-8px' }}>
          <button
            type="button"
            onClick={onForgot}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-red)', fontSize: '13px', padding: 0, fontWeight: 500 }}
          >
            Forgot password?
          </button>
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: '10px',
          background: loading ? 'rgba(229,9,20,0.6)' : '#E50914',
          border: 'none',
          color: 'white',
          fontWeight: 700,
          fontSize: '15px',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'background 0.2s, transform 0.1s',
          letterSpacing: '0.02em',
        }}
        onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#FF1A1A'; }}
        onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#E50914'; }}
        onMouseDown={(e) => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Signing in…</> : 'Sign In'}
      </button>

      {/* Switch */}
      <p style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: '14px' }}>
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onSignUp}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E50914', fontWeight: 600, padding: 0 }}
        >
          Create one
        </button>
      </p>
    </form>
  );
}

// ────────────────────────────────────────────────────────────
// Sign Up Form
// ────────────────────────────────────────────────────────────
function SignUpForm({
  name, setName, email, setEmail,
  password, setPassword, confirm, setConfirm,
  showPw, setShowPw, showConfirm, setShowConfirm,
  loading, errors, done, onSubmit, onSignIn,
}: {
  name: string; setName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  confirm: string; setConfirm: (v: string) => void;
  showPw: boolean; setShowPw: (v: boolean) => void;
  showConfirm: boolean; setShowConfirm: (v: boolean) => void;
  loading: boolean;
  errors: { name?: string; email?: string; password?: string; confirm?: string };
  done: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onSignIn: () => void;
}) {
  if (done) {
    return (
      <div className="auth-form-anim" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center', padding: '16px 0' }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CheckCircle2 size={36} color="#22C55E" />
        </div>
        <div>
          <h3 style={{ color: 'white', fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>Account created!</h3>
          <p style={{ color: 'var(--color-muted)', fontSize: '14px', lineHeight: 1.6 }}>
            Welcome to Flicker. Check your inbox to verify your email address.
          </p>
        </div>
        <button
          onClick={onSignIn}
          style={{
            padding: '12px 28px', borderRadius: '10px', background: '#E50914',
            border: 'none', color: 'white', fontWeight: 700, fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Go to Sign In
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="auth-form-anim" noValidate style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h2 style={{ color: 'white', fontSize: '26px', fontWeight: 700, marginBottom: '6px' }}>Create account</h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '14px' }}>Join Flicker and discover your next favorite film</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <InputField
          id="su-name" label="Full name" type="text"
          value={name} onChange={setName} placeholder="Jane Doe"
          icon={User} error={errors.name} autoComplete="name"
        />
        <InputField
          id="su-email" label="Email address" type="email"
          value={email} onChange={setEmail} placeholder="you@example.com"
          icon={Mail} error={errors.email} autoComplete="email"
        />
        <div>
          <InputField
            id="su-password" label="Password" type={showPw ? 'text' : 'password'}
            value={password} onChange={setPassword} placeholder="Min. 8 characters"
            icon={Lock} error={errors.password} autoComplete="new-password"
            rightEl={
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', padding: 0 }}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />
          <PasswordStrength password={password} />
        </div>
        <InputField
          id="su-confirm" label="Confirm password" type={showConfirm ? 'text' : 'password'}
          value={confirm} onChange={setConfirm} placeholder="Repeat your password"
          icon={Lock} error={errors.confirm} autoComplete="new-password"
          rightEl={
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', padding: 0 }}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%', padding: '14px', borderRadius: '10px',
          background: loading ? 'rgba(229,9,20,0.6)' : '#E50914',
          border: 'none', color: 'white', fontWeight: 700, fontSize: '15px',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          transition: 'background 0.2s, transform 0.1s',
        }}
        onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#FF1A1A'; }}
        onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#E50914'; }}
        onMouseDown={(e) => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Creating account…</> : 'Create Account'}
      </button>

      <p style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: '13px', lineHeight: 1.6 }}>
        By signing up you agree to our{' '}
        <a href="#" style={{ color: '#E50914', textDecoration: 'none' }}>Terms of Service</a>{' '}
        &amp;{' '}
        <a href="#" style={{ color: '#E50914', textDecoration: 'none' }}>Privacy Policy</a>
      </p>

      <p style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: '14px' }}>
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSignIn}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E50914', fontWeight: 600, padding: 0 }}
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

// ────────────────────────────────────────────────────────────
// Forgot Password Form
// ────────────────────────────────────────────────────────────
function ForgotForm({
  email, setEmail, loading, done, error, onSubmit, onBack,
}: {
  email: string; setEmail: (v: string) => void;
  loading: boolean; done: boolean; error: string;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  if (done) {
    return (
      <div className="auth-form-anim" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center', padding: '16px 0' }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Mail size={32} color="#3B82F6" />
        </div>
        <div>
          <h3 style={{ color: 'white', fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>Check your inbox</h3>
          <p style={{ color: 'var(--color-muted)', fontSize: '14px', lineHeight: 1.65, maxWidth: '300px' }}>
            We&apos;ve sent a password reset link to <strong style={{ color: 'white' }}>{email}</strong>. It may take a few minutes.
          </p>
        </div>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '8px', padding: '10px 20px',
            color: 'var(--color-text)', cursor: 'pointer', fontSize: '14px', fontWeight: 500,
          }}
        >
          <ArrowLeft size={15} /> Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="auth-form-anim" noValidate style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-muted)', fontSize: '13px', padding: 0,
          width: 'fit-content',
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-muted)'}
      >
        <ArrowLeft size={15} /> Back to Sign In
      </button>

      <div>
        <h2 style={{ color: 'white', fontSize: '26px', fontWeight: 700, marginBottom: '6px' }}>Reset password</h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '14px', lineHeight: 1.6 }}>
          Enter your email and we&apos;ll send you a link to reset your password.
        </p>
      </div>

      <InputField
        id="fp-email" label="Email address" type="email"
        value={email} onChange={setEmail} placeholder="you@example.com"
        icon={Mail} error={error} autoComplete="email"
      />

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%', padding: '14px', borderRadius: '10px',
          background: loading ? 'rgba(229,9,20,0.6)' : '#E50914',
          border: 'none', color: 'white', fontWeight: 700, fontSize: '15px',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          transition: 'background 0.2s, transform 0.1s',
        }}
        onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#FF1A1A'; }}
        onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#E50914'; }}
        onMouseDown={(e) => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Sending link…</> : 'Send Reset Link'}
      </button>
    </form>
  );
}
