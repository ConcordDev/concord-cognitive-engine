import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return { data: { ok: true, user: { id: 'u1', username: 'ana' } } };
      if (String(url).includes('/notifications/count')) return { data: { count: 0 } };
      return { data: { ok: true } };
    }),
    post: vi.fn(async () => ({ data: { ok: true } })),
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/lenses/social',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({
  MobileTabBar: ({ tabs }: { tabs: { id: string; label: string }[] }) =>
    React.createElement('div', { 'data-testid': 'mobile-tabs' }, tabs.map((t) => t.label).join(',')),
}));
vi.mock('@/components/social/StoriesBar', () => ({ StoriesBar: () => null }));
vi.mock('@/components/social/QuickPostComposer', () => ({
  QuickPostComposer: () => React.createElement('form', { id: 'social-quick-post', 'data-testid': 'composer' }, 'composer'),
}));
vi.mock('@/components/social/Discovery', () => ({ Discovery: () => React.createElement('div', { 'data-testid': 'discovery' }) }));
vi.mock('@/components/social/FindPeople', () => ({ FindPeople: () => React.createElement('div', { 'data-testid': 'find-people' }) }));
vi.mock('@/components/social/SuggestedFollows', () => ({ SuggestedFollows: () => null }));
vi.mock('@/components/social/UserProfile', () => ({ UserProfile: () => null }));
vi.mock('@/components/social/RankedFeed', () => ({ RankedFeed: () => null }));
vi.mock('@/components/social/SocialLists', () => ({ SocialLists: () => null }));
vi.mock('@/components/social/SocialGroups', () => ({ SocialGroups: () => null }));
vi.mock('@/components/social/feed/DMInbox', () => ({ DMInbox: () => React.createElement('div', { 'data-testid': 'dm-inbox' }) }));
vi.mock('@/components/social/NotificationCenter', () => ({ NotificationCenter: () => null }));
vi.mock('@/components/social/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/social/StreakIndicator', () => ({ StreakIndicator: () => null }));
vi.mock('@/components/social/DMIndicator', () => ({ DMIndicator: () => null }));
vi.mock('@/components/social/PushEnableButton', () => ({ PushEnableButton: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/reels/ReelsFeed', () => ({ ReelsFeed: () => React.createElement('div', { 'data-testid': 'clips' }) }));
vi.mock('@/components/audio-rooms/RoomList', () => ({ RoomList: () => React.createElement('div', { 'data-testid': 'rooms' }) }));
vi.mock('@/components/audio-rooms/RoomStage', () => ({ default: () => null }));
vi.mock('@/components/social/feed/FeedView', () => ({ FeedView: () => React.createElement('div', { 'data-testid': 'feed-composer-dupe' }) }));

import SocialHubPage from '@/app/lenses/social/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SocialHubPage />
    </QueryClientProvider>,
  );
}

describe('social 5-place IA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Home, Explore, Create, Inbox, You and a single composer', async () => {
    renderPage();
    // Two navs now render in jsdom (desktop sidebar + phone top bar — they
    // are never both visible in a real browser: hidden lg:flex vs lg:hidden),
    // so every place must appear at least once across them.
    await screen.findAllByRole('button', { name: /^Home$/i });
    expect(screen.getAllByRole('button', { name: /^Explore$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Create$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Inbox$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^You$/i }).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByTestId('composer')).toHaveLength(1));
    expect(screen.queryByTestId('feed-composer-dupe')).not.toBeInTheDocument();
    expect(screen.queryByText('Reels')).not.toBeInTheDocument();
    expect(screen.queryByText('Spaces')).not.toBeInTheDocument();
  });
});
