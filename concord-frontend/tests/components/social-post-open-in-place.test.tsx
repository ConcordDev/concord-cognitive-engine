/**
 * oc-social-4 — JOB 7: posts open in place + scroll reveal.
 *
 * Covers the spec:
 *  - tapping (click) or Enter-focusing a post in the Social feeds
 *    (Following, For You, Explore trending, profile posts) opens its
 *    detail view IN PLACE, with the URL updated (?post=<id>) so it is
 *    shareable and a reload re-opens it directly;
 *  - Back (browser history), Escape, and the visible close control all
 *    close it, restoring the feed's exact scroll position WITHOUT
 *    refetching/resetting the feed;
 *  - document.startViewTransition drives the morph when available and is
 *    skipped under reduced motion;
 *  - a post the viewer cannot see shows the existing not-found state
 *    (privacy is enforced server-side by the social.postDetail macro —
 *    mocked here exactly as the server answers).
 *
 * Only the HTTP layer (@/lib/api/client) and next/navigation are mocked.
 *
 * Test-env note: like production, /api/auth/me is async on the client,
 * so the hub first renders with the anonymous 'current-user' id and
 * every user-scoped feed (Following, For You, profile) remounts ONCE
 * when the real id lands (new react-query key). Interactions therefore
 * wait for the settled node — stableButton() — which is what a real
 * user taps.
 */

import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls: Array<{ method: string; url: string }> = [];
const NOW = new Date('2026-10-20T12:00:00Z').toISOString();

const FOLLOWING_POSTS = [
  { id: 'post_a', userId: 'u2', username: 'bea', content: 'First following post', createdAt: NOW, kind: 'post' },
  { id: 'post_hidden', userId: 'u3', username: 'kim', content: 'Secret followers-only post', createdAt: NOW, kind: 'post' },
];

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));

// framer-motion resolves prefers-reduced-motion from matchMedia at module
// init, so a per-test window.matchMedia override never reaches it. Mock
// the hook's flag instead (everything else passes through).
const framerReducedMotion = { on: false };
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => framerReducedMotion.on };
});

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      const u = String(url);
      calls.push({ method: 'GET', url: u });
      if (u === '/api/auth/me') return { data: { ok: true, user: { id: 'u1', username: 'ana', role: 'member' } } };
      if (u.includes('/api/social/feed/following')) return { data: { ok: true, posts: FOLLOWING_POSTS } };
      if (u.includes('/api/social/feed/for-you')) {
        return { data: { ok: true, posts: [{ id: 'post_b', userId: 'u2', content: 'Ranked post one', why: ['Recent'] }] } };
      }
      if (u.includes('/api/social/trending')) {
        return {
          data: {
            ok: true,
            posts: [{ id: 'post_c', content: 'Trending post one', tags: ['mix'], createdAt: NOW, trendScore: 5 }],
            hashtags: [],
          },
        };
      }
      if (u.includes('/api/social/notifications/count')) return { data: { count: 0 } };
      if (u.includes('/api/presence/active')) return { data: { users: [] } };
      if (u.includes('/api/social/profile/')) {
        return { data: { ok: true, profile: { userId: 'u1', displayName: 'Ana', bio: '', avatar: '', isPublic: true, specialization: [], website: '', createdAt: NOW, updatedAt: NOW, stats: { dtuCount: 1, publicDtuCount: 1, citationCount: 0, followerCount: 1, followingCount: 1 } } } };
      }
      if (u.includes('/api/social/posts/user/')) {
        return { data: { ok: true, total: 1, posts: [{ id: 'post_d', dtuId: 'post_d', title: 'Profile post one', content: 'Profile post one', authorId: 'u1', authorName: 'ana', tags: [], tier: 'regular', createdAt: NOW, citationCount: 0 }] } };
      }
      if (u.includes('/api/social/welcome-state')) {
        return { data: { ok: true, hasAvatar: true, hasBio: true, hasFirstPost: true, dismissed: true } };
      }
      if (u.includes('/api/social/people-to-follow')) return { data: { ok: true, people: [] } };
      if (u.includes('/api/media/feed')) return { data: { feed: [] } };
      if (u.includes('/api/connective-tissue/search')) return { data: { results: [] } };
      if (u.includes('/api/social/discover/')) return { data: { suggestions: [] } };
      return { data: { ok: true } };
    }),
    post: vi.fn(async (url: string) => {
      calls.push({ method: 'POST', url: String(url) });
      return { data: { ok: true } };
    }),
    delete: vi.fn(async () => ({ data: { ok: true, postId: 'x' } })),
  },
  lensRun: vi.fn(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push({ method: 'MACRO', url: `${domain}.${action}` });
    const postId = String((input as { postId?: unknown }).postId || '');
    if (domain === 'social' && action === 'postDetail') {
      // Exactly how the server answers a post the viewer cannot see
      // (canViewPost refuses: private / followers-only / blocked).
      if (postId === 'post_hidden') return { data: { ok: false, result: null, error: 'post not found' } };
      return {
        data: {
          ok: true,
          result: {
            post: {
              id: postId, userId: 'u2', username: 'bea', displayName: 'Bea',
              body: `DETAIL ${postId}`, media: [], poll: null, quoteOf: null,
              hashtags: [], createdAt: NOW, replyCount: 0, reactionCounts: {},
              reactionTotal: 0, repostCount: 0, viewerReaction: null, viewerReposted: false,
            },
            quoted: null,
            replyTree: [],
            permalink: `/lenses/social/post/${postId}`,
          },
        },
      };
    }
    if (domain === 'social' && action === 'shareTargets') {
      return { data: { ok: true, result: { permalink: `/lenses/social/post/${postId}` } } };
    }
    if (domain === 'social' && action === 'reactionKinds') {
      return { data: { ok: true, result: { kinds: ['like'] } } };
    }
    return { data: { ok: true, result: {} } };
  }),
  createSharedSession: vi.fn(async () => ({})),
  activeSharedSessions: vi.fn(async () => []),
}));

