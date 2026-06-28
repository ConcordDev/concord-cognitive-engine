/**
 * /lenses/neuro — four-UX-state contract for the Neuro (EEG/MEG) lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('neuro', type) → GET /api/lens/neuro), and that the
 * compute-action runner is constructed on the 'neuro' domain (a regression to
 * any other id resolves to NO backend receiver).
 *
 * This closes the swallowed-fetch → silent-empty defect: a FAILED neuro feed
 * surfaces the ErrorState (title "Something went wrong" + a working "Try again"
 * that RE-FETCHES) — NOT a blank "No … items yet" page. We assert refetch fires
 * on Retry and that the empty CTA is NOT shown while errored.
 *
 * No fabricated data — every state is driven by a mocked useLensData standing in
 * for the real backend in the exact shape it returns. The heavy children
 * (NeuroActionPanel / EegWorkbench — their backend macros are covered by the
 * server-side neuro-lens-macros test) are inert here.
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

// ── ErrorState: FAITHFUL stub of @/components/common/EmptyState's ErrorState ──
// The neuro page returns <ErrorState error onRetry={refetch}/> on isError, so the
// stub reproduces the real surface: a "Something went wrong" title, the error
// text, and a working "Try again" button wired to onRetry. This is the exact
// shape the real ErrorState renders (an EmptyState with action.label='Try again').
vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: ({ error, onRetry }: { error?: string; onRetry?: () => void }) =>
    React.createElement(
      'div',
      { role: 'alert' },
      React.createElement('span', null, 'Something went wrong'),
      React.createElement('span', null, error || 'An unexpected error occurred. Please try again.'),
      onRetry ? React.createElement('button', { type: 'button', onClick: onRetry }, 'Try again') : null,
    ),
  EmptyState: () => null,
  AdminRequiredState: () => null,
}));

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
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
vi.mock('@/components/neuro/NeuroFeed', () => ({ NeuroFeed: () => null }));
vi.mock('@/components/neuro/NeuroActionPanel', () => ({ NeuroActionPanel: () => null }));
vi.mock('@/components/neuro/EegWorkbench', () => ({ EegWorkbench: () => null }));
vi.mock('@/components/research/ArxivPanel', () => ({ ArxivPanel: () => null }));
vi.mock('@/components/research/PubMedPanel', () => ({ PubMedPanel: () => null }));
vi.mock('@/components/wiki/WikipediaSearchPanel', () => ({ WikipediaSearchPanel: () => null }));
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

import NeuroLensPage from '@/app/lenses/neuro/page';

const NETWORK = {
  id: 'art_1',
  title: 'Vision backbone',
  data: { name: 'Vision backbone', type: 'Network', status: 'converged', description: 'ResNet-50', notes: '', architecture: 'ResNet', neurons: 23456, layers: 50, accuracy: 0.912 },
  meta: { tags: [], status: 'converged', visibility: 'private' },
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

describe('neuro lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the neuro domain', () => {
    render(<NeuroLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('neuro');
  });

  it('LOADING: an in-flight feed shows a spinner, not an empty CTA', async () => {
    lensDataState.isLoading = true;
    const { container, queryByText } = render(<NeuroLensPage />);
    // the page's library view renders an animate-spin loader while loading
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeTruthy());
    // a loading feed must NOT show the empty CTA (silent-empty regression)
    expect(queryByText(/No .* items yet/i)).toBeNull();
  });

  it('EMPTY: an empty feed shows the honest "No … items yet" CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<NeuroLensPage />);
    await waitFor(() => expect(getByText(/No .* items yet/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Create First/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows the ErrorState + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('neuro store offline');
    const { container, getByText, queryByText } = render(<NeuroLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/neuro store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No … items yet" CTA instead — it must NOT.
    expect(queryByText(/No .* items yet/i)).toBeNull();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real network artifact renders with its name + accuracy', async () => {
    lensDataState.items = [NETWORK];
    const { getByText, getAllByText } = render(<NeuroLensPage />);
    await waitFor(() => expect(getByText('Vision backbone')).toBeInTheDocument());
    // the real accuracy from the artifact renders (0.912 → 91.2%) — appears on
    // both the item row and the dashboard avg-accuracy stat.
    expect(getAllByText(/91\.2%/).length).toBeGreaterThan(0);
  });
});
