// Audit fix sweep (PR #2356) — FIX-social-005: the post card's heart
// button only opened the emoji picker, so "react heart; click again"
// opened and closed the picker — no count, no removal — and a failed
// react was swallowed silently. The heart now toggles the heart
// reaction itself (the social.react macro toggles the same kind off),
// the picker lives on its own button, and a failed react says so.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostCard } from '@/components/social/feed/PostCard';
import type { SocialPost } from '@/components/social/feed/types';

const post = (viewerReaction: string | null): SocialPost => ({
  id: 'p1', userId: 'u2', username: 'bea', displayName: 'Bea',
  body: 'a post about maps', content: 'a post about maps',
  media: [], poll: null, quoteOf: null, hashtags: [], tags: [], mentions: [], comments: [],
  createdAt: '2026-03-02T10:00:00Z', sensitiveHidden: false,
  replyCount: 0, reactionCounts: viewerReaction ? { love: 1 } : {}, reactionTotal: viewerReaction ? 1 : 0,
  repostCount: 0, viewerReaction, viewerReposted: false, isPinned: false, editedAt: null,
});

let reactResult: { data: { ok: boolean; error?: string } } = { data: { ok: true } };

beforeEach(() => {
  lensRunMock.mockReset();
  reactResult = { data: { ok: true } };
  lensRunMock.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'reactionKinds') return { data: { ok: true, result: { kinds: ['like', 'love', 'celebrate', 'insightful', 'laugh', 'sad'] } } };
    if (action === 'react') return reactResult;
    return { data: { ok: true, result: {} } };
  });
});

function renderCard(viewerReaction: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PostCard post={post(viewerReaction)} username="ana" currentUserId="u1"
        onChanged={() => {}} onQuote={() => {}} onOpenHashtag={() => {}} onOpenDetail={() => {}} />
    </QueryClientProvider>,
  );
}

describe('PostCard heart toggle (FIX-social-005)', () => {
  it('clicking the heart sends the heart reaction instead of only opening the picker', async () => {
    renderCard(null);
    fireEvent.click(screen.getByRole('button', { name: 'React to post' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('social', 'react', { postId: 'p1', reaction: 'love' }));
  });

  it('clicking the heart again sends the same kind, which the macro toggles off', async () => {
    renderCard('love');
    const heart = screen.getByRole('button', { name: 'React to post' });
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(heart);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('social', 'react', { postId: 'p1', reaction: 'love' }));
  });

  it('the picker still opens from its own button and picks other kinds', async () => {
    renderCard(null);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a reaction' }));
    const like = await screen.findByTitle('like');
    fireEvent.click(like);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('social', 'react', { postId: 'p1', reaction: 'like' }));
  });

  it('a failed react says so instead of looking like a dead toggle', async () => {
    reactResult = { data: { ok: false, error: 'post not found' } };
    renderCard(null);
    fireEvent.click(screen.getByRole('button', { name: 'React to post' }));
    await waitFor(() => expect(screen.getByText(/Reaction didn't go through: post not found/)).toBeTruthy());
  });
});
