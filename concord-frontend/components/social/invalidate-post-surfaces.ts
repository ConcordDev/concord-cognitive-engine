import type { QueryClient } from '@tanstack/react-query';

/**
 * Every react-query surface that renders the viewer's social posts. One
 * helper so a confirmed create (QuickPostComposer) or delete (OwnPostDelete
 * call sites) refreshes all of them — no surface keeps a stale row until
 * its own poll or staleTime catches up.
 *
 * All keys are prefixes, so invalidation keeps working where a consumer
 * keys per-viewer or per-tab:
 *   ['social-following-activity', userId]  — Following timeline (page.tsx)
 *   ['social-for-you', userId]             — RankedFeed (For You)
 *   ['user-content', userId, tab]          — You > Posts list (UserProfile)
 *   ['user-post-count', userId]            — profile post count (UserProfile)
 *   ['stories', userId]                     — StoriesBar (24h posts)
 *
 * The old composer invalidated ['feed-for-you'] and ['social-feed'] — keys
 * no component declared, so For You never refreshed on post. The real keys
 * live here now.
 */
export function invalidatePostSurfaces(queryClient: QueryClient): Promise<Array<unknown>> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['social-following-activity'] }),
    queryClient.invalidateQueries({ queryKey: ['social-for-you'] }),
    queryClient.invalidateQueries({ queryKey: ['user-content'] }),
    queryClient.invalidateQueries({ queryKey: ['user-post-count'] }),
    queryClient.invalidateQueries({ queryKey: ['stories'] }),
  ]);
}