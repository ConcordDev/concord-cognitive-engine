// @vitest-environment jsdom
/**
 * FIX-social-021 — the 'Who to follow' card showed a stale follower
 * count until a reload. The card stays on screen after a follow (the
 * button flips to "Following"), so the count it renders must move with
 * the action: follow adds one, unfollow takes it back, no reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement('div', props, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { SuggestedFollows } from '@/components/social/SuggestedFollows';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('SuggestedFollows — follower count moves with the follow (FIX-social-021)', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.get.mockResolvedValue({
      data: {
        suggestions: [
          {
            userId: 'u-target',
            displayName: 'Target Creator',
            followerCount: 0,
            sharedInterests: [],
            matchScore: 0,
          },
        ],
      },
    });
    mockedApi.post.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('follow raises the shown count and unfollow lowers it back, without a reload', async () => {
    const { container } = render(
      withQuery(React.createElement(SuggestedFollows, { currentUserId: 'u-viewer' }), qc),
    );

    await waitFor(() => expect(container.textContent).toContain('0 followers'), { timeout: 3000 });

    const followBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /Follow/.test(b.textContent || ''),
    ) as HTMLButtonElement;
    expect(followBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(followBtn);
    });

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/api/social/follow', { followedId: 'u-target' }), { timeout: 3000 });
    await waitFor(() => expect(container.textContent).toContain('1 followers'), { timeout: 3000 });
    expect(container.textContent).not.toContain('0 followers');

    const followingBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /Following/.test(b.textContent || ''),
    ) as HTMLButtonElement;
    expect(followingBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(followingBtn);
    });

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/api/social/unfollow', { followedId: 'u-target' }), { timeout: 3000 });
    await waitFor(() => expect(container.textContent).toContain('0 followers'), { timeout: 3000 });
  });
});
