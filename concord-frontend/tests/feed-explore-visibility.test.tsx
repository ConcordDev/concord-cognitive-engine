/**
 * Explore / Following render the social feed. A public post returned by
 * those endpoints is visible. A private post in the payload is dropped.
 * The old system-DTU catalog (and the "Feed DTUs" panel) does not stand
 * in for the timeline. "Your posts" lists only the signed-in user's items.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: {
    dtus: {
      paginated: vi.fn(() =>
        Promise.resolve({
          data: { dtus: [{ id: 'sys', title: 'Feed DTUs - Regular 100', content: 'Feed DTUs - Regular 100' }] },
        }),
      ),
      list: vi.fn(() => Promise.resolve({ data: { dtus: [] } })),
    },
  },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [
      {
        id: 'sys-item',
        ownerId: 'user-a',
        title: 'Feed DTUs - Regular 100',
        data: { content: 'Feed DTUs - Regular 100' },
      },
      {
        id: 'mine',
        ownerId: 'user-b',
        title: 'My harbor note',
        data: { content: 'My harbor note' },
      },
    ],
    total: 2,
    isLoading: false,
    isError: false,
    error: null,
    isSeeding: false,
    refetch: vi.fn(),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({ ok: true })), isPending: false }),
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: () => () => {},
}));

vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    (selector?: (s: { addToast: () => void }) => unknown) => {
      const state = { addToast: () => {} };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ addToast: () => {} }) },
  ),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'virtuoso' },
      (data || []).map((d, i) => React.createElement('div', { key: i }, itemContent(i, d))),
    ),
}));

vi.mock('@/components/social/StoriesBar', () => ({ StoriesBar: () => null }));
vi.mock('@/components/social/SuggestedFollows', () => ({ SuggestedFollows: () => null }));
vi.mock('@/components/social/PresenceIndicator', () => ({ PresenceIndicator: () => null }));
vi.mock('@/components/social/SocialCommerceTag', () => ({ SocialCommerceTag: () => null }));
vi.mock('@/components/social/CrossPostExternal', () => ({ CrossPostExternal: () => null }));
vi.mock('@/components/social/Discovery', () => ({ Discovery: () => null }));
vi.mock('@/components/social/PostScheduler', () => ({ PostScheduler: () => null }));
vi.mock('@/components/social/TrendingTopics', () => ({ TrendingTopics: () => null }));
vi.mock('@/components/social/StreakIndicator', () => ({ StreakIndicator: () => null }));
vi.mock('@/components/social/NotificationCenter', () => ({ NotificationCenter: () => null }));
vi.mock('@/components/social/DMIndicator', () => ({ DMIndicator: () => null }));
vi.mock('@/components/lens/PullToSubstrate', () => ({ PullToSubstrate: () => null }));
vi.mock('@/components/lens/FeedBanner', () => ({ FeedBanner: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/dtu/ProvenanceBadge', () => ({ ProvenanceBadge: () => null }));
vi.mock('@/components/common/ReportButton', () => ({ ReportButton: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/feed/BookmarkFolderPicker', () => ({ BookmarkFolderPicker: () => null }));

import { FeedTimelinePanel } from '@/components/feed/FeedTimelinePanel';

const PUBLIC = {
  id: 'post-a',
  userId: 'user-a',
  content: 'A public hello',
  privacy: 'public',
  createdAt: new Date().toISOString(),
  commentCount: 0,
  shareCount: 0,
  viewCount: 0,
  tags: [],
};

function jsonFor(url: string, posts: unknown[]) {
  if (url.includes('/api/auth/me')) {
    return { data: { ok: true, user: { id: 'user-b', username: 'b', email: 'b@x', role: 'user' } } };
  }
  if (url.includes('/api/social/feed/explore') || url.includes('/api/social/feed/following') || url.includes('/api/social/feed/foryou')) {
    return { data: { ok: true, posts } };
  }
  if (url.includes('/api/dtus')) {
    return {
      data: {
        dtus: [{ id: 'sys', title: 'Feed DTUs - Regular 100', content: 'Feed DTUs - Regular 100' }],
      },
    };
  }
  return { data: { ok: true, topics: [], creators: [], users: [] } };
}

function renderFeed(tab: 'trending' | 'following' | 'for-you') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FeedTimelinePanel tab={tab} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('feed Explore / Following visibility', () => {
  it("shows A's public post on Explore and the viewer's own items, not system DTUs", async () => {
    apiGet.mockImplementation((url: string) =>
      Promise.resolve(jsonFor(String(url), [PUBLIC, { ...PUBLIC, id: 'secret', content: 'secret note', privacy: 'private' }])),
    );
    renderFeed('trending');
    expect(await screen.findByText('A public hello')).toBeTruthy();
    expect(screen.queryByText('secret note')).toBeNull();
    expect(screen.queryByText('Feed DTUs - Regular 100')).toBeNull();
    expect(screen.queryByText('Feed DTUs')).toBeNull();
    expect(screen.getByText('Your posts')).toBeTruthy();
    expect(await screen.findByText('My harbor note')).toBeTruthy();
  });

  it("shows A's public post on Following when that endpoint returns it", async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve(jsonFor(String(url), [PUBLIC])));
    renderFeed('following');
    expect(await screen.findByText('A public hello')).toBeTruthy();
    expect(screen.queryByText('Feed DTUs - Regular 100')).toBeNull();
  });

  it('does not render a private post the API omitted', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve(jsonFor(String(url), [])));
    renderFeed('trending');
    await waitFor(() => expect(screen.getByText(/nothing in your feed yet/i)).toBeTruthy());
    expect(screen.queryByText('secret note')).toBeNull();
    expect(screen.queryByText('Feed DTUs - Regular 100')).toBeNull();
  });
});
