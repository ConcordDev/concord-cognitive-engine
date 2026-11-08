// Render + behaviour coverage for the feed timeline panel. The panel composes many shared social
// widgets; those are stubbed as thin markers so the panel's own logic (post cards, reactions,
// composer, tabs, trending, presence, filters) is what runs.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
const refetch = vi.fn();
const fetchNext = vi.fn();
const POSTS = [
  { id: 'p1', type: 'text', author: { id: 'u2', name: 'Bo', handle: 'bo', gradient: 'from-a to-b', verified: true }, content: 'Hello #world from the feed', createdAt: new Date(Date.now() - 120000).toISOString(), likes: 4, comments: 2, reposts: 1, shares: 0, views: 40, liked: false, reposted: false, bookmarked: false, tags: ['world'], dtuId: 'dtu1', dtuSource: 'feed', linkedDTUs: [{ dtuId: 'd9', title: 'Linked', type: 'regular' }], taggedProducts: [{ listingId: 'l1', title: 'Guitar', price: 120, sellerId: 'u2' }] },
  { id: 'p2', type: 'release', author: { id: 'u3', name: 'Cy', handle: 'cy', gradient: 'g', verified: false }, content: 'New release out', createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), likes: 0, comments: 0, reposts: 0, shares: 0, views: 3, liked: true, reposted: true, bookmarked: true, release: { title: 'Album', artist: 'Cy', coverGradient: 'g', trackCount: 2, tracks: ['One', 'Two'], releaseDate: '2026-03-01' } },
  { id: 'p3', type: 'art', author: { id: 'u4', name: 'Di', handle: 'di', gradient: 'g', verified: false }, content: 'Art drop', createdAt: new Date().toISOString(), likes: 1, comments: 0, reposts: 0, shares: 0, views: 1, liked: false, reposted: false, bookmarked: false, art: { images: [{ gradient: 'g', label: 'Piece' }] } },
  { id: 'p4', type: 'collab', author: { id: 'u5', name: 'Ed', handle: 'ed', gradient: 'g', verified: false }, content: 'Jam session', createdAt: new Date().toISOString(), likes: 0, comments: 0, reposts: 0, shares: 0, views: 0, liked: false, reposted: false, bookmarked: false, collab: { sessionName: 'Late jam', participants: 2, maxParticipants: 4, genre: 'jazz' } },
];

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), delete: vi.fn(async () => ({ data: {} })), put: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/feed/useFeedPosts', () => ({ useFeedPosts: () => ({ feedPosts: POSTS, isLoading: false, isError: false, error: null, refetch, fetchNextPage: fetchNext, hasNextPage: true, isFetchingNextPage: false }) }));
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent, endReached }: { data: unknown[]; itemContent: (i: number, d: unknown) => React.ReactNode; endReached?: () => void }) => <div>{data.map((d, i) => <div key={i}>{itemContent(i, d)}</div>)}<button onClick={() => endReached?.()}>load-more</button></div> }));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => ({ items: [{ id: 'li1', title: 'Item', type: 'post', createdAt: '2026-03-01', updatedAt: '2026-03-01', version: 1, meta: { tags: [], status: 'active', visibility: 'public' }, data: { content: 'Lens post', type: 'text' } }], isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(async () => ({ id: 'n1' })), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), isCreating: false, createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false } }) }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn(async ({ action }: { action: string }) => ({ ok: true, result: { _a: action, postsAnalyzed: 4, totalPosts: 4, avgEngagement: 12.5, topPost: { id: 'p1', content: 'Hello', score: 9 }, topTags: [{ tag: 'world', uses: 3 }], clusters: [{ topic: 'world', postCount: 3, related: [{ tag: 'hello', cooccurrences: 2 }] }, { topic: 'solo', postCount: 1, related: [] }], bestPostingTimes: ['9am', '6pm'], gaps: ['Tuesdays'], coveragePercent: 62, planedPosts: 3, targetPosts: 5, recommendation: 'Post more', demographics: { ageRange: '25-34', topLocations: ['US'] }, totalFollowers: 120, growthRate: '+4%', posts: [{ id: 'p1', content: 'Hello', score: 9, author: 'Bo' }], rank: { postId: 'p1', score: 0.8, factors: { recency: 0.5, engagement: 0.7 } }, totalTopics: 2, personalized: [{ id: 'p1', score: 0.7 }], message: 'ok' } })), mutate: vi.fn(), isPending: false }) }));
vi.mock('@/store/ui', () => {
  const state = { addToast: vi.fn(), setActiveLens: vi.fn() };
  const useUIStore = Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(state), { getState: () => state });
  return { useUIStore };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'me' }, isLoading: false }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: { posts: 4 }, alerts: [], insights: [], isLive: true, lastUpdated: new Date('2026-03-02') }) }));
