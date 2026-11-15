/**
 * Saved social bookmarks envelope (FIX-saved-002).
 *
 * The tab badge said 2 while the list said "No bookmarks yet". Both
 * were reading the same endpoint — /api/social/bookmarks returns the
 * emergent layer's { ok, posts: [full serialized posts], total }
 * envelope (getUserBookmarks), and every other consumer reads
 * `posts` (the feed's bookmark overlay, the social export). This list
 * alone read `data.bookmarks`, a field no server sends, so its rows
 * were unconditionally [] and the empty state always won. The list
 * now derives its rows from `posts` (keeping the per-post fetch, so
 * a post deleted after bookmarking still gets its "Post unavailable"
 * placeholder + remove path), with the legacy row shape accepted
 * defensively.
 */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn().mockResolvedValue({ data: { ok: true } }) },
}));
vi.mock('@/components/social/ReactionBar', () => ({ ReactionBar: () => null }));
vi.mock('@/components/social/BookmarkButton', () => ({ BookmarkButton: () => null }));
vi.mock('@/components/social/CommentThread', () => ({ CommentThread: () => null }));
vi.mock('@/components/social/UserLink', () => ({ UserLink: ({ displayName, username }: { displayName?: string; username?: string }) => <span>{displayName || username}</span> }));
vi.mock('@/components/social/ShareButton', () => ({ ShareButton: () => null }));

import { BookmarksList } from '@/components/social/BookmarksList';

const post1 = { id: 'p1', userId: 'u-a', username: 'ada', displayName: 'Ada', content: 'first saved post', createdAt: '2026-11-01T00:00:00Z', tags: [] };
const post2 = { id: 'p2', userId: 'u-b', username: 'bob', displayName: 'Bob', content: 'second saved post', createdAt: '2026-11-02T00:00:00Z', tags: [] };

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BookmarksList />
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiGet.mockReset(); });
afterEach(() => { cleanup(); });

describe('saved bookmarks envelope (FIX-saved-002)', () => {
  it('renders the bookmarked posts the endpoint returns under `posts`', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/social/bookmarks') return Promise.resolve({ data: { ok: true, posts: [post1, post2], total: 2 } });
      if (url === '/api/social/post/p1') return Promise.resolve({ data: { ok: true, post: post1 } });
      if (url === '/api/social/post/p2') return Promise.resolve({ data: { ok: true, post: post2 } });
      return Promise.resolve({ data: { ok: false } });
    });
    renderList();
    expect(await screen.findByText(/2 saved posts/)).toBeInTheDocument();
    expect(screen.getByText('first saved post')).toBeInTheDocument();
    expect(screen.getByText('second saved post')).toBeInTheDocument();
    expect(screen.queryByText('No bookmarks yet')).not.toBeInTheDocument();
  });

  it('the empty state still shows when the endpoint returns no posts', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/social/bookmarks') return Promise.resolve({ data: { ok: true, posts: [], total: 0 } });
      return Promise.resolve({ data: { ok: false } });
    });
    renderList();
    expect(await screen.findByText('No bookmarks yet')).toBeInTheDocument();
  });
});
