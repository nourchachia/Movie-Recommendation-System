'use client';

/**
 * frontend/context/AuthContext.tsx
 * Global auth state for the Flicker app.
 *
 * - Access token: stored in React state (in-memory, never localStorage).
 *   Stays safe from XSS — lost on page refresh.
 * - Refresh token: stored in localStorage (30-day expiry).
 *   Used on every page load to silently restore the access token.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import * as authApi from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

const REFRESH_KEY = 'flicker_refresh_token';

// ── Context shape ─────────────────────────────────────────────────────────────
interface AuthContextType {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]               = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(true);
  const router = useRouter();

  // On mount: try to restore session from the stored refresh token
  useEffect(() => {
    const restore = async () => {
      const stored = localStorage.getItem(REFRESH_KEY);
      if (!stored) { setIsLoading(false); return; }
      try {
        const tokens = await authApi.refreshTokens(stored);
        setAccessToken(tokens.access_token);
        localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
        const me = await authApi.getMe(tokens.access_token);
        setUser(me);
      } catch {
        localStorage.removeItem(REFRESH_KEY); // refresh token expired / invalid
      } finally {
        setIsLoading(false);
      }
    };
    restore();
  }, []);

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const data = await authApi.login(email, password, totpCode);
    setAccessToken(data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const data = await authApi.register(username, email, password);
    setAccessToken(data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem(REFRESH_KEY);
    router.push('/');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
