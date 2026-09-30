/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/app/lenses/marketplace/page.perf.test.tsx
//
// Pins the perceived-latency fix for the marketplace lens. Measured against
// the live stack: `/lenses/marketplace` sat on a full-page skeleton for
// ~15-18s even though every backend call eventually returns 200. Root cause
// (see page.tsx's RENDER-section comment for the full writeup + a live
// reproduction): the lens fires ~30+ independent queries at mount against a
// single Node process backed by synchronous `better-sqlite3` — every request
// queues on that one thread, so the wall-clock cost scales with request
// COUNT, not any single endpoint's own latency. Three structural fixes, each
// guarded here:
//
//   1. The page used to block its ENTIRE render (header, tabs, search, every
//      other tab) behind `if (isLoading) return <FullPageSkeleton/>`, gated
//      on a query (`useLensData('marketplace','listing')`) whose result
//      isn't even part of the visible browse grid. Chrome must now render
//      immediately regardless of any query's timing.
//   2. `ShopfrontSection` (the seller dashboard — shop-get + dashboard-summary
//      + inventory-alerts + messages-threads, 4 calls, plus its ShopDashboard
//      child's own 2 more) used to mount unconditionally on every tab. It
//      must only mount on the My Shop tab it's actually for.
//   3. Supplementary below-the-fold widgets (TrendingListings, the listing
//      workbench, session rail, recents) used to fire their own backend
//      calls in the very same tick as the critical browse queries. They must
//      mount a tick later (useDeferredMount's idle-callback/timeout), not
//      synchronously with first paint — freeing the critical path from
//      competing with them for the single-threaded backend.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── api client: every call resolves instantly to an empty/ok envelope so
//    the test controls timing, not a real network. ───────────────────────
vi.mock('@/lib/api/client', () => {
  const emptyOk = () => Promise.resolve({ data: { ok: true } });
  return {
    api: {
      get: vi.fn(emptyOk),
      post: vi.fn(emptyOk),
      put: vi.fn(emptyOk),
      delete: vi.fn(emptyOk),
    },
    apiHelpers: {
      artistry: {
        marketplace: {
          beats: { list: vi.fn(() => Promise.resolve({ data: { beats: [] } })) },
          stems: { list: vi.fn(() => Promise.resolve({ data: { stems: [] } })) },
          samples: { list: vi.fn(() => Promise.resolve({ data: { samples: [] } })) },
          art: { list: vi.fn(() => Promise.resolve({ data: { artworks: [] } })) },
          purchases: vi.fn(() => Promise.resolve({ data: { purchases: [] } })),
          purchase: vi.fn(() => Promise.resolve({ data: { ok: true } })),
        },
      },
      economy: {
        balance: vi.fn(() => Promise.resolve({ data: { balance: 0 } })),
        config: vi.fn(() => Promise.resolve({ data: { fees: {} } })),
      },
      lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) },
    },
    lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  };
});

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useTilePush', () => ({ useTilePush: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    contextDTUs: [],
    hyperDTUs: [],
    megaDTUs: [],
    regularDTUs: [],
    tierDistribution: {},
    publishToMarketplace: vi.fn(),
    refetch: vi.fn(),
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [] }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })) }),
}));
vi.mock('@/lib/realtime/event-bus', () => ({ useEvent: () => {} }));
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: vi.fn() }) },
}));

