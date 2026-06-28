/**
 * /lenses/marketing — four-UX-state contract for the Marketing lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('marketing', type) → GET /api/lens/marketing), and that the
 * compute-action runner is constructed on the 'marketing' domain (a regression
 * to any other id resolves to NO backend receiver).
 *
 * The marketing page surfaces its states directly (NOT via LensPageShell):
 *   - isError → top-level <ErrorState error onRetry={refetch}/> ("Something went
 *     wrong" + "Try again" button wired to refetch).
 *   - isLoading → a role-less spinner inside renderLibrary.
 *   - empty → an honest "No {type} items yet" + "Create First" CTA.
 *   - populated → the artifact row with its title.
 *
 * This closes the swallowed-fetch → silent-empty defect: a failed marketing feed
 * surfaces the error + a Retry that RE-FETCHES, not a blank "no items" page. No
 * fabricated data — every state is driven by a mocked useLensData standing in
 * for the real backend in the exact shape it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── main list channel: useLensData (controls loading/error/empty/populated) ──
const lensDataState: {
  items: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();

// ── compute-action channel: useRunArtifact mutate ───────────────────────────
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    total: lensDataState.items.length,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    error: lensDataState.error,
    isSeeding: false,
    refetch,
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: null } })),
  isForbidden: () => false,
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
// heavy marketing children (their own backend macros are covered by the
// marketing server tests) → inert here.
vi.mock('@/components/marketing/MarketingDashboardSection', () => ({ MarketingDashboardSection: () => null }));
vi.mock('@/components/marketing/MarketingFeed', () => ({ MarketingFeed: () => null }));
vi.mock('@/components/marketing/MarketingActionPanel', () => ({ MarketingActionPanel: () => null }));
vi.mock('@/components/marketing/MarketingEmailPanel', () => ({ MarketingEmailPanel: () => null }));
vi.mock('@/components/marketing/MarketingWorkflowsPanel', () => ({ MarketingWorkflowsPanel: () => null }));
vi.mock('@/components/marketing/MarketingPagesPanel', () => ({ MarketingPagesPanel: () => null }));
vi.mock('@/components/marketing/MarketingSocialPanel', () => ({ MarketingSocialPanel: () => null }));
vi.mock('@/components/marketing/MarketingScoringPanel', () => ({ MarketingScoringPanel: () => null }));
vi.mock('@/components/marketing/MarketingSEOPanel', () => ({ MarketingSEOPanel: () => null }));
vi.mock('@/components/marketing/MarketingContactsPanel', () => ({ MarketingContactsPanel: () => null }));
vi.mock('@/components/marketing/MarketingCalendarPanel', () => ({ MarketingCalendarPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import MarketingLensPage from '@/app/lenses/marketing/page';

const CAMPAIGN = {
  id: 'art_1',
  title: 'Spring launch',
  data: { name: 'Spring launch', type: 'Campaign', status: 'active', description: 'Q2 push', notes: '', budget: 5000, channel: 'Email' },
  meta: { tags: [], status: 'active', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  refetch.mockReset();
  runMutate.mockClear();
  useRunArtifactSpy.mockClear();
  window.localStorage.clear();
});

describe('marketing lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the marketing domain', () => {
    render(<MarketingLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('marketing');
  });

  it('LOADING: an in-flight feed shows a spinner (not the empty CTA)', async () => {
    lensDataState.isLoading = true;
    const { container, queryByText } = render(<MarketingLensPage />);
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeTruthy());
    // a stuck spinner must NOT also show the "no items" CTA
    expect(queryByText(/No .* items yet/i)).toBeNull();
  });

  it('EMPTY: an empty feed shows the honest "No … items yet" CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<MarketingLensPage />);
    await waitFor(() => expect(getByText(/No .* items yet/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Create First/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows the error + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('marketing store offline');
    const { getByText, queryByText } = render(<MarketingLensPage />);

    await waitFor(() => expect(getByText(/marketing store offline/i)).toBeInTheDocument());
    // a silent-empty page would show the "No … items yet" CTA instead — it must NOT.
    expect(queryByText(/No .* items yet/i)).toBeNull();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real campaign artifact renders with its title + budget', async () => {
    lensDataState.items = [CAMPAIGN];
    const { getByText, getAllByText } = render(<MarketingLensPage />);
    await waitFor(() => expect(getByText('Spring launch')).toBeInTheDocument());
    // the real budget from the artifact renders (stat card + the item row)
    expect(getAllByText(/\$5,000/).length).toBeGreaterThan(0);
  });
});
