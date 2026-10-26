'use client';

/**
 * useCurrentUser — the one shared session query for the Social lens.
 *
 * History (oc-social-3afix): the social hub and the post permalink page
 * each declared their own ['me'] queryFn that CAUGHT failures and
 * returned null. One transient /api/auth/me failure (an auth-refresh
 * window, a 429 GET read-backoff skip) then cached "anonymous" as a
 * SUCCESSFUL result, and nothing ever refetched it — 60 s staleTime,
 * refetchOnWindowFocus off, no remount on ?view= changes — so the Home
 * composer stayed gone until a full reload. (The only in-app ['me']
 * refetch was the other page mounting over the shared key while stale.)
 *
 * The fix lives in this hook:
 *  - exactly one ['me'] declaration, shared by both pages;
 *  - the queryFn THROWS on failure, so react-query keeps the previous
 *    data for a failed refetch instead of caching null as success;
 *  - self-heal: while we expect a signed-in user (middleware already
 *    required auth to reach these pages) but the cache has no user,
 *    retry every 60 s instead of trusting one bad answer.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface MeResponse {
  ok: boolean;
  user?: { id: string; username: string; displayName?: string; role?: string; scopes?: string[] };
}

export function useCurrentUser(): UseQueryResult<MeResponse | null> {
  return useQuery<MeResponse | null>({
    queryKey: ['me'],
    queryFn: async () => {
      // Throwing is deliberate (see header): a failure must surface as an
      // error with previous data kept, never as a cached "no user".
      const r = await api.get<MeResponse>('/api/auth/me');
      return r?.data ?? null;
    },
    staleTime: 60 * 1000,
    refetchInterval: (query) => (query.state.data?.user ? false : 60_000),
  });
}