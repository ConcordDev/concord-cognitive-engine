/**
 * Lens Reddit community panels.
 *
 * Off unless NEXT_PUBLIC_COMMUNITY_REDDIT is "1" or "true".
 * The API route reads the same variable and does not call reddit.com while
 * it is off. Next inlines this at build time, so turning it on needs a
 * frontend rebuild plus the same variable on the API process.
 */
export function isCommunityRedditEnabled(): boolean {
  return communityRedditFlagOn(process.env.NEXT_PUBLIC_COMMUNITY_REDDIT);
}

export function communityRedditFlagOn(raw: string | undefined | null): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/** Drop nav entries for a Reddit community view while the flag is off. */
export function omitCommunityRedditViews<T extends { id: string }>(
  views: readonly T[],
  redditViewIds: readonly string[],
): T[] {
  if (isCommunityRedditEnabled()) return views as T[];
  const hide = new Set(redditViewIds);
  return views.filter((view) => !hide.has(view.id));
}
