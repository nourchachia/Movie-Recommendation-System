/**
 * frontend/lib/api.ts
 * Wrappers for the Flicker backend movie/rating endpoints.
 * Auth endpoints live in lib/auth.ts.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RatedMovie {
  movie_id: number;
  title: string;
  genres: string[];
  tmdb_id: number;
  rating: number;
  rated_at: string | null;
}

export interface WatchlistMovie {
  id: number;
  movie_id: number;
  title: string;
  genres: string[];
  tmdb_id: number;
  note: string | null;
  added_at: string;
}

// ── Rating endpoints ──────────────────────────────────────────────────────────

/** POST /api/ratings — submit or update a movie rating (1–5) */
export async function submitRating(
  movieId: number,
  rating: number,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${API}/api/ratings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ movie_id: movieId, rating }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to submit rating');
  }
}

/** GET /api/users/me/ratings — all movies rated by the current user */
export async function getMyRatings(
  accessToken: string
): Promise<{ user_id: number; total: number; ratings: RatedMovie[] }> {
  const res = await fetch(`${API}/api/users/me/ratings?limit=500`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch ratings');
  return res.json();
}

// ── Watchlist API endpoints ───────────────────────────────────────────────────

/** GET /api/watchlist — fetch the current user's full watchlist */
export async function getMyWatchlist(
  accessToken: string
): Promise<{ user_id: number; total: number; watchlist: WatchlistMovie[] }> {
  const res = await fetch(`${API}/api/watchlist`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch watchlist');
  return res.json();
}

/** POST /api/watchlist — add a movie; returns 409 if already present */
export async function addToWatchlist(
  movieId: number,
  accessToken: string,
  note?: string | null
): Promise<void> {
  const res = await fetch(`${API}/api/watchlist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ movie_id: movieId, note: note ?? null }),
  });
  if (!res.ok && res.status !== 409) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to add to watchlist');
  }
}

/** DELETE /api/watchlist/{movie_id} — remove a movie from the watchlist */
export async function removeFromWatchlist(
  movieId: number,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${API}/api/watchlist/${movieId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to remove from watchlist');
  }
}

/** Check if a specific movie is in the watchlist */
export async function isInWatchlist(
  movieId: number,
  accessToken: string
): Promise<boolean> {
  try {
    const data = await getMyWatchlist(accessToken);
    return data.watchlist.some((m) => m.movie_id === movieId);
  } catch {
    return false;
  }
}

// ── Watchlist (localStorage — legacy fallback) ────────────────────────────────

const WATCHLIST_KEY    = 'flicker_watchlist';
const LOCAL_RATINGS_KEY = 'flicker_ratings';

export function getWatchlist(): number[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? '[]'); } catch { return []; }
}

/** @deprecated Use addToWatchlist / removeFromWatchlist (real API) instead */
export function toggleWatchlist(movieId: number): boolean {
  const list = getWatchlist();
  const inList = list.includes(movieId);
  const next = inList ? list.filter((id) => id !== movieId) : [...list, movieId];
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  return !inList;
}

export function getLocalRating(movieId: number): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_RATINGS_KEY) ?? '{}');
    return typeof all[movieId] === 'number' ? all[movieId] : null;
  } catch { return null; }
}

export function setLocalRating(movieId: number, rating: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_RATINGS_KEY) ?? '{}');
    all[movieId] = rating;
    localStorage.setItem(LOCAL_RATINGS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// ── Trending API endpoints ──────────────────────────────────────────────────
export interface TrendingByGenreMovie {
  movie_id: number;
  title: string;
  genres: string[];
  tmdb_id: number;
  trending_score: number;
}

export interface TrendingGenreGroup {
  genre: string;
  rank: number;
  liked_count: number;
  movies: TrendingByGenreMovie[];
}

export interface TrendingByGenreResponse {
  user_id: number;
  max_genres: number;
  limit: number;
  genre_groups: TrendingGenreGroup[];
}

/**
 * GET /api/trending/by-genre — user-ranked genre buckets.
 */
export async function getTrendingByGenre(
  accessToken: string,
  options?: { maxGenres?: number; limit?: number }
): Promise<TrendingByGenreResponse> {
  const url = new URL(`${API}/api/trending/by-genre`);
  if (options?.maxGenres) url.searchParams.set('max_genres', String(options.maxGenres));
  if (options?.limit) url.searchParams.set('limit', String(options.limit));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to fetch trending by genre');
  }

  return res.json() as Promise<TrendingByGenreResponse>;
}