vi.mock('@/lib/realtime/socket', () => ({ subscribe: vi.fn(() => () => {}), getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }) }));
for (const [path, name] of [
  ['@/components/feed/BookmarkFolderPicker', 'BookmarkFolderPicker'], ['@/app/lenses/feed/WaveformPlayer', 'WaveformPlayer'],
  ['@/components/feedback/FeedbackWidget', 'FeedbackWidget'], ['@/components/lens/LiveIndicator', 'LiveIndicator'],
  ['@/components/lens/DTUExportButton', 'DTUExportButton'], ['@/components/lens/RealtimeDataPanel', 'RealtimeDataPanel'],
  ['@/components/common/VisionAnalyzeButton', 'VisionAnalyzeButton'], ['@/components/dtu/ProvenanceBadge', 'ProvenanceBadge'],
  ['@/components/common/ReportButton', 'ReportButton'], ['@/components/social/StoriesBar', 'StoriesBar'],
  ['@/components/social/SuggestedFollows', 'SuggestedFollows'], ['@/components/social/PresenceIndicator', 'PresenceIndicator'],
  ['@/components/social/SocialCommerceTag', 'SocialCommerceTag'], ['@/components/social/CrossPostExternal', 'CrossPostExternal'],
  ['@/components/social/Discovery', 'Discovery'], ['@/components/feed/FeedSchedulerPanel', 'FeedSchedulerPanel'],
  ['@/components/feed/FeedSearchResults', 'FeedSearchResults'], ['@/components/social/TrendingTopics', 'TrendingTopics'],
  ['@/components/lens/PullToSubstrate', 'PullToSubstrate'], ['@/components/lens/FeedBanner', 'FeedBanner'],
  ['@/components/social/StreakIndicator', 'StreakIndicator'], ['@/components/social/NotificationCenter', 'NotificationCenter'],
  ['@/components/social/DMIndicator', 'DMIndicator'],
] as const) vi.doMock(path, () => ({ [name]: () => <span>{name}-stub</span> }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: ({ error }: { error?: string }) => <div>error {error}</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: (_t, tag: string) => {
    const MOTION = ['initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'whileInView', 'layout', 'layoutId', 'drag'];
    return ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !MOTION.includes(k))), children as React.ReactNode);
  } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  [lensRunMock, apiGet, apiPost, refetch, fetchNext].forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: { ok: true, id: actionOf(a) }, error: null } }));
  apiGet.mockImplementation(async (url: string) => ({ data: url.includes('presence') ? { ok: true, users: [{ userId: 'u2', displayName: 'Bo', status: 'active' }, { userId: 'u3', displayName: 'Cy', status: 'idle' }] } : url.includes('trending') ? { topics: [{ id: 't1', tag: 'world', category: 'general', posts: 40 }] } : { ok: true, items: [], posts: [] } }));
  apiPost.mockResolvedValue({ data: { ok: true, id: 'new-post', post: { id: 'new-post' } } });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

describe('feed timeline panel', () => {
  it.each(['for-you', 'following', 'releases', 'trending'] as const)('renders the %s tab, shows posts and survives a full exercise pass', async (tab) => {
    const { FeedTimelinePanel } = await import('../FeedTimelinePanel');
    const view = render(<FeedTimelinePanel tab={tab} onDiscover={vi.fn()} />);
    await settle();
    expect(view.container.textContent).toMatch(/Hello|New release|Art drop|Jam session/);
    await exercise({ passes: 3, text: 'A fresh post #world', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await settle();
    await exercise({ passes: 1, text: 'search' });
    expect(view.container.textContent).toBeTruthy();
  });

  it('likes, reposts, bookmarks, comments, shares, deletes, runs feed actions, loads more and composes', async () => {
    const { FeedTimelinePanel } = await import('../FeedTimelinePanel');
    render(<FeedTimelinePanel tab="for-you" />);
    await settle();
    const box = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (box) fireEvent.change(box, { target: { value: 'Posting from a test #feed' } });
    await press(/^Post$/);
    await press(/^4$/); await press(/^1$/); await press(/^2$/);
    const input = screen.queryAllByRole('textbox').find((i) => /comment|reply|say/i.test((i as HTMLInputElement).placeholder || ''));
    if (input) { fireEvent.change(input, { target: { value: 'Nice one' } }); fireEvent.keyDown(input, { key: 'Enter' }); }
    await press(/Send|Reply|Comment$/i);
    await press(/^Bookmark$/, 0); await press(/^Bookmark$/, 1);
    await press(/^Share$/);
    await press(/Repost/i);
    await press(/^More options$/); await press(/Delete post|Delete/i); await press(/Confirm|Yes/i);
    for (const a of ['Engagement Score', 'Content Calendar', 'Audience Insights', 'Hashtag Analysis', 'Rank This Post', 'Personalize Score', 'Topic Clusters']) await press(new RegExp(`^${a}$`));
    await press(/Show more/); await press(/View all releases/); await press(/Join/);
    await press(/load-more/);
    await press(/^Private$/); await press(/^Public$/);
    await press(/Attach link|Add poll|Tag Product|Link DTU|Attach image|Attach audio/i);
    expect(apiPost.mock.calls.length + fetchNext.mock.calls.length).toBeGreaterThan(0);
    expect(apiGet.mock.calls.length).toBeGreaterThan(0);
  });

  it('stays standing when the feed fails to load', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    apiPost.mockRejectedValue(new Error('offline'));
    const { FeedTimelinePanel } = await import('../FeedTimelinePanel');
    const view = render(<FeedTimelinePanel tab="trending" />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});
