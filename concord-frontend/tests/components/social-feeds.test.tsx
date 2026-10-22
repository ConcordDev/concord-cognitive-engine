import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls: Array<{ method: string; url: string }> = [];

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      calls.push({ method: 'GET', url });
      if (String(url).includes('/api/social/feed/for-you')) {
        return { data: { ok: true, posts: [{ id: 'p1', userId: 'bea', content: 'ranked', why: ['Recent', 'You follow the author'] }] } };
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
    fireEvent.click(screen.getByRole('button', { name: 'Not interested' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/social/feed/feedback')).toBe(true);
    });
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
