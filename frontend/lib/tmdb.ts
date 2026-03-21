/**
 * TMDB (The Movie Database) utility
 *
 * Flow:
 *  1. Backend returns { tmdb_id: 862, ... } in every Movie object.
 *  2. We call fetchPosterUrl(862) → fetches TMDB API → returns full image URL.
 *  3. We pass that URL string directly to <Image src={posterUrl} />.
 *
 * All fetching is done server-side (page.tsx is a Server Component),
 * so the API key is never exposed to the browser.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

/** Fallback poster shown when TMDB has no image for a movie */
const FALLBACK_POSTER = 'https://image.tmdb.org/t/p/w500/'; // returns 404 → Next.js uses placeholder

/**
 * Fetch the poster URL for a single movie from TMDB.
 * Returns the full https://image.tmdb.org/t/p/w500/... URL.
 */
export async function fetchPosterUrl(tmdb_id: number): Promise<string> {
    const apiKey = process.env.TMDB_API_KEY;

    if (!apiKey || apiKey === 'your_tmdb_api_key_here') {
        // Return a placeholder gradient image when no key is configured
        return `https://picsum.photos/seed/tmdb${tmdb_id}/300/450`;
    }

    try {
        const res = await fetch(
            `${TMDB_BASE}/movie/${tmdb_id}?api_key=${apiKey}`,
            {
                // Cache per movie for 24 hours (Next.js fetch cache)
                next: { revalidate: 86400 },
            }
        );

        if (!res.ok) {
            console.warn(`[TMDB] Movie ${tmdb_id} not found (${res.status})`);
            return `https://picsum.photos/seed/tmdb${tmdb_id}/300/450`;
        }

        const data = await res.json();
        const poster_path: string | null = data.poster_path;
        const backdrop_path: string | null = data.backdrop_path;

        // Return backdrop for hero, poster for cards — we expose both
        return poster_path
            ? `${TMDB_IMAGE_BASE}${poster_path}`
            : FALLBACK_POSTER;
    } catch (err) {
        console.error(`[TMDB] Failed to fetch movie ${tmdb_id}:`, err);
        return `https://picsum.photos/seed/tmdb${tmdb_id}/300/450`;
    }
}

/**
 * Fetch hero-quality backdrop (w1280) for the HeroBanner.
 */
export async function fetchBackdropUrl(tmdb_id: number): Promise<string> {
    const apiKey = process.env.TMDB_API_KEY;

    if (!apiKey || apiKey === 'your_tmdb_api_key_here') {
        return `https://picsum.photos/seed/hero${tmdb_id}/1400/800`;
    }

    try {
        const res = await fetch(
            `${TMDB_BASE}/movie/${tmdb_id}?api_key=${apiKey}`,
            { next: { revalidate: 86400 } }
        );

        if (!res.ok) return `https://picsum.photos/seed/hero${tmdb_id}/1400/800`;

        const data = await res.json();
        const backdrop_path: string | null = data.backdrop_path;
        const poster_path: string | null = data.poster_path;

        // Prefer backdrop for full-screen hero, fallback to poster
        const path = backdrop_path ?? poster_path;
        return path
            ? `https://image.tmdb.org/t/p/w1280${path}`
            : `https://picsum.photos/seed/hero${tmdb_id}/1400/800`;
    } catch {
        return `https://picsum.photos/seed/hero${tmdb_id}/1400/800`;
    }
}

/**
 * Enrich an array of movies with resolved poster URLs in parallel.
 * Call this on the server (Server Component) before passing data to client components.
 */
export async function enrichMoviesWithPosters<T extends { tmdb_id: number }>(
    movies: T[]
): Promise<(T & { posterUrl: string })[]> {
    const urls = await Promise.all(movies.map((m) => fetchPosterUrl(m.tmdb_id)));
    return movies.map((m, i) => ({ ...m, posterUrl: urls[i] }));
}
