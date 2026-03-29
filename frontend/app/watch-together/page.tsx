'use client';

/**
 * frontend/app/watch-together/page.tsx
 *
 * Entry page for the Watch Together feature. Manages the full lifecycle:
 *   1. Create / Join lobby
 *   2. Waiting room (with invite code display)
 *   3. Active swipe session
 *   4. Match celebration (via MatchOverlay)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Film, Users, Copy, Check, Loader2, Zap, AlertCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import SwipeDeck from '@/components/SwipeDeck';
import MatchOverlay from '@/components/MatchOverlay';
import { useAuth } from '@/context/AuthContext';
import {
  createSession, joinSession, getSession,
  connectSessionWS,
} from '@/lib/sessions';
import type { SessionMovie, WsEvent } from '@/lib/sessions';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'lobby'        // initial create/join choice
  | 'waiting'      // creator waiting for guest
  | 'joining'      // guest is submitting join
  | 'swiping'      // both users are swiping
  | 'error';

interface PendingMatch {
  movie: SessionMovie;
  posterUrl: string;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WatchTogetherPage() {
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('lobby');
  const [sessionCode, setSessionCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [movies, setMovies] = useState<SessionMovie[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [pendingMatch, setPendingMatch] = useState<PendingMatch | null>(null);

  // WS ref — cleaned up on unmount
  const wsRef = useRef<WebSocket | null>(null);
  // Poll interval ref for waiting room
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Session creation ────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const result = await createSession(accessToken, 30);
      setSessionCode(result.code);
      setPhase('waiting');

      // Connect WS immediately so we receive the session_active event
      const ws = connectSessionWS(result.code, (ev: WsEvent) => {
        if (ev.event === 'session_active') {
          // Guest joined — fetch the session and start swiping
          if (pollRef.current) clearInterval(pollRef.current);
          loadSessionAndSwipe(result.code);
        }
      });
      wsRef.current = ws;

      // Fallback: poll every 2.5 s in case WS message was missed
      pollRef.current = setInterval(async () => {
        try {
          const sess = await getSession(result.code, accessToken!);
          if (sess.status === 'active') {
            if (pollRef.current) clearInterval(pollRef.current);
            setMovies(sess.movie_pool);
            setPhase('swiping');
          }
        } catch { /* ignore */ }
      }, 2500);

    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create session');
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session joining ─────────────────────────────────────────────────────────

  const handleJoin = useCallback(async () => {
    if (!accessToken || !joinCode.trim()) return;
    const code = joinCode.trim().toUpperCase();
    setLoading(true);
    setErrorMsg('');
    setPhase('joining');
    try {
      await joinSession(code, accessToken);
      setSessionCode(code);
      await loadSessionAndSwipe(code);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to join session');
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }, [accessToken, joinCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load session → start swiping ────────────────────────────────────────────

  async function loadSessionAndSwipe(code: string) {
    if (!accessToken) return;
    const sess = await getSession(code, accessToken);
    setMovies(sess.movie_pool);
    setSessionCode(code);

    // Connect / reconnect WS for match events
    wsRef.current?.close();
    const ws = connectSessionWS(code, async (ev: WsEvent) => {
      if (ev.event === 'match') {
        // Find movie details from the movie pool
        const matchedMovie = sess.movie_pool.find((m) => m.movie_id === ev.movie_id);
        if (matchedMovie) {
          const posterUrl = await resolvePoster(matchedMovie);
          setPendingMatch({ movie: matchedMovie, posterUrl });
        }
      }
    });
    wsRef.current = ws;
    setPhase('swiping');
  }

  // ── Poster resolver for MatchOverlay ────────────────────────────────────────

  async function resolvePoster(movie: SessionMovie): Promise<string> {
    if (!movie.tmdb_id) return `https://picsum.photos/seed/${movie.movie_id}/400/600`;
    try {
      const res = await fetch(`/api/posters?ids=${movie.tmdb_id}`);
      if (!res.ok) throw new Error();
      const map: Record<number, string> = await res.json();
      return map[movie.tmdb_id] ?? `https://picsum.photos/seed/${movie.movie_id}/400/600`;
    } catch {
      return `https://picsum.photos/seed/${movie.movie_id}/400/600`;
    }
  }

  // ── Match from SwipeDeck (same user's REST response) ───────────────────────

  const handleMatchFromDeck = useCallback(async (movie: SessionMovie) => {
    const posterUrl = await resolvePoster(movie);
    setPendingMatch({ movie, posterUrl });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Copy invite code ────────────────────────────────────────────────────────

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(sessionCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  }, [sessionCode]);

  // ── Render guards ───────────────────────────────────────────────────────────

  if (authLoading || !user) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ color: '#E50914', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: '#fff' }}>
      <Navbar />

      <main style={{ paddingTop: '100px', paddingBottom: '48px', maxWidth: '560px', margin: '0 auto', padding: '100px 24px 48px' }}>

        {/* ── LOBBY ───────────────────────────────────────────────────────── */}
        {phase === 'lobby' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <Film size={32} style={{ color: '#E50914' }} />
                <h1
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '2.8rem',
                    letterSpacing: '0.08em',
                    color: '#fff',
                  }}
                >
                  Watch Together
                </h1>
              </div>
              <p style={{ color: 'var(--color-muted)', fontSize: '15px', lineHeight: 1.6 }}>
                Swipe through movies with a friend. When you both swipe right on the same film —
                it&apos;s a match! 🎉
              </p>
            </div>

            {/* Create card */}
            <div
              style={{
                background: 'var(--color-card)',
                border: '1px solid rgba(229,9,20,0.2)',
                borderRadius: '20px',
                padding: '28px',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(229,9,20,0.5)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(229,9,20,0.2)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div
                  style={{
                    width: '44px', height: '44px', borderRadius: '12px',
                    background: 'rgba(229,9,20,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Zap size={22} style={{ color: '#E50914' }} />
                </div>
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Create a Session</h2>
                  <p style={{ fontSize: '13px', color: 'var(--color-muted)' }}>Start a new session and invite a friend</p>
                </div>
              </div>
              <button
                onClick={handleCreate}
                disabled={loading}
                id="create-session-btn"
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: '12px',
                  background: loading ? 'rgba(229,9,20,0.4)' : 'linear-gradient(135deg, #E50914, #c40811)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 20px rgba(229,9,20,0.3)',
                }}
              >
                {loading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Film size={18} />}
                {loading ? 'Creating…' : 'Create Session'}
              </button>
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
              <span style={{ color: 'var(--color-muted)', fontSize: '13px' }}>or join an existing one</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
            </div>

            {/* Join card */}
            <div
              style={{
                background: 'var(--color-card)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '20px',
                padding: '28px',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.15)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.06)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div
                  style={{
                    width: '44px', height: '44px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Users size={22} style={{ color: '#A3A3A3' }} />
                </div>
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Join a Session</h2>
                  <p style={{ fontSize: '13px', color: 'var(--color-muted)' }}>Enter the invite code from your friend</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  id="join-code-input"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 8))}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  placeholder="e.g. FILM4829"
                  maxLength={8}
                  style={{
                    flex: 1,
                    padding: '13px 16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#fff',
                    fontSize: '16px',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={handleJoin}
                  disabled={loading || joinCode.length < 4}
                  id="join-session-btn"
                  style={{
                    padding: '13px 20px',
                    borderRadius: '12px',
                    background: joinCode.length >= 4 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: joinCode.length >= 4 ? '#fff' : '#A3A3A3',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: joinCode.length >= 4 && !loading ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {loading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : 'Join →'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── WAITING ROOM ────────────────────────────────────────────────── */}
        {phase === 'waiting' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px', textAlign: 'center' }}>
            <div>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '2.4rem',
                  letterSpacing: '0.08em',
                  marginBottom: '10px',
                }}
              >
                Waiting for your partner…
              </h1>
              <p style={{ color: 'var(--color-muted)', fontSize: '15px' }}>
                Share this code with your friend. The session will start automatically when they join.
              </p>
            </div>

            {/* Invite code display */}
            <div
              style={{
                background: 'var(--color-card)',
                border: '2px solid rgba(229,9,20,0.3)',
                borderRadius: '20px',
                padding: '32px 40px',
                width: '100%',
              }}
            >
              <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
                Invite Code
              </p>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '3rem',
                  fontWeight: 900,
                  letterSpacing: '0.2em',
                  color: '#fff',
                  marginBottom: '20px',
                  background: 'linear-gradient(135deg, #E50914, #FF6B35)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {sessionCode}
              </div>
              <button
                onClick={copyCode}
                id="copy-code-btn"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  borderRadius: '10px',
                  background: codeCopied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${codeCopied ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'}`,
                  color: codeCopied ? '#22c55e' : '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.25s ease',
                }}
              >
                {codeCopied ? <Check size={16} /> : <Copy size={16} />}
                {codeCopied ? 'Copied!' : 'Copy Code'}
              </button>
            </div>

            {/* Spinner */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--color-muted)' }}>
              <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#E50914' }} />
              <span style={{ fontSize: '14px' }}>Waiting for partner to join…</span>
            </div>
          </div>
        )}

        {/* ── JOINING ─────────────────────────────────────────────────────── */}
        {phase === 'joining' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center', paddingTop: '80px' }}>
            <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: '#E50914' }} />
            <p style={{ fontSize: '16px', color: 'var(--color-muted)' }}>Joining session…</p>
          </div>
        )}

        {/* ── ERROR ───────────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center', paddingTop: '40px' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(229,9,20,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={32} style={{ color: '#E50914' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>Something went wrong</h2>
              <p style={{ color: 'var(--color-muted)', fontSize: '14px', maxWidth: '320px' }}>{errorMsg}</p>
            </div>
            <button
              onClick={() => { setPhase('lobby'); setErrorMsg(''); setJoinCode(''); }}
              style={{
                padding: '12px 28px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #E50914, #c40811)',
                border: 'none',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </main>

      {/* ── SWIPING (full screen, below navbar) ───────────────────────────── */}
      {phase === 'swiping' && movies.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: '80px', // below navbar
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            background: 'var(--color-bg)',
          }}
        >
          <div style={{ width: '100%', maxWidth: '420px', height: '100%' }}>
            <SwipeDeck
              movies={movies}
              sessionCode={sessionCode}
              accessToken={accessToken!}
              onMatch={handleMatchFromDeck}
            />
          </div>
        </div>
      )}

      {/* ── MATCH OVERLAY ──────────────────────────────────────────────────── */}
      {pendingMatch && accessToken && (
        <MatchOverlay
          movie={pendingMatch.movie}
          posterUrl={pendingMatch.posterUrl}
          accessToken={accessToken}
          onDismiss={() => setPendingMatch(null)}
        />
      )}

      {/* Spin keyframe for loading indicators */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
