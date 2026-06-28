/**
 * /lenses/supplychain — four-UX-state contract for the Supply Chain lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('supplychain', type) → GET /api/lens/supplychain), and that
 * the compute-action runner is constructed on the 'supplychain' domain (a
 * regression to any other id resolves to NO backend receiver).
 *
 * a11y: loading is role=status, error is role=alert with a Retry that RE-FETCHES
 * (we assert refetch fires). This closes the swallowed-fetch → silent-empty
 * defect: a failed supplychain feed surfaces role=alert + Retry, not a blank
 * "no items" page. No fabricated data — every state is driven by a mocked
 * useLensData standing in for the real backend in the exact shape it returns.
 * The heavy planner/action children (SupplyChainPlanner / SupplyChainActionPanel /
 * SupplyChainFeed) carry their own macro coverage in
 * server/tests/supplychain-lens-macros.test.js and are inert here.
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

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
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
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
// heavy supplychain children (their own backend macros are covered by the
// supplychain server test) → inert here.
vi.mock('@/components/supplychain/SupplyChainFeed', () => ({ SupplyChainFeed: () => null }));
vi.mock('@/components/supplychain/SupplyChainActionPanel', () => ({ SupplyChainActionPanel: () => null }));
vi.mock('@/components/supplychain/SupplyChainPlanner', () => ({ SupplyChainPlanner: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
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

import SupplyChainLensPage from '@/app/lenses/supplychain/page';

const ORDER = {
  id: 'art_1',
  title: 'Q1 steel order',
  data: { name: 'Q1 steel order', type: 'PurchaseOrder', status: 'in_transit', description: '50t rebar', notes: '', supplier: 'Acme Steel', totalCost: 18500 },
  meta: { tags: [], status: 'in_transit', visibility: 'private' },
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

describe('supplychain lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the supplychain domain', () => {
    render(<SupplyChainLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('supplychain');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<SupplyChainLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty feed shows the honest "No … items yet" CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<SupplyChainLensPage />);
    await waitFor(() => expect(getByText(/No .* items yet/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Create First/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('supplychain store offline');
    const { container, getByText } = render(<SupplyChainLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/supplychain store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No … items yet" CTA instead — it must NOT.
    expect(() => getByText(/No .* items yet/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real order artifact renders with its title + cost', async () => {
    lensDataState.items = [ORDER];
    const { getByText, getAllByText } = render(<SupplyChainLensPage />);
    await waitFor(() => expect(getByText('Q1 steel order')).toBeInTheDocument());
    // the real cost from the artifact renders (the item row shows $18,500)
    expect(getAllByText(/\$18,500/).length).toBeGreaterThan(0);
  });
});
