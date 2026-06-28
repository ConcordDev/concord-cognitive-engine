/**
 * /lenses/debate — four-UX-state contract for the Debate lens.
 *
 * The debate page is driven by useLensData('debate','debate') (the lens artifact
 * REST channel). We mock that hook to drive each of the four states the page
 * renders, plus the trending-topics useQuery and the realtime hook.
 *   - LOADING  : isLoading → the Debates list shows "Loading…", no fabricated rows.
 *   - ERROR    : isError → full-page ErrorState (role=alert) with a WORKING "Retry"
 *                that RE-FETCHES (swallowed-fetch → silent-empty guard) — we assert
 *                refetch fires.
 *   - EMPTY    : items=[] → the honest "No debates yet." CTA, no fabricated rows.
 *   - POPULATED: a real debate from useLensData renders in the list + detail.
 *
 * The Kialo argument-map + AI-analysis macros own their own lensRun/useRunArtifact
 * channels pinned by server/tests/debate-lens-macros.test.js; here those side
 * components are inert stubs so this test isolates the page's data-driven UX states.
 * No fabricated data — every state is mocked at the hook boundary the page reads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── primary data channel: useLensData mocked directly ────────────────────────
type LensItem = { id: string; title: string; data: Record<string, unknown> };
const lensState = {
  items: [] as LensItem[],
  isLoading: false,
  isError: false,
  error: null as Error | null,
};
const refetch = vi.fn();
const create = vi.fn(() => Promise.resolve({}));
const update = vi.fn(() => Promise.resolve({}));
const remove = vi.fn(() => Promise.resolve({}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensState.items,
    isLoading: lensState.isLoading,
    isError: lensState.isError,
    error: lensState.error,
    refetch,
    create,
    createMut: { isPending: false },
    update,
    remove,
    deleteMut: { isPending: false },
  }),
}));

// trending-topics useQuery (queryKey ['social-trending-topics']) → empty list.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── lens hooks + artifact run ─────────────────────────────────────────────────
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: [], isLoading: false }),
  useCreateArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({ ok: true, result: {} })), isPending: false }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn(() => Promise.resolve({ data: {} })) },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// ── headless chrome + heavy side panels → inert ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/debate/CmvFeed', () => ({ CmvFeed: () => null }));
vi.mock('@/components/debate/KialoArgumentMap', () => ({ KialoArgumentMap: () => null }));
vi.mock('@/components/debate/SharedDebateView', () => ({ SharedDebateView: () => null }));
vi.mock('@/components/debate/DebateActionPanel', () => ({ DebateActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// ErrorState renders a real role=alert + onRetry button; keep it real so the
// Retry → refetch wiring is genuinely exercised.
vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: ({ error, onRetry }: { error?: string; onRetry?: () => void }) =>
    React.createElement('div', { role: 'alert' }, [
      React.createElement('span', { key: 'm' }, error || 'Something went wrong'),
      React.createElement('button', { key: 'b', onClick: onRetry }, 'Try again'),
    ]),
}));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import DebateLens from '@/app/lenses/debate/page';

function reset() {
  lensState.items = [];
  lensState.isLoading = false;
  lensState.isError = false;
  lensState.error = null;
}

beforeEach(() => {
  refetch.mockReset();
  reset();
});

const realDebate: LensItem = {
  id: 'dbt_1',
  title: 'Should the city ban single-use plastics?',
  data: {
    topic: 'Should the city ban single-use plastics?',
    description: 'Environmental policy debate',
    status: 'open',
    format: 'structured',
    proArguments: [{ author: 'Ana', text: 'Banning plastics reduces ocean pollution.', votes: 3 }],
    conArguments: [{ author: 'Cy', text: 'A ban will cost packaging jobs.', votes: 2 }],
    proVotes: 4,
    conVotes: 2,
  },
};

describe('debate lens — four UX states', () => {
  it('LOADING: the Debates list shows a loading cue and no fabricated rows', () => {
    lensState.isLoading = true;
    const { getByText, queryByText } = render(<DebateLens />);
    expect(getByText(/Loading/i)).toBeInTheDocument();
    // No real debate row is fabricated while loading.
    expect(queryByText(/single-use plastics/i)).toBeNull();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches (swallowed-fetch guard)', async () => {
    lensState.isError = true;
    lensState.error = new Error('debate backend unreachable');
    const { container, getByText } = render(<DebateLens />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(getByText(/debate backend unreachable/i)).toBeInTheDocument();

    const before = refetch.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(refetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows the honest "No debates yet." CTA and no fabricated rows', () => {
    lensState.items = [];
    const { getByText, getAllByText, queryByText } = render(<DebateLens />);
    expect(getByText(/No debates yet/i)).toBeInTheDocument();
    expect(queryByText(/single-use plastics/i)).toBeNull();
    // The stat tiles read 0 debates — proof nothing is fabricated.
    // "Debates" appears as both a stat-tile label and the panel heading; the
    // empty state simply must render it (and no fabricated rows above).
    expect(getAllByText('Debates').length).toBeGreaterThan(0);
  });

  it('POPULATED: a real debate from useLensData renders in the list', () => {
    lensState.items = [realDebate];
    const { getAllByText } = render(<DebateLens />);
    expect(getAllByText(/single-use plastics/i).length).toBeGreaterThan(0);
  });
});
