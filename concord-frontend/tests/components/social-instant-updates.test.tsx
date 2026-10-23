/**
 * Social instant feed (job oc-social-2) — posts and deletes show up with no
 * reload, in every place the five-place IA shows them.
 *
 * Verified against main before the fix (run this file on 4fc08b839):
 *  - For You: the composer invalidated ['feed-for-you'], a key no component
 *    declares. RankedFeed reads ['social-for-you', userId] → new posts only
 *    appeared via the 30 s poll. (test 2 failed)
 *  - You > Posts: ['user-content', userId, tab] was never invalidated and
 *    the app default staleTime is 60 s → a warm You > Posts list kept showing
 *    without the new post / kept deleted posts for up to a minute.
 *    (tests 3, 4 failed)
 *  - The profile showed no post count at all; the server's real `total` from
 *    GET /api/social/posts/user/:id was never surfaced.
 *  - Home feeds after a delete from You > Posts: only
 *    ['user-content', userId] was invalidated; the Following timeline
 *    (explicit 30 s staleTime) and For You kept the deleted row. (test 4 failed)
 *
 * What already worked on main and is pinned here as regression tests:
 *  - Posting refreshes the Following timeline (composer invalidates
 *    ['social-following-activity'], which prefix-matches the real key).
 *    Since oc-social-3afix the viewer's OWN new post renders at the top
 *    immediately — never behind the "Show N new posts" cursor, which
 *    stays for OTHER people's new posts (tests 1, 8, 9).
 *  - A row is removed only after the server confirms the delete; a failed
 *    delete keeps the row and toasts the server's error. (#1452 behaviour,
 *    test 6)
 *
 * Harness: the real page (FollowingTimeline is page-internal) with the real
 * QuickPostComposer, RankedFeed, UserProfile and OwnPostDelete. Only the HTTP
 * layer (@/lib/api/client), next/navigation, jsdom-hostile leaves
 * (RoomStage WebRTC, ReelsFeed, RoomList), LensShell/DepthBadge chrome and
 * framer-motion's DOM passthrough are mocked — the components under test are
 * real. The api mock is a stateful in-memory social server: POST /post and
 * DELETE /post/:id actually mutate the store the GETs read, so a list only
 * updates when the app really refetches — no polling can rescue a missed
 * invalidation inside the test's lifetime (30 s intervals never fire).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// The page reads the active place from ?view= and drives it through
// router.replace(). Mirror Next's contract closely enough that clicking a
// nav button actually re-renders the page onto the new place: replace()
// updates the URL state and notifies useSearchParams subscribers via
// useSyncExternalStore (with a cached snapshot, as React requires).
const urlState = vi.hoisted(() => ({
  view: '',
  listeners: new Set<() => void>(),
  snapshot: null as URLSearchParams | null,
  replace(url: string) {
    const m = /[?&]view=([^&]+)/.exec(String(url));
    this.view = m ? m[1] : '';
    this.snapshot = null;
    this.listeners.forEach((l) => l());
  },
  getParams() {
    if (!this.snapshot) {
      this.snapshot = new URLSearchParams(this.view ? `view=${this.view}` : '');
    }
    return this.snapshot;
  },
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({
      push: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
      replace: (url: string) => urlState.replace(url),
    }),
    usePathname: () => '/lenses/social',
    useSearchParams: () =>
      useSyncExternalStore(
        (cb: () => void) => {
          urlState.listeners.add(cb);
          return () => { urlState.listeners.delete(cb); };
        },
        () => urlState.getParams(),
      ),
  };
});

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
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/audio-rooms/RoomStage', () => ({ default: () => null }));
vi.mock('@/components/reels/ReelsFeed', () => ({ ReelsFeed: () => React.createElement('div', null, 'Reels') }));
vi.mock('@/components/audio-rooms/RoomList', () => ({
  RoomList: () => React.createElement('div', null, 'Rooms'),
}));
vi.mock('framer-motion', () => {
  // Faithful DOM passthrough: keep props (className etc.) so tests can
  // traverse the same markup the real renderer produces.
  const passthrough = (tag: string) => {
    const Comp = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
      React.createElement(tag, { ...props, ref }, props.children as React.ReactNode));
    Comp.displayName = `Motion${tag}`;
    return Comp;
  };
  return {
    useReducedMotion: () => false,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    motion: { div: passthrough('div'), button: passthrough('button'), span: passthrough('span'), li: passthrough('li') },
  };
});

// In-memory social server. The GETs read what POST/DELETE mutate, so any list
// that updates in a test does so because the app refetched — never because
// the mock invented data.
const srv = vi.hoisted(() => ({
  posts: [] as Array<{ id: string; userId: string; username: string; content: string; createdAt: string }>,
  seq: 0,
  failNextDelete: false,
  add(content: string, who?: { userId: string; username: string }) {
    this.seq += 1;
    const post = {
      id: `p${this.seq}`,
      userId: who?.userId ?? 'u1', // the signed-in viewer by default
      username: who?.username ?? 'ana',
      content,
      createdAt: new Date().toISOString(),
    };
    this.posts.unshift(post); // newest first, like the real feed sorts
    return post;
  },
  reset() {
    this.posts.length = 0;
    this.seq = 0;
    this.failNextDelete = false;
  },
}));

const PROFILE = {
  userId: 'u1',
  username: 'ana',
  displayName: 'Ana',
  bio: '',
  avatar: '',
  isPublic: true,
  specialization: [],
  website: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  // 7/8 so stat values never collide with the post counts (1..3) in assertions
  stats: { followerCount: 7, followingCount: 8, dtuCount: 0, publicDtuCount: 0, citationCount: 0 },
};

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      const u = String(url);
      // Every response is a fresh copy, like real JSON over the wire —
      // react-query's structural sharing must never be able to suppress a
      // re-render just because the mock handed back the same array it
      // mutated.
      if (u === '/api/auth/me') return { data: { ok: true, user: { id: 'u1', username: 'ana', displayName: 'Ana' } } };
      if (u.includes('/api/social/feed/following')) return { data: { ok: true, posts: srv.posts.slice() } };
      if (u.includes('/api/social/feed/for-you')) {
        return { data: { ok: true, posts: srv.posts.map((p) => ({ ...p, why: ['Recent'] })) } };
      }
      if (u.includes('/api/social/posts/user/')) {
        return { data: { ok: true, posts: srv.posts.slice(), total: srv.posts.length } };
      }
      if (u.includes('/api/social/profile/')) return { data: { ok: true, profile: PROFILE } };
      if (u === '/api/social/notifications/count') return { data: { count: 0 } };
      if (u.includes('/api/presence/active')) return { data: { users: [] } };
      return { data: { ok: true, notifications: [], stories: [], topics: [], users: [] } };
    }),
    post: vi.fn(async (url: string, body: Record<string, unknown>) => {
      if (url === '/api/social/post') {
        const content = String((body as { content?: unknown })?.content || '');
        if (!content) return { data: { ok: false, error: 'content required' } };
        const post = srv.add(content);
        return { data: { ok: true, post: { id: post.id } } };
      }
      return { data: { ok: true } };
    }),
    delete: vi.fn(async (url: string) => {
      const id = /\/api\/social\/post\/(.+)$/.exec(String(url))?.[1] || '';
      if (srv.failNextDelete) {
        srv.failNextDelete = false;
        return { data: { ok: false, error: 'Post not found' } };
      }
      const i = srv.posts.findIndex((p) => p.id === id);
      if (i === -1) return { data: { ok: false, error: 'Post not found' } };
      srv.posts.splice(i, 1);
      return { data: { ok: true, postId: id } };
    }),
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

import SocialHubPage from '@/app/lenses/social/page';
import { useUIStore } from '@/store/ui';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function getCalls(method: 'get' | 'post' | 'delete', urlPart: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mockedApi[method] as any).mock.calls.filter((c: unknown[]) => String(c[0]).includes(urlPart));
}

function renderPage(view = '') {
  urlState.view = view;
  urlState.snapshot = null;
  urlState.listeners.clear();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SocialHubPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

/**
 * The page first renders with an empty currentUserId (the /api/auth/me query
 * is still in flight) and mounts the feeds against the ''-keyed queries; when
 * `me` resolves those subtrees re-render under the real user id. Waiting for
 * the composer (or profile content) means `me` has settled and the found
 * nodes belong to the settled tree.
 */
