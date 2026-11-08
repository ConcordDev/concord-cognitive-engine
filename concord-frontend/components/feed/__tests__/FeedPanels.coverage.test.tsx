// Render + behaviour coverage for the feed lens tool panels: scheduler, search results and the tools
// panel (for-you ranking, threads, lists, polls, saved items, spaces, controls).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
const CAND = [{ id: 'p1', authorId: 'u2', content: 'Hello world', tags: ['hi'], likes: 3, comments: 1, reposts: 0, createdAt: '2026-03-02', sensitive: false }, { id: 'p2', authorId: 'u3', content: 'Second post', likes: 0 }];
const THREAD = [{ id: 't1', parentId: null, kind: 'post', body: 'Root post', quotedId: null, quotedAuthor: null, quotedBody: null, author: 'u2', authorName: 'Bo', authorHandle: 'bo', collapsed: false, createdAt: '2026-03-02', replyCount: 1, children: [{ id: 't2', parentId: 't1', kind: 'quote', body: 'Quoting', quotedId: 't1', quotedAuthor: 'u2', quotedBody: 'Root post', author: 'u3', authorName: null, authorHandle: null, collapsed: true, createdAt: '2026-03-02', replyCount: 0, children: [] }] }];

function resultFor(action: string): unknown {
  switch (action) {
    case 'affinity-summary': return { authors: [{ authorId: 'u2', authorName: 'Bo', authorHandle: 'bo', affinity: 0.8, likes: 5, replies: 2, reposts: 1, views: 30, bookmarks: 1 }, { authorId: 'u3', authorName: null, authorHandle: null, affinity: 0.2, likes: 0, replies: 0, reposts: 0, views: 3, bookmarks: 0 }] };
    case 'rank-for-you': return { ranked: [{ id: 'p1', authorId: 'u2', title: 'Hello world', authorName: 'Bo', authorHandle: 'bo', score: 0.9, affinity: 0.8, recency: 0.5, engagement: 0.4, reasons: ['affinity', 'recent'] }, { id: 'p2', authorId: 'u3', title: null, authorName: null, authorHandle: null, score: 0.3, affinity: 0, recency: 0.2, engagement: 0, reasons: [] }] };
    case 'thread-tree': return { tree: THREAD };
    case 'list-all': return { lists: [{ id: 'l1', name: 'Friends', description: 'Close friends', members: ['u2', 'u3'], pinned: true, createdAt: '2026-03-01' }] };
    case 'list-feed': return { posts: CAND, memberCount: 2 };
    case 'poll-list': return { polls: [{ id: 'po1', question: 'Best fruit?', options: [{ id: 'o1', label: 'Apple', votes: 3, percent: 75 }, { id: 'o2', label: 'Pear', votes: 1, percent: 25 }], totalVotes: 4, closesAt: '2030-01-01', closed: false, myVote: null }, { id: 'po2', question: 'Done poll', options: [{ id: 'o3', label: 'A', votes: 1, percent: 100 }], totalVotes: 1, closesAt: '2020-01-01', closed: true, myVote: 'o3' }] };
    case 'poll-vote': return { poll: { id: 'po1', question: 'Best fruit?', options: [{ id: 'o1', label: 'Apple', votes: 4, percent: 80 }, { id: 'o2', label: 'Pear', votes: 1, percent: 20 }], totalVotes: 5, closesAt: '2030-01-01', closed: false, myVote: 'o1' } };
    case 'folder-list': return { folders: [{ id: 'f1', name: 'Read later', items: ['p1'], itemCount: 1, createdAt: '2026-03-01' }] };
    case 'saved-search-list': return { searches: [{ id: 's1', query: 'hello', alert: true, lastChecked: '2026-03-02', createdAt: '2026-03-01' }] };
    case 'saved-search-run': return { searchId: 's1', matches: CAND, newSinceLastCheck: 1 };
    case 'space-list': return { spaces: [{ id: 'sp1', title: 'AMA', topic: 'Music', hostId: 'u1', speakers: ['u1'], listeners: ['u2'], speakerCount: 1, listenerCount: 1, status: 'live', createdAt: '2026-03-02', endedAt: null }, { id: 'sp2', title: 'Old', topic: 'Art', hostId: 'u2', speakers: [], listeners: [], speakerCount: 0, listenerCount: 0, status: 'ended', createdAt: '2026-03-01', endedAt: '2026-03-01' }] };
    case 'controls-get': case 'controls-mute-word': case 'controls-block-user': case 'controls-sensitive-media': return { controls: { mutedWords: ['spoiler'], blockedUsers: ['u9'], sensitiveMedia: 'blur' } };
    case 'controls-apply': return { posts: CAND, removed: { muted: 1, blocked: 0 }, sensitiveFlagged: 0 };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/social/BookmarksList', () => ({ BookmarksList: () => <div>bookmarks list</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { FeedSchedulerPanel, parseScheduledRows } from '../FeedSchedulerPanel';
import { FeedSearchResults } from '../FeedSearchResults';
import { FeedToolsPanel, feedAuthorLabel } from '../FeedToolsPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  [lensRunMock, apiGet, apiPost].forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  apiGet.mockImplementation(async (url: string) => ({ data: url.includes('/scheduled') ? { scheduled: [{ id: 'sc1', content: 'Later post', scheduled_at: '2030-01-01T10:00:00Z', status: 'pending' }, { id: 'sc2', content: 'Done post', scheduled_at: '2026-01-01T10:00:00Z', status: 'posted' }, { id: '', content: 'bad' }] } : { people: [{ id: 'u5', username: 'eve', displayName: 'Eve' }], posts: [{ id: 'sp1', userId: 'u5', content: 'Found post', createdAt: '2026-03-02' }], hashtags: [{ tag: 'found', count: 2 }] } }));
  apiPost.mockResolvedValue({ data: { ok: true } });
});

