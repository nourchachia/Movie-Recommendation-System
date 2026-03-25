/**
 * frontend/lib/auth.ts
 * Typed wrappers for all Flicker backend auth endpoints.
 * The API base URL is read from NEXT_PUBLIC_API_URL in .env.local.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ── Shared types ─────────────────────────────────────────────────────────────
export interface AuthUser {
  id: number;
  email: string;
  username: string;
  role: string;
  totp_enabled?: boolean;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

// ── Helper: throw if the response is an error ─────────────────────────────────
async function apiPost<T>(path: string, body: object, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    // FastAPI detail can be a string or an array of validation errors
    const message =
      typeof json.detail === 'string'
        ? json.detail
        : Array.isArray(json.detail)
        ? json.detail.map((e: { msg: string }) => e.msg).join(', ')
        : 'Request failed';
    throw new Error(message);
  }
  return json as T;
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail ?? 'Request failed');
  return json as T;
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

/** POST /auth/login → access + refresh tokens */
export async function login(email: string, password: string, totp_code?: string): Promise<TokenPair> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, totp_code: totp_code ?? null }),
  });

  const json = await res.json().catch(() => ({}));

  // Backend uses 202 Accepted with { detail: "2FA_REQUIRED" } to indicate
  // that a code was emailed and the client must retry with totp_code.
  if (res.status === 202 && json?.detail === '2FA_REQUIRED') {
    throw new Error('2FA_REQUIRED');
  }

  if (!res.ok) {
    const message =
      typeof json.detail === 'string'
        ? json.detail
        : Array.isArray(json.detail)
        ? json.detail.map((e: { msg: string }) => e.msg).join(', ')
        : 'Request failed';
    throw new Error(message);
  }

  return json as TokenPair;
}

/** POST /auth/register → tokens + user (user is immediately logged in) */
export const register = (username: string, email: string, password: string) =>
  apiPost<TokenPair & { message: string }>('/auth/register', {
    username,
    email,
    password,
  });

/** POST /auth/forgot-password → always returns success message */
export const forgotPassword = (email: string) =>
  apiPost<{ message: string }>('/auth/forgot-password', { email });

/** GET /auth/me → current user info */
export const getMe = (token: string) =>
  apiGet<AuthUser>('/auth/me', token);

/** POST /auth/refresh → fresh token pair */
export const refreshTokens = (refresh_token: string) =>
  apiPost<Omit<TokenPair, 'user'>>('/auth/refresh', { refresh_token });

/** POST /auth/reset-password → confirm new password using the token from the email link */
export const resetPassword = (token: string, new_password: string) =>
  apiPost<{ message: string }>('/auth/reset-password', { token, new_password });

// ── Account / Profile endpoints ───────────────────────────────────────────────

export interface UserProfile {
  user_id: number;
  total_ratings: number;
  average_rating: number;
  rating_breakdown: {
    '1_star': number;
    '2_stars': number;
    '3_stars': number;
    '4_stars': number;
    '5_stars': number;
  };
  top_genres: string[];
  favorites: Array<{
    movie_id: number;
    title: string;
    genres: string[];
    tmdb_id: number;
    rating: number;
  }>;
}

/** GET /api/users/{user_id}/profile */
export const getUserProfile = (userId: number, token: string) =>
  apiGet<UserProfile>(`/api/users/${userId}/profile`, token);

/** POST /auth/me/deactivate */
export const deactivateMe = (password: string, token: string) =>
  apiPost<{ message: string }>('/auth/me/deactivate', { password }, token);

/** POST /auth/2fa/setup */
export const setup2fa = (token: string) =>
  apiPost<{ message: string }>('/auth/2fa/setup', {}, token);

/** POST /auth/2fa/verify */
export const verify2fa = (totp_code: string, token: string) =>
  apiPost<{ message: string }>('/auth/2fa/verify', { totp_code }, token);

/** POST /auth/2fa/disable */
export const disable2fa = (password: string, token: string) =>
  apiPost<{ message: string }>('/auth/2fa/disable', { password }, token);
