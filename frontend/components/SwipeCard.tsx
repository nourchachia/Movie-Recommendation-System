'use client';

/**
 * frontend/components/SwipeCard.tsx
 *
 * A single draggable movie card. No third-party animation library needed —
 * drag physics are pure pointer-events + CSS transitions.
 *
 * Props:
 *   movie        — the movie data to display
 *   posterUrl    — resolved TMDB poster URL (or placeholder)
 *   onSwipeLeft  — called when user commits a left swipe
 *   onSwipeRight — called when user commits a right swipe
 *   isTop        — whether this card is the front-most (interactive) card
 *   stackIndex   — 0 = top/front, 1 = middle, 2 = back
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import type { SessionMovie } from '@/lib/sessions';

interface SwipeCardProps {
  movie: SessionMovie;
  posterUrl: string;
  onSwipeLeft: (movieId: number) => void;
  onSwipeRight: (movieId: number) => void;
  isTop: boolean;
  stackIndex: number;
}

const SWIPE_THRESHOLD = 110; // px to commit a swipe
const ROTATION_FACTOR = 0.07;

export default function SwipeCard({
  movie,
  posterUrl,
  onSwipeLeft,
  onSwipeRight,
  isTop,
  stackIndex,
}: SwipeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const [deltaX, setDeltaX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null);

  // Stack transform for non-top cards
  const stackTranslateY = stackIndex * 12;
  const stackScale = 1 - stackIndex * 0.045;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isTop) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startY.current = e.clientY;
    setIsDragging(true);
    setDeltaX(0);
  }, [isTop]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !isTop) return;
    const dx = e.clientX - startX.current;
    setDeltaX(dx);
  }, [isDragging, isTop]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging || !isTop) return;
    setIsDragging(false);
    if (deltaX > SWIPE_THRESHOLD) {
      setExitDir('right');
      setTimeout(() => onSwipeRight(movie.movie_id), 300);
    } else if (deltaX < -SWIPE_THRESHOLD) {
      setExitDir('left');
      setTimeout(() => onSwipeLeft(movie.movie_id), 300);
    } else {
      setDeltaX(0); // spring back
    }
  }, [isDragging, isTop, deltaX, movie.movie_id, onSwipeLeft, onSwipeRight]);

  // Keyboard support on top card
  useEffect(() => {
    if (!isTop) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setExitDir('right');
        setTimeout(() => onSwipeRight(movie.movie_id), 300);
      } else if (e.key === 'ArrowLeft') {
        setExitDir('left');
        setTimeout(() => onSwipeLeft(movie.movie_id), 300);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isTop, movie.movie_id, onSwipeLeft, onSwipeRight]);

  // Calculate live transform
  const activeDelta = exitDir === 'right' ? 600 : exitDir === 'left' ? -600 : deltaX;
  const rotation = activeDelta * ROTATION_FACTOR;
  const opacity = exitDir ? 0 : 1;

  const cardStyle: React.CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    cursor: isTop ? (isDragging ? 'grabbing' : 'grab') : 'default',
    userSelect: 'none',
    touchAction: 'none',
    transform: isTop
      ? `translateX(${activeDelta}px) rotate(${rotation}deg)`
      : `translateY(${stackTranslateY}px) scale(${stackScale})`,
    transition: isDragging
      ? 'none'
      : exitDir
      ? 'transform 0.3s ease, opacity 0.3s ease'
      : 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    opacity,
    zIndex: 10 - stackIndex,
    willChange: 'transform',
  };

  // Overlay indicators
  const likeOpacity = isTop && deltaX > 20 ? Math.min((deltaX - 20) / 80, 1) : 0;
  const nopeOpacity = isTop && deltaX < -20 ? Math.min((-deltaX - 20) / 80, 1) : 0;

  const year = movie.title.match(/\((\d{4})\)/)?.[1] ?? '';
  const cleanTitle = movie.title.replace(/\s*\(\d{4}\)\s*$/, '');

  return (
    <div
      ref={cardRef}
      style={cardStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '20px',
          overflow: 'hidden',
          background: 'var(--color-card)',
          boxShadow: isTop
            ? '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)'
            : '0 8px 24px rgba(0,0,0,0.4)',
          position: 'relative',
        }}
      >
        {/* Poster */}
        <Image
          src={posterUrl}
          alt={cleanTitle}
          fill
          style={{ objectFit: 'cover' }}
          draggable={false}
          priority={stackIndex === 0}
        />

        {/* Bottom gradient + info */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, transparent 70%)',
          }}
        />

        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '28px 24px 24px',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              color: '#fff',
              lineHeight: 1.1,
              marginBottom: '6px',
              letterSpacing: '0.05em',
              textShadow: '0 2px 8px rgba(0,0,0,0.6)',
            }}
          >
            {cleanTitle}
            {year && (
              <span style={{ fontSize: '1.2rem', color: '#A3A3A3', marginLeft: '8px', fontFamily: 'var(--font-body)', fontWeight: 400 }}>
                {year}
              </span>
            )}
          </h2>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
            {movie.genres.slice(0, 4).map((g) => (
              <span
                key={g}
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: '100px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#fff',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {g}
              </span>
            ))}
          </div>
        </div>

        {/* LIKE indicator */}
        <div
          style={{
            position: 'absolute',
            top: 32,
            left: 24,
            opacity: likeOpacity,
            transition: 'opacity 0.1s',
            transform: 'rotate(-15deg)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              border: '4px solid #22c55e',
              borderRadius: '8px',
              padding: '6px 18px',
              color: '#22c55e',
              fontSize: '28px',
              fontWeight: 900,
              letterSpacing: '0.1em',
              textShadow: '0 0 20px rgba(34,197,94,0.5)',
              boxShadow: '0 0 20px rgba(34,197,94,0.3)',
            }}
          >
            LIKE
          </div>
        </div>

        {/* NOPE indicator */}
        <div
          style={{
            position: 'absolute',
            top: 32,
            right: 24,
            opacity: nopeOpacity,
            transition: 'opacity 0.1s',
            transform: 'rotate(15deg)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              border: '4px solid #E50914',
              borderRadius: '8px',
              padding: '6px 18px',
              color: '#E50914',
              fontSize: '28px',
              fontWeight: 900,
              letterSpacing: '0.1em',
              textShadow: '0 0 20px rgba(229,9,20,0.5)',
              boxShadow: '0 0 20px rgba(229,9,20,0.3)',
            }}
          >
            NOPE
          </div>
        </div>
      </div>
    </div>
  );
}
