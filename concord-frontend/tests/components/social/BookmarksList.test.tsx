import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
}));

// Stub the heavy social sub-components so this suite isolates BookmarksList.
vi.mock('@/components/social/ReactionBar', () => ({
  ReactionBar: ({ postId }: { postId: string }) =>
    React.createElement('div', { 'data-testid': `react-${postId}` }),
}));
vi.mock('@/components/social/BookmarkButton', () => ({
  BookmarkButton: ({ postId }: { postId: string }) =>
    React.createElement('div', { 'data-testid': `bm-${postId}` }),
}));
vi.mock('@/components/social/CommentThread', () => ({
  CommentThread: ({ postId }: { postId: string }) =>
    React.createElement('div', { 'data-testid': `ct-${postId}` }),
}));
vi.mock('@/components/social/UserLink', () => ({
  UserLink: ({ username }: { username?: string }) =>
    React.createElement('span', null, username || 'user'),
}));
vi.mock('@/components/social/ShareButton', () => ({
  ShareButton: ({ postId }: { postId: string }) =>
    React.createElement('div', { 'data-testid': `share-${postId}` }),
}));

import { BookmarksList } from '@/components/social/BookmarksList';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('BookmarksList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPost.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => cleanup());

  it('shows the unauthenticated error state when bookmarks request not ok', async () => {
    apiGet.mockResolvedValue({ data: { ok: false } });
    wrap(<BookmarksList />);
    expect(
      await screen.findByText("Couldn't load bookmarks. Are you signed in?"),
    ).toBeInTheDocument();
  });

  it('shows the error state when the request throws (data null)', async () => {
    apiGet.mockRejectedValue(new Error('down'));
    wrap(<BookmarksList />);
    expect(
      await screen.findByText("Couldn't load bookmarks. Are you signed in?"),
    ).toBeInTheDocument();
  });

  it('shows the empty state when there are no bookmarks', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, bookmarks: [] } });
    wrap(<BookmarksList />);
    expect(await screen.findByText('No bookmarks yet')).toBeInTheDocument();
  });

  it('renders a full post card with header, tags, media', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/social/bookmarks') {
        return Promise.resolve({
          data: { ok: true, bookmarks: [{ postId: 'p1', createdAt: '2026-05-01' }] },
        });
      }
      return Promise.resolve({
        data: {
          ok: true,
          post: {
            id: 'p1',
            userId: 'u1',
            username: 'alice',
            content: 'My saved post',
            createdAt: '2026-05-01T00:00:00Z',
            mediaUrl: '/img.png',
            tags: ['ai', 'rust'],
            isStory: true,
          },
        },
      });
    });
    wrap(<BookmarksList />);
    expect(await screen.findByText('My saved post')).toBeInTheDocument();
    expect(screen.getByText('Story')).toBeInTheDocument();
    expect(screen.getByText('#ai')).toBeInTheDocument();
    expect(screen.getByText('1 saved post')).toBeInTheDocument();
    expect(screen.getByTestId('react-p1')).toBeInTheDocument();
    expect(screen.getByTestId('ct-p1')).toBeInTheDocument();
  });

  it('shows a "Post unavailable" card and removes the bookmark', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/social/bookmarks') {
        return Promise.resolve({
          data: { ok: true, bookmarks: [{ postId: 'gone', createdAt: '2026-05-01' }] },
        });
      }
      return Promise.resolve({ data: { ok: false, post: null, error: 'deleted' } });
    });
    wrap(<BookmarksList />);
    expect(
      await screen.findByText('Post unavailable (deleted or hidden).'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/social/bookmark', { postId: 'gone' }),
    );
  });

  it('refreshes the list via the Refresh button', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/social/bookmarks') {
        return Promise.resolve({
          data: { ok: true, bookmarks: [{ postId: 'p2', createdAt: '2026-05-01' }] },
        });
      }
      return Promise.resolve({
        data: { ok: true, post: { id: 'p2', userId: 'u2', content: 'P2' } },
      });
    });
    wrap(<BookmarksList />);
    await screen.findByText('P2');
    apiGet.mockClear();
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/api/social/bookmarks'),
    );
  });

  it('omits the header when showHeader is false but pluralises elsewhere', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/social/bookmarks') {
        return Promise.resolve({
          data: {
            ok: true,
            bookmarks: [
              { postId: 'p1', createdAt: '2026-05-01' },
              { postId: 'p2', createdAt: '2026-05-02' },
            ],
          },
        });
      }
      return Promise.resolve({
        data: { ok: true, post: { id: url.split('/').pop(), userId: 'u', content: 'c' } },
      });
    });
    wrap(<BookmarksList showHeader={false} />);
    await waitFor(() => expect(screen.getAllByText('c').length).toBe(2));
    expect(screen.queryByText('Refresh')).toBeNull();
  });
});
