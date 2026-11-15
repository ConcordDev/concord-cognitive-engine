/**
 * Authentication hook for Concord Cognitive Engine.
 *
 * Checks /api/auth/me for the current user session via httpOnly JWT cookie.
 * Returns the current user, loading state, auth status, and logout function.
 *
 * Usage:
 *   const { user, isLoading, isAuthenticated, logout } = useAuth();
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api/client';
import { isGuestMode } from '@/lib/guest-bridge';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: string;
  scopes?: string[];
  /** IANA zone when the account profile has one. Absent means "use the browser zone". */
  timezone?: string | null;
  timeZone?: string | null;
  preferences?: { timezone?: string | null; timeZone?: string | null };
}

interface UseAuthReturn {
  /** Current authenticated user, or null if not authenticated */
  user: AuthUser | null;
  /** True while the initial auth check is in progress */
  isLoading: boolean;
  /** True if user is authenticated */
  isAuthenticated: boolean;
  /** Log out the current user (clears cookies, resets state) */
  logout: () => Promise<void>;
  /** Manually re-check authentication status */
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAuth = useCallback(async (attempt = 0) => {
    // FIX-civic-bonds-008: one transient /api/auth/me failure (an
    // auth-refresh window, a 429 read-backoff) used to settle this
    // hook on null FOREVER — on authenticated lenses the user then
    // saw "Sign in to see your profile" while signed in and lost
    // every own-content control gated on the user id (the Feed post
    // Delete among them). Same genus the Social lens cured in
    // useCurrentUser (oc-social-3afix): retry a few times before
    // believing "signed out"; only the final settle clears loading.
    const settleRetryOrNull = (att: number) => {
      if (att < 3) {
        retryTimerRef.current = setTimeout(() => { void checkAuth(att + 1); }, 3000 * (att + 1));
      } else {
        setUser(null);
        setIsLoading(false);
      }
    };
    try {
      const resp = await api.get('/api/auth/me');
      const data = resp.data;
      if (!mountedRef.current) return;
      if (data.ok && data.user) {
        const prefs = data.user.preferences;
        setUser({
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          role: data.user.role,
          scopes: data.user.scopes,
          ...(typeof data.user.timezone === 'string' ? { timezone: data.user.timezone } : {}),
          ...(typeof data.user.timeZone === 'string' ? { timeZone: data.user.timeZone } : {}),
          ...(prefs && typeof prefs === 'object' ? { preferences: prefs } : {}),
        });
        setIsLoading(false);
      } else {
        settleRetryOrNull(attempt);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // GB-1536 guest: the middleware already established "no session"
      // (it set the guest flag), so a 401/403 from /me is the definitive
      // signed-out answer, not a refresh-window blip — settle now instead
      // of holding a guest in "loading" through ~18 s of retries.
      const status = (err as { response?: { status?: number } } | null)?.response?.status;
      if ((status === 401 || status === 403) && isGuestMode()) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      settleRetryOrNull(attempt);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    checkAuth();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [checkAuth]);

  const logout = useCallback(async () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      // Proceed with local cleanup even if the server request fails
    }
    if (mountedRef.current) {
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await checkAuth();
  }, [checkAuth]);

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
    logout,
    refresh,
  };
}
