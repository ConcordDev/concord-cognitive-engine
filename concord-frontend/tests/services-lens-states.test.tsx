/**
 * /lenses/services — four-UX-state contract for the Services (service-business) lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('services', type) → GET /api/lens/services), and that the
 * compute-action runner is constructed on the 'services' domain (a regression to
 * any other id resolves to NO backend receiver — the dead-wire trap).
 *
 * The ERROR state asserts the page surfaces a real failure with a Retry that
 * RE-FETCHES (refetch fires), NOT a silent "No items" empty page — closing the
 * swallowed-fetch → silent-empty defect. No fabricated data: every state is
 * driven by a mocked useLensData standing in for the real backend in the exact
 * shape it returns.
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
  useCreateArtifact: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useUpdateArtifact: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: null })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  isForbidden: () => false,
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
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
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
// heavy services children (their own backend macros are covered by the
// services-lens-macros server test) → inert here.
vi.mock('@/components/services/ServicesFeed', () => ({ ServicesFeed: () => null }));
vi.mock('@/components/services/RevenueRetentionPanel', () => ({ RevenueRetentionPanel: () => null }));
vi.mock('@/components/services/BookingSuite', () => ({ BookingSuite: () => null }));
vi.mock('@/components/services/BookingActionDock', () => ({ BookingActionDock: () => null, EndOfDayClose: () => null }));
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

import ServicesLensPage from '@/app/lenses/services/page';

const APPOINTMENT = {
  id: 'art_1',
  title: 'Mia — Color + Cut',
  data: { clientName: 'Mia', serviceType: 'Color + Cut', provider: 'Ana', date: '2026-06-28', time: '10:00', duration: 90, price: 180, recurring: false, noShowCount: 0 },
  meta: { tags: [], status: 'booked', visibility: 'private' },
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

describe('services lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the services domain', () => {
    render(<ServicesLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('services');
  });

  it('LOADING: an in-flight feed shows a spinner indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<ServicesLensPage />);
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeTruthy());
  });

  it('ERROR: a failed feed surfaces the error + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('services store offline');
    const { getByText, queryByText } = render(<ServicesLensPage />);

    await waitFor(() => expect(getByText(/services store offline/i)).toBeInTheDocument());
    // a silent-empty page would show the dashboard / "No … found" CTA instead — the
    // error surface must own the screen, not a blank page.
    expect(queryByText(/No .* found/i)).toBeNull();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: switching off the dashboard shows the honest "No … found" CTA', async () => {
    lensDataState.items = [];
    const { getByText, getAllByText } = render(<ServicesLensPage />);
    // The default tab is Dashboard; switch to Appointments to reach the list view.
    await act(async () => { fireEvent.click(getAllByText('Appointments')[0]); });
    await waitFor(() => expect(getByText(/No .* found/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getAllByText(/Add Appointment/i).length).toBeGreaterThan(0);
  });

  it('POPULATED: a real appointment artifact renders with its title', async () => {
    lensDataState.items = [APPOINTMENT];
    const { getByText, getAllByText } = render(<ServicesLensPage />);
    await act(async () => { fireEvent.click(getAllByText('Appointments')[0]); });
    await waitFor(() => expect(getByText('Mia — Color + Cut')).toBeInTheDocument());
  });
});
