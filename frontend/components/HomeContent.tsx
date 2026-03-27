'use client';

/**
 * HomeContent.tsx
 * Client component — picks which home layout to render based on auth state.
 *
 *  Logged in  → Personalised hero (top-pick #1 + its TMDB backdrop + AI reason)
 *               + multiple self-fetching MovieRows
 *  Guest      → Static landing page + Trending Now row
 */

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import Navbar from '@/components/Navbar';
import HeroBanner from '@/components/HeroBanner';
import MovieRow from '@/components/MovieRow';
import type { FeaturedMovie, Movie } from '@/lib/mockApi';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// Converts MovieLens titles like "Matrix, The (1999)" → "The Matrix"
function formatTitle(raw: string): string {
    // Strip year suffix e.g. " (1999)"
    const withoutYear = raw.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    // Move leading article from end: "Matrix, The" → "The Matrix"
    const articleMatch = withoutYear.match(/^(.+),\s*(The|A|An)$/i);
    if (articleMatch) {
        return `${articleMatch[2]} ${articleMatch[1]}`;
    }
    return withoutYear;
}


// ── Types ──────────────────────────────────────────────────────────────────────
interface TopPickMovie {
    movie_id:       number;
    title:          string;
    genres:         string[];
    tmdb_id:        number;
    match_score:    number;
    reason?:        string;
    is_serendipity?: boolean;
}

interface DynamicHero {
    movie:       FeaturedMovie;
    backdropUrl: string;
}

