/**
 * /lenses/pharmacy — four-UX-state contract for the Pharmacy lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the
 * medication artifact list (useLensData('pharmacy', 'medication') →
 * GET /api/lens/pharmacy), and that the compute-action runner is constructed on
 * the 'pharmacy' domain (a regression to any other id resolves to NO receiver).
 *
 * a11y: loading is role=status, error is role=alert with a Retry that RE-FETCHES
 * (we assert refetch fires). This closes the swallowed-fetch → silent-empty
 * defect: a failed pharmacy feed now surfaces role=alert + Retry, not a blank
 * "no meds" page — which, for a dosing/interaction tool, is a safety regression.
 * No fabricated data: every state is driven by a mocked useLensData standing in
 * for the real backend in the exact shape it returns.
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

// ── compute-action channel: useRunArtifact mutate ───────────────────────────
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  // The page calls useLensData('pharmacy', 'medication', {seed:[]}) AND
  // useLensData('pharmacy', 'interaction', {seed:[]}). The first controls the
  // medication feed states; the second is always empty here.
  useLensData: (_domain: string, type: string) => {
    if (type === 'medication') {
      return {
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
      };
    }
    return {
      items: [], total: 0, isLoading: false, isError: false, error: null, isSeeding: false,
      refetch: vi.fn(), create: vi.fn(() => Promise.resolve({})), update: vi.fn(), remove: vi.fn(),
      createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false },
    };
  },
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  isForbidden: () => false,
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
// heavy pharmacy children (their own backend macros are covered by the
// pharmacy-lens-macros server test) → inert here.
vi.mock('@/components/pharmacy/PharmacyRxSection', () => ({ PharmacyRxSection: () => null }));
vi.mock('@/components/pharmacy/FdaDrugReference', () => ({ FdaDrugReference: () => null }));
vi.mock('@/components/pharmacy/FdaLivePanel', () => ({ FdaLivePanel: () => null }));
vi.mock('@/components/pharmacy/PharmacyActionPanel', () => ({ PharmacyActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn() }),
  RecallSlot: () => null,
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

import PharmacyLensPage from '@/app/lenses/pharmacy/page';

const MEDICATION = {
  id: 'art_med_1',
  title: 'Atorvastatin',
  data: { name: 'Atorvastatin', dosage: '20mg', frequency: 'daily', route: 'oral', status: 'active', refillsLeft: 3 },
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

describe('pharmacy lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the pharmacy domain', () => {
    render(<PharmacyLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('pharmacy');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<PharmacyLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty feed shows the honest "No medications tracked yet" + Add Medication CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<PharmacyLensPage />);
    await waitFor(() => expect(getByText(/No medications tracked yet/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Add Medication/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('pharmacy store offline');
    const { container, getByText } = render(<PharmacyLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/pharmacy store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No medications tracked yet" message instead — it must NOT.
    expect(() => getByText(/No medications tracked yet/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real medication artifact renders with its name + dosage', async () => {
    lensDataState.items = [MEDICATION];
    const { getAllByText, getByText } = render(<PharmacyLensPage />);
    await waitFor(() => expect(getAllByText('Atorvastatin').length).toBeGreaterThan(0));
    // the real dosage line from the artifact renders (med row: "20mg - daily - oral")
    expect(getByText(/20mg/)).toBeInTheDocument();
  });
});
