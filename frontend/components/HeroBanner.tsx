'use client';

import { Star, Sparkles, Play, Plus } from 'lucide-react';
import type { FeaturedMovie } from '@/lib/mockApi';
import Image from 'next/image';

interface HeroBannerProps {
    movie: FeaturedMovie;
    backdropUrl: string;   // resolved server-side from TMDB
}

export default function HeroBanner({ movie, backdropUrl }: HeroBannerProps) {
    return (
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

            {/* Diagonal accent line (matches screenshot) */}
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
                        fontSize: 'clamp(3.5rem, 8vw, 7rem)',
                        lineHeight: 1,
                        marginBottom: '28px',
                    }}
                >
                    {movie.title}
                </h1>

                {/* Badges Row */}
                <div
                    className="flex items-center flex-wrap"
                    style={{ gap: '16px', marginBottom: '16px' }}
                >
                    {/* IMDB rating */}
                    <div
                        className="flex items-center bg-black/50 border border-[#2A2A2A] rounded-lg"
                        style={{ gap: '8px', padding: '6px 12px' }}
                    >
                        <Star size={14} className="text-yellow-400 fill-yellow-400" />
                        <span className="text-white font-bold" style={{ fontSize: '14px' }}>{movie.rating}</span>
                    </div>

                    {/* AI Match */}
                    <div
                        className="flex items-center bg-[#E50914] rounded-lg"
                        style={{ gap: '6px', padding: '6px 12px' }}
                    >
                        <Sparkles size={14} className="text-white" />
                        <span className="text-white font-bold" style={{ fontSize: '14px' }}>{movie.match_score}%</span>
                    </div>

                    {/* Meta */}
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

                {/* Description */}
                <p
                    className="text-[#C8C8C8]"
                    style={{ fontSize: '16px', lineHeight: 1.7, maxWidth: '430px', marginBottom: '20px' }}
                >
                    {movie.description}
                </p>

                {/* AI Recommendation Card */}
                <div
                    className="glass flex items-center rounded-xl"
                    style={{ gap: '12px', padding: '12px 16px', maxWidth: '430px', marginBottom: '28px' }}
                >
                    <div
                        className="rounded-full bg-[#E50914] flex items-center justify-center flex-shrink-0"
                        style={{ width: '32px', height: '32px' }}
                    >
                        <Sparkles size={14} className="text-white" />
                    </div>
                    <div>
                        <p
                            className="font-bold uppercase text-[#E50914]"
                            style={{ fontSize: '11px', letterSpacing: '0.15em', marginBottom: '2px' }}
                        >
                            AI Recommendation
                        </p>
                        <p className="text-[#C8C8C8]" style={{ fontSize: '14px' }}>
                            {movie.ai_reason}
                        </p>
                    </div>
                </div>

                {/* CTA Buttons */}
                <div className="flex items-center flex-wrap" style={{ gap: '16px' }}>
                    <button
                        className="flex items-center bg-[#E50914] hover:bg-[#FF1A1A] text-white font-bold rounded-xl transition-all duration-200 hover:scale-105 active:scale-100 shadow-lg shadow-red-900/40"
                        style={{ gap: '10px', padding: '12px 28px', fontSize: '15px' }}
                    >
                        <Play size={18} className="fill-white" />
                        Watch Trailer
                    </button>
                    <button
                        className="flex items-center bg-transparent border-2 border-white/80 hover:border-white text-white font-bold rounded-xl transition-all duration-200 hover:bg-white/10 active:scale-95"
                        style={{ gap: '10px', padding: '12px 28px', fontSize: '15px' }}
                    >
                        <Plus size={18} />
                        Add to List
                    </button>
                </div>
            </div>
        </section>
    );
}
