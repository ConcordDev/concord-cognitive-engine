import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { BookmarkButton } from '@/components/social/BookmarkButton';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('BookmarkButton', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.get.mockResolvedValue({ data: { ok: true, bookmarks: [] } });
    mockedApi.post.mockResolvedValue({ data: { ok: true, bookmarked: true } });
  });
  afterEach(() => { cleanup(); qc.clear(); });

  it('renders a toggle button regardless of bookmarked state', async () => {
    const { container } = render(withQuery(React.createElement(BookmarkButton, { postId: 'p1' }), qc));
    await waitFor(() => expect(container.querySelector('button')).not.toBeNull());
  });

  it('clicking fires POST /api/social/bookmark with the postId', async () => {
    const { container } = render(withQuery(React.createElement(BookmarkButton, { postId: 'p-toggle' }), qc));
    const btn = await waitFor(() => container.querySelector('button')!);
    fireEvent.click(btn);
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/api/social/bookmark', { postId: 'p-toggle' }));
  });

  it('shows bookmarked tint when the post id is in the bookmarks list', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, bookmarks: [{ postId: 'p-saved', createdAt: 't' }] } });
    const { container } = render(withQuery(React.createElement(BookmarkButton, { postId: 'p-saved' }), qc));
    const btn = await waitFor(() => {
      const el = container.querySelector('button');
      expect(el?.getAttribute('aria-pressed')).toBe('true');
      return el!;
    });
    expect(btn).toBeDefined();
  });
});
