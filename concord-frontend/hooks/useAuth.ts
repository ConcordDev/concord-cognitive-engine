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

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: string;
  scopes?: string[];
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

  const checkAuth = useCallback(async () => {
    try {
      const resp = await api.get('/api/auth/me');
      const data = resp.data;
      if (mountedRef.current) {
        if (data.ok && data.user) {
          setUser({
            id: data.user.id,
            username: data.user.username,
            email: data.user.email,
            role: data.user.role,
            scopes: data.user.scopes,
          });
        } else {
          setUser(null);
        }
      }
    } catch {
      if (mountedRef.current) setUser(null);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    checkAuth();
    return () => { mountedRef.current = false; };
  }, [checkAuth]);

  const logout = useCallback(async () => {
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
