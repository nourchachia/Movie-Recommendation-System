/**
 * lib/tmdb.ts — TMDB (The Movie Database) API Integration
 *
 * Architecture:
 *  - Backend returns { tmdb_id: 862, ... } in every Movie object.
 *  - fetchPosterUrl(tmdb_id)    → full  https://image.tmdb.org/t/p/w500/...  URL
 *  - fetchBackdropUrl(tmdb_id)  → full  https://image.tmdb.org/t/p/w1280/... URL
 *  - fetchTrailerUrl(tmdb_id)   → YouTube embed URL for the official trailer
 *  - fetchTrailerKey(tmdb_id)   → raw YouTube video key (e.g. "dQw4w9WgXcQ")
 *  - fetchMovieDetails(tmdb_id) → all of the above + overview, runtime, rating…
 *  - enrichMoviesWithPosters()  → parallel-fetches posters for an array of movies
 *
 * Security:
 *  All fetching is done server-side (Server Components / API routes).
 *  TMDB_API_KEY is never sent to the browser.
 *
 * Caching:
 *  Next.js fetch() caches responses for 24 h (revalidate: 86400).
 *  Unchanged movies never hit TMDB twice between deployments.
 *
 * How to get a free API key:
 *  1. Sign up at https://www.themoviedb.org/signup
 *  2. Go to https://www.themoviedb.org/settings/api
 *  3. Copy your "API Key (v3 auth)" value
 *  4. Paste it in frontend/.env.local as: TMDB_API_KEY=<your_key>
 */

const TMDB_BASE        = 'https://api.themoviedb.org/3';
const TMDB_IMG_W500    = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMG_W780    = 'https://image.tmdb.org/t/p/w780';
const TMDB_IMG_W1280   = 'https://image.tmdb.org/t/p/w1280';

// ─── Internal helper ─────────────────────────────────────────────────────────

function getApiKey(): string | null {
    const key = process.env.TMDB_API_KEY;
    if (!key || key === 'your_tmdb_api_key_here') return null;
    return key;
}

/** Deterministic placeholder based on tmdb_id — always the same image for the same movie */
function placeholder(tmdb_id: number, width = 300, height = 450): string {
    return `https://picsum.photos/seed/tmdb${tmdb_id}/${width}/${height}`;
}

/**
 * Shared TMDB fetch helper — uses Next.js 24-hour cache.
 * Returns parsed JSON or null on error.
 */
async function tmdbFetch<T>(path: string): Promise<T | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
        // Use & if the path already has a query string (e.g. ?append_to_response=videos),
        // otherwise use ? — avoids the double-? bug that silently breaks TMDB responses.
        const sep = path.includes('?') ? '&' : '?';
        const res = await fetch(`${TMDB_BASE}${path}${sep}api_key=${apiKey}`, {
            next: { revalidate: 86400 }, // cache for 24 h
        });
        if (!res.ok) {
            console.warn(`[TMDB] ${path} → ${res.status} ${res.statusText}`);
            return null;
        }
        return res.json() as Promise<T>;
    } catch (err) {
        console.error(`[TMDB] fetch failed for ${path}:`, err);
        return null;
    }
}

// ─── Raw TMDB response types ──────────────────────────────────────────────────

interface TMDBVideo {
    id: string;
    key: string;          // YouTube video ID, e.g. "dQw4w9WgXcQ"
    name: string;
    site: string;         // "YouTube" | "Vimeo" | ...
    type: string;         // "Trailer" | "Teaser" | "Clip" | "Featurette" | ...
    official: boolean;
    published_at: string;
}

interface TMDBMovie {
    id: number;
    title: string;
    original_title: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date: string;          // "YYYY-MM-DD"
    vote_average: number;          // 0–10
    vote_count: number;
    runtime: number | null;        // minutes
    genres: { id: number; name: string }[];
    tagline: string;
    status: string;
    popularity: number;
    // append_to_response=videos injects this:
    videos?: { results: TMDBVideo[] };
}

// ─── Public enriched type ─────────────────────────────────────────────────────

export interface TMDBDetails {
    tmdb_id: number;
    title: string;
    tagline: string;
    overview: string;
    posterUrl: string;          // w500
    posterUrlHd: string;        // w780  — for modal cards
    backdropUrl: string;        // w1280 — for hero banners
    releaseYear: number;
    runtime: string;            // "2h 9m" or "N/A"
    voteAverage: number;        // 7.8
    voteCount: number;
    tmdbGenres: string[];       // ["Action", "Drama"]
    trailerKey: string | null;  // YouTube video key, e.g. "dQw4w9WgXcQ"
    trailerUrl: string | null;  // Full YouTube watch URL, e.g. "https://youtube.com/watch?v=..."
    trailerEmbed: string | null;// YouTube embed URL for <iframe src={trailerEmbed} />
}

// ─── Internal trailer picker ─────────────────────────────────────────────────

/**
 * Given TMDB's videos list, pick the best trailer key.
 * Priority: official YouTube Trailer → any YouTube Trailer → YouTube Teaser → null.
 */
function pickTrailerKey(videos: TMDBVideo[]): string | null {
    const yt = videos.filter((v) => v.site === 'YouTube');
    // 1. Official Trailer
    const officialTrailer = yt.find((v) => v.type === 'Trailer' && v.official);
    if (officialTrailer) return officialTrailer.key;
    // 2. Any Trailer
    const anyTrailer = yt.find((v) => v.type === 'Trailer');
    if (anyTrailer) return anyTrailer.key;
    // 3. Teaser (better than nothing)
    const teaser = yt.find((v) => v.type === 'Teaser');
    if (teaser) return teaser.key;
    return null;
}

