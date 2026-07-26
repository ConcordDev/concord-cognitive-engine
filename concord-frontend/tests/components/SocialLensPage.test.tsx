/**
 * Social lens page — ManifestActionBar removal + real unread-badge wiring.
 *
 * Real defect fixed this pass: the page rendered <ManifestActionBar/> at
 * the very top with a manifest.actions list ('follow'/'unfollow'/'comment'/
 * 'share'/'post'/'story_create'/'discover'/'notifications'/'trending') —
 * 9 of those 10 strings matched no registered "social" macro at all, so
 * every click but one 404'd as unknown_macro. It's been removed (see
 * lib/lenses/manifest.ts). Separately, the topbar's notification bell was
 * a bare icon button with no unread indicator, despite a fully-built
 * `NotificationBell` component (real count + realtime socket invalidation
 * + animated badge + dropdown) already existing, unused. This test proves
 * both: no dead quick-action bar renders, and the real unread count now
 * surfaces as a live badge in two real places (topbar bell, Notifications
 * tab) sourced from one shared query.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/realtime/socket', () => ({
  getSocket: () => null,
  subscribe: () => () => {},
}));

vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));

vi.mock('@/components/social/StoriesBar', () => ({ StoriesBar: () => null }));
vi.mock('@/components/social/QuickPostComposer', () => ({ QuickPostComposer: () => null }));
vi.mock('@/components/social/Discovery', () => ({ Discovery: () => null }));
vi.mock('@/components/social/UserProfile', () => ({ UserProfile: () => null }));
vi.mock('@/components/social/SuggestedFollows', () => ({ SuggestedFollows: () => null }));
vi.mock('@/components/social/TrendingTopics', () => ({ TrendingTopics: () => null }));
vi.mock('@/components/social/TrendingDomains', () => ({ TrendingDomains: () => null }));
vi.mock('@/components/social/PresenceIndicator', () => ({ PresenceIndicator: () => null }));
vi.mock('@/components/social/DMIndicator', () => ({ DMIndicator: () => null }));
vi.mock('@/components/social/StreakIndicator', () => ({ StreakIndicator: () => null }));
vi.mock('@/components/social/CreatorAnalytics', () => ({ CreatorAnalytics: () => null }));
vi.mock('@/components/social/UserLink', () => ({ UserLink: () => null }));
vi.mock('@/components/social/BookmarksList', () => ({ BookmarksList: () => null }));
vi.mock('@/components/social/ModerationPanel', () => ({ ModerationPanel: () => null }));
vi.mock('@/components/reels/ReelsFeed', () => ({ ReelsFeed: () => null }));
vi.mock('@/components/audio-rooms/RoomList', () => ({ RoomList: () => null }));
vi.mock('@/components/audio-rooms/RoomStage', () => ({ default: () => null }));
vi.mock('@/components/social/feed/FeedView', () => ({ FeedView: () => null }));

// NotificationCenter is used both as the full "Notifications" tab panel
// and (via the real, unmocked NotificationBell) as the topbar dropdown —
// stub it simply so we can tell dropdown-open apart from closed.
vi.mock('@/components/social/NotificationCenter', () => ({
  NotificationCenter: ({ isOpen, mode }: { isOpen?: boolean; mode?: string }) =>
    mode === 'dropdown'
      ? (isOpen ? React.createElement('div', { 'data-testid': 'notif-dropdown' }, 'dropdown open') : null)
      : React.createElement('div', { 'data-testid': 'notif-panel' }, 'panel'),
}));

// NotificationBell itself is left REAL (not mocked) — that's the fix under test.

import SocialHubPage from '@/app/lenses/social/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SocialHubPage />
    </QueryClientProvider>,
  );
}

describe('social lens page — real unread badge (ManifestActionBar removed)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/auth/me') return { data: { ok: true, user: { id: 'u1', username: 'ana' } } };
      if (url === '/api/social/notifications/count') return { data: { count: 3 } };
      if (url === '/api/social/following-activity') return { data: { items: [] } };
      if (url === '/api/presence/active') return { data: { users: [] } };
      return { data: {} };
    });
  });

  it('renders no dead ManifestActionBar quick-trigger row', async () => {
    renderPage();
    // The generic quick-trigger bar always titles buttons "<verb> — quick
    // trigger, runs with no parameters" (ManifestActionBar.tsx). None of
    // that surface exists anymore.
    await screen.findByText('Social');
    expect(screen.queryByTitle(/quick trigger, runs with no parameters/i)).not.toBeInTheDocument();
  });

  it('shows the real unread count as a live badge on the topbar bell', async () => {
    renderPage();
    const bellButton = await screen.findByRole('button', { name: /notifications.*3 unread/i });
    await waitFor(() => expect(bellButton).toHaveTextContent('3'));
  });

  it('the same real count also badges the Notifications tab (shared query, not two fake numbers)', async () => {
    renderPage();
    const tab = await screen.findByRole('tab', { name: /Notifications/i });
    await waitFor(() => expect(tab).toHaveTextContent('3'));
  });

  it('clicking the topbar bell opens the real dropdown preview (a genuine state change, not decoration)', async () => {
    renderPage();
    const bellButton = await screen.findByRole('button', { name: /notifications.*3 unread/i });
    expect(screen.queryByTestId('notif-dropdown')).not.toBeInTheDocument();
    fireEvent.click(bellButton);
    expect(await screen.findByTestId('notif-dropdown')).toBeInTheDocument();
    fireEvent.click(bellButton);
    await waitFor(() => expect(screen.queryByTestId('notif-dropdown')).not.toBeInTheDocument());
  });
});
