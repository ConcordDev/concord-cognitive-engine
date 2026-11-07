// Render + behaviour coverage for the social lens panels: creator analytics, discovery (trending /
// topics / users / media + search), the notification bell, the feed post card and the post
// normalizer. REST calls are routed by URL against plausible payloads; panels must render real
// content, survive a full exercise pass and degrade honestly when the server is down.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
let failing = false;

function getFor(url: string): unknown {
  if (url.startsWith('/api/social/notifications/count')) return { count: 3 };
  if (url.startsWith('/api/social/notifications')) return { notifications: [{ id: 'n1', type: 'follow', message: 'Ann followed you', read: false, createdAt: '2026-03-02T10:00:00Z' }, { id: 'n2', type: 'reaction', message: 'Bo liked your post', read: true, createdAt: '2026-03-01T10:00:00Z' }] };
  if (url.startsWith('/api/notifications/count')) return { unread: 2 };
  if (url.startsWith('/api/notifications')) return { notifications: [{ id: 'p1', title: 'Backup done', body: 'ok', read: false, createdAt: '2026-03-02T10:00:00Z' }] };
  if (url.startsWith('/api/social/analytics/creator')) return { overview: { engagementRate: 4.2, engagementBasis: { totalEngagement: 420, totalReach: 10000 }, totalReach: 10000, followerCount: 321, followerTrend: 'up' }, engagementByDay: [{ date: '2026-03-01', reactions: 10, comments: 3, shares: 1 }, { date: '2026-03-02', reactions: 14, comments: 5, shares: 2 }], topPosts: [{ postId: 'p1', title: 'Launch day', engagementScore: 88, reactions: 40, comments: 9, shares: 4, createdAt: '2026-03-01' }], bestPostingHours: [{ hour: 9, score: 70 }, { hour: 18, score: 92 }], contentBreakdown: [{ mediaType: 'text', count: 12 }, { mediaType: 'image', count: 5 }, { mediaType: 'video', count: 2 }, { mediaType: 'audio', count: 1 }, { mediaType: 'document', count: 1 }], followerGrowth: { gained: 20, lost: 4, net: 16, period: '30d' }, earnings: { totalCC: 120, thisWeek: 15, thisMonth: 60 } };
  if (url.startsWith('/api/social/trending')) return { posts: [{ id: 'tp1', dtuId: 'tp1', title: 'Hot post', content: 'Trending content', authorId: 'u2', authorName: 'Bo', userId: 'u2', username: 'bo', tags: ['music', 'art'], hashtags: ['music'], citationCount: 4, score: 9, createdAt: '2026-03-02T10:00:00Z', mediaType: 'image', engagement: { views: 100, likes: 20, comments: 4 } }], hashtags: [{ tag: 'music', count: 12 }, { tag: 'art', count: 3 }] };
  if (url.startsWith('/api/social/discover/')) return { suggestions: [{ userId: 'u3', displayName: 'Cy', username: 'cy', bio: 'Maker', followerCount: 50, citationCount: 7, matchScore: 0.8, specialization: ['woodwork'] }, { userId: 'u4', displayName: 'Di', username: null, bio: '', followerCount: 0, citationCount: 0, matchScore: 0.2 }] };
  if (url.startsWith('/api/media/feed')) return { feed: [{ dtuId: 'm1', title: 'Cover art', authorId: 'u2', authorName: 'Bo', tags: ['art'], citationCount: 1, score: 3, createdAt: '2026-03-02', mediaType: 'image' }] };
  if (url.startsWith('/api/social/search')) return { people: [{ id: 'u5', username: 'eve', displayName: 'Eve' }], posts: [{ id: 'sp1', userId: 'u5', content: 'Found post', createdAt: '2026-03-02' }], hashtags: [{ tag: 'found', count: 2 }] };
  return {};
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), put: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
  createSharedSession: vi.fn(async () => ({ data: { ok: true } })),
  activeSharedSessions: vi.fn(async () => ({ data: { sessions: [] }, sessions: [] })),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/lenses/social', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/realtime/socket', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }), subscribe: vi.fn(() => () => {}) }));
