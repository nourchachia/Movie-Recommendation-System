'use client';

import { useState } from 'react';
import { Star, Sparkles, Play, Plus, Check, X, Loader2 } from 'lucide-react';
import MovieModal from '@/components/MovieModal';
import type { FeaturedMovie } from '@/lib/mockApi';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface HeroBannerProps {
    movie: FeaturedMovie;
    backdropUrl: string;
}

export default function HeroBanner({ movie, backdropUrl }: HeroBannerProps) {
    const { accessToken } = useAuth();

    // ── Trailer state ────────────────────────────────────────────────────────
    const [trailerOpen, setTrailerOpen] = useState(false);
    const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
    const [trailerLoading, setTrailerLoading] = useState(false);

    const openTrailer = async () => {
        if (trailerUrl) { setTrailerOpen(true); return; }
        setTrailerLoading(true);
        try {
            const data = await fetch(`/api/trailer/${movie.tmdb_id}`).then((r) => r.json());
            setTrailerUrl(data.trailerEmbed ?? null);
        } finally {
            setTrailerLoading(false);
            setTrailerOpen(true);
        }
    };

    // ── Movie modal state ─────────────────────────────────────────────────────
    const [modalOpen, setModalOpen] = useState(false);

    // ── Watchlist state ──────────────────────────────────────────────────────
    const [watchlist, setWatchlist] = useState<'idle' | 'loading' | 'added'>('idle');

    const addToWatchlist = async () => {
        if (!accessToken || watchlist !== 'idle') return;
        setWatchlist('loading');
        try {
            const res = await fetch(`${API}/api/watchlist`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ movie_id: movie.movie_id }),
            });
            // 201 = added, 409 = already in list — both count as success
            if (res.status === 201 || res.status === 409) {
                setWatchlist('added');
            } else {
                setWatchlist('idle');
            }
        } catch {
            setWatchlist('idle');
        }
    };

    return (
        <>
            {/* ── Hero section ────────────────────────────────────────────── */}
            <section className="relative w-full h-screen min-h-[600px] max-h-[900px] flex items-center overflow-hidden">
                {/* Background poster */}
                <div className="absolute inset-0">
                    <Image
                        src={backdropUrl}
                        alt={movie.title}
                        fill
                        priority
                        className="object-cover object-center scale-105"
                        style={{ filter: 'brightness(0.55)' }}
                    />
                </div>

                {/* Cinematic gradient overlays */}
                <div className="absolute inset-0 hero-gradient" />
                <div className="absolute bottom-0 left-0 right-0 h-48 hero-bottom-fade" />

                {/* Diagonal accent line */}
                <div
                    className="absolute right-1/4 top-0 bottom-0 w-px opacity-20 pointer-events-none"
                    style={{
                        background: 'linear-gradient(to bottom, transparent, #4A6CF7, transparent)',
                        transform: 'rotate(8deg) translateX(200px)',
                    }}
                />

                {/* Content */}
                <div
                    className="relative z-10 mx-auto max-w-[1440px] w-full"
                    style={{ paddingLeft: '64px', paddingRight: '64px', paddingTop: '128px' }}
                >
                    {/* Label */}
                    <p
                        className="font-semibold uppercase text-[#A3A3A3]"
                        style={{ fontSize: '13px', letterSpacing: '0.25em', marginBottom: '20px' }}
                    >
                        Featured Recommendation
                    </p>

                    {/* Title */}
                    <h1
                        className="font-black text-white uppercase"
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 'clamp(3.2rem, 7vw, 6rem)',
                            lineHeight: 1,
                            marginBottom: '28px',
                        }}
                    >
                        {movie.title}
                    </h1>

                    {/* Badges Row */}
                    <div className="flex items-center flex-wrap" style={{ gap: '16px', marginBottom: '16px' }}>
                        <div className="flex items-center bg-black/50 border border-[#2A2A2A] rounded-lg" style={{ gap: '8px', padding: '6px 12px' }}>
                            <Star size={14} className="text-yellow-400 fill-yellow-400" />
                            <span className="text-white font-bold" style={{ fontSize: '14px' }}>{movie.rating}</span>
                        </div>
                        <div className="flex items-center bg-[#E50914] rounded-lg" style={{ gap: '6px', padding: '6px 12px' }}>
                            <Sparkles size={14} className="text-white" />
                            <span className="text-white font-bold" style={{ fontSize: '14px' }}>{movie.match_score}%</span>
                        </div>
                        <span className="text-[#A3A3A3] font-medium" style={{ fontSize: '14px' }}>{movie.year}</span>
                        <span className="text-[#A3A3A3] font-medium" style={{ fontSize: '14px' }}>{movie.runtime}</span>
                    </div>

                    {/* Genre Chips */}
                    <div className="flex flex-wrap" style={{ gap: '8px', marginBottom: '20px' }}>
                        {movie.genres.map((g) => (
                            <span
                                key={g}
                                className="rounded-full font-semibold uppercase text-[#A3A3A3] border border-[#2A2A2A] bg-black/30"
                                style={{ padding: '4px 12px', fontSize: '11px', letterSpacing: '0.1em' }}
                            >
                                {g}
                            </span>
                        ))}
                    </div>

                    {/* Description — clamped to 3 lines */}
                    <div style={{ maxWidth: '430px', marginBottom: '20px' }}>
                        <p
                            className="text-[#C8C8C8]"
                            style={{
                                fontSize: '12px',
                                lineHeight: 1.2,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                marginBottom: '1.2px',
                            }}
                        >
                            {movie.description}
                        </p>
                        <button
                            onClick={() => setModalOpen(true)}
                            className="text-[#E50914] hover:text-[#FF3333] font-semibold transition-colors"
                            style={{ fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                            See more
                        </button>
                    </div>

                    {/* AI Recommendation Card */}
                    <div className="glass flex items-center rounded-xl" style={{ gap: '12px', padding: '12px 16px', maxWidth: '430px', marginBottom: '14px' }}>
                        <div className="rounded-full bg-[#E50914] flex items-center justify-center flex-shrink-0" style={{ width: '26px', height: '26px' }}>
                            <Sparkles size={14} className="text-white" />
                        </div>
                        <div>
                            <p className="font-bold uppercase text-[#E50914]" style={{ fontSize: '11px', letterSpacing: '0.15em', marginBottom: '2px' }}>
                                AI Recommendation
                            </p>
                            <p className="text-[#C8C8C8]" style={{ fontSize: '14px' }}>
                                {movie.ai_reason}
                            </p>
                        </div>
                    </div>

                    {/* CTA Buttons */}
                    <div className="flex items-center flex-wrap" style={{ gap: '16px' }}>
                        {/* Watch Trailer */}
                        <button
                            onClick={openTrailer}
                            disabled={trailerLoading}
                            className="flex items-center bg-[#E50914] hover:bg-[#FF1A1A] text-white font-bold rounded-xl transition-all duration-200 hover:scale-105 active:scale-100 shadow-lg shadow-red-900/40 disabled:opacity-60 disabled:cursor-wait"
                            style={{ gap: '10px', padding: '4px 28px', fontSize: '15px' }}
                        >
                            {trailerLoading
                                ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Play size={18} className="fill-white" />
                            }
                            Watch Trailer
                        </button>

                        {/* Add to Watchlist */}
                        <button
                            onClick={addToWatchlist}
                            disabled={watchlist === 'loading' || !accessToken}
                            className="flex items-center border-2 text-white font-bold rounded-xl transition-all duration-200 active:scale-95 disabled:opacity-50"
                            style={{
                                gap: '10px', padding: '4px 28px', fontSize: '15px',
                                background: watchlist === 'added' ? 'rgba(34,197,94,0.15)' : 'transparent',
                                borderColor: watchlist === 'added' ? '#22C55E' : 'rgba(255,255,255,0.8)',
                            }}
                        >
                            {watchlist === 'loading'
                                ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                : watchlist === 'added'
                                    ? <Check size={18} color="#22C55E" />
                                    : <Plus size={18} />
                            }
                            {watchlist === 'added' ? 'In Watchlist' : 'Add to List'}
                        </button>
                    </div>
                </div>
            </section>

            {/* ── Movie detail modal ─────────────────────────────────────── */}
            {modalOpen && (
                <MovieModal
                    movie={{
                        movie_id: movie.movie_id,
                        title: movie.title,
                        year: movie.year,
                        genres: movie.genres,
                        match_score: movie.match_score ?? 0,
                        tmdb_id: movie.tmdb_id,
                        posterUrl: backdropUrl,
                    }}
                    onClose={() => setModalOpen(false)}
                />
            )}

            {/* ── Trailer Modal ────────────────────────────────────────────── */}
            {trailerOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        onClick={() => setTrailerOpen(false)}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 9998,
                            background: 'rgba(0,0,0,0.88)',
                            backdropFilter: 'blur(8px)',
                        }}
                    />
                    {/* Modal */}
                    <div style={{
                        position: 'fixed', inset: 0, zIndex: 9999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '24px',
                        pointerEvents: 'none',
                    }}>
                        <div style={{
                            width: '100%', maxWidth: '900px',
                            background: '#111', borderRadius: '16px',
                            overflow: 'hidden', boxShadow: '0 40px 80px rgba(0,0,0,0.8)',
                            pointerEvents: 'auto',
                        }}>
                            {/* Header */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #222' }}>
                                <p style={{ color: 'white', fontWeight: 700, fontSize: '16px' }}>{movie.title} — Trailer</p>
                                <button onClick={() => setTrailerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A3A3A3', display: 'flex' }}>
                                    <X size={22} />
                                </button>
                            </div>
                            {/* Iframe or no-trailer message */}
                            {trailerUrl ? (
                                <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
                                    <iframe
                                        src={trailerUrl}
                                        title="Trailer"
                                        allow="autoplay; encrypted-media"
                                        allowFullScreen
                                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                                    />
                                </div>
                            ) : (
                                <div style={{ padding: '48px', textAlign: 'center', color: '#A3A3A3' }}>
                                    No trailer available for this movie.
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </>
    );
}
