'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Movie } from '@/lib/mockApi';
import Image from 'next/image';
import MovieModal from './MovieModal';

// Movie enriched with a resolved TMDB poster URL
interface EnrichedMovie extends Movie {
    posterUrl: string;
}

interface MovieCardProps {
    movie: EnrichedMovie;
}

export default function MovieCard({ movie }: MovieCardProps) {
    const [modalOpen, setModalOpen] = useState(false);

    return (
        <>
            {/* ── Card ── */}
            <div
                className="relative flex-shrink-0 w-52 md:w-64 group cursor-pointer"
                onClick={() => setModalOpen(true)}
                role="button"
                tabIndex={0}
                aria-label={`View details for ${movie.title}`}
                onKeyDown={(e) => e.key === 'Enter' && setModalOpen(true)}
            >
                {/* Poster */}
                <div className="relative w-full aspect-[2/3] rounded-xl overflow-hidden card-glow transition-all duration-300 group-hover:scale-105 group-hover:-translate-y-1">
                    <Image
                        src={movie.posterUrl}
                        alt={movie.title}
                        fill
                        className="object-cover"
                        sizes="180px"
                        unoptimized
                    />

                    {/* Gradient overlay on hover */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                    {/* Match score badge */}
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-[#E50914] rounded-md px-1.5 py-0.5 shadow-lg">
                        <Sparkles size={10} className="text-white" />
                        <span className="text-white text-[10px] font-bold">{movie.match_score}%</span>
                    </div>

                    {/* Hover genre chips */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                        <div className="flex gap-1 flex-wrap">
                            {movie.genres.slice(0, 2).map((g) => (
                                <span
                                    key={g}
                                    className="text-[9px] uppercase tracking-wider text-[#A3A3A3] bg-black/60 px-1.5 py-0.5 rounded"
                                >
                                    {g}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>



                {/* ── Modal (portal-style, rendered outside the card) ── */}
                {modalOpen && (
                    <MovieModal
                        movie={movie}
                        onClose={() => setModalOpen(false)}
                    />
                )}
            </>
            );
}
