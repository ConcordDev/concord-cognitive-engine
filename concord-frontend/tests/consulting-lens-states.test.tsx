/**
 * /lenses/consulting — four-UX-state contract for the Consulting lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channel: the artifact list
 * (useLensData('consulting', type) → GET /api/lens/consulting), and that the
 * compute-action runner is constructed on the 'consulting' domain via
 * useRunArtifact — a regression to any other id would resolve to NO backend
 * receiver.
 *
 * a11y: loading is role=status (aria-busy), error is role=alert with a working
 * Retry that RE-FETCHES (we assert the underlying refetch fires). A swallowed
 * fetch must surface as the error state, NOT a silent empty surface. No
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

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
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
// LensPageShell: render children + a Retry that calls onRetry (mirrors the real
// shell contract so the populated-state assertions reach the library rows).
vi.mock('@/components/lens/LensPageShell', () => ({
  LensPageShell: ({ children, isLoading, isError, error, onRetry }: {
    children: React.ReactNode; isLoading?: boolean; isError?: boolean;
    error?: { message?: string } | null; onRetry?: () => void;
  }) => {
    if (isLoading) return React.createElement('div', { role: 'status', 'aria-busy': 'true' }, 'Loading consulting data…');
    if (isError) return React.createElement('div', { role: 'alert' },
      React.createElement('span', null, error?.message || 'error'),
      React.createElement('button', { onClick: onRetry }, 'Try again'),
    );
    return React.createElement('div', { 'data-testid': 'lens-page-shell' }, children);
  },
}));
// Heavy consulting children call lensRun on mount → inert stubs.
vi.mock('@/components/consulting/ConsultingFirmReference', () => ({ ConsultingFirmReference: () => null }));
vi.mock('@/components/consulting/EngagementTracker', () => ({ EngagementTracker: () => null }));
vi.mock('@/components/consulting/ConsultingWorkbench', () => ({ ConsultingWorkbench: () => null }));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })) },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import ConsultingLens from '@/app/lenses/consulting/page';

const ENGAGEMENT = {
  id: 'art_1',
  title: 'Strategy Refresh',
  data: { name: 'Strategy Refresh', type: 'Engagement', status: 'active', client: 'Acme', engagementType: 'Strategy', totalFee: 40000, hourlyRate: 250 },
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

describe('consulting lens — wiring', () => {
  it('drives the compute-action runner on the consulting domain', () => {
    render(<ConsultingLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('consulting');
  });
});

describe('consulting lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the list is in flight', () => {
    lensDataState.isLoading = true;
    const { container, getByText } = render(<ConsultingLens />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading consulting data/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('practice data offline');
    const { container, getByText } = render(<ConsultingLens />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(getByText(/practice data offline/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty CTA when the list is empty', () => {
    lensDataState.items = [];
    const { getAllByText } = render(<ConsultingLens />);
    // The library surface renders "No Engagement items yet" + a Create CTA.
    expect(getAllByText(/No .* items yet|Create First/i).length).toBeGreaterThan(0);
  });

  it('POPULATED: renders the real engagement row from the backend list', () => {
    lensDataState.items = [ENGAGEMENT];
    const { getAllByText } = render(<ConsultingLens />);
    expect(getAllByText(/Strategy Refresh/i).length).toBeGreaterThan(0);
  });
});
