'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import MovieRow from '@/components/MovieRow';
import { useAuth } from '@/context/AuthContext';
import { getTrendingByGenre, type TrendingByGenreResponse } from '@/lib/api';
import type { Movie } from '@/lib/mockApi';

type EnrichedMovie = Movie & { posterUrl: string };
type GenreGroupUI = {
    genre: string;
    rank: number;
    liked_count: number;
    movies: EnrichedMovie[];
};

function picsumPosterUrl(tmdbId: number) {
    return `https://picsum.photos/seed/tmdb${tmdbId}/300/450`;
}

function normalizeToMatchScore(trendingScore: number, min: number, max: number) {
    // MovieCard expects a 0-100 integer percentage.
    const range = Math.max(max - min, 0.0001);
    const raw = 55 + ((trendingScore - min) / range) * 40; // 55-95
    return Math.min(100, Math.max(0, Math.round(raw)));
}

function Footer() {
    return (
        <footer className="border-t border-[#2A2A2A] py-8 px-8 md:px-16 mt-14">
            <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-sm bg-[#E50914] flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                            <rect x="2" y="2" width="4" height="4" rx="0.5" fill="white" />
                            <rect x="10" y="2" width="4" height="4" rx="0.5" fill="white" />
                            <rect x="18" y="2" width="4" height="4" rx="0.5" fill="white" />
                            <rect x="2" y="10" width="20" height="12" rx="1" fill="white" />
                            <circle cx="12" cy="16" r="2.5" fill="#E50914" />
                        </svg>
                    </div>
                    <span
                        className="text-white font-black text-sm tracking-wider uppercase"
                        style={{ fontFamily: 'var(--font-display)' }}
                    >
                        Flicker
                    </span>
                </div>
                <p className="text-[#A3A3A3] text-xs">© 2025 Flicker AI — Powered by hybrid recommendations</p>
            </div>
        </footer>
    );
}

export default function TrendingPage() {
    const { accessToken, isLoading: authLoading } = useAuth();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<TrendingByGenreResponse | null>(null);
    const [genreGroups, setGenreGroups] = useState<GenreGroupUI[]>([]);
    const [posterVersion, setPosterVersion] = useState(0);

    useEffect(() => {
        if (authLoading) return;
        if (!accessToken) return;

        setError(null);
        setLoading(true);
        getTrendingByGenre(accessToken, { maxGenres: 6, limit: 12 })
            .then((res) => setData(res))
            .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load trending'))
            .finally(() => setLoading(false));
    }, [accessToken, authLoading]);

    // Convert the backend response into UI-ready MovieCard props.
    useEffect(() => {
        if (!data) {
            setGenreGroups([]);
            return;
        }

        const sorted = [...data.genre_groups].sort(
            (a, b) => (b.liked_count ?? 0) - (a.liked_count ?? 0)
        );

        const allScores = sorted.flatMap((g) => g.movies.map((m) => m.trending_score));
        const min = allScores.length ? Math.min(...allScores) : 0;
        const max = allScores.length ? Math.max(...allScores) : 0;

        const groups: GenreGroupUI[] = sorted.map((g) => ({
            genre: g.genre,
            rank: g.rank,
            liked_count: g.liked_count,
            movies: g.movies.map((m) => ({
                movie_id: m.movie_id,
                title: m.title,
                year: 0, // MovieModal shows real year once it loads TMDB details.
                genres: m.genres,
                match_score: normalizeToMatchScore(m.trending_score, min, max),
                tmdb_id: m.tmdb_id,
                posterUrl: picsumPosterUrl(m.tmdb_id),
            })),
        }));

        setGenreGroups(groups);
    }, [data]);

    // Resolve real posters for all TMDB ids in one batch, then swap into cards.
    useEffect(() => {
        if (!data) return;
        if (!genreGroups.length) return;

        const uniqueIds = Array.from(
            new Set(data.genre_groups.flatMap((g) => g.movies.map((m) => m.tmdb_id)))
        );
        if (uniqueIds.length === 0) return;

        fetch(`/api/posters?ids=${uniqueIds.join(',')}`)
            .then((r) => r.json())
            .then((posterMap: Record<number, string>) => {
                setGenreGroups((prev) =>
                    prev.map((g) => ({
                        ...g,
                        movies: g.movies.map((m) => ({
                            ...m,
                            posterUrl: posterMap[m.tmdb_id] ?? m.posterUrl,
                        })),
                    }))
                );
                // MovieRow copies propMovies into internal state only once.
                // Force a remount so cards pick up the updated posterUrl values.
                setPosterVersion((v) => v + 1);
            })
            .catch(() => {
                /* keep picsum placeholders */
            });
    }, [data, genreGroups.length]);

    return (
        <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
            <Navbar />

            <div style={{ paddingTop: '96px', paddingBottom: '60px' }}>
                {!accessToken && !authLoading ? (
                    <section
                        style={{
                            maxWidth: 720,
                            margin: '80px auto 0',
                            padding: '0 24px',
                            textAlign: 'center',
                        }}
                    >
                        <h1 className="text-white text-2xl md:text-3xl font-black mb-3">Trending by Genre</h1>
                        <p className="text-[#A3A3A3] mb-6">
                            Log in to see which genres match your likes, then explore trending picks per genre.
                        </p>
                        <div className="flex items-center justify-center gap-4">
                            <Link
                                href="/login"
                                className="font-bold text-white bg-[#E50914] hover:bg-[#FF1A1A] rounded-lg transition-all duration-200"
                                style={{ padding: '14px 28px' }}
                            >
                                Sign In
                            </Link>
                        </div>
                    </section>
                ) : (
                    <>
                        {loading && (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    paddingTop: 60,
                                    paddingBottom: 60,
                                    color: 'white',
                                }}
                            >
                                <Loader2 className="animate-spin" size={28} />
                            </div>
                        )}

                        {error && (
                            <div
                                style={{
                                    maxWidth: 720,
                                    margin: '24px auto 0',
                                    padding: '0 24px',
                                    color: 'white',
                                }}
                            >
                                <p className="text-[#E50914] font-semibold">Error: {error}</p>
                            </div>
                        )}

                        {!loading && !error && genreGroups.length > 0 && (
                            <div className="space-y-2">
                                {genreGroups.map((g) => (
                                    <MovieRow
                                        key={`${g.genre}-${posterVersion}`}
                                        title={`Trending in ${g.genre} · ${g.liked_count} liked`}
                                        movies={g.movies}
                                        lockTitle
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
                <Footer />
            </div>
        </main>
    );
}

