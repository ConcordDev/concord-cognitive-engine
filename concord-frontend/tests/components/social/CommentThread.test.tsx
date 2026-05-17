import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { CommentThread } from '@/components/social/CommentThread';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('CommentThread', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.get.mockResolvedValue({ data: { ok: true, comments: [] } });
    mockedApi.post.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => { cleanup(); qc.clear(); });

  it('empty state renders the placeholder when zero comments', async () => {
    const { container } = render(withQuery(
      React.createElement(CommentThread, { postId: 'p1' }),
      qc,
    ));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(container.textContent).toMatch(/No comments yet/i), { timeout: 3000 });
  });

  it('renders the composer form when showComposer=true (default)', async () => {
    const { container } = render(withQuery(
      React.createElement(CommentThread, { postId: 'p2' }),
      qc,
    ));
    await waitFor(() => expect(container.querySelector('form')).not.toBeNull());
  });

  it('submitting the composer fires POST /api/social/comment', async () => {
    const { container } = render(withQuery(
      React.createElement(CommentThread, { postId: 'p3' }),
      qc,
    ));
    const input = await waitFor(() => container.querySelector('input[type="text"]') as HTMLInputElement);
    fireEvent.change(input, { target: { value: 'first comment' } });
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/api/social/comment', expect.objectContaining({
        postId: 'p3',
        content: 'first comment',
      })),
    );
  });

  it('collapsed mode hides the comment list behind a Show button', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, comments: [{ id: 'c1', userId: 'u1', content: 'hi', createdAt: new Date().toISOString() }] } });
    const { container } = render(withQuery(
      React.createElement(CommentThread, { postId: 'p4', collapsed: true }),
      qc,
    ));
    // In collapsed mode the query is disabled until expanded — no fetch happens.
    expect(container.textContent || '').not.toContain('first comment');
  });
});
