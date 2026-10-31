/**
 * /lenses/analytics — Overview card correctness (Review 4, S7 + the
 * DeskPanel Engagement derivation; remainder slice R2).
 *
 *   S7 DUPLICATE — the Overview used to render TWO "Followers" cards: the
 *     DeskPanel strip's and CreatorAnalytics' own overview row. The strip's
 *     card is the survivor; CreatorAnalytics hides its own ONLY in this
 *     embedding (hideFollowersCard) — Social/Profile keep theirs.
 *   ENGAGEMENT — the DeskPanel strip read engagementRate FLAT off the
 *     creator response, but the live view (emergent/social-layer.js
 *     getCreatorAnalyticsView) carries it nested under `overview`, so the
 *     card was pinned at 0.0% forever. It now derives nested-first, the
 *     way CreatorAnalytics renders it.
 *
 * Backend is mocked at '@/lib/api/client' in the exact envelopes the
 * components consume; the creator fixture is the live view's shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── backend channels ────────────────────────────────────────────────────────
const myDtus = vi.fn();
const apiGet = vi.fn();

// The live creator view's shape (getCreatorAnalyticsView): engagement rate
// and follower count live under `overview`; totalPosts is flat.
const CREATOR_VIEW = {
  ok: true,
  overview: { engagementRate: 7.42, totalReach: 900, followerCount: 123, followerTrend: 1.5 },
  topPosts: [],
  bestPostingHours: [],
  contentBreakdown: [],
  followerGrowth: [],
  totalPosts: 9,
};

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
  apiHelpers: { dtus: { myDtus: (...a: unknown[]) => myDtus(...a) } },
}));

vi.mock('@/components/analytics/AnalyticsActionPanel', () => ({
  AnalyticsActionPanel: () => null,
}));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) =>
      React.createElement('div', props, props.children as React.ReactNode),
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { AnalyticsDeskPanel } from '@/components/analytics/AnalyticsDeskPanel';
import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  myDtus.mockResolvedValue({ data: { dtus: [], total: 0 } });
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/social/profile') {
      return Promise.resolve({
        data: { profile: { userId: 'u1', displayName: 'Tester', stats: { followers: 123, citations: 4 } } },
      });
    }
    if (path === '/api/social/analytics/creator') return Promise.resolve({ data: CREATOR_VIEW });
    if (path === '/api/economy/transactions') {
      return Promise.resolve({ data: { transactions: [], summary: { total: 0, count: 0, volume: 0 } } });
    }
    if (path.startsWith('/api/social/followers/')) {
      return Promise.resolve({ data: { followers: ['a', 'b'], total: 123 } });
    }
    return Promise.resolve({ data: {} });
  });
});

describe('Analytics Overview cards (R2)', () => {
  it('renders exactly ONE "Followers" card on the Overview (S7)', async () => {
    wrap(<AnalyticsDeskPanel mode="overview" />);
    // CreatorAnalytics has resolved when its Total Reach card paints.
    await waitFor(() => expect(screen.getByText('Total Reach')).toBeTruthy());
    expect(screen.getAllByText('Followers')).toHaveLength(1);
  });

  it('Engagement card derives from overview.engagementRate, not the flat read', async () => {
    wrap(<AnalyticsDeskPanel mode="overview" />);
    await waitFor(() => expect(screen.getByText('Total Reach')).toBeTruthy());
    // 7.42 nested → the strip card paints 7.4%. The pre-fix flat read
    // painted 0.0% against this same fixture.
    expect(screen.getByText('7.4%')).toBeTruthy();
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('CreatorAnalytics standalone keeps its Followers card (Social/Profile unchanged)', async () => {
    wrap(<CreatorAnalytics userId="u1" />);
    await waitFor(() => expect(screen.getByText('Total Reach')).toBeTruthy());
    expect(screen.getByText('Followers')).toBeTruthy();
  });
});
