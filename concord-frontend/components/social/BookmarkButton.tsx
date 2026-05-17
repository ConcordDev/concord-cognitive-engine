'use client';

/**
 * BookmarkButton — save/unsave a post for later.  Drop-in for any DTU
 * or post card.
 *
 * Phase 10g: backend has POST /api/social/bookmark + GET
 * /api/social/bookmarks; no UI surface before now.
 *
 *   <BookmarkButton postId={dtu.id} />
 *
 * Toggles state via single endpoint that flips bookmark on/off.
 * Optimistic UI; rolls back on failure.  No fake "0 saves" decoration.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface BookmarksResponse {
  ok: boolean;
  bookmarks?: Array<{ postId: string; createdAt: string }>;
}

export interface BookmarkButtonProps {
  postId: string;
  /** Compact chip mode. Default true. */
  compact?: boolean;
  className?: string;
}

export function BookmarkButton({ postId, compact = true, className }: BookmarkButtonProps) {
  const queryClient = useQueryClient();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  // The endpoint returns the current user's bookmarks list; we derive
  // bookmarked-state from that.  Cached across the whole app so
  // multiple BookmarkButton instances share one fetch.
  const { data } = useQuery<BookmarksResponse | null>({
    queryKey: ['social-bookmarks'],
    queryFn: async () => {
      try { const r = await api.get<BookmarksResponse>('/api/social/bookmarks'); return r?.data; }
      catch { return null; }
    },
    staleTime: 60_000,
  });

  const bookmarked = optimistic !== null
    ? optimistic
    : !!data?.bookmarks?.some(b => b.postId === postId);

  const toggleMut = useMutation({
    mutationFn: async () => {
      const r = await api.post('/api/social/bookmark', { postId });
      return r?.data as { ok: boolean; bookmarked?: boolean; error?: string };
    },
    onMutate: () => { setOptimistic(!bookmarked); },
    onError: () => { setOptimistic(null); },
    onSuccess: (resp) => {
      // Server returns canonical bookmarked state — trust it
      if (resp?.bookmarked !== undefined) setOptimistic(resp.bookmarked);
      queryClient.invalidateQueries({ queryKey: ['social-bookmarks'] });
    },
    onSettled: () => {
      setTimeout(() => setOptimistic(null), 500);
    },
  });

  const onToggle = useCallback(() => {
    if (toggleMut.isPending) return;
    toggleMut.mutate();
  }, [toggleMut]);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={toggleMut.isPending}
      title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      aria-pressed={bookmarked}
      className={cn(
        'inline-flex items-center rounded border bg-zinc-900/40 transition-colors',
        bookmarked
          ? 'text-amber-300 bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/15'
          : 'text-zinc-400 hover:text-amber-300 hover:bg-amber-500/10 border-zinc-700',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1',
        toggleMut.isPending && 'opacity-60',
        className,
      )}
    >
      {toggleMut.isPending
        ? <Loader2 className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5', 'animate-spin')} />
        : bookmarked
        ? <BookmarkCheck className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
        : <Bookmark className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
    </button>
  );
}

export default BookmarkButton;
