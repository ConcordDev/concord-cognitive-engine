/**
 * /lenses/astronomy — four-UX-state contract for the Astronomy lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (with a CTA) / populated states against its real backend channel:
 *   • the artifact list (useLensData('astronomy','object') → GET /api/lens/astronomy)
 *
 * a11y: loading is role=status, error is role=alert with a working Retry that
 * RE-FETCHES (we assert refetch fires). The empty + populated catalog states are
 * driven by the real useLensData shape the page consumes. No fabricated data —
 * every state is mocked at the hook boundary the page actually reads.
 *
 * This lens is ALREADY-WIRED (PATH 3 — server/domains/astronomy.js via
 * registerLensAction). The domain id 'astronomy' has no dash, so there is no
 * hyphenation contract to assert; this test asserts the four states render.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: useLensData (the artifact list the page renders) ────────
const lensData = vi.fn();
const obsData = vi.fn();
const refetch = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (...a: unknown[]) => {
    // page calls useLensData('astronomy','object',…) then ('astronomy','observation',…)
    const type = a[1];
    return type === 'observation' ? obsData(...a) : lensData(...a);
  },
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

// ── headless chrome + hooks: render-only / inert stubs ───────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// lens chrome + cross-lens panels → null
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
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
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));

// astronomy + space child panels → inert (each owns its own backend channel)
vi.mock('@/components/astronomy/AstronomySkySection', () => ({ AstronomySkySection: () => null }));
vi.mock('@/components/astronomy/SkyChartWorkbench', () => ({ SkyChartWorkbench: () => null }));
vi.mock('@/components/astronomy/NasaExplorer', () => ({ NasaExplorer: () => null }));
vi.mock('@/components/astronomy/NasaLivePanel', () => ({ NasaLivePanel: () => null }));
vi.mock('@/components/astronomy/IssPassPanel', () => ({ IssPassPanel: () => null }));
vi.mock('@/components/astronomy/AstronomyActionPanel', () => ({ AstronomyActionPanel: () => null }));
vi.mock('@/components/space/SpaceflightNewsPanel', () => ({ SpaceflightNewsPanel: () => null }));
vi.mock('@/components/space/UpcomingLaunchesPanel', () => ({ UpcomingLaunchesPanel: () => null }));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
}));

import AstronomyLens from '@/app/lenses/astronomy/page';

const STAR_ITEM = {
  id: 'obj_1',
  title: 'Vega',
  data: { name: 'Vega', type: 'star', constellation: 'Lyra', magnitude: 0.03, ra: '', dec: '', distance: '25 ly', notes: '' },
};

function mockLensData(over: Record<string, unknown> = {}) {
  lensData.mockImplementation(() => ({
    items: [],
    total: 0,
    isLoading: false,
    isError: false,
    error: null,
    refetch,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...over,
  }));
  // observation list channel — always inert/empty for these state tests.
  obsData.mockImplementation(() => ({
    items: [], total: 0, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  }));
}

beforeEach(() => {
  lensData.mockReset();
  obsData.mockReset();
  refetch.mockReset();
});

describe('astronomy lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the catalog is in flight', async () => {
    mockLensData({ isLoading: true });
    const { container, getByText } = render(<AstronomyLens />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Scanning the cosmos/i)).toBeInTheDocument();
  });

  it('ERROR: a failed catalog load shows role=alert + a working Retry that re-fetches', async () => {
    mockLensData({ isError: true, error: { message: 'cosmos offline' } });
    const { container, getByText } = render(<AstronomyLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/cosmos offline/i)).toBeInTheDocument();

    // The Retry button re-invokes refetch.
    const before = refetch.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/^Retry$/i)); });
    await waitFor(() => expect(refetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows the honest empty message + the Add-Object CTA when the catalog is empty', async () => {
    mockLensData({ items: [], total: 0 });
    const { getByText, getByPlaceholderText } = render(<AstronomyLens />);
    await waitFor(() =>
      expect(getByText(/No celestial objects cataloged yet/i)).toBeInTheDocument(),
    );
    // CTA to create the first object is present (the always-on Add Object panel).
    expect(getByText(/Add Object/i)).toBeInTheDocument();
    expect(getByPlaceholderText(/Object name/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real catalog row from the artifact list', async () => {
    mockLensData({ items: [STAR_ITEM], total: 1 });
    const { getByText } = render(<AstronomyLens />);
    await waitFor(() => expect(getByText('Vega')).toBeInTheDocument());
    // The constellation metadata from the real item renders too.
    expect(getByText('Lyra')).toBeInTheDocument();
  });
});
