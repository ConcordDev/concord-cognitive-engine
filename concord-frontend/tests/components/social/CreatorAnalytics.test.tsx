import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('div', props, children),
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
}));

import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const DATA = {
  overview: { engagementRate: 4.27, totalReach: 15400, followerCount: 980, followerTrend: 'up' as const },
  engagementByDay: [
    { date: '2026-05-01', reactions: 10, comments: 5, shares: 2 },
    { date: '2026-05-02', reactions: 0, comments: 0, shares: 0 },
    { date: '2026-05-03', reactions: 8, comments: 1, shares: 4 },
  ],
  topPosts: [
    { postId: 'tp1', title: 'Top one', engagementScore: 99, reactions: 50, comments: 20, shares: 10, createdAt: '2026-05-01' },
    { postId: 'tp2', title: 'Top two', engagementScore: 80, reactions: 40, comments: 15, shares: 8, createdAt: '2026-05-02' },
    { postId: 'tp3', title: 'Top three', engagementScore: 70, reactions: 30, comments: 10, shares: 6, createdAt: '2026-05-03' },
    { postId: 'tp4', title: 'Fourth', engagementScore: 60, reactions: 20, comments: 5, shares: 4, createdAt: '2026-05-04' },
  ],
  bestPostingHours: [
    { hour: 0, score: 5 },
    { hour: 4, score: 30 },
    { hour: 12, score: 90 },
  ],
  contentBreakdown: [
    { mediaType: 'text', count: 12 },
    { mediaType: 'image', count: 6 },
    { mediaType: 'video', count: 3 },
    { mediaType: 'audio', count: 2 },
    { mediaType: 'unknown', count: 1 },
  ],
  followerGrowth: { gained: 120, lost: 30, net: 90, period: '30d' },
  earnings: { totalCC: 5400, thisWeek: 200, thisMonth: 800 },
};

describe('CreatorAnalytics', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders the error state when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    wrap(<CreatorAnalytics userId="u1" />);
    expect(await screen.findByText('Unable to load analytics')).toBeInTheDocument();
  });

  it('renders full analytics with overview, top posts and earnings', async () => {
    apiGet.mockResolvedValue({ data: DATA });
    wrap(<CreatorAnalytics userId="u1" />);
    expect(await screen.findByText('Engagement Rate')).toBeInTheDocument();
    expect(screen.getByText('4.3')).toBeInTheDocument();
    expect(screen.getByText('Total Reach')).toBeInTheDocument();
    expect(screen.getByText('Top one')).toBeInTheDocument();
    expect(screen.getByText('Best Posting Hours')).toBeInTheDocument();
    expect(screen.getByText('Content Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Total Earned')).toBeInTheDocument();
    expect(screen.getByText('5.4K CC')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
  });

  it('handles a negative net follower growth branch', async () => {
    apiGet.mockResolvedValue({
      data: { ...DATA, followerGrowth: { gained: 5, lost: 50, net: -45, period: '30d' } },
    });
    wrap(<CreatorAnalytics userId="u1" />);
    expect(await screen.findByText('Follower Growth (30d)')).toBeInTheDocument();
    expect(screen.getByText('-45')).toBeInTheDocument();
  });

  it('renders stable / down trend without arrows', async () => {
    apiGet.mockResolvedValue({
      data: { ...DATA, overview: { ...DATA.overview, followerTrend: 'down' as const } },
    });
    wrap(<CreatorAnalytics userId="u1" />);
    expect(await screen.findByText('Engagement Rate')).toBeInTheDocument();
  });

  it('does not fetch when userId is empty', () => {
    wrap(<CreatorAnalytics userId="" />);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('handles empty engagement / hours / content arrays without crashing', async () => {
    apiGet.mockResolvedValue({
      data: {
        ...DATA,
        engagementByDay: [],
        bestPostingHours: [],
        contentBreakdown: [],
        topPosts: [],
      },
    });
    wrap(<CreatorAnalytics userId="u1" />);
    expect(await screen.findByText('Engagement (Last 7 Days)')).toBeInTheDocument();
  });
});
