'use client';

/**
 * SearchOverlay.tsx
 * Full-screen search overlay: opens when the user clicks the search icon.
 * Debounced queries hit GET /api/search?q=...
 * Results show as movie mini-cards with real TMDB posters.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Loader2, Sparkles } from 'lucide-react';
import MovieModal from './MovieModal';
import type { Movie } from '@/lib/mockApi';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SearchMovie {
    movie_id:    number;
    title:       string;
    genres:      string[];
    tmdb_id:     number;
    match_score: number;
    reason?:     string;
}

interface SearchOverlayProps {
    onClose: () => void;
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({
    movie,
    posterUrl,
    onClick,
}: {
    movie: SearchMovie;
    posterUrl: string;
    onClick: () => void;
}) {
    const [hovered, setHovered] = useState(false);

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex', alignItems: 'center', gap: '16px',
                width: '100%', textAlign: 'left',
                padding: '12px 16px', borderRadius: '12px',
                background: hovered ? 'rgba(255,255,255,0.07)' : 'transparent',
                border: 'none', cursor: 'pointer',
                transition: 'background 0.15s',
            }}
        >
            {/* Poster */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={posterUrl}
                alt={movie.title}
                style={{
                    width: '52px', height: '78px', borderRadius: '6px',
                    objectFit: 'cover', flexShrink: 0,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                }}
            />

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                    color: 'white', fontWeight: 600, fontSize: '15px',
                    marginBottom: '4px', lineHeight: 1.2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {movie.title}
                </p>
                <p style={{ color: 'var(--color-muted)', fontSize: '12px', marginBottom: '6px' }}>
                    {movie.genres.slice(0, 3).join(' · ')}
                </p>
                {movie.reason && (
                    <p style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        color: '#E50914', fontSize: '11px', fontWeight: 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        <Sparkles size={10} style={{ flexShrink: 0 }} />
                        {movie.reason}
                    </p>
                )}
            </div>

            {/* Match badge */}
            {movie.match_score > 0 && (
                <span style={{
                    flexShrink: 0,
                    padding: '3px 8px', borderRadius: '6px',
                    background: 'rgba(229,9,20,0.15)', border: '1px solid rgba(229,9,20,0.3)',
                    color: '#FF6B6B', fontSize: '11px', fontWeight: 700,
                }}>
                    {movie.match_score}%
                </span>
            )}
        </button>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SearchOverlay({ onClose }: SearchOverlayProps) {
    const [query,   setQuery]   = useState('');
    const [results, setResults] = useState<SearchMovie[]>([]);
    const [posters, setPosters] = useState<Record<number, string>>({});
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [selected, setSelected] = useState<(Movie & { posterUrl: string }) | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Auto-focus input
    useEffect(() => { inputRef.current?.focus(); }, []);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !selected) onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose, selected]);

    // Debounced search
    const doSearch = useCallback((q: string) => {
        if (!q.trim()) { setResults([]); setSearched(false); setLoading(false); return; }
        setLoading(true);
        fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=12`)
            .then((r) => r.json())
            .then((data) => {
                const movies: SearchMovie[] = data.movies ?? [];
                setResults(movies);
                setSearched(true);

                // Batch-fetch real TMDB posters
                if (movies.length > 0) {
                    const ids = movies.map((m) => m.tmdb_id).join(',');
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
            .catch(() => { setResults([]); setSearched(true); })
            .finally(() => setLoading(false));
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(val), 350);
    };

    const getPoster = (movie: SearchMovie) =>
        posters[movie.tmdb_id] ?? `https://picsum.photos/seed/tmdb${movie.tmdb_id}/300/450`;

    const openModal = (movie: SearchMovie) => {
        setSelected({
            movie_id:    movie.movie_id,
            title:       movie.title,
            year:        0,
            genres:      movie.genres,
            match_score: movie.match_score,
            tmdb_id:     movie.tmdb_id,
            posterUrl:   getPoster(movie),
        });
    };

    return (
        <>
            {/* ── Backdrop ── */}
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0, zIndex: 9000,
                    background: 'rgba(0,0,0,0.75)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                    animation: 'fadeInOverlay 0.2s ease',
                }}
            />

            {/* ── Panel ── */}
            <div style={{
                position: 'fixed', top: '60px', left: '50%', transform: 'translateX(-50%)',
                zIndex: 9001,
                width: '100%', maxWidth: '680px',
                padding: '0 24px',
                animation: 'slideDownSearch 0.2s ease',
            }}>
                {/* Search input */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    background: '#1C1C1C',
                    border: '1px solid rgba(229,9,20,0.5)',
                    borderRadius: results.length > 0 || (searched && !loading) ? '14px 14px 0 0' : '14px',
                    padding: '14px 18px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(229,9,20,0.2)',
                }}>
                    {loading
                        ? <Loader2 size={20} color="#E50914" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                        : <Search size={20} color="#E50914" style={{ flexShrink: 0 }} />
                    }
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={handleChange}
                        placeholder="Search by title, genre, or mood… try 'dark sci-fi'"
                        style={{
                            flex: 1, background: 'none', border: 'none', outline: 'none',
                            color: 'white', fontSize: '17px',
                        }}
                    />
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', padding: 0 }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Results */}
                {(results.length > 0 || (searched && !loading)) && (
                    <div style={{
                        background: '#1C1C1C',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderTop: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '0 0 14px 14px',
                        maxHeight: '480px', overflowY: 'auto',
                        scrollbarWidth: 'thin',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
                        padding: '8px',
                    }}>
                        {results.length === 0 ? (
                            <p style={{ color: 'var(--color-muted)', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>
                                No results for &ldquo;{query}&rdquo;
                            </p>
                        ) : (
                            <>
                                <p style={{ color: 'var(--color-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 8px 8px' }}>
                                    {results.length} result{results.length !== 1 ? 's' : ''}
                                </p>
                                {results.map((movie) => (
                                    <ResultCard
                                        key={movie.movie_id}
                                        movie={movie}
                                        posterUrl={getPoster(movie)}
                                        onClick={() => openModal(movie)}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                )}

                {/* Hint when empty */}
                {!searched && !loading && (
                    <div style={{
                        background: 'rgba(28,28,28,0.95)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderTop: 'none', borderRadius: '0 0 14px 14px',
                        padding: '16px 20px',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
                    }}>
                        <p style={{ color: 'var(--color-muted)', fontSize: '13px' }}>
                            Try: <span style={{ color: '#E50914', cursor: 'pointer' }} onClick={() => { setQuery('dark thriller'); doSearch('dark thriller'); }}>dark thriller</span>
                            {' · '}
                            <span style={{ color: '#E50914', cursor: 'pointer' }} onClick={() => { setQuery('feel good comedy'); doSearch('feel good comedy'); }}>feel good comedy</span>
                            {' · '}
                            <span style={{ color: '#E50914', cursor: 'pointer' }} onClick={() => { setQuery('Inception'); doSearch('Inception'); }}>Inception</span>
                        </p>
                    </div>
                )}
            </div>

            {/* MovieModal */}
            {selected && (
                <div style={{ zIndex: 9999, position: 'relative' }}>
                    <MovieModal movie={selected} onClose={() => setSelected(null)} />
                </div>
            )}

            <style>{`
                @keyframes fadeInOverlay { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideDownSearch { from { opacity: 0; transform: translateX(-50%) translateY(-12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </>
    );
}
