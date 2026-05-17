import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { ReactionBar } from '@/components/social/ReactionBar';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('ReactionBar', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    // Default: empty reactions
    mockedApi.get.mockResolvedValue({ data: { ok: true, reactions: {}, total: 0, userReaction: null } });
    mockedApi.post.mockResolvedValue({ data: { ok: true, added: true, type: 'like' } });
  });

  afterEach(() => { cleanup(); qc.clear(); });

  it('hides when empty by default (hideWhenEmpty=true)', async () => {
    const { container } = render(withQuery(React.createElement(ReactionBar, { postId: 'p1' }), qc));
    // The empty-state branch returns null immediately on first render.
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('renders all 6 reaction buttons when forced visible (hideWhenEmpty=false)', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, reactions: {}, total: 0, userReaction: null } });
    const { container } = render(withQuery(React.createElement(ReactionBar, { postId: 'p2', hideWhenEmpty: false }), qc));
    await waitFor(() => expect(container.querySelectorAll('button').length).toBe(6));
  });

  it('clicking a reaction fires POST /api/social/react with the right type', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, reactions: {}, total: 0, userReaction: null } });
    render(withQuery(React.createElement(ReactionBar, { postId: 'p3', hideWhenEmpty: false }), qc));
    const btn = await waitFor(() => {
      const el = screen.getByTitle(/^Like$/);
      expect(el).toBeDefined();
      return el;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/api/social/react', { postId: 'p3', type: 'like' }));
  });
});