// The page (and useOpenPostInPlace) read the URL state through
// next/navigation — mirror the real contract by deriving the params from
// window.location so the shallow-routed `post` param behaves like
// production across pushState/popstate.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lenses/social',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/social/StoriesBar', () => ({ StoriesBar: () => null }));
vi.mock('@/components/social/QuickPostComposer', () => ({ QuickPostComposer: () => null }));
vi.mock('@/components/social/FindPeople', () => ({ FindPeople: () => null }));
vi.mock('@/components/social/SuggestedFollows', () => ({ SuggestedFollows: () => null }));
vi.mock('@/components/social/SocialLists', () => ({ SocialLists: () => null }));
vi.mock('@/components/social/SocialGroups', () => ({ SocialGroups: () => null }));
vi.mock('@/components/social/feed/DMInbox', () => ({ DMInbox: () => null }));
vi.mock('@/components/social/NotificationCenter', () => ({ NotificationCenter: () => null }));
vi.mock('@/components/social/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/social/StreakIndicator', () => ({ StreakIndicator: () => null }));
vi.mock('@/components/social/DMIndicator', () => ({ DMIndicator: () => null }));
vi.mock('@/components/social/PushEnableButton', () => ({ PushEnableButton: () => null }));
vi.mock('@/components/reels/ReelsFeed', () => ({ ReelsFeed: () => null }));
vi.mock('@/components/audio-rooms/RoomList', () => ({ RoomList: () => null }));
vi.mock('@/components/audio-rooms/RoomStage', () => ({ default: () => null }));

import SocialHubPage from '@/app/lenses/social/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the shared session query (['me'], hooks/use-current-user): in
  // production the session cookie is already resolved when the page
  // loads, so the hub renders with the real user id from the first
  // paint. Seeding the cache reproduces exactly that and avoids the
  // test-only anonymous→u1 remount churn (user-scoped feed queries would
  // otherwise remount their lists once when /api/auth/me lands).
  qc.setQueryData(['me'], {
    ok: true,
    user: { id: 'u1', username: 'ana', displayName: 'Ana', role: 'member' },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SocialHubPage />
    </QueryClientProvider>,
  );
}

function feedGetCount(urlPart: string): number {
  return calls.filter((c) => c.method === 'GET' && c.url.includes(urlPart)).length;
}

/**
 * Wait until the SAME connected node is returned on two consecutive
 * checks, then return it: the settled node a real user would tap.
 */
async function stableButton(name: string | RegExp): Promise<HTMLElement> {
  let prev: HTMLElement | null = null;
  await waitFor(
    () => {
      const cur = screen.getByRole('button', { name }) as HTMLElement;
      if (prev && prev === cur && cur.isConnected) return;
      prev = cur;
      throw new Error(`button ${String(name)} not settled yet`);
    },
    { timeout: 4000 },
  );
  return prev as HTMLElement;
}

async function openFirstFollowingPost(): Promise<HTMLElement> {
  const btn = await stableButton(/Open post — First following post/);
  // A real tap lands focus on the control (jsdom's fireEvent doesn't).
  btn.focus();
  fireEvent.click(btn);
  await screen.findByTestId('social-post-detail-inplace');
  return btn;
}

