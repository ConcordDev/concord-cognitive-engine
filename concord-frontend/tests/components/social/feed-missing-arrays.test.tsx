import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === 'feed') {
      return {
        data: {
          ok: true,
          result: {
            posts: [{
              id: 'sparse-1',
              userId: 'ada',
              content: 'sparse body from the server',
              createdAt: '2026-10-22T17:00:00.000Z',
            }],
          },
        },
      };
    }
    if (action === 'trendingHashtags') {
      return { data: { ok: true, result: { trending: [] } } };
    }
    return { data: { ok: false } };
  }),
}));

import { FeedView } from '@/components/social/feed/FeedView';
import { PostCard } from '@/components/social/feed/PostCard';
import { normalizePost } from '@/components/social/feed/normalizePost';
import type { SocialPost } from '@/components/social/feed/types';

describe('social feed missing arrays', () => {
  it('normalizes a server post that omitted media, hashtags, comments, and reactions', () => {
    const post = normalizePost({ id: 'p1', userId: 'ada', content: 'hello' });
    expect(post?.media).toEqual([]);
    expect(post?.hashtags).toEqual([]);
    expect(post?.comments).toEqual([]);
    expect(post?.body).toBe('hello');
    expect(post?.reactionTotal).toBe(0);
  });

  it('renders a post card when those arrays are missing', () => {
    const post = {
      id: 'sparse-card',
      userId: 'ada',
      username: 'ada',
      body: 'card still renders',
      createdAt: '2026-10-22T17:00:00.000Z',
    } as SocialPost;
    render(
      <PostCard
        post={post}
        username="ada"
        currentUserId="ada"
        onChanged={() => {}}
        onQuote={() => {}}
        onOpenHashtag={() => {}}
        onOpenDetail={() => {}}
      />,
    );
    expect(screen.getByText('card still renders')).toBeTruthy();
  });

  it('renders the Feed tab when the feed payload omitted those arrays', async () => {
    render(<FeedView currentUserId="ada" username="ada" />);
    expect(await screen.findByText('sparse body from the server')).toBeTruthy();
  });
});
