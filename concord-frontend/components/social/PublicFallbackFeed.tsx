'use client';

/**
 * PublicFallbackFeed — never an empty first screen (job oc-social-3b item a).
 *
 * When the Following timeline has nothing to show (a brand-new user, or
 * nobody they follow has posted), Home fills with real recent PUBLIC posts
 * from across the site — served by the existing GET /api/social/feed/explore
 * route, which the server already holds to the privacy bar: public audience
 * only (never private or followers-only posts of people the viewer doesn't
 * follow), blocks respected in both directions, expired stories dropped.
 *
 * A clear "Follow people to fill this feed" prompt sits above the list; the
 * button opens Explore's Find people. When the site itself has no posts,
 * the honest EmptyStateCTA renders — nothing is fabricated.
 */

import { useQuery } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { api } from '@/lib/api/client';
import { EmptyStateCTA } from '@/components/lens/EmptyStateCTA';
import { UserLink } from './UserLink';
import { PostMediaCard, type PostListingAttachment } from './PostMediaCard';

export interface FallbackPost {
  id: string;
  userId: string;
  username?: string | null;
  displayName?: string | null;
  content?: string | null;
  createdAt?: string;
  mediaType?: string;
  mediaUrl?: string | null;
  sensitiveHidden?: boolean;
  listing?: PostListingAttachment | null;
}

interface PublicFallbackFeedProps {
  currentUserId: string;
  onFindPeople?: () => void;
}

export function PublicFallbackFeed({ currentUserId, onFindPeople }: PublicFallbackFeedProps) {
  const { data, isLoading, isError } = useQuery<{ posts?: FallbackPost[] }>({
    queryKey: ['social-public-fallback', currentUserId],
    queryFn: async () => {
      const r = await api.get<{ ok?: boolean; posts?: FallbackPost[]; error?: string }>(
        '/api/social/feed/explore',
        { params: { limit: 20 } },
      );
      if (r?.data && (r.data as { ok?: boolean }).ok === false) {
        throw new Error(r.data.error || 'Couldn’t load recent posts');
      }
      return { posts: r?.data?.posts || [] };
    },
    staleTime: 30 * 1000,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-zinc-400">
        Loading recent posts…
      </div>
    );
  }

  if (isError) {
    // Honest, not padded: an unreachable route shows a plain failure note,
    // never fabricated rows or a fake "empty site" claim.
    return (
      <p className="px-4 py-8 text-sm text-zinc-400" role="status">
        Couldn’t load recent public posts right now. Try again in a moment.
      </p>
    );
  }

  const posts = data?.posts || [];

  if (posts.length === 0) {
    return (
      <EmptyStateCTA
        lensId="social"
        headline="No activity yet"
        caption="Follow some people. Their posts show up here in reverse-chronological order."
        buttonLabel="Find people"
        onAction={() => onFindPeople?.()}
      />
    );
  }

  return (
    <section aria-label="Recent public posts" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-zinc-200">Recent posts from around Concord</h2>
        <button
          type="button"
          onClick={() => onFindPeople?.()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-teal-400/40 bg-teal-400/10 px-3 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/20"
          aria-label="Find people to follow"
        >
          <Compass className="h-3.5 w-3.5" aria-hidden="true" />
          Follow people to fill this feed
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Your Following feed is empty — here are public posts from across the site while you find people to follow.
      </p>
      <ul className="space-y-2">
        {posts.map((post) => (
          <li
            key={post.id}
            className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 transition-colors hover:border-indigo-500/30"
          >
            <div className="mb-1 flex items-baseline gap-2">
              <UserLink
                username={post.username || undefined}
                userId={post.userId}
                displayName={post.displayName || undefined}
                className="text-sm"
                showFollow
                currentUserId={currentUserId}
              />
              {post.createdAt && (
                <span className="ml-auto text-[10px] text-zinc-400">
                  {new Date(post.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
            </div>
            <p className="text-sm leading-snug text-zinc-300">{post.content}</p>
            {post.sensitiveHidden && <p className="mt-1 text-xs text-zinc-500">Sensitive media hidden</p>}
            <PostMediaCard mediaType={post.mediaType} mediaUrl={post.mediaUrl} listing={post.listing} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default PublicFallbackFeed;