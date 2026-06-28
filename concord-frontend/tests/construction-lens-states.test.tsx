/**
 * /lenses/construction — four-UX-state contract for the Construction lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('construction', type) → GET /api/lens/construction), and
 * that the compute-action runner is constructed on the 'construction' domain (a
 * regression to any other id resolves to NO backend receiver).
 *
 * a11y: loading is role=status, error is role=alert with a Retry that RE-FETCHES
 * (we assert refetch fires). This closes the swallowed-fetch → silent-empty
 * defect: a failed construction feed now surfaces role=alert + Retry, not a
 * blank "No items yet" page. No fabricated data: every state is driven by a
 * mocked useLensData standing in for the real backend in the exact shape it
 * returns.
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
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
// LensPageShell: passthrough that renders header actions + children, so the
// test exercises the page's OWN loading/empty/populated branches (the page owns
// the loading=role=status + error=role=alert surfaces itself).
vi.mock('@/components/lens/LensPageShell', () => ({
  LensPageShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-page-shell' }, actions, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
// heavy construction children (their own backend macros are covered by the
// construction-lens-macros + construction-domain-parity server tests) → inert.
vi.mock('@/components/construction/FieldManagementPanel', () => ({ FieldManagementPanel: () => null }));
vi.mock('@/components/construction/OshaIncidentSearch', () => ({ OshaIncidentSearch: () => null }));
vi.mock('@/components/construction/ProcorePanel', () => ({ ProcorePanel: () => null }));
vi.mock('@/components/construction/ConstructionActionPanel', () => ({ ConstructionActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }));
vi.mock('@/components/common/MapView', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
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

import ConstructionLensPage from '@/app/lenses/construction/page';

const JOB = {
  id: 'art_1',
  title: 'Downtown tower',
  data: { name: 'Downtown tower', type: 'Job', status: 'in_progress', description: '40-story core + shell', notes: '', client: 'Vertex', address: '1 Main St', contractValue: 5400000 },
  meta: { tags: [], status: 'in_progress', visibility: 'private' },
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

describe('construction lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the construction domain', () => {
    render(<ConstructionLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('construction');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<ConstructionLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty feed shows the honest "No Job items yet" CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<ConstructionLensPage />);
    await waitFor(() => expect(getByText(/No Job items yet/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Create First/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('construction store offline');
    const { container, getByText } = render(<ConstructionLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/construction store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No Job items yet" CTA instead — it must NOT.
    expect(() => getByText(/No Job items yet/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real job artifact renders with its title + contract value', async () => {
    lensDataState.items = [JOB];
    const { getByText, getAllByText } = render(<ConstructionLensPage />);
    await waitFor(() => expect(getByText('Downtown tower')).toBeInTheDocument());
    // the real contract value from the artifact renders (stat row + item row)
    expect(getAllByText(/5,400,000/).length).toBeGreaterThan(0);
    // the status badge reads "In Progress" (also a filter option → use getAllByText)
    expect(getAllByText('In Progress').length).toBeGreaterThan(0);
  });
});