// ─── Core fetch functions ─────────────────────────────────────────────────────

/**
 * Fetch the w500 poster URL for a single movie.
 * Falls back to a deterministic placeholder if the API key is missing or TMDB returns nothing.
 */
export async function fetchPosterUrl(tmdb_id: number): Promise<string> {
    const data = await tmdbFetch<TMDBMovie>(`/movie/${tmdb_id}`);
    if (!data?.poster_path) return placeholder(tmdb_id, 300, 450);
    return `${TMDB_IMG_W500}${data.poster_path}`;
}

/**
 * Fetch the w1280 backdrop URL for hero banners.
 * Falls back to placeholder on failure.
 */
export async function fetchBackdropUrl(tmdb_id: number): Promise<string> {
    const data = await tmdbFetch<TMDBMovie>(`/movie/${tmdb_id}`);
    if (!data) return placeholder(tmdb_id, 1400, 800);
    const path = data.backdrop_path ?? data.poster_path;
    return path ? `${TMDB_IMG_W1280}${path}` : placeholder(tmdb_id, 1400, 800);
}

/**
 * Fetch the YouTube key for a movie's official trailer.
 * Returns null if no trailer is available or API key is not set.
 *
 * Usage:
 *   const key = await fetchTrailerKey(157336); // → "e0fkunal8jE"
 */
export async function fetchTrailerKey(tmdb_id: number): Promise<string | null> {
    const data = await tmdbFetch<{ results: TMDBVideo[] }>(`/movie/${tmdb_id}/videos`);
    if (!data?.results?.length) return null;
    return pickTrailerKey(data.results);
}

/**
 * Fetch a ready-to-use YouTube watch URL for a movie's official trailer.
 * Returns null if no trailer is available.
 *
 * Usage:
 *   const url = await fetchTrailerUrl(157336);
 *   // → "https://www.youtube.com/watch?v=e0fkunal8jE"
 *   <a href={url}>Watch Trailer</a>
 */
export async function fetchTrailerUrl(tmdb_id: number): Promise<string | null> {
    const key = await fetchTrailerKey(tmdb_id);
    return key ? `https://www.youtube.com/watch?v=${key}` : null;
}

/**
 * Fetch rich movie details from TMDB — poster, backdrop, trailers, overview, runtime, rating.
 * Uses TMDB's append_to_response trick to get everything in ONE API call (no extra round-trips).
 * Returns a fully typed TMDBDetails object. Always succeeds (falls back gracefully).
 */
export async function fetchMovieDetails(tmdb_id: number): Promise<TMDBDetails> {
    // append_to_response=videos fetches the videos list in the same single HTTP call
    const data = await tmdbFetch<TMDBMovie>(`/movie/${tmdb_id}?append_to_response=videos`);

    const posterUrl    = data?.poster_path    ? `${TMDB_IMG_W500}${data.poster_path}`    : placeholder(tmdb_id, 300, 450);
    const posterUrlHd  = data?.poster_path    ? `${TMDB_IMG_W780}${data.poster_path}`    : placeholder(tmdb_id, 390, 585);
    const backdropUrl  = data?.backdrop_path  ? `${TMDB_IMG_W1280}${data.backdrop_path}` : placeholder(tmdb_id, 1400, 800);

    const runtimeMins  = data?.runtime ?? 0;
    const runtime      = runtimeMins > 0
        ? `${Math.floor(runtimeMins / 60)}h ${runtimeMins % 60}m`
        : 'N/A';

    const releaseYear  = data?.release_date
        ? parseInt(data.release_date.slice(0, 4), 10)
        : 0;

    // Pick the best trailer from the embedded videos list
    const trailerKey   = data?.videos?.results?.length
        ? pickTrailerKey(data.videos.results)
        : null;
    const trailerUrl   = trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}`  : null;
    const trailerEmbed = trailerKey ? `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&rel=0` : null;

    return {
        tmdb_id,
        title:       data?.title           ?? 'Unknown Title',
        tagline:     data?.tagline         ?? '',
        overview:    data?.overview        ?? 'No description available.',
        posterUrl,
        posterUrlHd,
        backdropUrl,
        releaseYear,
        runtime,
        voteAverage: data?.vote_average    ?? 0,
        voteCount:   data?.vote_count      ?? 0,
        tmdbGenres:  data?.genres?.map((g) => g.name) ?? [],
        trailerKey,
        trailerUrl,
        trailerEmbed,
    };
}

// ─── Batch helpers ────────────────────────────────────────────────────────────

/**
 * Enrich an array of movies with resolved poster URLs in parallel.
 *
 * Usage (Server Component):
 *   const enriched = await enrichMoviesWithPosters(trending.movies);
 *   // enriched[i].posterUrl is now a full TMDB image URL
 */
export async function enrichMoviesWithPosters<T extends { tmdb_id: number }>(
    movies: T[]
): Promise<(T & { posterUrl: string })[]> {
    const urls = await Promise.all(movies.map((m) => fetchPosterUrl(m.tmdb_id)));
    return movies.map((m, i) => ({ ...m, posterUrl: urls[i] }));
}

/**
 * Enrich an array of movies with full TMDB details (poster, backdrop, overview, runtime…) in parallel.
 * More expensive than enrichMoviesWithPosters — use only when you need the extra fields.
 */
export async function enrichMoviesWithDetails<T extends { tmdb_id: number }>(
    movies: T[]
): Promise<(T & TMDBDetails)[]> {
    const details = await Promise.all(movies.map((m) => fetchMovieDetails(m.tmdb_id)));
    return movies.map((m, i) => ({ ...m, ...details[i] }));
}
