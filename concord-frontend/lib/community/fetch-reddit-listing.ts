/** Same-origin community listing. The browser never calls reddit.com. */
export const REDDIT_LISTING_PATH = '/api/community/reddit-listing';

export interface RedditListingPost {
  id: string;
  title: string;
  permalink: string;
  author: string;
  score: number;
  num_comments: number;
  created_utc?: number;
  link_flair_text?: string | null;
  subreddit?: string;
  thumbnail?: string;
  url?: string;
  domain?: string;
  total_awards_received?: number;
  selftext?: string;
  preview?: { images?: { source: { url: string; width: number; height: number } }[] };
}

export interface RedditListing {
  posts: RedditListingPost[];
  cached: boolean;
  stale: boolean;
  fetchedAt: number | null;
}

function isListing(body: unknown): body is { ok: true; posts: RedditListingPost[]; cached?: boolean; stale?: boolean; fetchedAt?: number } {
  if (!body || typeof body !== 'object') return false;
  const row = body as { ok?: unknown; posts?: unknown };
  return row.ok === true && Array.isArray(row.posts);
}

export async function fetchRedditListing(params: {
  sub: string;
  window?: string;
  sort?: string;
  limit?: number;
}): Promise<RedditListing> {
  const qs = new URLSearchParams({
    sub: params.sub,
    t: params.window || 'week',
    sort: params.sort || 'top',
    limit: String(params.limit ?? 25),
  });
  let response: Response;
  try {
    response = await fetch(`${REDDIT_LISTING_PATH}?${qs.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('community_feed_unavailable');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !isListing(body)) {
    throw new Error('community_feed_unavailable');
  }
  return {
    posts: body.posts,
    cached: body.cached === true,
    stale: body.stale === true,
    fetchedAt: typeof body.fetchedAt === 'number' ? body.fetchedAt : null,
  };
}