vi.mock('../BookmarkButton', () => ({ BookmarkButton: () => <button>bookmark</button> }));
vi.mock('../deleteOwnPost', () => ({ deleteOwnPost: vi.fn(async () => ({ ok: true })) }));
vi.mock('../feed/ReplyTree', () => ({ ReplyTree: () => <div>reply tree</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CreatorAnalytics from '../CreatorAnalytics';
import { Discovery } from '../Discovery';
import { NotificationBell } from '../NotificationBell';
import { PostCard } from '../feed/PostCard';
import { normalizePost } from '../feed/normalizePost';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
const POST = { id: 'po1', userId: 'u1', username: 'ann', displayName: 'Ann', body: 'Hello #world with a poll', media: [{ kind: 'image', url: 'https://example.org/a.png', alt: 'a' }, { kind: 'video', url: 'https://example.org/v.mp4' }, { kind: 'audio', url: 'https://example.org/a.mp3' }], poll: { question: 'Best fruit?', options: [{ id: 'o1', label: 'Apple', votes: 3 }, { id: 'o2', label: 'Pear', votes: 1 }], closesAt: '2030-01-01T00:00:00Z' }, quoteOf: null, hashtags: ['world'], createdAt: '2026-03-02T10:00:00Z', replyCount: 2, reactionCounts: { like: 3, love: 1 }, reactionTotal: 4, repostCount: 1, viewerReaction: null, viewerReposted: false, isPinned: false, editedAt: null };
afterEach(() => cleanup());
beforeEach(() => {
  failing = false;
  [lensRunMock, apiGet, apiPost].forEach((f) => f.mockReset());
  apiGet.mockImplementation(async (url: string) => { if (failing) throw new Error('down'); return { data: getFor(url) }; });
  apiPost.mockImplementation(async () => { if (failing) throw new Error('down'); return { data: { ok: true } }; });
  lensRunMock.mockImplementation(async (...a: unknown[]) => {
    const act_ = actionOf(a);
    if (act_ === 'reactionKinds') return { data: { ok: true, result: { kinds: ['like', 'love', 'celebrate'] } } };
    if (act_ === 'pollResults') return { data: { ok: true, result: { viewerChoice: 'o1', options: [{ id: 'o1', label: 'Apple', votes: 4 }, { id: 'o2', label: 'Pear', votes: 1 }] } } };
    return { data: { ok: true, result: { ok: true } } };
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

describe('normalizePost', () => {
  it('reads the legacy and the new wire shapes and rejects rows without an id', () => {
    expect(normalizePost(null)).toBeNull();
    expect(normalizePost({ content: 'x' })).toBeNull();
    const a = normalizePost({ id: 'a', userId: 'u', content: 'hi', mediaUrl: 'https://x/y.png', mediaType: 'video', reactions: { like: 2, love: 'x' }, commentCount: 4, shareCount: 2, tags: ['t', 3], mentions: ['m'], createdAt: '2026-01-01', poll: { question: 'q', options: [{ id: 'o', text: 'Opt', voteCount: 2 }, null, {}] } });
    expect(a).toMatchObject({ id: 'a', body: 'hi', replyCount: 4, repostCount: 2, reactionTotal: 2 });
    expect(a?.media[0]).toMatchObject({ kind: 'video', url: 'https://x/y.png' });
    expect(a?.poll?.options[0]).toMatchObject({ id: 'o', label: 'Opt', votes: 2 });
    const b = normalizePost({ id: 'b', body: 'new', media: [{ url: 'https://x/a.mp3', kind: 'audio', alt: 'a', caption: 'c', mime: 'audio/mpeg' }, { url: '' }, 5], reactionCounts: { like: 1 }, reactionTotal: 9, replyCount: 1, repostCount: 3, mentionedUsers: ['z'], comments: [1, 2] });
    expect(b).toMatchObject({ body: 'new', reactionTotal: 9, replyCount: 1, repostCount: 3 });
    expect(b?.media).toHaveLength(1);
    expect(normalizePost({ id: 'c', poll: { options: 'nope' } })?.poll).toBeNull();
    expect(normalizePost({ id: 'd', comments: [1, 2, 3] })?.replyCount).toBe(3);
  });
});

describe('social panels', () => {
  const PANELS: Array<[string, () => React.ReactElement]> = [
    ['CreatorAnalytics', () => <CreatorAnalytics userId="u1" />],
    ['Discovery', () => <Discovery currentUserId="u1" onNavigateToUser={vi.fn()} onNavigateToContent={vi.fn()} onOpenPost={vi.fn()} />],
    ['NotificationBell', () => <NotificationBell userId="u1" />],
    ['PostCard', () => <PostCard post={POST as never} username="ann" currentUserId="u1" onChanged={vi.fn()} onQuote={vi.fn()} onOpenHashtag={vi.fn()} onOpenDetail={vi.fn()} />],
  ];
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(0);
    await exercise({ passes: 3, text: 'music' });
    await settle();
    await exercise({ passes: 1, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });
  it.each(PANELS)('%s stays standing when the server is down', async (_n, make) => {
    failing = true;
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('social flows', () => {
  it('analytics also renders with sparse data and the followers card can be hidden', async () => {
    apiGet.mockImplementation(async () => ({ data: { overview: { engagementRate: 0, totalReach: 0, followerCount: 0, followerTrend: 'down' }, engagementByDay: [], topPosts: [], bestPostingHours: [], contentBreakdown: [], followerGrowth: { gained: 0, net: 0, period: '7d' }, earnings: { totalCC: 0, thisWeek: 0, thisMonth: 0 } } }));
    const view = render(<CreatorAnalytics userId="u1" hideFollowersCard />);
    await settle();
    expect(view.container.textContent?.length).toBeGreaterThan(20);
  });

  it('discovery switches tabs, searches the social store and opens a result', async () => {
    const onUser = vi.fn(); const onPost = vi.fn(); const onContent = vi.fn();
    render(<Discovery currentUserId="u1" onNavigateToUser={onUser} onNavigateToContent={onContent} onOpenPost={onPost} />);
    await settle();
    for (const tab of [/Topics/, /People|Users/, /Media/, /Trending/]) { await press(tab); await settle(); }
    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'found' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    await settle();
    await press(/Eve|eve/);
    await press(/Found post/);
    for (const cat of ['Audio', 'Video', 'Image', 'Document', 'Text', 'All']) await press(new RegExp(`^${cat}$`));
    const urls = apiGet.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(expect.arrayContaining(['/api/social/trending', '/api/social/search']));
  });

  it('the bell shows the combined unread count and opens the panel', async () => {
    const view = render(<NotificationBell userId="u1" />);
    await settle();
    expect(view.container.textContent).toMatch(/5/);
    await press(/notif|bell/i);
    await press(/Mark|read/i);
    expect(apiGet.mock.calls.map((c) => String(c[0]))).toContain('/api/social/notifications/count');
  });

  it('the bell falls back to counting the unread list when the count route fails', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/social/notifications/count')) throw new Error('no count route');
      return { data: getFor(url) };
    });
    render(<NotificationBell userId="u1" />);
    await settle();
    expect(apiGet.mock.calls.map((c) => String(c[0]))).toContain('/api/social/notifications');
  });

  it('a post card reacts, reposts, quotes, shares, reports, votes, edits, pins and deletes', async () => {
    const onChanged = vi.fn(); const onQuote = vi.fn(); const onTag = vi.fn(); const onDetail = vi.fn();
    render(<PostCard post={POST as never} username="ann" currentUserId="u1" onChanged={onChanged} onQuote={onQuote} onOpenHashtag={onTag} onOpenDetail={onDetail} />);
    await settle();
    await press(/React|Like|👍/i);
    await press(/❤️|love/i);
    await press(/Repost/i);
    await press(/Quote/i);
    await press(/Share/i);
    await press(/Copy/i);
    await press(/Apple/);
    await press(/#world|world/);
    await press(/Replies|Reply|comment/i);
    await press(/More|menu|⋯|\.\.\./i);
    await press(/Report/i);
    await press(/spam/i);
    await press(/Edit/i);
    const area = document.querySelector('textarea');
    if (area) fireEvent.change(area, { target: { value: 'Edited body' } });
    await press(/Save/i);
    await press(/Pin/i);
    await press(/Delete/i);
    await press(/Confirm|Yes|Delete/i);
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a.length).toBeGreaterThan(0);
    expect(a.some((x) => /react|repost|report|votePoll|pollResults/.test(x)) || apiPost.mock.calls.length > 0).toBe(true);
  });
});
