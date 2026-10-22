import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls: Array<{ method: string; url: string }> = [];
const deleteGate = vi.hoisted(() => ({ resolve: null as null | ((value: unknown) => void) }));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      calls.push({ method: 'GET', url });
      if (String(url).includes('/api/social/feed/for-you')) {
        return { data: { ok: true, posts: [
          { id: 'p1', userId: 'bea', content: 'ranked', why: ['Recent', 'You follow the author'] },
          { id: 'mine', userId: 'u1', content: 'my ranked post', why: ['Recent'] },
        ] } };
      }
      if (String(url).includes('/api/social/search')) {
        return { data: { ok: true, people: [{ id: 'u2', displayName: 'Bea' }], posts: [], hashtags: [{ tag: 'live', count: 1 }] } };
      }
      return { data: { ok: true, lists: [] } };
    }),
    post: vi.fn(async (url: string) => {
      calls.push({ method: 'POST', url });
      return { data: { ok: true, list: { id: 'l1', name: 'Friends', memberIds: [] } } };
    }),
    delete: vi.fn((url: string) => new Promise((resolve) => {
      calls.push({ method: 'DELETE', url });
      deleteGate.resolve = resolve;
    })),
  },
}));

import { RankedFeed } from '@/components/social/RankedFeed';
import { SocialLists } from '@/components/social/SocialLists';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('social feeds ui', () => {
  beforeEach(() => { calls.length = 0; });

  it('shows why a ranked post is here and can hide it', async () => {
    wrap(<RankedFeed currentUserId="u1" />);
    expect(await screen.findByText(/You follow the author/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Not interested' })[0]);
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/social/feed/feedback')).toBe(true);
    });
  });

  it('removes an own For You post only after the server deletes it', async () => {
    wrap(<RankedFeed currentUserId="u1" />);
    expect(await screen.findByText('my ranked post')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    expect(screen.getByText('my ranked post')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(screen.getByText('my ranked post')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/social/post/mine')).toBe(true);
    deleteGate.resolve?.({ data: { ok: true, postId: 'mine' } });
    await waitFor(() => expect(screen.queryByText('my ranked post')).toBeNull());
    expect(screen.getByText('ranked')).toBeTruthy();
  });

  it('searches and creates a list through the API', async () => {
    wrap(<SocialLists />);
    fireEvent.change(screen.getByLabelText('Search social'), { target: { value: 'be' } });
    expect(await screen.findByText('Bea')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Friends' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/social/lists')).toBe(true);
    });
  });
});
