'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { BookMarked, Loader2, Trash2, Compass } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getMyWatchlist, removeFromWatchlist, type WatchlistMovie } from '@/lib/api';
import type { Movie } from '@/lib/mockApi';
import MovieModal from '@/components/MovieModal';
import Navbar from '@/components/Navbar';

// ── Watchlist Card ─────────────────────────────────────────────────────────────
function WatchlistCard({
  movie,
  posterUrl,
  onRemove,
  onClick,
}: {
  movie: WatchlistMovie;
  posterUrl: string;
  onRemove: () => void;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRemoving(true);
    await new Promise((r) => setTimeout(r, 150)); // brief visual feedback
    onRemove();
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: '10px',
        overflow: 'hidden',
        background: '#1A1A1A',
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'transform 0.2s, box-shadow 0.2s, opacity 0.2s',
        transform: hovered ? 'scale(1.03)' : 'scale(1)',
        boxShadow: hovered
          ? '0 12px 40px rgba(229,9,20,0.22)'
          : '0 4px 16px rgba(0,0,0,0.4)',
        opacity: removing ? 0.4 : 1,
        cursor: 'pointer',
      }}
    >
      {/* Poster */}
      <div
        onClick={onClick}
        style={{ position: 'relative', aspectRatio: '2/3', overflow: 'hidden' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterUrl}
          alt={movie.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />

        {/* Hover overlay: "View Details" */}
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{
              padding: '8px 18px', borderRadius: '8px',
              background: 'rgba(229,9,20,0.9)',
              color: 'white', fontWeight: 700, fontSize: '13px',
            }}
          >
            View Details
          </div>
        </div>

        {/* Note strip — pinned to bottom of poster */}
        {movie.note && (
          <div
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'rgba(251,191,36,0.92)',
              backdropFilter: 'blur(4px)',
              padding: '5px 8px',
              display: 'flex', alignItems: 'flex-start', gap: '5px',
            }}
          >
            {/* pin icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10" height="10"
              viewBox="0 0 24 24"
              fill="#92400e"
              style={{ flexShrink: 0, marginTop: '1px' }}
            >
              <path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7zm0 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>
            </svg>
            <span
              style={{
                fontSize: '10px', lineHeight: 1.35,
                color: '#1c1917', fontWeight: 600,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {movie.note}
            </span>
          </div>
        )}
      </div>

      {/* Info + Remove */}
      <div style={{ padding: '10px 10px 12px' }}>
        <p
          style={{
            color: 'white', fontWeight: 600, fontSize: '13px',
            marginBottom: '4px', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {movie.title}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
          {movie.genres.slice(0, 2).map((g) => (
            <span
              key={g}
              style={{
                fontSize: '10px', padding: '2px 7px', borderRadius: '4px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(163,163,163,1)',
                whiteSpace: 'nowrap',
              }}
            >
              {g}
            </span>
          ))}
        </div>

        {/* Remove button */}
        <button
          onClick={handleRemove}
          title="Remove from watchlist"
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 10px', borderRadius: '6px',
            background: 'rgba(229,9,20,0.08)',
            border: '1px solid rgba(229,9,20,0.2)',
            color: 'rgba(255,100,100,0.85)', fontSize: '11px',
            fontWeight: 600, cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
            width: '100%', justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(229,9,20,0.18)';
            e.currentTarget.style.color = '#FF6B6B';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(229,9,20,0.08)';
            e.currentTarget.style.color = 'rgba(255,100,100,0.85)';
          }}
        >
          <Trash2 size={11} />
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState() {
  const router = useRouter();
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '24px', textAlign: 'center', maxWidth: '480px', margin: '80px auto',
      }}
    >
      <div
        style={{
          width: '96px', height: '96px', borderRadius: '50%',
          background: 'rgba(229,9,20,0.1)', border: '1px solid rgba(229,9,20,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <BookMarked size={40} color="#E50914" />
      </div>
      <div>
        <h2 style={{ color: 'white', fontSize: '22px', fontWeight: 700, marginBottom: '12px' }}>
          Your watchlist is empty
        </h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '15px', lineHeight: 1.7 }}>
          Add movies you want to watch later by clicking{' '}
          <strong style={{ color: 'white' }}>+ Watchlist</strong> on any movie card.
          They&apos;ll show up here, organised by genre.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => router.push('/')}
          style={{
            padding: '12px 24px', borderRadius: '10px',
            background: '#E50914', border: 'none',
            color: 'white', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#FF1A1A')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#E50914')}
        >
          Browse Home
        </button>
        <button
          onClick={() => router.push('/discover')}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '12px 24px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'white', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
        >
          <Compass size={15} />
          Discover
        </button>
      </div>
    </div>
  );
}

