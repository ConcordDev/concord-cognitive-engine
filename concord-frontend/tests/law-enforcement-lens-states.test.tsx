/**
 * /lenses/law-enforcement — four-UX-state contract for the Law Enforcement lens.
 *
 * Pins that the page renders genuine loading / error (with a WORKING Retry) /
 * empty (honest "No … records found") / populated states against its real
 * backend channel: the artifact list (useLensData('law-enforcement', type) →
 * GET /api/lens/law-enforcement), and that the compute-action runner is
 * constructed on the 'law-enforcement' domain (a regression to any other id
 * resolves to NO backend receiver — the welding/hvac dead-calculator class).
 *
 * The page DELEGATES loading/error to LensPageShell (it threads
 * isLoading/isError/error/onRetry through), so the stub here reproduces the real
 * shell FAITHFULLY: role=status while loading, role=alert + a Retry wired to
 * onRetry while errored. This closes the swallowed-fetch → silent-empty defect:
 * a failed law-enforcement feed surfaces role=alert + Retry, not a blank page.
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

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
// LensPageShell: a FAITHFUL stub of the real shell's loading/error gating — the
// law-enforcement page delegates those surfaces to it, so the stub must
// reproduce role=status (loading) and role=alert + working Retry (error).
vi.mock('@/components/lens/LensPageShell', () => ({
  LensPageShell: ({
    children, actions, isLoading, isError, error, onRetry,
  }: {
    children: React.ReactNode; actions?: React.ReactNode;
    isLoading?: boolean; isError?: boolean; error?: { message?: string } | null;
    onRetry?: () => void;
  }) => {
    if (isLoading) {
      return React.createElement('div', { 'data-testid': 'lens-page-shell', role: 'status' }, 'Loading law enforcement...');
    }
    if (isError) {
      return React.createElement(
        'div',
        { 'data-testid': 'lens-page-shell', role: 'alert' },
        React.createElement('span', null, error?.message || 'Something went wrong'),
        React.createElement('button', { type: 'button', onClick: onRetry }, 'Retry'),
      );
    }
    return React.createElement('div', { 'data-testid': 'lens-page-shell' }, actions, children);
  },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
// panel-polish (PipingProvider wrapper) → pass-through provider.
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn(), label: '' }),
  RecallSlot: () => null,
}));
// heavy law-enforcement children (their own backend macros are covered by the
// law-enforcement-lens-macros server test) → inert here.
vi.mock('@/components/law-enforcement/PoliceFeed', () => ({ PoliceFeed: () => null }));
vi.mock('@/components/law-enforcement/RmsCadConsole', () => ({ RmsCadConsole: () => null }));
vi.mock('@/components/law-enforcement/LawEnforcementActionPanel', () => ({ LawEnforcementActionPanel: () => null }));
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

import LawEnforcementLensPage from '@/app/lenses/law-enforcement/page';

const CASE = {
  id: 'art_1',
  title: 'Homicide 24-00187',
  data: { caseNumber: '24-00187', type: 'homicide', status: 'open', priority: 'high', detective: 'Det. Wells', description: 'Downtown shooting investigation', suspects: 2, witnesses: 3, evidenceCount: 11, jurisdiction: 'SFPD', statute: 'PC 187' },
  meta: { tags: [], status: 'open', visibility: 'private' },
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

describe('law-enforcement lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the law-enforcement domain', () => {
    render(<LawEnforcementLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('law-enforcement');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<LawEnforcementLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty feed shows the honest "No … records found" state with a working create affordance', async () => {
    lensDataState.items = [];
    const { getByText } = render(<LawEnforcementLensPage />);
    await waitFor(() => expect(getByText(/No .* records found/i)).toBeInTheDocument());
    // the create affordance is a real button, not a dead label
    expect(getByText(/New Case/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('law-enforcement store offline');
    const { container, getByText } = render(<LawEnforcementLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/law-enforcement store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No … records found" state instead — it must NOT.
    expect(() => getByText(/No .* records found/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real case artifact renders with its title + status', async () => {
    lensDataState.items = [CASE];
    const { getByText, getAllByText } = render(<LawEnforcementLensPage />);
    await waitFor(() => expect(getByText('Homicide 24-00187')).toBeInTheDocument());
    // the real status from the artifact renders as a badge on the item row
    expect(getAllByText(/open/i).length).toBeGreaterThan(0);
  });
});