// ── Footer ─────────────────────────────────────────────────────────────────────
function Footer() {
    return (
        <footer className="border-t border-[#2A2A2A] py-8 px-8 md:px-16">
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
                    <span className="text-white font-black text-sm tracking-wider uppercase" style={{ fontFamily: 'var(--font-display)' }}>
                        Flicker
                    </span>
                </div>
                <p className="text-[#A3A3A3] text-xs">
                    © 2025 Flicker AI — Powered by hybrid machine learning recommendations
                </p>
            </div>
        </footer>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props {
    featured:    FeaturedMovie;   // server-fetched fallback (Interstellar)
    backdropUrl: string;          // server-fetched fallback backdrop
}

export default function HomeContent({ featured, backdropUrl }: Props) {
    const { user, accessToken, isLoading } = useAuth();
    const showFullHome = !isLoading && !!user;

    // Personalised hero — swapped in once top-picks are fetched
    const [hero, setHero] = useState<DynamicHero | null>(null);
    const [favoriteMovies, setFavoriteMovies] = useState<{movie_id: number, title: string}[]>([]);

    useEffect(() => {
        if (!accessToken) return;

        if (user?.id) {
            fetch(`${API}/api/users/${user.id}/favorites`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            })
                .then((r) => r.json())
                .then((data) => {
                    if (data && data.length > 0) {
                        setFavoriteMovies(data.slice(0, 3));
                    }
                })
                .catch(() => { /* keep fallback on error */ });
        }

        // 1. Fetch the user's top picks
        fetch(`${API}/api/recommendations/top-picks?limit=5`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
            .then((r) => r.json())
            .then(async (data) => {
                const movies: TopPickMovie[] = data.movies ?? [];
                if (movies.length === 0) return;

                const pick = movies[0]; // highest-scoring personalised pick

                // 2. Fetch TMDB details (backdrop, overview, runtime, release year)
                const tmdb = await fetch(`/api/trailer/${pick.tmdb_id}`).then((r) => r.json());

                const dynamicMovie: FeaturedMovie = {
                    movie_id:    pick.movie_id,
                    tmdb_id:     pick.tmdb_id,
                    title:       tmdb.title ?? pick.title,
                    year:        tmdb.releaseYear ?? 0,
                    runtime:     tmdb.runtime ?? 'N/A',
                    genres:      tmdb.tmdbGenres?.length ? tmdb.tmdbGenres : pick.genres,
                    match_score: pick.match_score,
                    rating:      tmdb.voteAverage ?? undefined,
                    description: tmdb.overview ?? 'No description available.',
                    // AI reason: from backend if available, else generic message
                    ai_reason:   pick.reason
                        ?? (pick.is_serendipity
                            ? 'A surprising pick outside your usual taste — highly rated by viewers like you.'
                            : 'Highly rated by viewers with similar taste to yours.'),
                };

                setHero({ movie: dynamicMovie, backdropUrl: tmdb.backdropUrl ?? backdropUrl });
            })
            .catch(() => { /* keep static fallback on error */ });
    }, [accessToken, backdropUrl, user?.id]);

    // Use personalised hero when ready, fall back to static Interstellar
    const heroMovie    = hero?.movie       ?? featured;
    const heroBackdrop = hero?.backdropUrl ?? backdropUrl;

    return (
        <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
            <Navbar />

            {showFullHome ? (
                /* ── Logged-in home ─────────────────────────────────────── */
                <>
                    <HeroBanner movie={heroMovie} backdropUrl={heroBackdrop} />

                    <div style={{ paddingBottom: '60px' }}>
                        <MovieRow title="Trending Now"       endpoint="/api/trending"                            params={{ limit: '20' }} />
                        <MovieRow title="Top Picks for You"  endpoint="/api/recommendations/top-picks"           params={{ limit: '20' }} requiresAuth />
                        {favoriteMovies.length > 0 ? (
                            favoriteMovies.map(fav => (
                                <MovieRow 
                                    key={fav.movie_id}
                                    title={`Because You Liked ${formatTitle(fav.title)}\u2026`} 
                                    endpoint="/api/recommendations/because-you-liked"   
                                    params={{ limit: '20', movie_id: String(fav.movie_id) }} 
                                    requiresAuth 
                                    lockTitle
                                />
                            ))
                        ) : null}
                    </div>

                    <Footer />
                </>
            ) : (
                /* ── Guest landing page ─────────────────────────────────── */
                <>
                    <section style={{
                        minHeight: '100vh',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        paddingTop: '80px', paddingBottom: '60px',
                        paddingLeft: '64px', paddingRight: '64px',
                        background: 'linear-gradient(180deg, #1a0000 0%, #0A0A0A 100%)',
                        textAlign: 'center',
                    }}>
                        <p className="font-semibold uppercase text-[#E50914]"
                            style={{ fontSize: '13px', letterSpacing: '0.3em', marginBottom: '30px' }}>
                            AI-Powered Recommendations
                        </p>
                        <h1 className="font-black text-white uppercase mx-auto"
                            style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 'clamp(2.8rem, 6vw, 5.5rem)',
                                lineHeight: 1.05, maxWidth: '860px', marginBottom: '24px',
                            }}>
                            Your next favourite film is one click away
                        </h1>
                        <p className="text-[#A3A3A3] mx-auto"
                            style={{ fontSize: '18px', lineHeight: 1.7, maxWidth: '560px', marginBottom: '40px' }}>
                            Flicker learns what you love and builds a personalised soundtrack of movies — powered by
                            collaborative filtering and real viewer ratings.
                        </p>
                        <div className="flex items-center justify-center flex-wrap" style={{ gap: '16px' }}>
                            <Link href="/login?tab=signup"
                                className="font-bold text-white rounded-xl transition-all duration-200 hover:scale-105 active:scale-100 shadow-lg shadow-red-900/40"
                                style={{ background: '#E50914', padding: '14px 36px', fontSize: '16px' }}>
                                Get Started — it&apos;s free
                            </Link>
                            <Link href="/login"
                                className="font-bold text-white border-2 border-white/40 hover:border-white rounded-xl transition-all duration-200 hover:bg-white/10"
                                style={{ padding: '14px 36px', fontSize: '16px' }}>
                                Sign In
                            </Link>
                        </div>
                        <p className="text-[#555]" style={{ fontSize: '13px', marginTop: '28px' }}>
                            100,000+ ratings · 9,700+ movies · No subscription needed
                        </p>
                    </section>

                    <div className="pb-16" style={{ marginTop: '8px' }}>
                        <MovieRow title="Trending Now" endpoint="/api/trending" params={{ limit: '20' }} />
                    </div>

                    <Footer />
                </>
            )}
        </main>
    );
}