// ── Genre Tab Bar ─────────────────────────────────────────────────────────────
function GenreTabs({
  genres,
  active,
  onSelect,
}: {
  genres: string[];
  active: string;
  onSelect: (g: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '28px',
      }}
    >
      {['All', ...genres].map((g) => {
        const isActive = g === active;
        return (
          <button
            key={g}
            onClick={() => onSelect(g)}
            style={{
              padding: '7px 18px', borderRadius: '99px',
              background: isActive ? '#E50914' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${isActive ? '#E50914' : 'rgba(255,255,255,0.12)'}`,
              color: isActive ? 'white' : 'rgba(163,163,163,1)',
              fontSize: '13px', fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.18s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.color = 'rgba(163,163,163,1)';
              }
            }}
          >
            {g}
          </button>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WatchlistPage() {
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [movies, setMovies]   = useState<WatchlistMovie[]>([]);
  const [posters, setPosters] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [activeGenre, setActiveGenre] = useState('All');
  const [selected, setSelected] = useState<(Movie & { posterUrl: string }) | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  // Fetch watchlist
  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    getMyWatchlist(accessToken)
      .then((data) => {
        setMovies(data.watchlist);
        // Batch-fetch TMDB posters
        if (data.watchlist.length > 0) {
          const ids = data.watchlist.map((m) => m.tmdb_id).join(',');
          fetch(`/api/posters?ids=${ids}`)
            .then((r) => r.json())
            .then((map: Record<string, string>) => {
              const numeric: Record<number, string> = {};
              Object.entries(map).forEach(([k, v]) => { numeric[Number(k)] = v; });
              setPosters(numeric);
            })
            .catch(() => {});
        }
      })
      .catch(() => setError('Could not load your watchlist. Please try again.'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  // Derive sorted list of unique genres across all watchlist movies
  const allGenres = useMemo(() => {
    const set = new Set<string>();
    movies.forEach((m) => m.genres.forEach((g) => g && g !== '(no genres listed)' && set.add(g)));
    return Array.from(set).sort();
  }, [movies]);

  // Filter movies for the active genre tab
  // A movie with multiple genres appears in EACH of its genre tabs
  const visibleMovies = useMemo(() => {
    if (activeGenre === 'All') return movies;
    return movies.filter((m) => m.genres.includes(activeGenre));
  }, [movies, activeGenre]);

  const getPoster = (m: WatchlistMovie) =>
    posters[m.tmdb_id] ?? `https://picsum.photos/seed/tmdb${m.tmdb_id}/300/450`;

  const handleRemove = async (movieId: number) => {
    if (!accessToken) return;
    // Optimistically remove from local state
    setMovies((prev) => prev.filter((m) => m.movie_id !== movieId));
    try {
      await removeFromWatchlist(movieId, accessToken);
    } catch {
      // On failure reload from server
      getMyWatchlist(accessToken).then((d) => setMovies(d.watchlist)).catch(() => {});
    }
  };

  const openModal = (m: WatchlistMovie) => {
    setSelected({
      movie_id:    m.movie_id,
      title:       m.title,
      year:        0,
      genres:      m.genres,
      match_score: 0,
      tmdb_id:     m.tmdb_id,
      posterUrl:   getPoster(m),
    });
  };

  if (authLoading || (!user && !authLoading)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} color="#E50914" style={{ animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <Navbar />

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '100px 24px 60px' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: '32px' }}>
          <h1
            style={{
              color: 'white',
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(28px, 5vw, 48px)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              marginBottom: '8px',
            }}
          >
            Watchlist
          </h1>
          {!loading && movies.length > 0 && (
            <p
              style={{
                color: 'var(--color-muted)', fontSize: '15px',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              <BookMarked size={15} />
              {movies.length} movie{movies.length !== 1 ? 's' : ''} saved
              {activeGenre !== 'All' && (
                <span
                  style={{
                    marginLeft: '4px', padding: '2px 10px', borderRadius: '99px',
                    background: 'rgba(229,9,20,0.1)', border: '1px solid rgba(229,9,20,0.25)',
                    color: '#FF6B6B', fontSize: '12px', fontWeight: 600,
                  }}
                >
                  {visibleMovies.length} in {activeGenre}
                </span>
              )}
            </p>
          )}
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
            <Loader2 size={36} color="#E50914" style={{ animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Error ── */}
        {!loading && error && (
          <p style={{ color: '#FF6B6B', textAlign: 'center', marginTop: '60px' }}>{error}</p>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && movies.length === 0 && <EmptyState />}

        {/* ── Genre tabs + grid ── */}
        {!loading && !error && movies.length > 0 && (
          <>
            <GenreTabs
              genres={allGenres}
              active={activeGenre}
              onSelect={(g) => setActiveGenre(g)}
            />

            {visibleMovies.length === 0 ? (
              <p style={{ color: 'var(--color-muted)', textAlign: 'center', marginTop: '40px' }}>
                No movies in this genre yet.
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '16px',
                }}
              >
                {visibleMovies.map((movie) => (
                  <WatchlistCard
                    key={`${movie.movie_id}-${activeGenre}`}
                    movie={movie}
                    posterUrl={getPoster(movie)}
                    onRemove={() => handleRemove(movie.movie_id)}
                    onClick={() => openModal(movie)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Modal ── */}
      {selected && (
        <MovieModal movie={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
