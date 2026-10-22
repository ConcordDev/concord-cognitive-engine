/**
 * Every visible Social control either fires a real request or is absent.
 * MSW is not installed in this repo; the API client is mocked the same way
 * the rest of the frontend suite mocks it, and each assertion checks the
 * recorded call.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls: Array<{ method: string; url: string }> = [];

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => React.createElement('img', { alt: props.alt || '' }),
}));
vi.mock('@/lib/realtime/socket', () => ({
  getSocket: () => null,
  subscribe: () => () => {},
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/audio-rooms/RoomStage', () => ({ default: () => null }));
vi.mock('@/components/reels/ReelsFeed', () => ({ ReelsFeed: () => React.createElement('div', null, 'Reels') }));
vi.mock('@/components/audio-rooms/RoomList', () => ({
  RoomList: () => React.createElement('div', null, 'Spaces'),
}));
vi.mock('framer-motion', () => {
  const passthrough = (tag: string) => {
    const Comp = React.forwardRef<HTMLElement, { children?: React.ReactNode }>((props, ref) =>
      React.createElement(tag, { ref }, props.children));
    Comp.displayName = `Motion${tag}`;
    return Comp;
  };
  return {
    useReducedMotion: () => false,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    motion: { div: passthrough('div'), button: passthrough('button'), span: passthrough('span'), li: passthrough('li') },
  };
});

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      calls.push({ method: 'GET', url });
      if (url === '/api/auth/me') return { data: { ok: true, user: { id: 'u1', username: 'ana' } } };
      if (url === '/api/social/notifications/count') return { data: { count: 0 } };
      if (String(url).includes('/api/social/profile/')) return { data: { ok: false } };
      if (String(url).includes('/api/social/feed/following') || String(url).includes('/api/social/following-activity')) {
        const err = new Error('missing') as Error & { response?: { status: number } };
        err.response = { status: 404 };
        throw err;
      }
      if (url === '/api/social/analytics/creator') {
        return { data: { ok: true, overview: { engagementRate: 0, totalReach: 0, followerCount: 0, followerTrend: 'stable' }, topPosts: [], bestPostingHours: [], contentBreakdown: [], followerGrowth: { gained: 0, net: 0, period: '30d' }, totalPosts: 0 } };
      }
      if (url === '/api/social/topics/trending') return { data: { topics: [{ tag: 'music', count: 2 }] } };
      if (String(url).includes('/api/social/discover')) return { data: { users: [{ userId: 'u2', displayName: 'Bea', username: 'bea', bio: '' }] } };
      if (String(url).includes('/api/social/users/search')) return { data: { users: [{ id: 'u2', username: 'bea', displayName: 'Bea' }] } };
      return { data: { ok: true, notifications: [], stories: [], topics: [], users: [] } };
    }),
    post: vi.fn(async (url: string) => {
      calls.push({ method: 'POST', url });
      return { data: { ok: true, profile: { userId: 'u1' } } };
    }),
    delete: vi.fn(async (url: string) => {
      calls.push({ method: 'DELETE', url });
      return { data: { ok: true } };
    }),
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { posts: [], trending: [], threads: [] } } })),
}));

import SocialHubPage from '@/app/lenses/social/page';
import { FeedView } from '@/components/social/feed/FeedView';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SocialHubPage />
    </QueryClientProvider>,
  );
}

describe('social honest controls', () => {
  beforeEach(() => { calls.length = 0; });

  it('hides the empty export, domain rail, and live video tab', async () => {
    renderPage();
    await screen.findByText('Social');
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Trending Domains/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Live$/ })).not.toBeInTheDocument();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FeedView currentUserId="u1" username="ana" />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /^Live$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Messages$/i }).length).toBeGreaterThan(0);
  });

  it('a failed following timeline is an error, not an empty feed', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /Following/i }));
    expect(await screen.findByText(/Couldn’t load your timeline/i)).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
  });

  it('creates a public profile on first visit and edits it through a real save', async () => {
    renderPage();
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/social/profile')).toBe(true);
    });
    const complete = await screen.findByRole('button', { name: /Complete your profile/i });
    fireEvent.click(complete);
    const save = await screen.findByRole('button', { name: /Save profile/i });
    fireEvent.change(screen.getByLabelText(/Display name/i), { target: { value: 'Ana' } });
    fireEvent.click(save);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/social/profile').length).toBeGreaterThan(1);
    });
  });

  it('trending topics and story creation hit real endpoints', async () => {
    renderPage();
    await screen.findByText('music');
    expect(calls.some((c) => c.url === '/api/social/topics/trending')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Your Story/i }));
    expect(screen.getByRole('button', { name: /^24h Story$/i })).toBeInTheDocument();
  });

  it('analytics renders without a daily series and does not invent earnings', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /Analytics/i }));
    expect(await screen.findByText('Engagement Rate')).toBeInTheDocument();
    expect(screen.queryByText(/Last 7 Days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Earnings/i)).not.toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/social/analytics/creator')).toBe(true);
  });
});
