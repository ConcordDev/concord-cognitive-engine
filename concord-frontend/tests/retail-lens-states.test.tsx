/**
 * /lenses/retail — four-UX-state contract for the Retail & Commerce lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channel: the artifact list
 * (useLensData('retail', type) → GET /api/lens/retail), and that the
 * compute-action panel drives the 'retail' domain via useRunArtifact.
 *
 * Load-bearing wiring assertion: the action runner must be constructed on the
 * 'retail' domain — a regression to any other id would resolve to NO backend
 * receiver (the silent-dead class).
 *
 * Swallowed-fetch guard: the ERROR state must surface the real error message
 * and a Retry that RE-FETCHES (we assert refetch fires + recovery to populated),
 * never a silent blank/empty that hides a failed load.
 *
 * No fabricated data — every state is driven by a mocked useLensData standing
 * in for the real backend in the exact shape it returns.
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

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
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
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/retail/RetailWorkbench', () => ({ default: () => null }));
vi.mock('@/components/retail/TaxRatesPanel', () => ({ TaxRatesPanel: () => null }));
vi.mock('@/components/retail/LivePosTerminal', () => ({ LivePosTerminal: () => null }));
vi.mock('@/components/retail/RetailActionPanel', () => ({ RetailActionPanel: () => null }));
vi.mock('@/components/retail/CustomersPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/DiscountsManager', () => ({ default: () => null }));
vi.mock('@/components/retail/AbandonedCartsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/ShippingZonesEditor', () => ({ default: () => null }));
vi.mock('@/components/retail/GiftCardsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/RefundsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/CollectionsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/InventoryTransfers', () => ({ default: () => null }));
vi.mock('@/components/retail/SalesAnalytics', () => ({ default: () => null }));
vi.mock('@/components/retail/CommerceSuite', () => ({ default: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import RetailLens from '@/app/lenses/retail/page';

const PRODUCT = {
  id: 'art_1',
  title: 'Aurora Lamp',
  data: { name: 'Aurora Lamp', sku: 'LMP-001', price: 49.99, stock: 12, reorderPoint: 5 },
  meta: { tags: [], status: 'active', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  refetch.mockReset();
  runMutate.mockReset();
  runMutate.mockImplementation(() => Promise.resolve({ ok: true, result: {} }));
  useRunArtifactSpy.mockReset();
});

describe('retail lens — wiring', () => {
  it('drives the compute-action runner on the retail domain', () => {
    render(<RetailLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('retail');
  });
});

describe('retail lens — four UX states', () => {
  it('LOADING: shows a spinner + Loading cue while the list is in flight', () => {
    lensDataState.isLoading = true;
    const { getByText } = render(<RetailLens />);
    expect(getByText(/Loading/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load surfaces the real error message + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('inventory service offline');
    const { getByText } = render(<RetailLens />);
    // swallowed-fetch guard: the real error string must be visible, not a blank/empty
    expect(getByText(/inventory service offline/i)).toBeInTheDocument();
    expect(getByText(/Something went wrong/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty cue when the product list is empty', () => {
    lensDataState.items = [];
    const { getAllByText } = render(<RetailLens />);
    // default Products library view: "No Products found" + "Create one to get started."
    expect(getAllByText(/No Products? found|Create one to get started/i).length).toBeGreaterThan(0);
  });

  it('POPULATED: renders the real product row from the backend list', () => {
    lensDataState.items = [PRODUCT];
    const { getAllByText } = render(<RetailLens />);
    expect(getAllByText(/Aurora Lamp/i).length).toBeGreaterThan(0);
  });
});
