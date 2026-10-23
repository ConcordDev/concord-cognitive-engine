/**
 * Social phone follow-ups (job oc-social-3afix), items 3 + 4.
 *
 * Item 3 — the Home composer disappearing after Home → Explore/Inbox/You →
 * Home (client-side ?view= change, no reload). Root cause: both Social
 * pages declared their own ['me'] query whose queryFn CAUGHT failures and
 * returned null, so one transient /api/auth/me failure (an auth-refresh
 * window, a 429 GET read-backoff skip) cached "anonymous" as a SUCCESSFUL
 * result — and with staleTime 60s, refetchOnWindowFocus off and no remount
 * on ?view= changes, nothing ever refetched it. The composer (gated on
 * currentUserId) stayed gone until a full reload. Both pages now share one
 * hook (hooks/use-current-user.ts) that THROWS on failure (react-query
 * keeps the previous data for a failed refetch) and self-heals with a 60s
 * retry while entered-but-no-user.
 *
 * Item 4 — tapping the mobile "Create" item while on Home did nothing
 * visible: startPost's requestAnimationFrame queried the DOM before React
 * committed the Home view (when coming from other places), and when the
 * focus did land there was no visible affordance. Create now bumps a
 * focus-request counter handled in a post-commit effect: it scrolls with a
 * prefers-reduced-motion fallback and focuses the composer textarea (the
 * composer form carries a focus-within ring so the focus is visible).
 *
 * Harness: the real page + real QuickPostComposer (like
 * social-instant-updates.test.tsx — FollowingTimeline is page-internal).
 * Only the HTTP layer (@/lib/api/client), next/navigation, jsdom-hostile
 * leaves (RoomStage's WebRTC, ReelsFeed, RoomList), LensShell/DepthBadge
 * chrome and framer-motion's DOM passthrough are mocked.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// The page reads the active place from ?view= and drives it through
// router.replace(). Mirror Next's contract closely enough that clicking a
// nav button actually re-renders the page onto the new place (same
// useSyncExternalStore-with-cached-snapshot mock as
// social-instant-updates.test.tsx).
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

// framer-motion passthrough with a mutable reduced-motion flag (the focus
// effect must scroll with behavior:'auto' when the user prefers it).
const motionPrefs = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', () => {
  const passthrough = (tag: string) => {
    const Comp = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
      React.createElement(tag, { ...props, ref }, props.children as React.ReactNode));
    Comp.displayName = `Motion${tag}`;
    return Comp;
  };
  return {
    useReducedMotion: () => motionPrefs.reduced,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    motion: { div: passthrough('div'), button: passthrough('button'), span: passthrough('span'), li: passthrough('li') },
  };
});

// Stateful mock of the HTTP layer. meState.fail makes /api/auth/me reject —
// the transient-failure shape that used to poison the old catch-to-null
// ['me'] query.
const meState = vi.hoisted(() => ({ fail: false, calls: 0 }));
const srv = vi.hoisted(() => ({
  posts: [
    { id: 'p1', userId: 'u1', username: 'ana', content: 'seed one', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', userId: 'u2', username: 'bea', content: 'seed two', createdAt: '2025-12-31T00:00:00.000Z' },
  ],
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      const u = String(url);
      if (u === '/api/auth/me') {
        meState.calls += 1;
        if (meState.fail) throw new Error('transient auth hiccup');
        return { data: { ok: true, user: { id: 'u1', username: 'ana', displayName: 'Ana' } } };
      }
      if (u.includes('/api/social/feed/following')) return { data: { ok: true, posts: srv.posts.slice() } };
      if (u.includes('/api/social/feed/for-you')) {
        return { data: { ok: true, posts: srv.posts.map((p) => ({ ...p, why: ['Recent'] })) } };
      }
      if (u.includes('/api/social/posts/user/')) return { data: { ok: true, posts: [], total: 0 } };
      if (u.includes('/api/social/profile/')) return { data: { ok: true, profile: { userId: 'u1', username: 'ana', displayName: 'Ana', stats: { followerCount: 0, followingCount: 0 } } } };
      if (u === '/api/social/notifications/count') return { data: { count: 0 } };
      if (u.includes('/api/presence/active')) return { data: { users: [] } };
      // Shape-rich default so every real view component (FindPeople,
      // Discovery, SocialLists, SocialGroups, DMInbox, NotificationCenter…)
      // finds the array field it reads.
      return {
        data: {
          ok: true, notifications: [], stories: [], topics: [], users: [],
          lists: [], groups: [], requests: [], posts: [], conversations: [],
        },
      };
    }),
    post: vi.fn(async () => ({ data: { ok: true } })),
    delete: vi.fn(async () => ({ data: { ok: true } })),
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

import SocialHubPage from '@/app/lenses/social/page';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const meCalls = () => mockedApi.get.mock.calls.filter((c) => String(c[0]) === '/api/auth/me').length;

// jsdom has no scrollIntoView — the focus effect guards with typeof, and
// the tests stub it to observe the scroll behavior.
const scrollIntoView = vi.hoisted(() => vi.fn());
beforeAll(() => {
  (window.HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
});

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

async function settleHome() {
  await screen.findByLabelText('Post text');
}

async function goPlace(label: 'Home' | 'Explore' | 'Inbox' | 'You') {
  fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^${label}$`) })[0]);
  await waitFor(() => {
    const current = screen.getAllByRole('button', { name: new RegExp(`^${label}$`) })[0];
    expect(current.getAttribute('aria-current')).toBe('page');
  });
}

function mobilePlaces() {
  return screen.getByTestId('social-mobile-places');
}

function desktopPlaces() {
  const navs = screen.getAllByRole('navigation', { name: 'Social places' });
  return navs.find((n) => n.className.includes('sticky')) as HTMLElement;
}

async function tapCreate(scope: 'mobile' | 'desktop' = 'mobile') {
  const bar = scope === 'mobile' ? mobilePlaces() : desktopPlaces();
  fireEvent.click(within(bar).getByRole('button', { name: 'Create' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  scrollIntoView.mockClear();
  meState.fail = false;
  meState.calls = 0;
  motionPrefs.reduced = false;
  localStorage.clear();
  urlState.view = '';
  urlState.snapshot = null;
  urlState.listeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('social phone follow-ups — the Home composer persists (item 3)', () => {
  it('the composer survives Home → Explore/Inbox/You → Home via ?view= changes (no reload)', async () => {
    renderPage();
    await settleHome();
    for (const place of ['Explore', 'Inbox', 'You'] as const) {
      await goPlace(place);
      // Other places do not render the Home composer…
      expect(screen.queryByLabelText('Post text')).toBeNull();
      await goPlace('Home');
      // …and coming back to Home brings it straight back up — same page,
      // same session, purely client-side ?view= change.
      expect(await screen.findByLabelText('Post text')).toBeInTheDocument();
    }
  });

  it('a transient /api/auth/me failure can never blank the composer (failed refetch keeps previous data)', async () => {
    const { qc } = renderPage();
    await settleHome();
    const callsBefore = meCalls();

    // One transient failure — exactly the shape that used to cache
    // "anonymous" and hide the composer until a full reload.
    meState.fail = true;
    await qc.invalidateQueries({ queryKey: ['me'] });
    await waitFor(() => expect(meCalls()).toBe(callsBefore + 1));

    // The failed refetch surfaces as an error with the PREVIOUS data kept
    // — the composer never blanks.
    expect(screen.getByLabelText('Post text')).toBeInTheDocument();

    // And it recovers on the next successful fetch — no stuck anonymous.
    meState.fail = false;
    await qc.invalidateQueries({ queryKey: ['me'] });
    await waitFor(() => expect(meCalls()).toBe(callsBefore + 2));
    expect(await screen.findByLabelText('Post text')).toBeInTheDocument();
  });

  it('self-heal: if the first /api/auth/me call fails, the composer appears once the 60s retry succeeds', async () => {
    vi.useFakeTimers();
    meState.fail = true;
    renderPage();
    // First call fails → no session → no composer yet.
    expect(screen.queryByLabelText('Post text')).toBeNull();
    expect(meCalls()).toBe(1);

    // The shared session query retries every 60s while entered-but-no-user.
    meState.fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(meCalls()).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Post text')).toBeInTheDocument();
  });
});

describe('social phone follow-ups — Create taps the composer (item 4)', () => {
  it('tapping mobile Create while on Home scrolls to and focuses the composer textarea', async () => {
    renderPage();
    await settleHome();
    await tapCreate('mobile');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Post text'));
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    // Focusing the textarea rings the form (focus-within) — the tap is
    // something you see, not a silent focus.
    const form = (screen.getByLabelText('Post text') as HTMLElement).closest('form') as HTMLElement;
    expect(form.className).toContain('focus-within:ring');
  });

  it('tapping mobile Create from Explore lands on Home and focuses the composer', async () => {
    renderPage();
    await settleHome();
    await goPlace('Explore');
    expect(screen.queryByLabelText('Post text')).toBeNull();
    await tapCreate('mobile');
    expect(urlState.view).toBe(''); // back on Home (?view= removed)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Post text'));
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('the desktop Create button still works — and is a type=button action, not a second submit path (PR #1451 nit)', async () => {
    renderPage();
    await settleHome();
    const postsBefore = mockedApi.post.mock.calls.filter((c) => String(c[0]) === '/api/social/post').length;
    const createBtn = within(desktopPlaces()).getByRole('button', { name: 'Create' });
    expect(createBtn.getAttribute('type')).toBe('button');
    expect(createBtn.getAttribute('form')).toBeNull();
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Post text'));
    });
    // It focused the composer; it did NOT submit an empty post.
    const postsAfter = mockedApi.post.mock.calls.filter((c) => String(c[0]) === '/api/social/post').length;
    expect(postsAfter).toBe(postsBefore);
  });

  it('prefers-reduced-motion: Create scrolls instantly (behavior auto), not smooth', async () => {
    motionPrefs.reduced = true;
    renderPage();
    await settleHome();
    await tapCreate('mobile');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Post text'));
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(scrollIntoView).not.toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it("'n' is bound exactly once in the page (the duplicate social-post binding is gone)", () => {
    const source = readFileSync(resolve(__dirname, '../../app/lenses/social/page.tsx'), 'utf8');
    const bindings = source.match(/keys: 'n'/g) || [];
    expect(bindings).toHaveLength(1);
  });
});