/**
 * /lenses/chem — four-UX-state contract for the Chemistry lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channel: the artifact lists
 * (useLensData('chem', 'compound') + useLensData('chem', 'reaction') →
 * GET /api/lens/chem), and that the compute-action panel drives the 'chem'
 * domain via useRunArtifact.
 *
 * Load-bearing wiring assertion: the action runner must be constructed on the
 * 'chem' domain — a regression to any other id would resolve to NO backend
 * receiver (the chem macros are registerLensAction handlers keyed by 'chem.*').
 *
 * a11y: loading is role=status (aria-busy), error is role=alert with a working
 * Retry that RE-FETCHES (we assert the underlying refetch fires). No fabricated
 * data — every state is driven by a mocked useLensData standing in for the real
 * backend in the exact { items, isLoading, isError, error, refetch } shape it
 * returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── main list channel: useLensData (controls loading/error/empty/populated) ──
const lensDataState: {
  items: Array<Record<string, unknown>>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();

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

// ── compute-action channel: useRunArtifact mutate ───────────────────────────
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

// react-query useMutation (runReaction) → inert, render-only
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: () => ({ data: null, isLoading: false }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })) },
  lensRun: vi.fn(() => Promise.resolve({ ok: true, result: {} })),
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
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
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
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
vi.mock('@/components/lens/SubLensQuickNav', () => ({ SubLensQuickNav: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null, adaptToLiveFeedArticles: () => [] }));
vi.mock('@/components/research/ArxivPanel', () => ({ ArxivPanel: () => null }));
vi.mock('@/components/chem/PubChemPanel', () => ({ PubChemPanel: () => null }));
vi.mock('@/components/chem/PeriodicTable', () => ({ PeriodicTable: () => null }));
vi.mock('@/components/chem/ChemWorkbench', () => ({ default: () => null }));
vi.mock('@/components/chem/ChemStructureLab', () => ({ default: () => null }));
vi.mock('@/components/chem/ChemActionPanel', () => ({ ChemActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import ChemLens from '@/app/lenses/chem/page';

// A real compound artifact in the exact shape useLensData returns
// (items are { id, data, ... } and the page flattens i.data into the row).
const COMPOUND = {
  id: 'art_water',
  title: 'Water',
  data: { name: 'Water', formula: 'H2O', type: 'product', stability: 0.95 },
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

describe('chem lens — wiring', () => {
  it('drives the compute-action runner on the chem domain', () => {
    render(<ChemLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('chem');
  });
});

describe('chem lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the list is in flight', () => {
    lensDataState.isLoading = true;
    const { container, getByText } = render(<ChemLens />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading lab results/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('chem backend offline');
    const { container, getByText } = render(<ChemLens />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(getByText(/chem backend offline/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: the Compounds tab shows an honest empty CTA when the library is empty', () => {
    lensDataState.items = [];
    const { getByText, getByTestId, getByRole } = render(<ChemLens />);
    // Default tab is "reactions"; switch to "Compounds" to reach the library.
    // ("Compounds" also appears as the "Compound Library" heading, so target
    // the tab button specifically by its accessible name.)
    fireEvent.click(getByRole('button', { name: /^Compounds$/ }));
    const empty = getByTestId('chem-compounds-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent || '').toMatch(/No compounds in library/i);
    // The CTA is a real button, not decorative text.
    expect(getByText('Run a reaction').tagName).toBe('BUTTON');
  });

  it('POPULATED: renders the real compound row from the backend list', () => {
    lensDataState.items = [COMPOUND];
    const { getAllByText } = render(<ChemLens />);
    // Default reactions tab renders the Compound Library sidebar mapping items.
    expect(getAllByText(/Water/i).length).toBeGreaterThan(0);
    expect(getAllByText(/H2O/i).length).toBeGreaterThan(0);
  });
});
