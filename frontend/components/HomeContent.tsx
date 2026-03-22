'use client';

/**
 * HomeContent.tsx
 * Client component — picks which home layout to render based on auth state.
 *
 *  Logged in  → Netflix-style: HeroBanner + multiple self-fetching MovieRows
 *  Guest      → Landing page: headline + CTA + Trending Now row
 *
 * Each MovieRow fetches its own data from the backend via the `endpoint` prop,
 * so no server → client data passing is needed for the movie lists.
 */

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import Navbar from '@/components/Navbar';
import HeroBanner from '@/components/HeroBanner';
import MovieRow from '@/components/MovieRow';
import type { FeaturedMovie } from '@/lib/mockApi';

interface Props {
    featured: FeaturedMovie;
    backdropUrl: string;
}

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

export default function HomeContent({ featured, backdropUrl }: Props) {
    const { user, isLoading } = useAuth();

    // While auth resolves, show guest view to avoid flash
    const showFullHome = !isLoading && !!user;

    return (
        <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
            <Navbar />

            {showFullHome ? (
                /* ── Logged-in home ─────────────────────────────────────── */
                <>
                    <HeroBanner movie={featured} backdropUrl={backdropUrl} />

                    <div style={{ paddingBottom: '60px' }}>
                        {/* Each row fetches its own data from the backend */}
                        <MovieRow
                            title="Trending Now"
                            endpoint="/api/trending"
                            params={{ limit: '20' }}
                        />
                        <MovieRow
                            title="Top Picks for You"
                            endpoint="/api/recommendations/top-picks"
                            params={{ limit: '20' }}
                            requiresAuth
                        />
                        <MovieRow
                            title="Because You Liked…"
                            endpoint="/api/recommendations/because-you-liked"
                            params={{ limit: '20', movie_id: String(featured.movie_id) }}
                            requiresAuth
                        />
                    </div>

                    <Footer />
                </>
            ) : (
                /* ── Guest landing page ─────────────────────────────────── */
                <>
                    <section
                        style={{
                            minHeight: '100vh',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            paddingTop: '80px', paddingBottom: '60px',
                            paddingLeft: '64px', paddingRight: '64px',
                            background: 'linear-gradient(180deg, #1a0000 0%, #0A0A0A 100%)',
                            textAlign: 'center',
                        }}
                    >
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

                    {/* Trending row — fetches from real backend, visible to guests too */}
                    <div className="pb-16" style={{ marginTop: '8px' }}>
                        <MovieRow title="Trending Now" endpoint="/api/trending" params={{ limit: '20' }} />
                    </div>

                    <Footer />
                </>
            )}
        </main>
    );
}
