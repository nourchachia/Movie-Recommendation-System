'use client';

/**
 * frontend/components/MatchOverlay.tsx
 *
 * Full-screen match celebration overlay.
 * Triggered when the WebSocket fires { event: "match", movie_id: N }.
 * Shows a scale-in poster, confetti rain, and action buttons.
 * Auto-dismisses after 6 s.
 */

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { Sparkles, BookMarked, ChevronRight, X } from 'lucide-react';
import type { SessionMovie } from '@/lib/sessions';
import { addToWatchlist } from '@/lib/api';

interface MatchOverlayProps {
  movie: SessionMovie;
  posterUrl: string;
  accessToken: string;
  onDismiss: () => void;
}

// Generate stable confetti pieces
const CONFETTI_COUNT = 48;
const CONFETTI_COLORS = [
  '#E50914', '#FF6B35', '#FFD700', '#22c55e',
  '#3B82F6', '#EC4899', '#A78BFA', '#F97316',
];

function useConfetti() {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    delay: `${Math.random() * 2.5}s`,
    duration: `${2.5 + Math.random() * 2}s`,
    size: `${6 + Math.random() * 8}px`,
    shape: Math.random() > 0.5 ? 'circle' : 'rect',
    rotation: `${Math.random() * 360}deg`,
  }));
}

export default function MatchOverlay({
  movie,
  posterUrl,
  accessToken,
  onDismiss,
}: MatchOverlayProps) {
  const confetti = useConfetti();
  const [visible, setVisible] = useState(false);
  const [addedToWatchlist, setAddedToWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  const cleanTitle = movie.title.replace(/\s*\(\d{4}\)\s*$/, '');
  const year = movie.title.match(/\((\d{4})\)/)?.[1] ?? '';

  // Animate in
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss after 6 s
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const handleAddToWatchlist = useCallback(async () => {
    if (addedToWatchlist || watchlistLoading) return;
    setWatchlistLoading(true);
    try {
      await addToWatchlist(movie.movie_id, accessToken);
      setAddedToWatchlist(true);
    } catch {
      // silently ignore; watchlist might already contain it
      setAddedToWatchlist(true);
    } finally {
      setWatchlistLoading(false);
    }
  }, [movie.movie_id, accessToken, addedToWatchlist, watchlistLoading]);

  return (
    <>
      {/* Confetti keyframes */}
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(-60px) rotate(0deg); opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes matchScaleIn {
          0%   { transform: scale(0.6) translateY(40px); opacity: 0; }
          70%  { transform: scale(1.04) translateY(-4px); }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes matchGlow {
          0%, 100% { box-shadow: 0 0 40px rgba(229,9,20,0.4), 0 0 80px rgba(229,9,20,0.2); }
          50%       { box-shadow: 0 0 60px rgba(229,9,20,0.7), 0 0 120px rgba(229,9,20,0.35); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes pulse-soft {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 200,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'opacity 0.3s ease',
          opacity: visible ? 1 : 0,
        }}
      >
        {/* Confetti rain */}
        {confetti.map((c) => (
          <span
            key={c.id}
            style={{
              position: 'fixed',
              top: '-20px',
              left: c.left,
              width: c.size,
              height: c.size,
              background: c.color,
              borderRadius: c.shape === 'circle' ? '50%' : '2px',
              transform: `rotate(${c.rotation})`,
              animation: `confettiFall ${c.duration} ${c.delay} ease-in forwards`,
              pointerEvents: 'none',
              zIndex: 201,
            }}
          />
        ))}

        {/* Modal */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            zIndex: 202,
            width: '100%',
            maxWidth: '420px',
            margin: '0 16px',
            borderRadius: '24px',
            overflow: 'hidden',
            background: 'var(--color-card)',
            border: '1px solid rgba(255,255,255,0.1)',
            animation: visible ? 'matchScaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' : 'none',
            opacity: 0,
          }}
        >
          {/* Close button */}
          <button
            onClick={onDismiss}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              zIndex: 10,
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#A3A3A3',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#fff')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#A3A3A3')}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>

          {/* Poster */}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', maxHeight: '280px', overflow: 'hidden' }}>
            <Image
              src={posterUrl}
              alt={cleanTitle}
              fill
              style={{ objectFit: 'cover' }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to top, var(--color-card) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
              }}
            />
          </div>

          {/* Content */}
          <div style={{ padding: '24px 28px 28px', textAlign: 'center' }}>
            {/* Match badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: 'linear-gradient(135deg, rgba(229,9,20,0.2), rgba(255,107,53,0.2))',
                border: '1px solid rgba(229,9,20,0.4)',
                borderRadius: '100px',
                padding: '6px 16px',
                marginBottom: '16px',
                animation: 'pulse-soft 2s ease-in-out infinite',
              }}
            >
              <Sparkles size={14} style={{ color: '#FFD700' }} />
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  background: 'linear-gradient(90deg, #E50914, #FF6B35, #FFD700)',
                  backgroundSize: '200% auto',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  animation: 'shimmer 2s linear infinite',
                }}
              >
                It&apos;s a Match!
              </span>
              <Sparkles size={14} style={{ color: '#FFD700' }} />
            </div>

            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.9rem',
                color: '#fff',
                letterSpacing: '0.06em',
                lineHeight: 1.1,
                marginBottom: '6px',
              }}
            >
              {cleanTitle}
            </h2>

            {year && (
              <p style={{ color: 'var(--color-muted)', fontSize: '14px', marginBottom: '12px' }}>
                {year}
              </p>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', marginBottom: '24px' }}>
              {movie.genres.slice(0, 4).map((g) => (
                <span
                  key={g}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '100px',
                    padding: '3px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--color-muted)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {g}
                </span>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleAddToWatchlist}
                disabled={addedToWatchlist || watchlistLoading}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px',
                  borderRadius: '12px',
                  background: addedToWatchlist
                    ? 'rgba(34,197,94,0.15)'
                    : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${addedToWatchlist ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'}`,
                  color: addedToWatchlist ? '#22c55e' : '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: addedToWatchlist || watchlistLoading ? 'default' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: watchlistLoading ? 0.6 : 1,
                }}
              >
                <BookMarked size={16} />
                {addedToWatchlist ? 'Added!' : watchlistLoading ? 'Adding…' : 'Add to Watchlist'}
              </button>

              <button
                onClick={onDismiss}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #E50914, #c40811)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 20px rgba(229,9,20,0.35)',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.03)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)')}
              >
                Keep Swiping
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
