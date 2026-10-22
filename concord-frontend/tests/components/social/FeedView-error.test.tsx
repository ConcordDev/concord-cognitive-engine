/**
 * A failed social.feed request must not render the empty-feed copy.
 * The live failure was HTTP 500 from social.feed; the page treated a
 * missing post list as "No posts yet — Write the first post".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { FeedView } from '@/components/social/feed/FeedView';

const FEED_ERROR = 'object is not iterable (cannot read property Symbol(Symbol.iterator))';

describe('FeedView feed failure', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('does not render the empty-feed copy when the feed request fails', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'feed') {
        return { data: { ok: false, result: null, error: FEED_ERROR } };
      }
      return { data: { ok: true, result: { trending: [] }, error: null } };
    });

    render(<FeedView currentUserId="user_a" username="ana" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByText('Feed unavailable')).toBeTruthy();
    expect(screen.getByText(FEED_ERROR)).toBeTruthy();
    expect(screen.queryByText('No posts yet')).toBeNull();
    expect(screen.queryByText(/Write the first post/i)).toBeNull();
  });

  it('still shows the empty-feed copy when the feed succeeds with no posts', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'feed') {
        return { data: { ok: true, result: { posts: [] }, error: null } };
      }
      return { data: { ok: true, result: { trending: [] }, error: null } };
    });

    render(<FeedView currentUserId="user_a" username="ana" />);

    await waitFor(() => {
      expect(screen.getByText('No posts yet')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Write your first post/i })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('empty-state action focuses the composer', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'feed') {
        return { data: { ok: true, result: { posts: [] }, error: null } };
      }
      return { data: { ok: true, result: { trending: [] }, error: null } };
    });
    render(
      <div id="social-main">
        <FeedView currentUserId="user_a" username="ana" />
      </div>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Write your first post/i })).toBeTruthy();
    });
    const box = document.querySelector('#social-main textarea') as HTMLTextAreaElement;
    expect(box).toBeTruthy();
    const focus = vi.spyOn(box, 'focus');
    screen.getByRole('button', { name: /Write your first post/i }).click();
    expect(focus).toHaveBeenCalled();
  });

  it('drops [object Object] and [object object] trending tags', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'feed') {
        return { data: { ok: true, result: { posts: [] }, error: null } };
      }
      return {
        data: {
          ok: true,
          result: {
            trending: [
              { tag: 'concord', posts: 3 },
              { tag: '[object Object]', posts: 9 },
              { tag: '[object object]', posts: 84 },
            ],
          },
          error: null,
        },
      };
    });

    render(<FeedView currentUserId="user_a" username="ana" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /#concord/ })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /object object/i })).toBeNull();
  });
});
