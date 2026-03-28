'use client';

/**
 * frontend/components/SwipeDeck.tsx
 *
 * Manages the card stack: renders top 3 cards, pops them as they are
 * swiped, fires REST swipe calls, and signals match events upward.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import SwipeCard from '@/components/SwipeCard';
import type { SessionMovie } from '@/lib/sessions';
import { recordSwipe } from '@/lib/sessions';

/** Batch-fetch poster URLs via the Next.js API route that keeps TMDB key server-side */
async function fetchPosters(tmdbIds: number[]): Promise<Record<number, string>> {
  if (tmdbIds.length === 0) return {};
  const res = await fetch(`/api/posters?ids=${tmdbIds.join(',')}`);
  if (!res.ok) return {};
  return res.json();
}

interface SwipeDeckProps {
  movies: SessionMovie[];
  sessionCode: string;
  accessToken: string;
  onMatch: (movie: SessionMovie) => void;
}

export default function SwipeDeck({
  movies,
  sessionCode,
  accessToken,
  onMatch,
}: SwipeDeckProps) {
  const [deck, setDeck] = useState<SessionMovie[]>([...movies]);
  const [posterCache, setPosterCache] = useState<Record<number, string>>({});
  const [swiped, setSwiped] = useState<{ id: number; dir: 'left' | 'right' }[]>([]);
  const swipingRef = useRef(false);

  // Pre-load TMDB poster URLs for the top 5 cards using the server-side /api/posters route
  useEffect(() => {
    const topFive = deck.slice(0, 5);
    const missing = topFive.filter((m) => m.tmdb_id && !posterCache[m.movie_id]);
    if (missing.length === 0) return;
    const tmdbIds = missing.map((m) => m.tmdb_id!);
    fetchPosters(tmdbIds).then((urlMap) => {
      const updates: Record<number, string> = {};
      missing.forEach((m) => {
        updates[m.movie_id] = urlMap[m.tmdb_id!] ?? `https://picsum.photos/seed/${m.movie_id}/400/600`;
      });
      setPosterCache((prev) => ({ ...prev, ...updates }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.slice(0, 5).map((m) => m.movie_id).join(',')]); 

  const handleSwipe = useCallback(
    async (movieId: number, direction: 'left' | 'right') => {
      if (swipingRef.current) return;
      swipingRef.current = true;

      // Optimistically pop the card
      setDeck((prev) => prev.filter((m) => m.movie_id !== movieId));
      setSwiped((prev) => [...prev, { id: movieId, dir: direction }]);

      try {
        const result = await recordSwipe(sessionCode, movieId, direction, accessToken);
        if (result.match && result.matched_movie) {
          onMatch(result.matched_movie);
        }
      } catch (err) {
        console.error('Swipe record failed:', err);
      } finally {
        swipingRef.current = false;
      }
    },
    [sessionCode, accessToken, onMatch]
  );

  const topThree = deck.slice(0, 3);
  const total = movies.length;
  const remaining = deck.length;
  const progress = total > 0 ? ((total - remaining) / total) * 100 : 0;

  if (deck.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '16px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '64px' }}>🎬</div>
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2rem',
            color: '#fff',
            letterSpacing: '0.08em',
          }}
        >
          All Done!
        </h3>
        <p style={{ color: 'var(--color-muted)', fontSize: '15px' }}>
          You&apos;ve gone through all the movies.
        </p>
        <p style={{ color: 'var(--color-muted)', fontSize: '14px' }}>
          {swiped.filter((s) => s.dir === 'right').length} liked ·{' '}
          {swiped.filter((s) => s.dir === 'left').length} passed
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '20px' }}>
      {/* Progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            flex: 1,
            height: '4px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '100px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #E50914, #ff6b35)',
              borderRadius: '100px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <span style={{ color: 'var(--color-muted)', fontSize: '13px', whiteSpace: 'nowrap' }}>
          {total - remaining} / {total}
        </span>
      </div>

      {/* Card stack */}
      <div style={{ flex: 1, position: 'relative' }}>
        {[...topThree].reverse().map((movie, reversedIdx) => {
          const stackIndex = topThree.length - 1 - reversedIdx;
          const posterUrl =
            posterCache[movie.movie_id] ??
            `https://picsum.photos/seed/${movie.movie_id}/400/600`;
          return (
            <SwipeCard
              key={movie.movie_id}
              movie={movie}
              posterUrl={posterUrl}
              isTop={stackIndex === 0}
              stackIndex={stackIndex}
              onSwipeLeft={(id) => handleSwipe(id, 'left')}
              onSwipeRight={(id) => handleSwipe(id, 'right')}
            />
          );
        })}
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '24px',
          paddingBottom: '8px',
        }}
      >
        {/* Nope button */}
        <button
          onClick={() => deck[0] && handleSwipe(deck[0].movie_id, 'left')}
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(229,9,20,0.12)',
            border: '2px solid rgba(229,9,20,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            color: '#E50914',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(229,9,20,0.25)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#E50914';
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(229,9,20,0.12)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(229,9,20,0.4)';
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
          }}
          title="Pass (← arrow key)"
        >
          <ChevronLeft size={28} strokeWidth={2.5} />
        </button>

        {/* Keyboard hint */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px', letterSpacing: '0.06em' }}>
            ← PASS &nbsp;·&nbsp; LIKE →
          </p>
        </div>

        {/* Like button */}
        <button
          onClick={() => deck[0] && handleSwipe(deck[0].movie_id, 'right')}
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(34,197,94,0.12)',
            border: '2px solid rgba(34,197,94,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            color: '#22c55e',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.25)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#22c55e';
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.12)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(34,197,94,0.4)';
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
          }}
          title="Like (→ arrow key)"
        >
          <Heart size={26} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
