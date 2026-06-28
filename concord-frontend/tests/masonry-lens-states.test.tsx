/**
 * /lenses/masonry — four-UX-state contract for the Masonry lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('masonry', type) → GET /api/lens/masonry), and that the
 * compute-action runner is constructed on the 'masonry' domain (a regression to
 * any other id resolves to NO backend receiver).
 *
 * a11y: loading is role=status, error is role=alert with a Retry that RE-FETCHES
 * (we assert refetch fires). This closes the swallowed-fetch → silent-empty
 * defect: a failed masonry feed surfaces role=alert + Retry, not a blank "no
 * items" page.
 *
 * The masonry page DELEGATES its loading/error surfaces to LensPageShell (it
 * passes isLoading/isError/error/onRetry through), so the stub here reproduces
 * the real shell's behavior FAITHFULLY: role=status while loading, role=alert +
 * a Retry button wired to onRetry while errored, children otherwise. No
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
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: null } })),
  isForbidden: () => false,
}));

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
// LensPageShell: a FAITHFUL stub of the real shell's loading/error gating —
// the masonry page delegates those surfaces to it, so the stub must reproduce
// role=status (loading) and role=alert + working Retry (error) to test them.
vi.mock('@/components/lens/LensPageShell', () => ({
  LensPageShell: ({
    children, actions, isLoading, isError, error, onRetry,
  }: {
    children: React.ReactNode; actions?: React.ReactNode;
    isLoading?: boolean; isError?: boolean; error?: { message?: string } | null;
    onRetry?: () => void;
  }) => {
    if (isLoading) {
      return React.createElement('div', { 'data-testid': 'lens-page-shell', role: 'status' }, 'Loading masonry...');
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
// heavy masonry children (their own backend macros are covered by the
// masonry-lens-macros + masonry-domain-parity server tests) → inert here.
vi.mock('@/components/masonry/MasonryFeed', () => ({ MasonryFeed: () => null }));
vi.mock('@/components/masonry/MasonStuff', () => ({ MasonStuff: () => null }));
vi.mock('@/components/masonry/ContractorSuite', () => ({ ContractorSuite: () => null }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
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

import MasonryLensPage from '@/app/lenses/masonry/page';

const JOB = {
  id: 'art_1',
  title: 'Garden retaining wall',
  data: { name: 'Garden retaining wall', type: 'Job', status: 'in_progress', description: 'Backyard 40ft block wall', notes: '', client: 'Acme', totalCost: 5400 },
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

describe('masonry lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the masonry domain', () => {
    render(<MasonryLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('masonry');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<MasonryLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty feed shows the honest "No … items yet" CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<MasonryLensPage />);
    await waitFor(() => expect(getByText(/No .* items yet/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Create First/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('masonry store offline');
    const { container, getByText } = render(<MasonryLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/masonry store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No … items yet" CTA instead — it must NOT.
    expect(() => getByText(/No .* items yet/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real job artifact renders with its title + cost', async () => {
    lensDataState.items = [JOB];
    const { getByText, getAllByText } = render(<MasonryLensPage />);
    await waitFor(() => expect(getByText('Garden retaining wall')).toBeInTheDocument());
    // the real cost from the artifact renders (revenue stat + the item row)
    expect(getAllByText(/\$5,400/).length).toBeGreaterThan(0);
  });
});
