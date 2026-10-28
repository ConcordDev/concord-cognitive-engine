/**
 * Social page northstar greeting.
 *
 * The Social concept (docs/lens-northstar/84) opens on the serif
 * headline "What's moving, Ramaj" above the feed composer. This
 * pins the page header carrying it with the signed-in username
 * (from the page's own useCurrentUser session query — no new hook
 * was added). Every hub surface is mocked away; the greeting lives
 * in the page's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { ok: true, user: { id: 'u1', username: 'ramaj' } } }),
}));
vi.mock('@/hooks/use-open-post-in-place', () => ({
  useOpenPostInPlace: () => ({ openPostId: null, openPost: vi.fn(), closePost: vi.fn() }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/lenses/social',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));
vi.mock('@/lib/social-places', () => ({ parseSocialPlace: () => 'feed' }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: () => null }));
const named = (name: string) => ({ [name]: () => null });
vi.mock('@/components/social/StoriesBar', () => named('StoriesBar'));
vi.mock('@/components/social/QuickPostComposer', () => named('QuickPostComposer'));
vi.mock('@/components/social/OwnPostDelete', () => named('OwnPostDelete'));
vi.mock('@/components/social/invalidate-post-surfaces', () => ({ invalidatePostSurfaces: vi.fn() }));
vi.mock('@/components/social/Discovery', () => named('Discovery'));
vi.mock('@/components/social/NotificationBell', () => named('NotificationBell'));
vi.mock('@/components/social/NotificationCenter', () => named('NotificationCenter'));
vi.mock('@/components/social/UserProfile', () => named('UserProfile'));
vi.mock('@/components/social/SuggestedFollows', () => named('SuggestedFollows'));
vi.mock('@/components/social/TrendingTopics', () => named('TrendingTopics'));
vi.mock('@/components/social/FindPeople', () => named('FindPeople'));
vi.mock('@/components/social/SocialPreferencesForm', () => named('SocialPreferencesForm'));
vi.mock('@/components/social/PushEnableButton', () => named('PushEnableButton'));
vi.mock('@/components/social/PresenceIndicator', () => named('PresenceIndicator'));
vi.mock('@/components/social/DMIndicator', () => named('DMIndicator'));
vi.mock('@/components/social/StreakIndicator', () => named('StreakIndicator'));
vi.mock('@/components/social/CreatorAnalytics', () => named('CreatorAnalytics'));
vi.mock('@/components/social/UserLink', () => named('UserLink'));
vi.mock('@/components/social/BookmarksList', () => named('BookmarksList'));
vi.mock('@/components/social/ModerationPanel', () => named('ModerationPanel'));
vi.mock('@/components/reels/ReelsFeed', () => named('ReelsFeed'));
vi.mock('@/components/audio-rooms/RoomList', () => named('RoomList'));
vi.mock('@/components/audio-rooms/RoomStage', () => ({ default: () => null }));
vi.mock('@/components/social/feed/DMInbox', () => named('DMInbox'));
vi.mock('@/components/social/RankedFeed', () => named('RankedFeed'));
vi.mock('@/components/social/SocialLists', () => named('SocialLists'));
vi.mock('@/components/social/SocialGroups', () => named('SocialGroups'));
vi.mock('@/components/social/AdminModerationQueue', () => named('AdminModerationQueue'));
vi.mock('@/components/social/PeopleToFollow', () => named('PeopleToFollow'));
vi.mock('@/components/social/WelcomeChecklist', () => named('WelcomeChecklist'));
vi.mock('@/components/social/PostMediaCard', () => named('PostMediaCard'));
vi.mock('@/components/social/PublicFallbackFeed', () => named('PublicFallbackFeed'));
vi.mock('@/components/social/PostDetailInPlace', () => ({
  PostDetailInPlace: () => null,
  socialPostViewTransitionName: () => '',
}));

import SocialHubPage from '@/app/lenses/social/page';

describe('Social page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<SocialHubPage />);
    const greeting = screen.getByTestId('social-greeting');
    expect(greeting.textContent).toBe("What's moving, ramaj");
    expect(greeting.className).toContain('font-vault');
  });
});