// ── Heavy / irrelevant chrome — passthrough or null, same pattern as
//    app/lenses/chat/page.conkay-backport.test.tsx and
//    app/lenses/plugins/page.test.tsx. ─────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/lens/LensContextPanel', () => ({ LensContextPanel: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/FeedBanner', () => ({ FeedBanner: () => null }));
vi.mock('@/components/lens/PullToSubstrate', () => ({ PullToSubstrate: () => null }));
vi.mock('@/components/lens/MarketplaceTab', () => ({ MarketplaceTab: () => null }));
vi.mock('@/components/dtu/ProvenanceBadge', () => ({ ProvenanceBadge: () => null }));
vi.mock('@/components/artifact/ArtifactRenderer', () => ({ ArtifactRenderer: () => null }));
vi.mock('@/components/artifact/ArtifactUploader', () => ({ ArtifactUploader: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/market/ArtifactDetailModal', () => ({ ArtifactDetailModal: () => null }));
vi.mock('@/components/market/RoyaltyDashboard', () => ({ RoyaltyDashboard: () => null }));
vi.mock('@/components/visualizations/RoyaltyCascadeViz', () => ({ default: () => null }));
vi.mock('@/components/world-lens/SocialProofFeed', () => ({ default: () => null }));
vi.mock('@/components/social/TrendingDomains', () => ({ TrendingDomains: () => null }));
vi.mock('@/components/platform/ActivityBadge', () => ({ ActivityBadge: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/marketplace/MarketplaceActionPanel', () => ({ MarketplaceActionPanel: () => null }));

// ── The two components under direct test: instrumented with test-ids so we
//    can assert mount/unmount timing without caring about their internals.
vi.mock('@/components/marketplace/ShopfrontSection', () => ({
  ShopfrontSection: () => <div data-testid="shopfront-section">shop manager</div>,
}));
vi.mock('@/components/marketplace/TrendingListings', () => ({
  TrendingListings: () => <div data-testid="trending-listings">trending</div>,
}));
vi.mock('@/components/lens/SessionRail', () => ({
  SessionRail: () => <div data-testid="session-rail">session rail</div>,
}));
vi.mock('@/components/lens/RecentMineCard', () => ({
  RecentMineCard: () => <div data-testid="recent-mine-card">recent mine</div>,
}));
vi.mock('@/components/lens/AutoActionStrip', () => ({
  AutoActionStrip: () => <div data-testid="auto-action-strip">auto actions</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({
  CrossLensRecentsPanel: () => <div data-testid="cross-lens-recents">cross lens recents</div>,
}));

import MarketplaceLensPage from './page';

/** Renders the page and flushes the microtask queue once so the mocked
 * queries' already-resolved promises settle inside `act` — avoids noisy
 * (but harmless) "not wrapped in act" warnings without touching the fake
 * timers the deferred-mount assertions depend on. */
async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <QueryClientProvider client={queryClient}>
        <MarketplaceLensPage />
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  return utils;
}

describe('Marketplace lens — perceived-latency fixes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders real page chrome (tabs) immediately — never blocks on a full-page loading gate', async () => {
    await renderPage();
    // Header / tab navigation is real structure, not a placeholder — it must
    // be present on the very first synchronous render, before any query has
    // had a chance to resolve (there has been no `await`/tick yet).
    expect(screen.getByText('Creative Marketplace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Browse$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sell$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cart$/i })).toBeInTheDocument();
  });

  it('does NOT mount ShopfrontSection (seller dashboard: 6 backend calls) on the default Browse tab', async () => {
    await renderPage();
    expect(screen.queryByTestId('shopfront-section')).not.toBeInTheDocument();
  });

  it('mounts ShopfrontSection only once the user navigates to Sell', async () => {
    await renderPage();
    expect(screen.queryByTestId('shopfront-section')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Sell$/i }));

    expect(screen.getByTestId('shopfront-section')).toBeInTheDocument();
  });

  it('does not mount ShopfrontSection on the Cart or Purchases tabs either', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Cart$/i }));
    expect(screen.queryByTestId('shopfront-section')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Purchases$/i }));
    expect(screen.queryByTestId('shopfront-section')).not.toBeInTheDocument();
  });

  it('defers mounting the supplementary widget strip (trending/session-rail/recents) past first paint', async () => {
    await renderPage();

    // Immediately after the synchronous render, none of the deferred
    // widgets have mounted yet — their queries have not fired.
    expect(screen.queryByTestId('trending-listings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cross-lens-recents')).not.toBeInTheDocument();

    // jsdom has no requestIdleCallback, so useDeferredMount falls back to a
    // timer. Advancing past its timeout is the moment the deferred content
    // is allowed to mount and start firing its own requests.
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByTestId('trending-listings')).toBeInTheDocument();
    expect(screen.getByTestId('session-rail')).toBeInTheDocument();
    expect(screen.getByTestId('cross-lens-recents')).toBeInTheDocument();
  });
});
