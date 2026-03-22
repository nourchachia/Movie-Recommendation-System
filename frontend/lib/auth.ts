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
export const login = (email: string, password: string) =>
  apiPost<TokenPair>('/auth/login', { email, password });

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
