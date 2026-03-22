'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Film, Loader2, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getMyRatings, type RatedMovie } from '@/lib/api';
import type { Movie } from '@/lib/mockApi';
import MovieModal from '@/components/MovieModal';
import Navbar from '@/components/Navbar';

// ── Star display (read-only) ──────────────────────────────────────────────────
function StarDisplay({ rating }: { rating: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            fontSize: '13px',
            color: i <= rating ? '#F59E0B' : 'rgba(255,255,255,0.2)',
            lineHeight: 1,
          }}
        >
          ★
        </span>
      ))}
      <span style={{ fontSize: '12px', color: 'var(--color-muted)', marginLeft: '4px' }}>
        {rating}/5
      </span>
    </div>
  );
}

// ── Movie card ────────────────────────────────────────────────────────────────
function MovieCard({ movie, onClick, posterUrl }: { movie: RatedMovie; onClick: () => void; posterUrl: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: '10px',
        overflow: 'hidden',
        cursor: 'pointer',
        background: '#1A1A1A',
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'transform 0.2s, box-shadow 0.2s',
        transform: hovered ? 'scale(1.03)' : 'scale(1)',
        boxShadow: hovered ? '0 12px 40px rgba(229,9,20,0.25)' : '0 4px 16px rgba(0,0,0,0.4)',
      }}
    >
      {/* Poster */}
      <div style={{ position: 'relative', aspectRatio: '2/3', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterUrl}
          alt={movie.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {/* Hover overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            padding: '8px 18px', borderRadius: '8px',
            background: 'rgba(229,9,20,0.9)',
            color: 'white', fontWeight: 700, fontSize: '13px',
          }}>
            View Details
          </div>
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '12px' }}>
        <p style={{
          color: 'white', fontWeight: 600, fontSize: '13px',
          marginBottom: '4px', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {movie.title}
        </p>
        <p style={{ color: 'var(--color-muted)', fontSize: '11px', marginBottom: '8px' }}>
          {movie.genres.slice(0, 2).join(' · ')}
        </p>
        <StarDisplay rating={movie.rating} />
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  const router = useRouter();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '24px', textAlign: 'center', maxWidth: '480px', margin: '80px auto',
    }}>
      <div style={{
        width: '96px', height: '96px', borderRadius: '50%',
        background: 'rgba(229,9,20,0.12)', border: '1px solid rgba(229,9,20,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Star size={40} color="#E50914" />
      </div>
      <div>
        <h2 style={{ color: 'white', fontSize: '22px', fontWeight: 700, marginBottom: '12px' }}>
          You haven&apos;t rated any movies yet
        </h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '15px', lineHeight: 1.7 }}>
          Rate movies to help us understand your taste. The more you rate, the smarter your
          recommendations become. Try to rate at least <strong style={{ color: 'white' }}>20 movies</strong> to unlock
          personalised picks!
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
          Start Rating
        </button>
        <button
          onClick={() => router.push('/discover')}
          style={{
            padding: '12px 24px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'white', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
        >
          Discover Movies
        </button>
      </div>

      {/* Tip */}
      <div style={{
        width: '100%', padding: '16px 20px', borderRadius: '12px',
        background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
        textAlign: 'left',
      }}>
        <p style={{ color: '#F59E0B', fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>
          💡 Pro Tip
        </p>
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '13px', lineHeight: 1.65 }}>
          Open any movie card and click the stars to rate it. Your ratings train the AI to learn
          your taste — even 5 ratings make a noticeable difference!
        </p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MyListPage() {
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [ratings, setRatings]   = useState<RatedMovie[]>([]);
  const [posters, setPosters]   = useState<Record<number, string>>({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [selected, setSelected] = useState<(Movie & { posterUrl: string }) | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  // Fetch rated movies
  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    getMyRatings(accessToken)
      .then((data) => {
        setRatings(data.ratings);
        // Batch-fetch real TMDB posters after getting the list
        if (data.ratings.length > 0) {
          const ids = data.ratings.map((r) => r.tmdb_id).join(',');
          fetch(`/api/posters?ids=${ids}`)
            .then((r) => r.json())
            .then((map: Record<string, string>) => {
              const numeric: Record<number, string> = {};
              Object.entries(map).forEach(([k, v]) => { numeric[Number(k)] = v; });
              setPosters(numeric);
            })
            .catch(() => {}); // keep picsum on error
        }
      })
      .catch(() => setError('Could not load your ratings. Please try again.'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const getPoster = (r: RatedMovie) =>
    posters[r.tmdb_id] ?? `https://picsum.photos/seed/tmdb${r.tmdb_id}/300/450`;

  const openModal = (r: RatedMovie) => {
    setSelected({
      movie_id: r.movie_id,
      title:    r.title,
      year:     0,
      genres:   r.genres,
      match_score: 0,
      tmdb_id:  r.tmdb_id,
      rating:   r.rating,
      posterUrl: getPoster(r),
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

      <main style={{ paddingTop: '100px', paddingBottom: '60px', maxWidth: '1200px', margin: '0 auto', padding: '100px 24px 60px' }}>
        {/* Header */}
        <div style={{ marginBottom: '36px' }}>
          <h1 style={{
            color: 'white',
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 5vw, 48px)',
            fontWeight: 900, letterSpacing: '0.04em',
            textTransform: 'uppercase', marginBottom: '8px',
          }}>
            My List
          </h1>
          {!loading && ratings.length > 0 && (
            <p style={{ color: 'var(--color-muted)', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Film size={15} />
              {ratings.length} movie{ratings.length !== 1 ? 's' : ''} rated
              {ratings.length < 20 && (
                <span style={{
                  marginLeft: '8px', padding: '2px 10px', borderRadius: '99px',
                  background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)',
                  color: '#F59E0B', fontSize: '12px', fontWeight: 600,
                }}>
                  Rate {20 - ratings.length} more for better recommendations!
                </span>
              )}
            </p>
          )}
        </div>

        {/* States */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
            <Loader2 size={36} color="#E50914" style={{ animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {!loading && error && (
          <p style={{ color: '#FF6B6B', textAlign: 'center', marginTop: '60px' }}>{error}</p>
        )}

        {!loading && !error && ratings.length === 0 && <EmptyState />}

        {/* Grid */}
        {!loading && !error && ratings.length > 0 && (
          <>
            {/* Rating tip */}
            {ratings.length < 20 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '14px 18px', borderRadius: '12px', marginBottom: '28px',
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              }}>
                <Clock size={16} color="#F59E0B" style={{ flexShrink: 0 }} />
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', lineHeight: 1.5 }}>
                  <strong style={{ color: '#F59E0B' }}>Keep going!</strong> Rate at least 20 movies for the AI to generate personalised recommendations tailored to your taste.
                </p>
              </div>
            )}

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '16px',
            }}>
              {ratings.map((movie) => (
                <MovieCard
                  key={movie.movie_id}
                  movie={movie}
                  posterUrl={getPoster(movie)}
                  onClick={() => openModal(movie)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Modal */}
      {selected && (
        <MovieModal movie={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
