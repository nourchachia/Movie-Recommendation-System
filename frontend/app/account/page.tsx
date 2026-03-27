'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck, ShieldOff, UserCircle, AlertTriangle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { useAuth } from '@/context/AuthContext';
import * as authApi from '@/lib/auth';

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 18,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'rgba(163,163,163,1)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{children}</div>;
}

export default function AccountPage() {
  const { user, accessToken, isLoading: authLoading, logout } = useAuth();

  const [me, setMe] = useState<authApi.AuthUser | null>(null);
  const [profile, setProfile] = useState<authApi.UserProfile | null>(null);

  const [loadingMe, setLoadingMe] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2FA flow state
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [twoFaMessage, setTwoFaMessage] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');

  // Deactivate flow state
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState('');
  const [deactivateMessage, setDeactivateMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!accessToken) return;

    setError(null);
    setTwoFaMessage(null);
    setDeactivateMessage(null);

    setLoadingMe(true);
    authApi
      .getMe(accessToken)
      .then((m) => setMe(m))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load account'))
      .finally(() => setLoadingMe(false));
  }, [accessToken, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    if (!accessToken) return;
    if (!user?.id) return;

    setLoadingProfile(true);
    authApi
      .getUserProfile(user.id, accessToken)
      .then((p) => setProfile(p))
      .catch((e) => {
        // Backend returns 404 if the user has no ratings yet — treat as empty profile.
        const msg = e instanceof Error ? e.message : 'Failed to load profile';
        if (msg.toLowerCase().includes('no ratings')) setProfile(null);
        else setError(msg);
      })
      .finally(() => setLoadingProfile(false));
  }, [accessToken, authLoading, user?.id]);

  const topGenres = useMemo(() => profile?.top_genres ?? [], [profile]);

  const onSetup2fa = async () => {
    if (!accessToken) return;
    setTwoFaBusy(true);
    setTwoFaMessage(null);
    try {
      const res = await authApi.setup2fa(accessToken);
      setTwoFaMessage(res.message);
    } catch (e) {
      setTwoFaMessage(e instanceof Error ? e.message : 'Failed to start 2FA setup');
    } finally {
      setTwoFaBusy(false);
    }
  };

  const onVerify2fa = async () => {
    if (!accessToken) return;
    const code = verifyCode.trim();
    if (code.length !== 6) {
      setTwoFaMessage('Please enter the 6-digit code from your email.');
      return;
    }
    setTwoFaBusy(true);
    setTwoFaMessage(null);
    try {
      const res = await authApi.verify2fa(code, accessToken);
      setTwoFaMessage(res.message);
      setVerifyCode('');
      const fresh = await authApi.getMe(accessToken);
      setMe(fresh);
    } catch (e) {
      setTwoFaMessage(e instanceof Error ? e.message : 'Failed to verify 2FA code');
    } finally {
      setTwoFaBusy(false);
    }
  };

  const onDisable2fa = async () => {
    if (!accessToken) return;
    if (!disablePassword.trim()) {
      setTwoFaMessage('Password is required to disable 2FA.');
      return;
    }
    setTwoFaBusy(true);
    setTwoFaMessage(null);
    try {
      const res = await authApi.disable2fa(disablePassword, accessToken);
      setTwoFaMessage(res.message);
      setDisablePassword('');
      const fresh = await authApi.getMe(accessToken);
      setMe(fresh);
    } catch (e) {
      setTwoFaMessage(e instanceof Error ? e.message : 'Failed to disable 2FA');
    } finally {
      setTwoFaBusy(false);
    }
  };

  const onDeactivate = async () => {
    if (!accessToken) return;
    if (!deactivatePassword.trim()) {
      setDeactivateMessage('Password is required to deactivate your account.');
      return;
    }
    setDeactivateBusy(true);
    setDeactivateMessage(null);
    try {
      const res = await authApi.deactivateMe(deactivatePassword, accessToken);
      setDeactivateMessage(res.message);
      logout();
    } catch (e) {
      setDeactivateMessage(e instanceof Error ? e.message : 'Failed to deactivate account');
    } finally {
      setDeactivateBusy(false);
    }
  };

  if (!authLoading && !accessToken) {
    return (
      <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
        <Navbar />
        <div style={{ paddingTop: 110, maxWidth: 860, margin: '0 auto', paddingLeft: 24, paddingRight: 24 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <UserCircle size={20} color="white" />
              <h1 style={{ color: 'white', fontSize: 20, fontWeight: 900, margin: 0 }}>Account</h1>
            </div>
            <p style={{ color: 'rgba(163,163,163,1)', marginTop: 0 }}>
              Please sign in to manage your account settings.
            </p>
            <Link
              href="/login"
              className="font-bold text-white bg-[#E50914] hover:bg-[#FF1A1A] rounded-lg transition-all duration-200 inline-block"
              style={{ padding: '12px 18px' }}
            >
              Sign In
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
      <Navbar />

      <div style={{ paddingTop: 110, paddingBottom: 70, maxWidth: 960, margin: '0 auto', paddingLeft: 24, paddingRight: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserCircle size={22} color="white" />
            <h1 style={{ color: 'white', fontSize: 22, fontWeight: 900, margin: 0 }}>Account</h1>
          </div>
          {(loadingMe || loadingProfile) && <Loader2 className="animate-spin" size={18} color="rgba(229,9,20,1)" />}
        </div>

        {error && (
          <div style={{ marginBottom: 14, color: 'white' }}>
            <Card>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <AlertTriangle size={18} color="#E50914" />
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>Something went wrong</div>
                  <div style={{ color: 'rgba(163,163,163,1)' }}>{error}</div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Profile */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, marginBottom: 14 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ color: 'white', fontWeight: 900, fontSize: 16, marginBottom: 6 }}>Profile</div>
                <div style={{ color: 'rgba(163,163,163,1)', fontSize: 13 }}>
                  Signed in as <span style={{ color: 'white', fontWeight: 800 }}>{me?.username ?? user?.username ?? '...'}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'rgba(163,163,163,1)', fontSize: 12, fontWeight: 700 }}>Email</div>
                <div style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>{me?.email ?? user?.email ?? '...'}</div>
              </div>
            </div>

            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <div>
                <Label>Total ratings</Label>
                <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>{profile?.total_ratings ?? '—'}</div>
              </div>
              <div>
                <Label>Average rating</Label>
                <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>{profile?.average_rating ?? '—'}</div>
              </div>
              <div>
                <Label>Top genres</Label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {topGenres.length ? (
                    topGenres.map((g) => (
                      <span
                        key={g}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          borderRadius: 999,
                          background: 'rgba(229,9,20,0.12)',
                          border: '1px solid rgba(229,9,20,0.25)',
                          color: 'rgba(255,255,255,0.9)',
                          fontWeight: 800,
                        }}
                      >
                        {g}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'rgba(163,163,163,1)', fontSize: 12 }}>No ratings yet</span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* 2FA */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            {me?.totp_enabled ? <ShieldCheck size={18} color="white" /> : <ShieldOff size={18} color="rgba(163,163,163,1)" />}
            <div style={{ color: 'white', fontWeight: 900, fontSize: 16 }}>Two‑Factor Authentication (Email Code)</div>
          </div>
          <div style={{ color: 'rgba(163,163,163,1)', fontSize: 13, marginBottom: 14 }}>
            {me?.totp_enabled
              ? '2FA is enabled. You’ll need a verification code when logging in.'
              : 'Enable 2FA to protect your account with a 6‑digit email code.'}
          </div>

          {!me?.totp_enabled ? (
            <>
              <button
                onClick={onSetup2fa}
                disabled={twoFaBusy || loadingMe}
                className="font-bold text-white bg-[#E50914] hover:bg-[#FF1A1A] rounded-lg transition-all duration-200"
                style={{ padding: '10px 14px' }}
              >
                {twoFaBusy ? 'Sending…' : 'Send setup code to my email'}
              </button>

              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                  style={{
                    width: 180,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: 'white',
                    outline: 'none',
                    fontWeight: 700,
                    letterSpacing: 2,
                  }}
                />
                <button
                  onClick={onVerify2fa}
                  disabled={twoFaBusy || verifyCode.trim().length !== 6}
                  className="font-bold text-white border border-white/20 hover:border-white/40 rounded-lg transition-all duration-200"
                  style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.06)' }}
                >
                  Verify & enable
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Password to disable"
                  type="password"
                  style={{
                    width: 260,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: 'white',
                    outline: 'none',
                    fontWeight: 700,
                  }}
                />
                <button
                  onClick={onDisable2fa}
                  disabled={twoFaBusy || !disablePassword.trim()}
                  className="font-bold text-white rounded-lg transition-all duration-200"
                  style={{ padding: '10px 14px', background: 'rgba(229,9,20,0.18)', border: '1px solid rgba(229,9,20,0.35)' }}
                >
                  Disable 2FA
                </button>
              </div>
            </>
          )}

          {twoFaMessage && (
            <div style={{ marginTop: 12, color: 'rgba(163,163,163,1)', fontSize: 13 }}>
              {twoFaMessage}
            </div>
          )}
        </Card>

        {/* Deactivate */}
        <div style={{ marginTop: 14 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <AlertTriangle size={18} color="#E50914" />
              <div style={{ color: 'white', fontWeight: 900, fontSize: 16 }}>Deactivate account</div>
            </div>
            <div style={{ color: 'rgba(163,163,163,1)', fontSize: 13, marginBottom: 12 }}>
              This will <span style={{ color: 'white', fontWeight: 800 }}>soft‑delete</span> your account (set it inactive). You can restore it by logging in again.
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={deactivatePassword}
                onChange={(e) => setDeactivatePassword(e.target.value)}
                placeholder="Password to confirm"
                type="password"
                style={{
                  width: 260,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: 'white',
                  outline: 'none',
                  fontWeight: 700,
                }}
              />
              <button
                onClick={onDeactivate}
                disabled={deactivateBusy || !deactivatePassword.trim()}
                className="font-bold text-white rounded-lg transition-all duration-200"
                style={{
                  padding: '10px 14px',
                  background: 'rgba(229,9,20,0.9)',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
              >
                {deactivateBusy ? 'Deactivating…' : 'Deactivate my account'}
              </button>
            </div>

            {deactivateMessage && (
              <div style={{ marginTop: 12, color: 'rgba(163,163,163,1)', fontSize: 13 }}>
                {deactivateMessage}
              </div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

