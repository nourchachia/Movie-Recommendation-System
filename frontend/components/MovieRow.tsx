'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';
import type { Movie } from '@/lib/mockApi';
import { useAuth } from '@/context/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichedMovie extends Movie { posterUrl: string; }

interface MovieRowProps {
    /** Fallback title — overridden by the API's row_title when endpoint is set */
    title: string;
    /** Pass movies directly (server pre-fetched). Skip if using endpoint. */
    movies?: EnrichedMovie[];
    /**
     * Backend path to fetch from, e.g. '/api/trending', '/api/recommendations/top-picks'.
     * When set, the component fetches its own data and uses picsum placeholders for posters.
     */
    endpoint?: string;
    /** Additional query-string params (e.g. { limit: '20' }) */
    params?: Record<string, string>;
    /** If true, the Bearer access token is sent in the request header */
    requiresAuth?: boolean;
    /** If true, the title prop is always used and the API's row_title is ignored */
    lockTitle?: boolean;
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
    return (
        <div className="flex-shrink-0 w-52 md:w-64" style={{
            borderRadius: '10px',
            background: 'rgba(255,255,255,0.06)', aspectRatio: '2/3',
            animation: 'rowPulse 1.5s ease-in-out infinite',
        }} />
    );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MovieRow({
    title,
    movies: propMovies,
    endpoint,
    params = {},
    requiresAuth = false,
    lockTitle = false,
}: MovieRowProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const { accessToken, isLoading: authLoading } = useAuth();

    const [movies, setMovies] = useState<EnrichedMovie[]>(propMovies ?? []);
    const [rowTitle, setRowTitle] = useState(title);
    const [loading, setLoading] = useState(!!endpoint);

    useEffect(() => {
        if (!endpoint) return;
        // Wait while auth is resolving
        if (requiresAuth && authLoading) return;
        // Don't try authenticated endpoints without a token
        if (requiresAuth && !accessToken) { setLoading(false); return; }

        const url = new URL(`${API}${endpoint}`);
        const defaultParams: Record<string, string> = { limit: '20' };
        Object.entries({ ...defaultParams, ...params }).forEach(([k, v]) => url.searchParams.set(k, v));

        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

        setLoading(true);
        fetch(url.toString(), { headers })
            .then((r) => r.json())
            .then(async (data) => {
                const raw: Array<{
                    movie_id: number; title: string; genres: string[];
                    tmdb_id: number; match_score?: number;
                }> = data.movies ?? [];
                if (!lockTitle && data.row_title) setRowTitle(data.row_title);

                // Build initial list with picsum placeholders so cards appear immediately
                const initialMovies: EnrichedMovie[] = raw.map((m) => ({
                    movie_id: m.movie_id,
                    title: m.title,
                    year: 0,
                    genres: m.genres,
                    match_score: m.match_score ?? 0,
                    tmdb_id: m.tmdb_id,
                    posterUrl: `https://picsum.photos/seed/tmdb${m.tmdb_id}/300/450`,
                }));
                setMovies(initialMovies);

                // Swap placeholders for real TMDB posters via the batch server route
                if (raw.length > 0) {
                    const ids = raw.map((m) => m.tmdb_id).join(',');
                    fetch(`/api/posters?ids=${ids}`)
                        .then((r) => r.json())
                        .then((posterMap: Record<string, string>) => {
                            setMovies((prev) =>
                                prev.map((m) =>
                                    posterMap[m.tmdb_id]
                                        ? { ...m, posterUrl: posterMap[m.tmdb_id] }
                                        : m
                                )
                            );
                        })
                        .catch(() => { /* keep picsum on error */ });
                }
            })
            .catch(() => { /* silently keep empty */ })
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, accessToken, authLoading, requiresAuth]);

    const scroll = (dir: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const amount = scrollRef.current.clientWidth * 0.75;
        scrollRef.current.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: 'smooth' });
    };

    // Hide auth-required rows when the user has no token
    if (requiresAuth && !authLoading && !accessToken) return null;

    return (
        <section className="relative group/row" style={{ paddingTop: '32px', paddingBottom: '32px' }}>
            {/* Row header */}
            <div className="flex items-center justify-between px-8 md:px-16" style={{ marginBottom: '24px' }}>
                {/* Title with red left accent bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <span style={{
                        display: 'block',
                        width: '4px',
                        height: '28px',
                        borderRadius: '2px',
                        background: 'linear-gradient(to bottom, #E50914, #ff6b6b)',
                        flexShrink: 0,
                        boxShadow: '0 0 8px rgba(229,9,20,0.6)',
                    }} />
                    <h4 style={{
                        fontSize: '1.5rem',
                        fontWeight: '700',
                        letterSpacing: '0.02em',
                        background: 'linear-gradient(90deg, #ffffff 60%, #a3a3a3 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        margin: 0,
                    }}>{rowTitle}</h4>
                </div>
                <button style={{
                    color: '#a3a3a3',
                    fontSize: '11px',
                    fontWeight: '600',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    transition: 'color 0.2s',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#E50914')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#a3a3a3')}
                >
                    See All →
                </button>
            </div>

            {/* Scroll container */}
            <div className="relative">
                {/* Left fade + arrow */}
                <button
                    onClick={() => scroll('left')}
                    className="absolute left-0 top-0 bottom-4 z-10 w-14 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 bg-gradient-to-r from-[#0A0A0A] to-transparent hover:from-[#141414]"
                    aria-label="Scroll left"
                >
                    <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 transition-colors">
                        <ChevronLeft size={18} className="text-white" />
                    </div>
                </button>

                {/* Cards */}
                <div ref={scrollRef} className="flex overflow-x-auto scrollbar-hide px-8 md:px-16 pb-2" style={{ gap: '24px' }}>
                    {loading
                        ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
                        : movies.map((movie) => <MovieCard key={movie.movie_id} movie={movie} />)
                    }
                </div>

                {/* Right fade + arrow */}
                <button
                    onClick={() => scroll('right')}
                    className="absolute right-0 top-0 bottom-4 z-10 w-14 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 bg-gradient-to-l from-[#0A0A0A] to-transparent hover:from-[#141414]"
                    aria-label="Scroll right"
                >
                    <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 transition-colors">
                        <ChevronRight size={18} className="text-white" />
                    </div>
                </button>
            </div>

            <style>{`
                @keyframes rowPulse {
                    0%, 100% { opacity: 0.35; }
                    50%       { opacity: 0.7; }
                }
            `}</style>
        </section>
    );
}