function stubScrollTo(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  Object.defineProperty(window, 'scrollTo', { writable: true, configurable: true, value: spy });
  return spy;
}

describe('social post opens in place (JOB 7)', () => {
  beforeEach(() => {
    calls.length = 0;
    framerReducedMotion.on = false;
    // Fresh URL per test (jsdom's session history persists across tests).
    window.history.replaceState(null, '', '/');
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Remove a possibly-installed fake View Transitions API.
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it('opens the post detail in place on click, with the URL updated', async () => {
    renderPage();
    await openFirstFollowingPost();

    // The detail body (real postDetail macro) renders in place…
    expect(screen.getByText('DETAIL post_a')).toBeInTheDocument();
    // …the URL carries the shareable post param…
    expect(window.location.search).toContain('post=post_a');
    // …and the feed stays mounted but hidden (no unmount/reset).
    expect(screen.getByText('First following post')).not.toBeVisible();
  });

  it('opens via Enter on the focused post (keyboard)', async () => {
    renderPage();
    const btn = await stableButton(/Open post — First following post/);
    btn.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByTestId('social-post-detail-inplace');
    expect(screen.getByText('DETAIL post_a')).toBeInTheDocument();
    expect(window.location.search).toContain('post=post_a');
  });

  it('the close control (aria-labelled, visible) closes and restores the exact scroll position without refetching the feed', async () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1200);
    const scrollToSpy = stubScrollTo();

    renderPage();
    // Focus the card first — pointer users land focus on the control they
    // tap (jsdom's fireEvent does not auto-focus), so the panel's opener
    // records it and close must hand it back.
    const origin = await openFirstFollowingPost();
    // Everything has settled (stableButton); snapshot the fetch count now.
    const fetchesBefore = feedGetCount('/api/social/feed/following');

    // The visible close control: PostDetail's back control, labelled
    // "Close post" in the in-place panel.
    fireEvent.click(screen.getByRole('button', { name: 'Close post' }));

    await waitFor(() => {
      expect(screen.queryByTestId('social-post-detail-inplace')).not.toBeInTheDocument();
    });
    // Exact scroll restore, feed visible again…
    expect(scrollToSpy).toHaveBeenCalledWith(0, 1200);
    expect(screen.getByText('First following post')).toBeVisible();
    // …and not a single new following-feed fetch — no refetch/reset.
    expect(feedGetCount('/api/social/feed/following')).toBe(fetchesBefore);

    // Focus returned to the originating post control.
    expect(document.activeElement).toBe(origin);
  });

  it('browser Back closes the in-place detail (popstate) and restores scroll', async () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(340);
    const scrollToSpy = stubScrollTo();

    renderPage();
    await openFirstFollowingPost();
    expect(window.location.search).toContain('post=post_a');
    const fetchesBefore = feedGetCount('/api/social/feed/following');

    window.history.back();
    await waitFor(() => {
      expect(screen.queryByTestId('social-post-detail-inplace')).not.toBeInTheDocument();
    });
    await waitFor(() => expect(window.location.search).not.toContain('post='));
    expect(screen.getByText('First following post')).toBeVisible();
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledWith(0, 340));
    expect(feedGetCount('/api/social/feed/following')).toBe(fetchesBefore);
  });

  it('Escape closes the open post', async () => {
    renderPage();
    await openFirstFollowingPost();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('social-post-detail-inplace')).not.toBeInTheDocument();
    });
    await waitFor(() => expect(window.location.search).not.toContain('post='));
    expect(screen.getByText('First following post')).toBeVisible();
  });

  it('a deep link (?post=) opens the post directly, and Escape strips the param without leaving the page', async () => {
    window.history.replaceState(null, '', '/lenses/social?post=post_a');
    renderPage();

    await screen.findByTestId('social-post-detail-inplace');
    expect(screen.getByText('DETAIL post_a')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('social-post-detail-inplace')).not.toBeInTheDocument();
    });
    await waitFor(() => expect(window.location.search).not.toContain('post='));
  });

  it('uses document.startViewTransition when available (morph path)', async () => {
    const startVT = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    (document as unknown as { startViewTransition: typeof startVT }).startViewTransition = startVT;

    renderPage();
    await openFirstFollowingPost();

    expect(startVT).toHaveBeenCalled();
    expect(screen.getByText('DETAIL post_a')).toBeInTheDocument();
  });

  it('reduced motion: no view transition is started (instant swap)', async () => {
    const startVT = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    (document as unknown as { startViewTransition: typeof startVT }).startViewTransition = startVT;
    // prefers-reduced-motion: reduce (see the framer-motion mock above).
    framerReducedMotion.on = true;

    renderPage();
    await openFirstFollowingPost();

    // The detail opened (plain, instant swap) but NO transition ran.
    expect(screen.getByText('DETAIL post_a')).toBeInTheDocument();
    expect(startVT).not.toHaveBeenCalled();
  });

  it('a post the viewer cannot see shows the existing not-found state, never its content', async () => {
    renderPage();
    const btn = await stableButton(/Open post — Secret followers-only post/);
    fireEvent.click(btn);
    await screen.findByTestId('social-post-detail-inplace');

    // The server (social.postDetail → canViewPost) refused; the panel shows
    // the existing error state and leaks nothing.
    expect(await screen.findByText('post not found')).toBeInTheDocument();
    expect(screen.queryByText('DETAIL post_hidden')).not.toBeInTheDocument();
  });

  it('For You (RankedFeed) posts open in place too', async () => {
    renderPage();
    // Let the initial (following) feed settle first — the one-time auth
    // remount happens before any interaction.
    await stableButton(/Open post — First following post/);
    fireEvent.click(screen.getByRole('tab', { name: 'For You' }));
    const btn = await stableButton(/Open post — Ranked post one/);
    fireEvent.click(btn);
    await screen.findByTestId('social-post-detail-inplace');
    expect(screen.getByText('DETAIL post_b')).toBeInTheDocument();
    expect(window.location.search).toContain('post=post_b');
  });

  it('Explore trending posts open in place (click and Enter on the focused card)', async () => {
    window.history.replaceState(null, '', '/lenses/social?view=explore');
    renderPage();

    const card = await stableButton(/Open post — Trending post one/);
    fireEvent.click(card);
    await screen.findByTestId('social-post-detail-inplace');
    expect(screen.getByText('DETAIL post_c')).toBeInTheDocument();
    expect(window.location.search).toContain('post=post_c');

    // Close, then reopen via keyboard (Enter) — the div[role=button] card
    // handles Enter itself (real browsers don't activate divs natively).
    fireEvent.click(screen.getByRole('button', { name: 'Close post' }));
    await waitFor(() => expect(screen.queryByTestId('social-post-detail-inplace')).not.toBeInTheDocument());
    card.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByTestId('social-post-detail-inplace');
    expect(screen.getByText('DETAIL post_c')).toBeInTheDocument();
  });

  it('profile posts (You tab) open in place', async () => {
    window.history.replaceState(null, '', '/lenses/social?view=you');
    renderPage();

    const btn = await stableButton(/Open post — Profile post one/);
    fireEvent.click(btn);
    await screen.findByTestId('social-post-detail-inplace');
    expect(screen.getByText('DETAIL post_d')).toBeInTheDocument();
    expect(window.location.search).toContain('post=post_d');
  });

  it('focus moves into the detail panel on open', async () => {
    renderPage();
    await openFirstFollowingPost();
    const panel = screen.getByTestId('social-post-detail-inplace');
    expect(document.activeElement).toBe(panel);
  });
});

