'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';

interface Bookmark {
  id: string;
  userId: string;
  targetId: string;
  targetType: string;
  domain: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface BookmarksResponse {
  ok: boolean;
  items: Bookmark[];
  total: number;
}

/**
 * Hook for persistent bookmarks. Replaces local useState bookmarks
 * with backend-persisted ones that survive page refresh.
 */
export function useBookmarks(domain: string) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<BookmarksResponse>({
    queryKey: ['bookmarks', domain],
    queryFn: () => apiHelpers.bookmarks.list(domain),
    staleTime: 30_000,
  });

  const bookmarkMut = useMutation({
    mutationFn: (input: { targetId: string; targetType: string; domain: string; metadata?: Record<string, unknown> }) =>
      apiHelpers.bookmarks.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks', domain] });
    },
  });

  const unbookmarkMut = useMutation({
    mutationFn: (id: string) => apiHelpers.bookmarks.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks', domain] });
    },
  });

  const items = data?.items || [];
  const bookmarkedIds = useMemo(() => new Set(items.map(b => b.targetId)), [items]);

  const toggleBookmark = useCallback((targetId: string, targetType = 'item', metadata?: Record<string, unknown>) => {
    if (bookmarkedIds.has(targetId)) {
      const item = items.find(b => b.targetId === targetId);
      if (item) unbookmarkMut.mutate(item.id);
    } else {
      bookmarkMut.mutate({ targetId, targetType, domain, metadata });
    }
  }, [bookmarkedIds, items, domain, bookmarkMut, unbookmarkMut]);

  return {
    bookmarkedIds,
    bookmarks: items,
    isLoading,
    toggleBookmark,
    bookmark: bookmarkMut.mutate,
    unbookmark: unbookmarkMut.mutate,
  };
}
