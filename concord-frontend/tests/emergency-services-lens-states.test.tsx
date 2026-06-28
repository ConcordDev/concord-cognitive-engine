/**
 * /lenses/emergency-services — four-UX-state contract.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING retry) /
 * empty (honest "no records" CTA) / populated states against its real backend
 * channel — the artifact list (useLensData('emergency-services', type) →
 * GET /api/lens/emergency-services) — and that the compute-action runner is
 * constructed on the 'emergency-services' domain (a regression to any other id
 * resolves to NO backend receiver, since the registered domain string is
 * 'emergency-services' even though the domain FILE is emergencyservices.js).
 *
 * This closes the swallowed-fetch → silent-empty defect for a SAFETY-relevant
 * lens: a failed dispatch/CAD feed must surface the error + a working retry,
 * NOT a blank "no records" page that hides an outage from a dispatcher. No
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
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  isForbidden: () => false,
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
// LensPageShell: render the REAL component so its loading/error branches are
// exercised (it owns the Loading + ErrorState surfaces). Only the page's own
// empty/populated branches live in the page body.
// Realtime overlay inside LensPageShell pulls react-query + a socket; stub it
// inert so the shell's loading/error/data branches render without a live socket.
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ isConnected: false, insights: [], alerts: [], lastUpdated: null }) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
// emergency-services children — their own macros are covered by the
// emergency-services-lens-macros server test → inert here.
vi.mock('@/components/emergency-services/QuakeFeed', () => ({ QuakeFeed: () => null }));
vi.mock('@/components/emergency-services/CADConsole', () => ({ CADConsole: () => null }));
vi.mock('@/components/emergency-services/EmergencyServicesActionPanel', () => ({ EmergencyServicesActionPanel: () => null }));
vi.mock('@/components/common/MapView', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn() }),
  RecallSlot: () => null,
}));
// next/dynamic: resolve to an inert component synchronously.
vi.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
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

import EmergencyServicesLensPage from '@/app/lenses/emergency-services/page';

const CALL = {
  id: 'art_1',
  title: 'Structure fire — 4th & Main',
  data: { callNumber: 'C-1001', type: 'fire', priority: 'echo', status: 'dispatched', location: '4th & Main' },
  meta: { tags: [], status: 'dispatched', visibility: 'private' },
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

describe('emergency-services lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the emergency-services domain', () => {
    render(<EmergencyServicesLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('emergency-services');
  });

  it('LOADING: an in-flight feed shows a loading indicator (not a blank page)', async () => {
    lensDataState.isLoading = true;
    const { getByText } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(getByText(/Loading emergency services/i)).toBeInTheDocument());
  });

  it('EMPTY: an empty feed shows the honest "no records found" state', async () => {
    lensDataState.items = [];
    const { getByText } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(getByText(/No .* records found/i)).toBeInTheDocument());
  });

  it('ERROR: a failed feed shows the error + a working retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('CAD store offline');
    const { getByText, queryByText } = render(<EmergencyServicesLensPage />);

    await waitFor(() => expect(getByText('CAD store offline')).toBeInTheDocument());
    // a silent-empty page would show the "no records found" copy instead — it must NOT.
    expect(queryByText(/No .* records found/i)).toBeNull();

    // The retry affordance must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real dispatch call artifact renders with its title + location', async () => {
    lensDataState.items = [CALL];
    const { getByText } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(getByText('Structure fire — 4th & Main')).toBeInTheDocument());
    expect(getByText('4th & Main')).toBeInTheDocument();
  });
});
