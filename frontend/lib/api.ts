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

// ── Watchlist (localStorage) ──────────────────────────────────────────────────

const WATCHLIST_KEY    = 'flicker_watchlist';
const LOCAL_RATINGS_KEY = 'flicker_ratings';

export function getWatchlist(): number[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? '[]'); } catch { return []; }
}

/** Toggle a movie in watchlist. Returns true if now added, false if removed. */
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
