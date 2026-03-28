/**
 * frontend/lib/sessions.ts
 * API client for Watch Together session endpoints + WebSocket factory.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const WS_API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000')
  .replace(/^http/, 'ws');

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionMovie {
  movie_id: number;
  title: string;
  genres: string[];
  tmdb_id: number | null;
  est?: number;
}

export interface SessionMatch {
  movie_id: number;
  title: string;
  genres: string[];
  tmdb_id: number | null;
  matched_at: string;
}

export interface SessionState {
  code: string;
  status: 'waiting' | 'active' | 'done';
  creator_id: number;
  guest_id: number | null;
  movie_pool: SessionMovie[];
  expires_at: string;
}

export interface SwipeResult {
  match: boolean;
  movie_id: number;
  direction: 'left' | 'right';
  matched_movie?: SessionMovie;
}

// ── REST helpers ───────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/** POST /api/sessions — create a new Watch Together session */
export async function createSession(
  token: string,
  poolSize = 30
): Promise<{ code: string; status: string; pool_size: number; message: string }> {
  const res = await fetch(`${API}/api/sessions?pool_size=${poolSize}`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to create session');
  }
  return res.json();
}

/** POST /api/sessions/{code}/join — guest joins a session */
export async function joinSession(
  code: string,
  token: string
): Promise<{ code: string; status: string; message: string }> {
  const res = await fetch(`${API}/api/sessions/${code}/join`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to join session');
  }
  return res.json();
}

/** GET /api/sessions/{code} — poll session status + movie pool */
export async function getSession(code: string, token: string): Promise<SessionState> {
  const res = await fetch(`${API}/api/sessions/${code}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to fetch session');
  }
  return res.json();
}

/** POST /api/sessions/{code}/swipe — record a swipe */
export async function recordSwipe(
  code: string,
  movieId: number,
  direction: 'left' | 'right',
  token: string
): Promise<SwipeResult> {
  const res = await fetch(`${API}/api/sessions/${code}/swipe`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ movie_id: movieId, direction }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to record swipe');
  }
  return res.json();
}

/** GET /api/sessions/{code}/matches — all matched movies */
export async function getMatches(
  code: string,
  token: string
): Promise<{ code: string; total_matches: number; matches: SessionMatch[] }> {
  const res = await fetch(`${API}/api/sessions/${code}/matches`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to fetch matches');
  }
  return res.json();
}

// ── WebSocket ──────────────────────────────────────────────────────────────────

export type WsEvent =
  | { event: 'session_active' }
  | { event: 'match'; movie_id: number };

/**
 * Opens a WebSocket connection to /ws/sessions/{code}.
 * Returns the WebSocket instance so the caller can close it on unmount.
 */
export function connectSessionWS(
  code: string,
  onEvent: (ev: WsEvent) => void,
  onClose?: () => void
): WebSocket {
  const ws = new WebSocket(`${WS_API}/ws/sessions/${code}`);
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as WsEvent;
      onEvent(data);
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = () => onClose?.();
  return ws;
}
