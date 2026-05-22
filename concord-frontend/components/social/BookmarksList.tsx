'use client';

/**
 * BookmarksList — renders the current user's saved posts.
 *
 * Phase 11 (Item 2): BookmarkButton was mounted in every DTUEmbed
 * but there was no surface to SEE what you'd saved. This list pulls
 * /api/social/bookmarks, parallel-fetches each post via
 * /api/social/post/:postId, then renders a real card per post with
 * ReactionBar / BookmarkButton / UserLink / CommentThread.
 *
 * No fake data — empty state says "No bookmarks yet" and a deleted
 * post shows a clean "Post unavailable" placeholder with a one-click
 * "Remove bookmark" path so the substrate stays clean.
 */

import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Bookmark, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ReactionBar } from './ReactionBar';
import { BookmarkButton } from './BookmarkButton';
import { CommentThread } from './CommentThread';
import { UserLink } from './UserLink';
import { ShareButton } from './ShareButton';

interface BookmarkRow { postId: string; createdAt: string; }
interface BookmarksResponse { ok: boolean; bookmarks?: BookmarkRow[] }
interface PostResponse {
  ok: boolean;
  post?: {
    id: string;
    userId: string;
    username?: string;
    displayName?: string;
    content?: string;
    createdAt?: string;
    mediaUrl?: string;
    tags?: string[];
    isStory?: boolean;
  } | null;
  error?: string;
}

export interface BookmarksListProps {
  currentUserId?: string | null;
  className?: string;
  /** Default true. When false, omits the surrounding header chrome. */
  showHeader?: boolean;
}

export function BookmarksList({ className, showHeader = true }: BookmarksListProps) {
  const { data, isLoading, refetch } = useQuery<BookmarksResponse | null>({
    queryKey: ['social-bookmarks'],
    queryFn: async () => {
      try { const r = await api.get<BookmarksResponse>('/api/social/bookmarks'); return r?.data; }
      catch { return null; }
    },
    staleTime: 30_000,
  });

  const bookmarks = useMemo(() => data?.bookmarks ?? [], [data]);

  // Parallel post fetches via useQueries.
  const postQueries = useQueries({
    queries: bookmarks.map(b => ({
      queryKey: ['social-post', b.postId],
      queryFn: async (): Promise<PostResponse | null> => {
        try { const r = await api.get<PostResponse>(`/api/social/post/${encodeURIComponent(b.postId)}`); return r?.data; }
        catch { return null; }
      },
      staleTime: 60_000,
    })),
  });

  const cards = useMemo(() => {
    return bookmarks.map((b, idx) => {
      const q = postQueries[idx];
      const post = q?.data?.post ?? null;
      return { bookmark: b, post, loading: q?.isLoading ?? false };
    });
  }, [bookmarks, postQueries]);

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 py-10 text-zinc-500 text-sm', className)}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your bookmarks…
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className={cn('text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-3', className)}>
        Couldn't load bookmarks. Are you signed in?
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className={cn('text-center py-12 text-zinc-400', className)}>
        <Bookmark className="w-6 h-6 mx-auto mb-2 text-zinc-500" />
        <div className="font-medium text-zinc-200">No bookmarks yet</div>
        <div className="text-sm mt-1">Click the bookmark icon on any post to save it for later.</div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {showHeader && (
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-zinc-300">
            <Bookmark className="w-4 h-4 text-amber-300" />
            <span>{bookmarks.length} saved post{bookmarks.length === 1 ? '' : 's'}</span>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            Refresh
          </button>
        </div>
      )}

      {cards.map(({ bookmark, post, loading }) => (
        <article
          key={bookmark.postId}
          className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2"
        >
          {loading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading post…
            </div>
          )}

          {!loading && !post && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-amber-300">
                <AlertTriangle className="w-4 h-4" />
                <span>Post unavailable (deleted or hidden).</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Single bookmark endpoint toggles — calling with same postId removes it.
                  void api.post('/api/social/bookmark', { postId: bookmark.postId }).then(() => refetch());
                }}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-zinc-700 hover:border-rose-500/40 hover:text-rose-300"
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          )}

          {post && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <UserLink
                    userId={post.userId}
                    username={post.username}
                    displayName={post.displayName}
                    prefix="@"
                  />
                  {post.createdAt && (
                    <span className="text-[10px] text-zinc-500">
                      {new Date(post.createdAt).toLocaleString()}
                    </span>
                  )}
                  {post.isStory && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
                      Story
                    </span>
                  )}
                </div>
                <BookmarkButton postId={post.id} />
              </div>

              {post.content && (
                <p className="text-sm text-zinc-100 whitespace-pre-wrap">{post.content}</p>
              )}

              {post.mediaUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={post.mediaUrl}
                  alt=""
                  className="rounded-md max-h-72 w-auto object-cover border border-zinc-800"
                  loading="lazy"
                />
              )}

              {post.tags && post.tags.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {post.tags.slice(0, 8).map(t => (
                    <li key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                      #{t}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <ReactionBar postId={post.id} compact />
                <ShareButton postId={post.id} compact />
              </div>

              <CommentThread postId={post.id} collapsed maxDepth={2} />
            </>
          )}
        </article>
      ))}
    </div>
  );
}

export default BookmarksList;
