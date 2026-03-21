'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';
import type { Movie } from '@/lib/mockApi';

interface EnrichedMovie extends Movie {
    posterUrl: string;
}

interface MovieRowProps {
    title: string;
    movies: EnrichedMovie[];
}

export default function MovieRow({ title, movies }: MovieRowProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const scroll = (dir: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const amount = scrollRef.current.clientWidth * 0.75;
        scrollRef.current.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: 'smooth' });
    };

    return (
        <section className="relative py-4 group/row">
            {/* Row header */}
            <div className="flex items-center justify-between mb-4 px-8 md:px-16">
                <h2 className="text-white text-lg md:text-xl font-bold tracking-tight">
                    {title}
                </h2>
                <button className="text-[#A3A3A3] hover:text-[#E50914] text-xs font-semibold uppercase tracking-widest transition-colors">
                    See All
                </button>
            </div>

            {/* Scroll container wrapper */}
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
                <div
                    ref={scrollRef}
                    className="flex gap-3 md:gap-4 overflow-x-auto scrollbar-hide px-8 md:px-16 pb-2"
                >
                    {movies.map((movie) => (
                        <MovieCard key={movie.movie_id} movie={movie} />
                    ))}
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
        </section>
    );
}
