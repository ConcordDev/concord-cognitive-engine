'use client';

export { fetchRedditListing, REDDIT_LISTING_PATH } from './fetch-reddit-listing';
export type { RedditListingPost, RedditListing } from './fetch-reddit-listing';

/** Visible label for a server-cached community listing. Fresh pulls render nothing. */
export function RedditCacheLabel({ cached, stale }: { cached?: boolean; stale?: boolean }) {
  if (!cached) return null;
  const label = stale ? 'cached · may be stale' : 'cached';
  return (
    <span
      className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-200"
      title={stale
        ? 'Last successful community listing. A fresh pull failed.'
        : 'Served from the server cache.'}
    >
      {label}
    </span>
  );
}
