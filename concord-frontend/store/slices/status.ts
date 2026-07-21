import type { StateCreator } from 'zustand';

export interface RequestError {
  id: string;
  at: string;
  path?: string;
  method?: string;
  status?: number;
  code?: string;
  requestId?: string;
  message: string;
  reason?: string;
}

export interface AuthPosture {
  mode: 'public' | 'apikey' | 'jwt' | 'hybrid' | 'unknown';
  usesJwt: boolean;
  usesApiKey: boolean;
}

/**
 * RBAC roles, ascending privilege — mirrors the backend's `Role` type
 * (`lib/permissions.ts`). Kept as `string` rather than a literal union so
 * this store never needs a matching update if the backend adds a role;
 * `isLensVisible`/`meetsExpertiseGate` already type their role param as
 * `string` for the same reason.
 */
export interface StatusSlice {
  requestErrors: RequestError[];
  authPosture: AuthPosture;
  /**
   * Synced once per session from `/api/auth/me` (see `Providers.tsx`).
   * Defaults to `'user'` — the least-privileged real role — rather than
   * `'sovereign'`, so sovereign-gated lenses (admin/command-center) stay
   * hidden (fail closed) until the real role has actually loaded, instead
   * of briefly (or, if the fetch ever fails, permanently) showing them to
   * every visitor.
   */
  userRole: string;

  addRequestError: (error: Omit<RequestError, 'id' | 'at'>) => void;
  clearRequestErrors: () => void;
  setAuthPosture: (authPosture: Partial<AuthPosture>) => void;
  setUserRole: (role: string) => void;
}

export const createStatusSlice: StateCreator<StatusSlice, [], [], StatusSlice> = (set) => ({
  requestErrors: [],
  authPosture: { mode: 'unknown', usesJwt: false, usesApiKey: false },
  userRole: 'user',

  addRequestError: (error) =>
    set((state) => {
      const now = Date.now();
      const isDuplicate = state.requestErrors.some(
        (e) =>
          e.path === error.path &&
          e.status === error.status &&
          now - new Date(e.at).getTime() < 10_000,
      );
      if (isDuplicate) return state;

      return {
        requestErrors: [
          ...state.requestErrors.slice(-19),
          {
            ...error,
            id: `reqerr-${now}-${Math.random().toString(36).slice(2, 9)}`,
            at: new Date().toISOString(),
          },
        ],
      };
    }),

  clearRequestErrors: () => set({ requestErrors: [] }),

  setAuthPosture: (authPosture) =>
    set((state) => ({ authPosture: { ...state.authPosture, ...authPosture } })),

  setUserRole: (role) => set({ userRole: role }),
});
