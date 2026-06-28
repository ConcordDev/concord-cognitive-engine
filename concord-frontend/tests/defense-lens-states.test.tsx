/**
 * /lenses/defense — four-UX-state contract for the Defense lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('defense', type) → GET /api/lens/defense), and that the
 * compute-action runner is constructed on the 'defense' domain (a regression to
 * any other id resolves to NO backend receiver).
 *
 * a11y: loading is role=status, error is role=alert with a Retry that RE-FETCHES
 * (we assert refetch fires). This closes the swallowed-fetch → silent-empty
 * defect: a failed defense feed surfaces role=alert + Retry, not a blank "no
 * items" page. The page's inline loading/error branches were given role=status /
 * role=alert on 2026-06-28 (the ErrorState's "Try again" is wired to refetch).
 *
 * No fabricated data — every state is driven by a mocked useLensData standing in
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

// useLensData is called multiple times in the page (current type + 4 seeded
// lists). The first call governs loading/error/empty/populated; the seeded
// lists return empty so the dashboard stats compute to 0.
let lensDataCalls = 0;
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => {
    const first = lensDataCalls === 0;
    lensDataCalls += 1;
    if (first) {
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
      refetch: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
      createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false },
    };
  },
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutate: (...a: unknown[]) => runMutate(...a), mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: null } })),
  isForbidden: () => false,
}));

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
// heavy defense children (their own backend macros are covered by the
// defense-lens-macros server test) → inert here.
vi.mock('@/components/defense/ContractSearch', () => ({ ContractSearch: () => null }));
vi.mock('@/components/defense/DefenseActionPanel', () => ({ DefenseActionPanel: () => null }));
vi.mock('@/components/defense/CommonOperatingPicture', () => ({ CommonOperatingPicture: () => null }));
vi.mock('@/components/defense/MissionPlanner', () => ({ MissionPlanner: () => null }));
vi.mock('@/components/defense/AssetReadiness', () => ({ AssetReadiness: () => null }));
vi.mock('@/components/defense/ThreatBoard', () => ({ ThreatBoard: () => null }));
vi.mock('@/components/defense/PersonnelRoster', () => ({ PersonnelRoster: () => null }));
vi.mock('@/components/defense/LogisticsBoard', () => ({ LogisticsBoard: () => null }));
vi.mock('@/components/defense/CommsLog', () => ({ CommsLog: () => null }));
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

import DefenseLensPage from '@/app/lenses/defense/page';

const OPERATION = {
  id: 'art_op1',
  title: 'Operation Vigilant Shield',
  data: { codeName: 'Vigilant Shield', status: 'active', classification: 'secret', objective: 'Secure the northern perimeter and deny enemy infiltration.' },
  meta: { tags: [], status: 'active', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  lensDataCalls = 0;
  refetch.mockReset();
  runMutate.mockClear();
  useRunArtifactSpy.mockClear();
  window.localStorage.clear();
});

describe('defense lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the defense domain', () => {
    render(<DefenseLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('defense');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<DefenseLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty feed shows the honest "No … found" create CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<DefenseLensPage />);
    await waitFor(() => expect(getByText(/No .* found/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Create your first/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('defense feed offline');
    const { container, getByText } = render(<DefenseLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/defense feed offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No … found" CTA instead — it must NOT.
    expect(() => getByText(/No .* found/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real operation artifact renders with its title + objective', async () => {
    lensDataState.items = [OPERATION];
    const { getByText } = render(<DefenseLensPage />);
    await waitFor(() => expect(getByText('Operation Vigilant Shield')).toBeInTheDocument());
    expect(getByText(/Secure the northern perimeter/)).toBeInTheDocument();
  });
});
