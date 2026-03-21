import Navbar from '@/components/Navbar';
import MovieRow from '@/components/MovieRow';
import { fetchTrending } from '@/lib/mockApi';
import { enrichMoviesWithPosters } from '@/lib/tmdb';
import Link from 'next/link';

export default async function HomePage() {
  // Fetch trending for the guest page
  const trending = await fetchTrending();
  const trendingWithPosters = await enrichMoviesWithPosters(trending.movies);

  return (
    <main style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
      <Navbar />

      {/* ── Guest Hero Section ─────────────────────────────────────────── */}
      <section
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: '80px',
          paddingBottom: '60px',
          paddingLeft: '64px',
          paddingRight: '64px',
          background: 'linear-gradient(180deg, #1a0000 0%, #0A0A0A 100%)',
          textAlign: 'center',
        }}
      >
        {/* Eyebrow label */}
        <p
          className="font-semibold uppercase text-[#E50914]"
          style={{ fontSize: '13px', letterSpacing: '0.3em', marginBottom: '30px' }}
        >
          AI-Powered Recommendations
        </p>

        {/* Headline */}
        <h1
          className="font-black text-white uppercase mx-auto"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2.8rem, 6vw, 5.5rem)',
            lineHeight: 1.05,
            maxWidth: '860px',
            marginBottom: '24px',
          }}
        >
          Your next favourite film is one click away
        </h1>

        {/* Description */}
        <p
          className="text-[#A3A3A3] mx-auto"
          style={{ fontSize: '18px', lineHeight: 1.7, maxWidth: '560px', marginBottom: '40px' }}
        >
          Flicker learns what you love and builds a personalised soundtrack of movies — powered by
          collaborative filtering and real viewer ratings.
        </p>

        {/* CTA Buttons */}
        <div className="flex items-center justify-center flex-wrap" style={{ gap: '16px' }}>
          <Link
            href="/login"
            className="font-bold text-white rounded-xl transition-all duration-200 hover:scale-105 active:scale-100 shadow-lg shadow-red-900/40"
            style={{
              background: '#E50914',
              padding: '14px 36px',
              fontSize: '16px',
            }}
          >
            Get Started — it&apos;s free
          </Link>
          <Link
            href="/discover"
            className="font-bold text-white border-2 border-white/40 hover:border-white rounded-xl transition-all duration-200 hover:bg-white/10"
            style={{ padding: '14px 36px', fontSize: '16px' }}
          >
            Browse Movies
          </Link>
        </div>

        {/* Trust indicators */}
        <p className="text-[#555]" style={{ fontSize: '13px', marginTop: '28px' }}>
          100,000+ ratings · 9,700+ movies · No subscription needed
        </p>
      </section>

      {/* ── Trending Now (visible to everyone) ─────────────────────────── */}
      <div className="pb-16" style={{ marginTop: '8px' }}>
        <MovieRow title="Trending Now" movies={trendingWithPosters} />
      </div>

      {/* Footer */}
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
            <span
              className="text-white font-black text-sm tracking-wider uppercase"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Flicker
            </span>
          </div>
          <p className="text-[#A3A3A3] text-xs">
            © 2025 Flicker AI — Powered by hybrid machine learning recommendations
          </p>
        </div>
      </footer>
    </main>
  );
}