async function settleHome() {
  await screen.findByLabelText('Post text');
}

async function goPlace(label: 'Home' | 'You') {
  fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^${label}$`) })[0]);
  await waitFor(() => {
    const current = screen.getAllByRole('button', { name: new RegExp(`^${label}$`) })[0];
    expect(current.getAttribute('aria-current')).toBe('page');
  });
}

async function postFromComposer(text: string) {
  const box = await screen.findByLabelText('Post text');
  fireEvent.change(box, { target: { value: text } });
  const form = box.closest('form') as HTMLElement;
  fireEvent.submit(form);
  await waitFor(() => {
    expect(getCalls('post', '/api/social/post').length).toBeGreaterThan(0);
  });
  await waitFor(() => expect(box.value).toBe('')); // server accepted the post
}

/** The profile stats grid in You > Posts. */
function statsGrid() {
  return screen.getByTestId('profile-stats');
}

/** A You > Posts content card containing the given text. */
function profileRow(text: string) {
  return screen.getByText(text).closest('div[class*="rounded-xl"]') as HTMLElement;
}

async function deleteRow(row: HTMLElement) {
  fireEvent.click(within(row).getByRole('button', { name: 'Delete post' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
}

describe('social instant feed — posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    srv.reset();
    localStorage.clear();
    urlState.view = '';
    urlState.snapshot = null;
    urlState.listeners.clear();
    useUIStore.setState({ toasts: [] });
  });

  it('1. your own new post appears at the top of Home immediately — never behind the "Show N new posts" button', async () => {
    // oc-social-3afix item 5: the timeline\u2019s seen-head cursor used to
    // buffer the viewer\u2019s OWN just-published post behind the button, so
    // Home showed "Show 1 new post" for your own post. Own posts now
    // render immediately; the button stays for OTHER people\u2019s posts
    // (pinned by tests 8 and 9 below).
    const seed = srv.add('seed own post');
    renderPage();
    await settleHome();
    expect(await screen.findByText('seed own post')).toBeInTheDocument();
    const fetchesBefore = getCalls('get', '/api/social/feed/following').length;

    await postFromComposer('hello instant world');

    // The timeline refetches immediately (the composer invalidates the key
    // the timeline actually uses) and your own post is at the top right
    // away — no button, no click needed.
    expect(await screen.findByText('hello instant world')).toBeInTheDocument();
    expect(screen.getByText('seed own post')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show \d+ new posts?/i })).toBeNull();
    expect(getCalls('get', '/api/social/feed/following').length).toBeGreaterThan(fetchesBefore);
    expect(seed.content).toBe('seed own post');
  });

  it('8. another user\u2019s new post still surfaces behind the "Show 1 new post" button (own-post fix kept the no-scroll-yank buffer for others)', async () => {
    srv.add('seed own post');
    const { qc } = renderPage();
    await settleHome();
    expect(await screen.findByText('seed own post')).toBeInTheDocument();

    // Another user\u2019s post arrives (as the 30s poll / socket event
    // would deliver it) — forced refetch via the real query key.
    srv.add('a friend\u2019s fresh take', { userId: 'u2', username: 'bea' });
    await qc.invalidateQueries({ queryKey: ['social-following-activity'] });

    const showNew = await screen.findByRole('button', { name: /Show 1 new post/i });
    fireEvent.click(showNew);
    expect(await screen.findByText('a friend\u2019s fresh take')).toBeInTheDocument();
    expect(screen.getByText('seed own post')).toBeInTheDocument();
  });

  it('9. when your own post and someone else\u2019s arrive together, yours shows immediately and the button counts only theirs', async () => {
    srv.add('seed own post');
    const { qc } = renderPage();
    await settleHome();
    expect(await screen.findByText('seed own post')).toBeInTheDocument();

    srv.add('friend arrived too', { userId: 'u2', username: 'bea' });
    srv.add('mine arrived too', { userId: 'u1', username: 'ana' });
    await qc.invalidateQueries({ queryKey: ['social-following-activity'] });

    // Own post is visible immediately (never buffered)…
    expect(await screen.findByText('mine arrived too')).toBeInTheDocument();
    expect(screen.getByText('seed own post')).toBeInTheDocument();
    // …while the friend\u2019s post waits behind a button that counts
    // exactly ONE new post (not two — the viewer\u2019s own is excluded).
    expect(screen.queryByText('friend arrived too')).toBeNull();
    const showNew = screen.getByRole('button', { name: /Show 1 new post/i });
    fireEvent.click(showNew);
    expect(await screen.findByText('friend arrived too')).toBeInTheDocument();
  });

  it('2. a new post appears in the For You feed immediately (the real key is invalidated)', async () => {
    srv.add('seed own post');
    renderPage();
    await settleHome();
    fireEvent.click(await screen.findByRole('tab', { name: 'For You' }));
    expect(await screen.findByText('seed own post')).toBeInTheDocument();
    const fetchesBefore = getCalls('get', '/api/social/feed/for-you').length;

    await postFromComposer('instant for you post');

    // No 30 s poll can fire inside the test — the post can only appear if
    // the composer invalidated RankedFeed's real key ['social-for-you', …].
    expect(await screen.findByText('instant for you post')).toBeInTheDocument();
    expect(getCalls('get', '/api/social/feed/for-you').length).toBeGreaterThan(fetchesBefore);
  });

  it('3. a new post appears in You > Posts and the profile post count goes up', async () => {
    srv.add('seed own post');
    renderPage();
    // Warm the You > Posts list first — the real repro: the list was already
    // mounted once, so without invalidation its 60 s staleTime hides the post.
    await goPlace('You');
    expect(await screen.findByText('seed own post')).toBeInTheDocument();
    expect(within(statsGrid()).getByText('Posts')).toBeInTheDocument();
    await waitFor(() => expect(within(statsGrid()).getByText('1')).toBeInTheDocument());

    await goPlace('Home');
    await postFromComposer('instant own list post');

    await goPlace('You');
    expect(await screen.findByText('instant own list post')).toBeInTheDocument();
    expect(screen.getByText('seed own post')).toBeInTheDocument();
    await waitFor(() => expect(within(statsGrid()).getByText('2')).toBeInTheDocument());
  });
});

describe('social instant feed — deleting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    srv.reset();
    localStorage.clear();
    urlState.view = '';
    urlState.snapshot = null;
    urlState.listeners.clear();
    useUIStore.setState({ toasts: [] });
  });

  it('4. deleting from You > Posts removes the row, drops the count, and clears both home feeds', async () => {
    const alpha = srv.add('alpha seeded post');
    const beta = srv.add('beta seeded post');
    renderPage();
    await settleHome();
    // Mount both home feeds first so their caches are warm and fresh — the
    // only way a deleted row can vanish from them is a real invalidation.
    expect(await screen.findByText('alpha seeded post')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'For You' }));
    expect(await screen.findByText('beta seeded post')).toBeInTheDocument();

    await goPlace('You');
    expect(await screen.findByText('alpha seeded post')).toBeInTheDocument();
    await waitFor(() => expect(within(statsGrid()).getByText('2')).toBeInTheDocument());

    await deleteRow(profileRow('alpha seeded post'));
    await waitFor(() => {
      expect(getCalls('delete', `/api/social/post/${alpha.id}`).length).toBe(1);
    });

    // Row gone from You > Posts, other row kept, count dropped — no reload.
    await waitFor(() => expect(screen.queryByText('alpha seeded post')).not.toBeInTheDocument());
    expect(screen.getByText('beta seeded post')).toBeInTheDocument();
    await waitFor(() => expect(within(statsGrid()).getByText('1')).toBeInTheDocument());

    // Both home feeds drop the deleted row when revisited.
    await goPlace('Home');
    // homeFeed state persisted as 'forYou' from the earlier tab click.
    await waitFor(() => expect(screen.queryByText('alpha seeded post')).not.toBeInTheDocument());
    expect(screen.getByText('beta seeded post')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Following' }));
    await waitFor(() => expect(screen.queryByText('alpha seeded post')).not.toBeInTheDocument());
    expect(screen.getByText('beta seeded post')).toBeInTheDocument();
    expect(beta.content).toBe('beta seeded post');
  });

  it('5. deleting several posts in a row: both hit the server, both rows disappear', async () => {
    const alpha = srv.add('alpha seeded post');
    const beta = srv.add('beta seeded post');
    srv.add('gamma seeded post');
    renderPage('you');
    expect(await screen.findByText('alpha seeded post')).toBeInTheDocument();
    expect(screen.getByText('beta seeded post')).toBeInTheDocument();
    expect(screen.getByText('gamma seeded post')).toBeInTheDocument();

    await deleteRow(profileRow('alpha seeded post'));
    await waitFor(() => expect(screen.queryByText('alpha seeded post')).not.toBeInTheDocument());

    await deleteRow(profileRow('beta seeded post'));
    await waitFor(() => expect(screen.queryByText('beta seeded post')).not.toBeInTheDocument());

    // Both deletes really reached the server, with the right ids.
    expect(getCalls('delete', `/api/social/post/${alpha.id}`).length).toBe(1);
    expect(getCalls('delete', `/api/social/post/${beta.id}`).length).toBe(1);
    expect(screen.getByText('gamma seeded post')).toBeInTheDocument();
    await waitFor(() => expect(within(statsGrid()).getByText('1')).toBeInTheDocument());
  });

  it('6. a failed delete keeps the row, toasts the server error, and can be retried (#1452 behaviour)', async () => {
    srv.add('kept seeded post');
    renderPage('you');
    expect(await screen.findByText('kept seeded post')).toBeInTheDocument();

    srv.failNextDelete = true;
    const row = profileRow('kept seeded post');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete post' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => {
      expect(useUIStore.getState().toasts.some((t) => t.type === 'error' && /Post not found/.test(t.message))).toBe(true);
    });
    // Row survives a server refusal — never removed on failure.
    expect(screen.getByText('kept seeded post')).toBeInTheDocument();
    // The control resets to the two-step confirm flow, not a stuck flag.
    expect(within(profileRow('kept seeded post')).getByRole('button', { name: 'Delete post' })).toBeInTheDocument();

    // Retrying after the failure succeeds and removes the row.
    await deleteRow(profileRow('kept seeded post'));
    await waitFor(() => expect(screen.queryByText('kept seeded post')).not.toBeInTheDocument());
    expect(getCalls('delete', '/api/social/post/').length).toBe(2);
  });

  it('7. deleting from the Following timeline removes the row immediately after the server confirms', async () => {
    srv.add('timeline own post');
    renderPage();
    await settleHome();
    expect(await screen.findByText('timeline own post')).toBeInTheDocument();
    const item = screen.getByText('timeline own post').closest('li') as HTMLElement;
    await deleteRow(item);
    await waitFor(() => expect(getCalls('delete', '/api/social/post/').length).toBe(1));
    await waitFor(() => expect(screen.queryByText('timeline own post')).not.toBeInTheDocument());
  });
});