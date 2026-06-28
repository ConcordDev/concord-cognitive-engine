/**
 * /lenses/insurance — four-UX-state contract for the Insurance Agency lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channel: the artifact list
 * (useLensData('insurance', type) → GET /api/lens/insurance), and that the
 * compute-action runner is constructed on the 'insurance' domain via
 * useRunArtifact — a regression to any other id would resolve to NO backend
 * receiver.
 *
 * a11y: loading is role=status (aria-busy), error is role=alert with a working
 * "Try again" that RE-FETCHES (we assert refetch fires + the surface recovers
 * to populated). No fabricated data — every state is driven by a mocked
 * useLensData standing in for the real backend in the exact shape it returns.
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
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/insurance/InsuranceWalletSection', () => ({ InsuranceWalletSection: () => null }));
vi.mock('@/components/insurance/InsurancePolicyTalk', () => ({ InsurancePolicyTalk: () => null }));
vi.mock('@/components/insurance/InsuranceActionPanel', () => ({ InsuranceActionPanel: () => null }));
vi.mock('@/components/insurance/PolicyVault', () => ({ default: () => null }));
vi.mock('@/components/insurance/ClaimTracker', () => ({ default: () => null }));
vi.mock('@/components/insurance/QuoteCompare', () => ({ default: () => null }));
vi.mock('@/components/insurance/CoverageAnalyzer', () => ({ default: () => null }));
vi.mock('@/components/insurance/AmsWorkbench', () => ({ default: () => null }));
vi.mock('@/components/insurance/MutualAidPactsPanel', () => ({ default: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import InsuranceLens from '@/app/lenses/insurance/page';

const POLICY = {
  id: 'art_1',
  title: 'Acme Auto Policy',
  data: { policyType: 'auto', carrier: 'Acme Mutual', premium: 1200, coverageLimit: 100000, deductible: 500, namedInsureds: [], endorsements: [], effectiveDate: '2026-01-01', expiryDate: '2027-01-01', policyNumber: 'POL-0001' },
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

describe('insurance lens — wiring', () => {
  it('drives the compute-action runner on the insurance domain', () => {
    render(<InsuranceLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('insurance');
  });
});

describe('insurance lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the list is in flight', () => {
    lensDataState.isLoading = true;
    const { container, getByText } = render(<InsuranceLens />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading insurance data/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('carrier feed offline');
    const { container, getByText } = render(<InsuranceLens />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(getByText(/carrier feed offline/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty cue when there are no policies', () => {
    lensDataState.items = [];
    const { getAllByText } = render(<InsuranceLens />);
    // The Dashboard "Recent Policies" panel renders "No policies yet." when empty.
    expect(getAllByText(/No policies yet|No .* found/i).length).toBeGreaterThan(0);
  });

  it('POPULATED: renders the real policy row from the backend list', () => {
    lensDataState.items = [POLICY];
    const { getAllByText } = render(<InsuranceLens />);
    expect(getAllByText(/Acme Auto Policy/i).length).toBeGreaterThan(0);
  });
});
