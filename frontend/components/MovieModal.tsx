'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Play, Star, Clock, Calendar, Loader2, ExternalLink, Bookmark, BookmarkCheck, CheckCircle2 } from 'lucide-react';
import type { Movie } from '@/lib/mockApi';
import { useAuth } from '@/context/AuthContext';
import { submitRating, addToWatchlist, removeFromWatchlist, isInWatchlist, getLocalRating, setLocalRating } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrailerData {
    title: string;
    tagline: string;
    overview: string;
    backdropUrl: string;
    runtime: string;
    releaseYear: number;
    voteAverage: number;
    tmdbGenres: string[];
    trailerKey: string | null;
    trailerUrl: string | null;
    trailerEmbed: string | null;
}

interface MovieModalProps {
    movie: Movie & { posterUrl: string };
    onClose: () => void;
}

// ─── Interactive Star Rating (supports half-stars) ───────────────────────────
function StarRating({ value, onRate, disabled }: { value: number | null; onRate: (v: number) => void; disabled?: boolean }) {
    const [hover, setHover] = useState<number>(0);
    const display = hover || value || 0;

    return (
        <div style={{ display: 'flex', gap: '4px' }} onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((i) => {
                const half = i - 0.5;
                const isFull = display >= i;
                const isHalf = !isFull && display >= half;

                return (
                    <div
                        key={i}
                        style={{ position: 'relative', width: '30px', height: '30px', cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }}
                    >
                        {/* Empty star (base layer) */}
                        <span style={{
                            position: 'absolute', inset: 0,
                            fontSize: '28px', lineHeight: '30px', textAlign: 'center',
                            color: 'rgba(255,255,255,0.15)', userSelect: 'none', pointerEvents: 'none',
                        }}>★</span>

                        {/* Filled star (clipped to half or full) */}
                        {(isFull || isHalf) && (
                            <span style={{
                                position: 'absolute', inset: 0,
                                fontSize: '28px', lineHeight: '30px', textAlign: 'center',
                                color: '#F59E0B', userSelect: 'none', pointerEvents: 'none',
                                clipPath: isHalf ? 'inset(0 50% 0 0)' : 'none',
                                transition: 'clip-path 0s',
                            }}>★</span>
                        )}

                        {/* Left half click zone → i - 0.5 */}
                        <div
                            style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', zIndex: 2 }}
                            onMouseEnter={() => !disabled && setHover(half)}
                            onClick={() => !disabled && onRate(half)}
                            aria-label={`Rate ${half} stars`}
                        />
                        {/* Right half click zone → i */}
                        <div
                            style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', zIndex: 2 }}
                            onMouseEnter={() => !disabled && setHover(i)}
                            onClick={() => !disabled && onRate(i)}
                            aria-label={`Rate ${i} stars`}
                        />
                    </div>
                );
            })}

            {/* Numeric label */}
            {display > 0 && (
                <span style={{ color: 'var(--color-muted)', fontSize: '13px', alignSelf: 'center', marginLeft: '4px', minWidth: '28px' }}>
                    {display}/5
                </span>
            )}
        </div>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MovieModal({ movie, onClose }: MovieModalProps) {
    const { user, accessToken } = useAuth();
    const [data, setData] = useState<TrailerData | null>(null);
    const [loading, setLoading] = useState(true);
    const [playTrailer, setPlayTrailer] = useState(false);

    // ── Rating state ──────────────────────────────────────────────────────────
    const [userRating,   setUserRating]   = useState<number | null>(null);
    const [ratingLoading, setRatingLoading] = useState(false);
    const [ratingDone,   setRatingDone]   = useState(false);

    // ── Watchlist state ───────────────────────────────────────────────────────
    const [watchlisted, setWatchlisted]           = useState(false);
    const [watchlistLoading, setWatchlistLoading] = useState(false);
    const [showNoteInput, setShowNoteInput]       = useState(false);
    const [noteText, setNoteText]                 = useState('');

    // Load saved rating from localStorage; check real watchlist status from backend
    useEffect(() => {
        setUserRating(getLocalRating(movie.movie_id));
        setRatingDone(false);
        setWatchlisted(false);
        setShowNoteInput(false);
        setNoteText('');
        if (accessToken) {
            isInWatchlist(movie.movie_id, accessToken).then(setWatchlisted).catch(() => {});
        }
    }, [movie.movie_id, accessToken]);

    const handleRate = async (stars: number) => {
        if (!accessToken) return;
        setRatingLoading(true);
        try {
            await submitRating(movie.movie_id, stars, accessToken);
            setUserRating(stars);
            setLocalRating(movie.movie_id, stars);
            setRatingDone(true);
            setTimeout(() => setRatingDone(false), 2000);
        } catch { /* silently fail */ }
        finally { setRatingLoading(false); }
    };

    // First click → reveal note input; second click (Save) → call API
    const handleWatchlistClick = () => {
        if (watchlisted || watchlistLoading) return;
        setShowNoteInput(true);
    };

    const handleWatchlistSave = async () => {
        if (!accessToken || watchlistLoading) return;
        setWatchlistLoading(true);
        try {
            await addToWatchlist(movie.movie_id, accessToken, noteText.trim() || null);
            setWatchlisted(true);
            setShowNoteInput(false);
        } catch { /* silently ignore */ }
        finally { setWatchlistLoading(false); }
    };

    const handleWatchlistRemove = async () => {
        if (!accessToken || watchlistLoading) return;
        setWatchlistLoading(true);
        try {
            await removeFromWatchlist(movie.movie_id, accessToken);
            setWatchlisted(false);
            setNoteText('');
        } catch { /* silently ignore */ }
        finally { setWatchlistLoading(false); }
    };

    // Fetch trailer + details from our server-side proxy route
    useEffect(() => {
        setLoading(true);
        setPlayTrailer(false);
        fetch(`/api/trailer/${movie.tmdb_id}`)
            .then((r) => r.json())
            .then((d) => { setData(d); setLoading(false); })
            .catch(() => setLoading(false));
    }, [movie.tmdb_id]);

    // Close on Escape key
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); },
        [onClose]
    );
    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden'; // prevent page scroll while open
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [handleKeyDown]);

    const title       = data?.title       ?? movie.title;
    const genres      = data?.tmdbGenres?.length ? data.tmdbGenres : movie.genres;
    const year        = data?.releaseYear || movie.year;
    const runtime     = data?.runtime;
    const voteAvg     = data?.voteAverage;
    const overview    = data?.overview;
    const backdropUrl = data?.backdropUrl ?? movie.posterUrl;
    const trailerEmbed= data?.trailerEmbed;
    const trailerUrl  = data?.trailerUrl;

    return (
        /* ── Backdrop overlay ── */
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(0,0,0,0.85)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                animation: 'fadeInOverlay 0.2s ease',
            }}
        >
            {/* ── Modal card ── */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: '860px',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    borderRadius: '16px',
                    background: '#141414',
                    border: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: '0 0 0 1px rgba(229,9,20,0.1), 0 40px 120px rgba(0,0,0,0.9)',
                    animation: 'slideUpModal 0.25s ease',
                    scrollbarWidth: 'none',
                }}
            >
                {/* ── Close button ── */}
                <button
                    onClick={onClose}
                    aria-label="Close"
                    style={{
                        position: 'absolute',
                        top: '14px',
                        right: '14px',
                        zIndex: 10,
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'rgba(0,0,0,0.7)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'white',
                        transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#E50914')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.7)')}
                >
                    <X size={18} />
                </button>

                {/* ── Trailer / Backdrop area ── */}
                <div
                    style={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '16/9',
                        background: '#0A0A0A',
                        borderRadius: '16px 16px 0 0',
                        overflow: 'hidden',
                    }}
                >
                    {/* Loading spinner */}
                    {loading && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: '#0A0A0A',
                        }}>
                            <Loader2 size={36} color="#E50914" style={{ animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}

                    {/* Backdrop image (shown until play is clicked OR if no trailer) */}
                    {!loading && !playTrailer && (
                        <div style={{ position: 'absolute', inset: 0 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={backdropUrl}
                                alt={title}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            {/* Dark gradient over image */}
                            <div style={{
                                position: 'absolute', inset: 0,
                                background: 'linear-gradient(to top, rgba(20,20,20,0.95) 0%, rgba(0,0,0,0.25) 60%, transparent 100%)',
                            }} />

                            {/* Play trailer button (only if trailer exists) */}
                            {trailerEmbed && (
                                <button
                                    onClick={() => setPlayTrailer(true)}
                                    style={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        width: '72px',
                                        height: '72px',
                                        borderRadius: '50%',
                                        background: 'rgba(229,9,20,0.9)',
                                        border: '3px solid rgba(255,255,255,0.3)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        transition: 'transform 0.2s, background 0.2s',
                                        backdropFilter: 'blur(4px)',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
                                        e.currentTarget.style.background = '#E50914';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
                                        e.currentTarget.style.background = 'rgba(229,9,20,0.9)';
                                    }}
                                    aria-label="Play trailer"
                                >
                                    <Play size={28} fill="white" color="white" style={{ marginLeft: '4px' }} />
                                </button>
                            )}

                            {/* "Watch Trailer" label under the play button */}
                            {trailerEmbed && (
                                <p style={{
                                    position: 'absolute',
                                    top: 'calc(50% + 50px)',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    color: 'rgba(255,255,255,0.7)',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    whiteSpace: 'nowrap',
                                }}>
                                    Watch Trailer
                                </p>
                            )}
                        </div>
                    )}

                    {/* YouTube iframe (shown after play is clicked) */}
                    {!loading && playTrailer && trailerEmbed && (
                        <iframe
                            src={trailerEmbed}
                            title={`${title} — Trailer`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                        />
                    )}

                    {/* No trailer fallback */}
                    {!loading && !trailerEmbed && !playTrailer && (
                        <div style={{
                            position: 'absolute',
                            bottom: '16px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'rgba(0,0,0,0.5)',
                            padding: '6px 14px',
                            borderRadius: '99px',
                            color: 'rgba(255,255,255,0.45)',
                            fontSize: '11px',
                            whiteSpace: 'nowrap',
                        }}>
                            No trailer available
                        </div>
                    )}
                </div>

                {/* ── Info section ── */}
                <div style={{ padding: '28px 32px 32px' }}>
                    {/* Title */}
                    <h2 style={{
                        color: 'white',
                        fontFamily: 'var(--font-display)',
                        fontSize: 'clamp(22px, 4vw, 34px)',
                        fontWeight: 900,
                        letterSpacing: '0.04em',
                        lineHeight: 1.1,
                        marginBottom: data?.tagline ? '6px' : '16px',
                        textTransform: 'uppercase',
                    }}>
                        {title}
                    </h2>

                    {/* Tagline */}
                    {data?.tagline && (
                        <p style={{ color: '#E50914', fontSize: '13px', fontStyle: 'italic', marginBottom: '16px', fontWeight: 500 }}>
                            &ldquo;{data.tagline}&rdquo;
                        </p>
                    )}

                    {/* Meta row */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                        {voteAvg != null && voteAvg > 0 && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#F59E0B', fontSize: '14px', fontWeight: 600 }}>
                                <Star size={14} fill="#F59E0B" />
                                {voteAvg.toFixed(1)} / 10
                            </span>
                        )}
                        {runtime && runtime !== 'N/A' && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--color-muted)', fontSize: '14px' }}>
                                <Clock size={14} />
                                {runtime}
                            </span>
                        )}
                        {year > 0 && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--color-muted)', fontSize: '14px' }}>
                                <Calendar size={14} />
                                {year}
                            </span>
                        )}
                        {movie.match_score > 0 && (
                            <span style={{
                                padding: '3px 10px', borderRadius: '99px',
                                background: 'rgba(229,9,20,0.15)', border: '1px solid rgba(229,9,20,0.3)',
                                color: '#FF6B6B', fontSize: '12px', fontWeight: 600,
                            }}>
                                {movie.match_score}% Match
                            </span>
                        )}
                    </div>

                    {/* Genre chips */}
                    {genres.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
                            {genres.map((g) => (
                                <span
                                    key={g}
                                    style={{
                                        padding: '4px 12px',
                                        borderRadius: '6px',
                                        background: 'rgba(255,255,255,0.06)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: 'var(--color-muted)',
                                        fontSize: '12px',
                                        fontWeight: 500,
                                    }}
                                >
                                    {g}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Overview */}
                    {overview && (
                        <p style={{
                            color: 'rgba(255,255,255,0.75)',
                            fontSize: '14px',
                            lineHeight: 1.75,
                            marginBottom: '20px',
                        }}>
                            {overview}
                        </p>
                    )}

                    {/* ── Rate this movie ── */}
                    {user && (
                        <div style={{
                            marginBottom: '20px', padding: '16px',
                            borderRadius: '12px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                        }}>
                            <p style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 600, marginBottom: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                {userRating ? 'Your rating' : 'Rate this movie'}
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <StarRating value={userRating} onRate={handleRate} disabled={ratingLoading} />
                                {ratingLoading && <Loader2 size={14} color="#E50914" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                                {ratingDone && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#22C55E', fontSize: '13px', fontWeight: 600 }}>
                                        <CheckCircle2 size={14} /> Saved!
                                    </span>
                                )}
                                {userRating && !ratingDone && !ratingLoading && (
                                    <span style={{ color: 'var(--color-muted)', fontSize: '12px' }}>{userRating}/5</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {trailerEmbed && (
                            <button
                                onClick={() => setPlayTrailer(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '11px 24px', borderRadius: '8px',
                                    background: '#E50914', border: 'none',
                                    color: 'white', fontWeight: 700, fontSize: '14px',
                                    cursor: 'pointer', transition: 'background 0.2s',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#FF1A1A')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = '#E50914')}
                            >
                                <Play size={15} fill="white" /> Play Trailer
                            </button>
                        )}
                        {trailerUrl && (
                            <a
                                href={trailerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '11px 20px', borderRadius: '8px',
                                    background: 'rgba(255,255,255,0.07)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    color: 'white', fontWeight: 600, fontSize: '14px',
                                    cursor: 'pointer', textDecoration: 'none',
                                    transition: 'background 0.2s',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                            >
                                <ExternalLink size={14} /> Open on YouTube
                            </a>
                        )}
                        {/* Watchlist — only when logged in */}
                        {user && !watchlisted && !showNoteInput && (
                            <button
                                onClick={handleWatchlistClick}
                                disabled={watchlistLoading}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '11px 20px', borderRadius: '8px',
                                    background: 'rgba(255,255,255,0.07)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    color: 'white', fontWeight: 600, fontSize: '14px',
                                    cursor: 'pointer', transition: 'all 0.2s',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                            >
                                <Bookmark size={15} />
                                + Watchlist
                            </button>
                        )}

                        {/* Already watchlisted → green button + remove */}
                        {user && watchlisted && (
                            <button
                                onClick={handleWatchlistRemove}
                                disabled={watchlistLoading}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '11px 20px', borderRadius: '8px',
                                    background: 'rgba(34,197,94,0.12)',
                                    border: '1px solid rgba(34,197,94,0.35)',
                                    color: '#22C55E', fontWeight: 600, fontSize: '14px',
                                    cursor: watchlistLoading ? 'default' : 'pointer',
                                    opacity: watchlistLoading ? 0.7 : 1,
                                    transition: 'all 0.2s',
                                }}
                            >
                                {watchlistLoading
                                    ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                                    : <BookmarkCheck size={15} />
                                }
                                In Watchlist
                            </button>
                        )}
                    </div>

                    {/* ── Note input (shown after clicking + Watchlist) ── */}
                    {user && showNoteInput && !watchlisted && (
                        <div style={{
                            marginTop: '16px',
                            padding: '14px 16px',
                            borderRadius: '12px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            animation: 'slideUpModal 0.2s ease',
                        }}>
                            <p style={{
                                color: 'var(--color-muted)', fontSize: '12px',
                                fontWeight: 600, letterSpacing: '0.07em',
                                textTransform: 'uppercase', marginBottom: '10px',
                            }}>
                                Add a note <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}>(optional)</span>
                            </p>
                            <input
                                autoFocus
                                maxLength={300}
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleWatchlistSave(); if (e.key === 'Escape') setShowNoteInput(false); }}
                                placeholder='e.g. "watch with Sarah", "sequel to X"…'
                                style={{
                                    width: '100%', boxSizing: 'border-box',
                                    padding: '9px 13px', borderRadius: '8px',
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    color: 'white', fontSize: '13px',
                                    outline: 'none', marginBottom: '12px',
                                }}
                            />
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={handleWatchlistSave}
                                    disabled={watchlistLoading}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '7px',
                                        padding: '9px 20px', borderRadius: '8px',
                                        background: '#E50914', border: 'none',
                                        color: 'white', fontWeight: 700, fontSize: '13px',
                                        cursor: watchlistLoading ? 'default' : 'pointer',
                                        opacity: watchlistLoading ? 0.7 : 1,
                                        transition: 'background 0.2s',
                                    }}
                                    onMouseEnter={(e) => { if (!watchlistLoading) e.currentTarget.style.background = '#FF1A1A'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = '#E50914'; }}
                                >
                                    {watchlistLoading
                                        ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                        : <BookmarkCheck size={13} />
                                    }
                                    Save to Watchlist
                                </button>
                                <button
                                    onClick={() => setShowNoteInput(false)}
                                    style={{
                                        padding: '9px 16px', borderRadius: '8px',
                                        background: 'transparent',
                                        border: '1px solid rgba(255,255,255,0.12)',
                                        color: 'rgba(163,163,163,1)', fontSize: '13px',
                                        cursor: 'pointer', transition: 'border-color 0.2s',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
                                >
                                    Cancel
                                </button>
                            </div>
                            {noteText.length > 250 && (
                                <p style={{ color: noteText.length >= 300 ? '#FF6B6B' : '#F59E0B', fontSize: '11px', marginTop: '6px' }}>
                                    {300 - noteText.length} characters remaining
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes fadeInOverlay {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes slideUpModal {
                    from { opacity: 0; transform: translateY(24px) scale(0.98); }
                    to   { opacity: 1; transform: translateY(0)     scale(1); }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
