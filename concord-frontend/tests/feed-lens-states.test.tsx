/**
 * /lenses/feed — UX-state contract for the Feed (social timeline) lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry
 * that re-fires ALL THREE data channels) / empty / populated states against
 * its real data channels:
 *   1. useLensData('feed', 'post')            — lens artifact list
 *   2. useInfiniteQuery(['feed-posts', tab])  — the social feed pages
 *   3. useQuery(['trending-topics'])          — trending sidebar
 *
 * Also load-bearing for the coverage gate: this page's import graph pulls in
 * a large slice of components/lib/hooks. Until the WaveformPlayer extraction
 * (Next.js rejects non-page exports from page files) the WaveformPlayer test
 * imported ./page and evaluated that graph incidentally; this test restores
 * it as a real behavioral surface instead.
 *
 * No fabricated data — every state is driven by mocked hooks standing in for
 * the real backend in the exact shape it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

// ── 'timeline:post' live-arrival pill (DET-C dead-event fix) ─────────────────
// Mocked at the socket.io-client level (not lib/realtime/socket.ts itself) so
// the page's real `subscribe('timeline:post', ...)` call runs unmodified —
// this captures the handler socket.ts actually registers via `.on(...)` and
// lets the test fire it directly, the same pattern already used by
// tests/components/mentorship-notifier.test.tsx.
let lastTimelinePostHandler: ((data: unknown) => void) | null = null;
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, handler: (data: unknown) => void) => {
      if (event === 'timeline:post') lastTimelinePostHandler = handler;
    },
    off: () => {},
    emit: () => {},
    connect: () => {},
    disconnect: () => {},
    connected: false,
    io: { on: () => {} },
  }),
}));

// ── channel 1: useLensData (lens artifact list) ──────────────────────────────
const lensDataState: { items: unknown[]; isError: boolean; error: Error | null } = {
  items: [],
  isError: false,
  error: null,
};
const refetchLens = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    total: lensDataState.items.length,
    isLoading: false,
    isError: lensDataState.isError,
    error: lensDataState.error,
    isSeeding: false,
    refetch: refetchLens,
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));

// ── channels 2+3: react-query (infinite feed pages + trending + misc) ────────
const feedState: {
  pages: { pages: unknown[][] } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { pages: undefined, isLoading: false, isError: false, error: null };
const trendingState: { isError: boolean; error: Error | null } = { isError: false, error: null };
const refetchFeed = vi.fn();
const refetchTrending = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (String(queryKey[0]) === 'trending-topics') {
      return {
        data: [],
        isLoading: false,
        isError: trendingState.isError,
        error: trendingState.error,
        refetch: refetchTrending,
      };
    }
    return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
  useInfiniteQuery: () => ({
    data: feedState.pages,
    isLoading: feedState.isLoading,
    isError: feedState.isError,
    error: feedState.error,
    refetch: refetchFeed,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock, setQueryData: vi.fn(), getQueryData: vi.fn() }),
}));

// ── api + artifact-action channels: inert (mocked hooks never invoke them) ──
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: { lens: { runDomain: vi.fn() } },
  lensRun: vi.fn(() => Promise.resolve({ ok: true, result: {} })),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({ ok: true })), isPending: false }),
}));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    hyperDTUs: [],
    megaDTUs: [],
    regularDTUs: [],
    tierDistribution: {},
    publishToMarketplace: vi.fn(),
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

// ── headless chrome + hooks: render-only / inert stubs ───────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    (selector?: (s: { addToast: () => void }) => unknown) => {
      const state = { addToast: () => {} };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ addToast: () => {} }) },
  ),
}));

// Virtuoso renders through a windowing engine jsdom can't drive — replace
// with a plain map so itemContent (the real post card markup) still runs.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'virtuoso' },
      (data || []).map((d, i) => React.createElement('div', { key: i }, itemContent(i, d))),
    ),
}));

import FeedLensPage from '@/app/lenses/feed/page';

function makePost(id: string, content: string) {
  return {
    id,
    type: 'text',
    author: { id: `author-${id}`, name: `Author ${id}`, handle: `author_${id}`, gradient: 'from-cyan-500 to-blue-500', verified: false },
    content,
    createdAt: new Date().toISOString(),
    likes: 0,
    comments: 0,
    reposts: 0,
    shares: 0,
    views: 0,
    liked: false,
    reposted: false,
    bookmarked: false,
  };
}

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isError = false;
  lensDataState.error = null;
  feedState.pages = undefined;
  feedState.isLoading = false;
  feedState.isError = false;
  feedState.error = null;
  trendingState.isError = false;
  trendingState.error = null;
  refetchLens.mockClear();
  refetchFeed.mockClear();
  refetchTrending.mockClear();
  invalidateQueriesMock.mockClear();
  lastTimelinePostHandler = null;
});

describe('/lenses/feed — UX state contract', () => {
  it('loading: renders the skeleton pulse while the feed query is in flight', () => {
    feedState.isLoading = true;
    const { container } = render(React.createElement(FeedLensPage));
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('error: renders ErrorState and Retry re-fires ALL THREE data channels', () => {
    feedState.isError = true;
    feedState.error = new Error('feed backend unreachable');
    const { getByText, getByRole } = render(React.createElement(FeedLensPage));
    expect(getByText(/feed backend unreachable/i)).toBeTruthy();
    fireEvent.click(getByRole('button', { name: /retry|try again/i }));
    expect(refetchLens).toHaveBeenCalledTimes(1);
    expect(refetchFeed).toHaveBeenCalledTimes(1);
    expect(refetchTrending).toHaveBeenCalledTimes(1);
  });

  it('empty: renders the honest empty state with a Discover CTA (no fabricated posts)', () => {
    feedState.pages = { pages: [[]] };
    const { getByText } = render(React.createElement(FeedLensPage));
    expect(getByText(/nothing in your feed yet/i)).toBeTruthy();
    expect(getByText(/discover sources/i)).toBeTruthy();
  });

  it('populated: renders real posts from the feed pages through the list', () => {
    feedState.pages = { pages: [[makePost('p1', 'First real post body'), makePost('p2', 'Second real post body')]] };
    const { getByText } = render(React.createElement(FeedLensPage));
    expect(getByText('First real post body')).toBeTruthy();
    expect(getByText('Second real post body')).toBeTruthy();
  });
});

// DET-C dead-event fix (tests/feed-lens-timeline-post-pill.test.ts carries
// the companion structural pins for the same feature — source-of-truth for
// the JSX shape and the SocketEvent type membership). This block is the
// genuine runtime proof: a real 'timeline:post' arrival through the actual
// lib/realtime/socket.ts `subscribe()` call (captured at the socket.io-client
// boundary, not stubbed away) really shows the pill, and a real click on it
// really clears the pill and invalidates the feed query.
describe("/lenses/feed — 'timeline:post' new-post pill (DET-C dead-event fix)", () => {
  it('shows no new-post pill before any timeline:post arrival', () => {
    feedState.pages = { pages: [[makePost('p1', 'Existing post')]] };
    render(React.createElement(FeedLensPage));
    expect(screen.queryByText(/new post.*tap to show/i)).toBeNull();
  });

  it('a real timeline:post arrival shows the pill, and clicking it clears the pill and invalidates the feed query', () => {
    feedState.pages = { pages: [[makePost('p1', 'Existing post')]] };
    render(React.createElement(FeedLensPage));
    expect(lastTimelinePostHandler).not.toBeNull();

    act(() => { lastTimelinePostHandler!({ dtuId: 'dtu-new-1' }); });

    const pill = screen.getByText(/1 new post.*tap to show/i);
    expect(pill).toBeTruthy();

    fireEvent.click(pill);
    expect(screen.queryByText(/new post.*tap to show/i)).toBeNull();
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['feed-posts'] });
  });

  it('two real timeline:post arrivals pluralize the pill correctly', () => {
    feedState.pages = { pages: [[makePost('p1', 'Existing post')]] };
    render(React.createElement(FeedLensPage));
    act(() => {
      lastTimelinePostHandler!({ dtuId: 'dtu-new-1' });
      lastTimelinePostHandler!({ dtuId: 'dtu-new-2' });
    });
    expect(screen.getByText(/2 new posts.*tap to show/i)).toBeTruthy();
  });
});