describe('social scroll reveal CSS (JOB 7)', () => {
  it('is scroll-driven, @supports-gated, and reduced-motion gated', () => {
    const css = readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8');

    // Scroll-driven reveal, inside an @supports block…
    const supportsIdx = css.indexOf('@supports (animation-timeline: view())');
    expect(supportsIdx).toBeGreaterThan(-1);
    const supportsBlock = css.slice(supportsIdx, css.indexOf('}', css.indexOf('.social-reveal-items > *', supportsIdx)) + 1);
    expect(supportsBlock).toContain('animation-timeline: view()');
    expect(supportsBlock).toContain('animation-range: entry');
    // …gated to no-preference motion…
    expect(supportsBlock).toContain('@media (prefers-reduced-motion: no-preference)');
    // …subtle only (opacity + a few px translate)…
    expect(supportsBlock).toContain('opacity: 0.35');
    expect(supportsBlock).toContain('translateY(8px)');
    // …and the in-app reduce-motion toggle kills it (scroll timelines
    // ignore the global duration kill, so this is explicit).
    expect(css).toContain('html.a11y-reduce-motion .social-reveal-items > *');
  });

  it('the plain cross-fade fallback exists for browsers without the View Transitions API', () => {
    const css = readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toContain('.social-post-open-fade');
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
  });
});