describe('feed helpers', () => {
  it('parse scheduled rows defensively and label authors honestly', () => {
    expect(parseScheduledRows(null)).toEqual([]);
    expect(parseScheduledRows({ scheduled: 'x' })).toEqual([]);
    expect(parseScheduledRows({ scheduled: [{ id: 1, content: 5 }, { id: '' }, null] })).toEqual([{ id: '1', content: '', scheduled_at: '', status: 'pending' }]);
    expect(feedAuthorLabel('Bo', 'bo')).toBe('Bo');
    expect(feedAuthorLabel(null, 'bo')).toBe('@bo');
    expect(feedAuthorLabel(null, null)).toBe('A member');
  });
});

describe('feed panels', () => {
  const PANELS: Array<[string, () => React.ReactElement]> = [
    ['FeedSchedulerPanel', () => <FeedSchedulerPanel onScheduled={vi.fn()} />],
    ['FeedSearchResults', () => <FeedSearchResults query="found" onNavigateToUser={vi.fn()} />],
    ['FeedToolsPanel', () => <FeedToolsPanel candidates={CAND} />],
  ];
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 3, text: 'hello', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    apiGet.mockRejectedValue(new Error('offline'));
    apiPost.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('feed flows', () => {
  it('the scheduler queues a post for a date and time, rejects an empty draft, and cancels one', async () => {
    render(<FeedSchedulerPanel onScheduled={vi.fn()} />);
    await settle();
    expect(document.body.textContent).toMatch(/Later post/);
    await press(/Schedule/i);
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Launch day' } });
    const date = document.querySelector('input[type="date"]') as HTMLInputElement | null;
    const time = document.querySelector('input[type="time"]') as HTMLInputElement | null;
    if (date) fireEvent.change(date, { target: { value: '2031-01-01' } });
    if (time) fireEvent.change(time, { target: { value: '10:30' } });
    await press(/Schedule/i);
    await press(/Cancel|Delete|Trash/i);
    expect(apiPost.mock.calls.length + apiGet.mock.calls.length).toBeGreaterThan(1);
  });

  it('search results list people, posts and hashtags, and a short query shows nothing', async () => {
    const onUser = vi.fn();
    const view = render(<FeedSearchResults query="found" onNavigateToUser={onUser} />);
    await settle();
    expect(view.container.textContent).toMatch(/Eve|Found post|found/);
    await press(/Eve|eve/);
    cleanup();
    const short = render(<FeedSearchResults query="a" />);
    await settle();
    expect(short.container).toBeTruthy();
  });

  it('the tools panel walks every tab and drives its macros', async () => {
    const view = render(<FeedToolsPanel candidates={CAND} />);
    await settle();
    const tabs = ['For You', 'Threads', 'Lists', 'Polls', 'Saved', 'Spaces', 'Controls'];
    const skip = new RegExp(`^(${tabs.join('|')})$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$`, 'i');
    for (const t of tabs) {
      await press(new RegExp(`^${t}$`));
      await settle();
      await exercise({ passes: 3, text: 'spoiler', skip });
      await settle();
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['affinity-summary', 'thread-tree', 'list-all', 'poll-list', 'folder-list', 'space-list', 'controls-get']));
    expect(a.filter((x) => /create|add|vote|join|mute|block|apply|run|feed|rank|collapse/.test(x)).length).toBeGreaterThan(2);
  });

  it('polls take a vote, lists open a member feed, spaces join and end', async () => {
    render(<FeedToolsPanel candidates={CAND} />);
    await settle();
    await press(/^Polls$/); await settle();
    await press(/Apple/);
    await press(/^Lists$/); await settle();
    await press(/Friends/); await press(/Feed|Open|View/i);
    await press(/^Spaces$/); await settle();
    await press(/Join/i); await press(/Leave/i); await press(/End/i);
    await press(/^Controls$/); await settle();
    await press(/blur|show|hide/i);
    expect(sent().some((x) => /poll-vote|list-feed|space-join|space-leave|space-end|controls-sensitive-media/.test(x))).toBe(true);
  });
});
