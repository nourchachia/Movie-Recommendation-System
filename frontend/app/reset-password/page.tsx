'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { resetPassword } from '@/lib/auth';

// ── Password strength bar (reuse same logic as sign-up) ──────────────────────
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
              flex: 1, height: '3px', borderRadius: '99px',
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

// ── Inner component (uses useSearchParams, must be inside Suspense) ───────────
function ResetForm() {
  const router      = useRouter();
  const params      = useSearchParams();
  const token       = params.get('token') ?? '';

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [showCf,    setShowCf]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [error,     setError]     = useState('');

  // If no token in URL, show an immediate error
  const tokenMissing = !token;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8)    return setError('Password must be at least 8 characters.');
    if (!/[A-Z]/.test(password)) return setError('Password must contain at least one uppercase letter.');
    if (!/[0-9]/.test(password)) return setError('Password must contain at least one number.');
    if (password !== confirm)    return setError('Passwords do not match.');

    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center' }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CheckCircle2 size={36} color="#22C55E" />
        </div>
        <div>
          <h2 style={{ color: 'white', fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>
            Password updated!
          </h2>
          <p style={{ color: 'var(--color-muted)', fontSize: '14px', lineHeight: 1.65 }}>
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
        </div>
        <button
          onClick={() => router.push('/login')}
          style={{
            padding: '12px 28px', borderRadius: '10px',
            background: '#E50914', border: 'none',
            color: 'white', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
          }}
        >
          Go to Sign In
        </button>
      </div>
    );
  }

  // ── Invalid / missing token ──────────────────────────────────────────────────
  if (tokenMissing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', textAlign: 'center' }}>
        <AlertCircle size={40} color="#E50914" />
        <div>
          <h2 style={{ color: 'white', fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
            Invalid reset link
          </h2>
          <p style={{ color: 'var(--color-muted)', fontSize: '14px' }}>
            This link is missing a reset token. Please request a new password reset.
          </p>
        </div>
        <Link
          href="/login"
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '10px 20px', borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'var(--color-text)', textDecoration: 'none', fontSize: '14px',
          }}
        >
          <ArrowLeft size={15} /> Back to Sign In
        </Link>
      </div>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      {/* Header */}
      <div>
        <h2 style={{ color: 'white', fontSize: '26px', fontWeight: 700, marginBottom: '6px' }}>
          Set new password
        </h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '14px' }}>
          Choose a strong password for your Flicker account.
        </p>
      </div>

      {/* New password */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.03em' }}>
          New password
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)', pointerEvents: 'none', display: 'flex' }}>
            <Lock size={16} />
          </span>
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 chars, 1 uppercase, 1 number"
            autoComplete="new-password"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
              padding: '13px 44px', color: 'var(--color-text)', fontSize: '15px', outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#E50914'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(229,9,20,0.15)'; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          <button
            type="button" onClick={() => setShowPw(!showPw)}
            style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', padding: 0 }}
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <PasswordStrength password={password} />
      </div>

      {/* Confirm password */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.03em' }}>
          Confirm password
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)', pointerEvents: 'none', display: 'flex' }}>
            <Lock size={16} />
          </span>
          <input
            type={showCf ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${confirm && confirm !== password ? '#E50914' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '10px', padding: '13px 44px',
              color: 'var(--color-text)', fontSize: '15px', outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#E50914'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(229,9,20,0.15)'; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = confirm && confirm !== password ? '#E50914' : 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          <button
            type="button" onClick={() => setShowCf(!showCf)}
            style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', padding: 0 }}
          >
            {showCf ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {confirm && confirm !== password && (
          <p style={{ fontSize: '12px', color: '#E50914', marginTop: '2px' }}>Passwords do not match.</p>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 14px', borderRadius: '10px',
          background: 'rgba(229,9,20,0.12)', border: '1px solid rgba(229,9,20,0.3)',
          color: '#FF6B6B', fontSize: '14px',
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit" disabled={loading}
        style={{
          width: '100%', padding: '14px', borderRadius: '10px',
          background: loading ? 'rgba(229,9,20,0.6)' : '#E50914',
          border: 'none', color: 'white', fontWeight: 700, fontSize: '15px',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#FF1A1A'; }}
        onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#E50914'; }}
      >
        {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Updating…</> : 'Reset Password'}
      </button>

      <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--color-muted)' }}>
        Remembered it?{' '}
        <Link href="/login" style={{ color: '#E50914', fontWeight: 600, textDecoration: 'none' }}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────
export default function ResetPasswordPage() {
  return (
    <main style={{
      minHeight: '100vh', background: 'var(--color-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background blobs */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '-15%', left: '-10%',
          width: '500px', height: '500px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(229,9,20,0.15) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', right: '-5%',
          width: '600px', height: '600px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(229,9,20,0.10) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
      </div>

      <div style={{ width: '100%', maxWidth: '440px', position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <div style={{ position: 'relative', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
        <div className="glass" style={{ borderRadius: '20px', padding: '40px 36px', boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 32px 80px rgba(0,0,0,0.7)' }}>
          <Suspense fallback={
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
              <Loader2 size={24} color="#E50914" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          }>
            <ResetForm />
          </Suspense>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
