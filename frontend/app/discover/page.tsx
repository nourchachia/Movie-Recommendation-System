'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Compass } from 'lucide-react';
import Navbar from '@/components/Navbar';
import MovieRow from '@/components/MovieRow';
import { useAuth } from '@/context/AuthContext';
import { getTopPicks, type RecommendationType, type TopPickMovie } from '@/lib/api';
import type { Movie } from '@/lib/mockApi';

type EnrichedMovie = Movie & { posterUrl: string };

function toEnrichedMovies(movies: TopPickMovie[]): EnrichedMovie[] {
  return movies.map((m) => ({
    movie_id: m.movie_id,
    title: m.title,
    year: 0,
    genres: m.genres,
    match_score: m.match_score ?? 0,
    tmdb_id: m.tmdb_id,
    posterUrl: `https://picsum.photos/seed/tmdb${m.tmdb_id}/300/450`,
    description: m.reason,
  }));
}

export default function DiscoverPage() {
  const { accessToken, isLoading: authLoading } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movies, setMovies] = useState<TopPickMovie[]>([]);
  const [posterVersion, setPosterVersion] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!accessToken) return;

    setError(null);
    setLoading(true);
    getTopPicks(accessToken, { limit: 24 })
      .then((res) => setMovies(res.movies ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load discover picks'))
      .finally(() => setLoading(false));
  }, [accessToken, authLoading]);

  const grouped = useMemo(() => {
    const byType: Record<RecommendationType, TopPickMovie[]> = {
      serendipity: [],
      collab_dominant: [],
      content_dominant: [],
    };

    for (const movie of movies) {
      const type: RecommendationType =
        movie.recommendation_type ??
        (movie.is_serendipity ? 'serendipity' : 'collab_dominant');
      byType[type].push(movie);
    }
    return byType;
  }, [movies]);

  const serendipityMovies = useMemo(() => toEnrichedMovies(grouped.serendipity), [grouped.serendipity]);
  const collabMovies = useMemo(() => toEnrichedMovies(grouped.collab_dominant), [grouped.collab_dominant]);
  const contentMovies = useMemo(() => toEnrichedMovies(grouped.content_dominant), [grouped.content_dominant]);

  // Replace placeholder posters with TMDB posters in a single batch.
  useEffect(() => {
    const all = [...serendipityMovies, ...collabMovies, ...contentMovies];
    if (!all.length) return;

    const ids = Array.from(new Set(all.map((m) => m.tmdb_id)));
    fetch(`/api/posters?ids=${ids.join(',')}`)
      .then((r) => r.json())
      .then((posterMap: Record<string, string>) => {
        setMovies((prev) =>
          prev.map((m) => ({
            ...m,
            poster_url: posterMap[String(m.tmdb_id)] ?? m.poster_url,
          }))
        );
        setPosterVersion((v) => v + 1);
      })
      .catch(() => {
        /* keep placeholder posters */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies.length]);

  const toRows = (items: TopPickMovie[]) =>
    items.map((m) => ({
      movie_id: m.movie_id,
      title: m.title,
      year: 0,
      genres: m.genres,
      match_score: m.match_score ?? 0,
      tmdb_id: m.tmdb_id,
      posterUrl: m.poster_url ?? `https://picsum.photos/seed/tmdb${m.tmdb_id}/300/450`,
      description: m.reason,
    })) as EnrichedMovie[];

  if (!authLoading && !accessToken) {
    return (
      <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
        <Navbar />
        <section style={{ paddingTop: 110, maxWidth: 760, margin: '0 auto', textAlign: 'center', paddingLeft: 24, paddingRight: 24 }}>
          <h1 className="text-white text-2xl md:text-3xl font-black mb-3">Discover</h1>
          <p className="text-[#A3A3A3] mb-6">
            Sign in to explore recommendations grouped by why they were selected.
          </p>
          <Link
            href="/login"
            className="font-bold text-white bg-[#E50914] hover:bg-[#FF1A1A] rounded-lg transition-all duration-200 inline-block"
            style={{ padding: '14px 28px' }}
          >
            Sign In
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
      <Navbar />
      <div style={{ paddingTop: 96, paddingBottom: 60 }}>
        <section className="px-8 md:px-16 mb-3">
          <div className="max-w-[1440px] mx-auto">
            <div className="flex items-center gap-2 mb-2">
              <Compass size={18} color="white" />
              <h1 className="text-white text-2xl font-black">Discover</h1>
            </div>
            <p className="text-[#A3A3A3] text-sm">
              Grouped by recommendation signal: serendipity, collaborative-dominant, and content-dominant.
            </p>
          </div>
        </section>

        {loading && (
          <div className="flex items-center justify-center text-white py-16">
            <Loader2 className="animate-spin" size={28} />
          </div>
        )}

        {error && (
          <div className="px-8 md:px-16">
            <p className="text-[#E50914] font-semibold">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {grouped.serendipity.length > 0 && (
              <MovieRow
                key={`serendipity-${posterVersion}`}
                title="Serendipity Picks"
                movies={toRows(grouped.serendipity)}
                lockTitle
              />
            )}
            {grouped.collab_dominant.length > 0 && (
              <MovieRow
                key={`collab-${posterVersion}`}
                title="Collaborative Score > Content Score"
                movies={toRows(grouped.collab_dominant)}
                lockTitle
              />
            )}
            {grouped.content_dominant.length > 0 && (
              <MovieRow
                key={`content-${posterVersion}`}
                title="Content Score > Collaborative Score"
                movies={toRows(grouped.content_dominant)}
                lockTitle
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

