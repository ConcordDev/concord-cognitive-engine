/**
 * /lenses/atlas — four-UX-state contract for the Atlas lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (with a CTA) / populated states against its real backend channel:
 *   • the signal-tomography queries (coverage / taxonomy / anomalies / live)
 *     the page reads through @tanstack/react-query.
 *
 * a11y: loading is role=status, error is role=alert with a Retry that
 * RE-FETCHES the failed queries (we assert refetch fires — NOT a full
 * window.location.reload). The empty + populated states are driven by the real
 * query shapes the page consumes. No fabricated data — every state is mocked at
 * the useQuery boundary the page actually reads.
 *
 * This lens is ALREADY-WIRED (PATH 3 — server/domains/atlas.js via
 * registerLensAction + the inline atlas-tomography REST routes). This test
 * asserts the four states render honestly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: react-query (the tomography queries the page renders) ───
type QueryState = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
};
const queryStates: Record<string, QueryState> = {};
const refetchCoverage = vi.fn();
const refetchAnomalies = vi.fn();
const refetchTile = vi.fn();

function stateFor(key: string): QueryState {
  return queryStates[key] ?? { data: undefined, isLoading: false, isError: false };
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    const s = stateFor(key);
    const refetch =
      key === 'atlas-coverage' ? refetchCoverage :
      key === 'atlas-anomalies' ? refetchAnomalies :
      key === 'atlas-tile' ? refetchTile : vi.fn();
    return { data: s.data, isLoading: !!s.isLoading, isError: !!s.isError, refetch };
  },
}));

// ── api helpers: inert (the mocked useQuery never invokes queryFn) ───────────
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiHelpers: {
    atlasTomography: {
      coverage: vi.fn(), signalsTaxonomy: vi.fn(), signalsAnomalies: vi.fn(),
      live: vi.fn(), tile: vi.fn(), signalsSpectrum: vi.fn(),
    },
    lens: { runDomain: vi.fn() },
  },
  lensRun: vi.fn(),
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
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], total: 0, isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
}));

// lens chrome + cross-lens panels → null
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
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/common/SafeCard', () => ({ SafeCard: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }));

// atlas + chat child panels → inert (each owns its own backend channel)
vi.mock('@/components/atlas/AtlasSection', () => ({ AtlasSection: () => null }));
vi.mock('@/components/atlas/OsmGeocodePanel', () => ({ OsmGeocodePanel: () => null }));
vi.mock('@/components/atlas/PlacesGraph', () => ({ PlacesGraph: () => null }));
vi.mock('@/components/atlas/NavigationSuite', () => ({ NavigationSuite: () => null }));
vi.mock('@/components/atlas/AtlasActionPanel', () => ({ AtlasActionPanel: () => null }));
vi.mock('@/components/atlas/PlaceFinder', () => ({ PlaceFinder: () => null }));
vi.mock('@/components/atlas/DistanceMatrixPanel', () => ({ DistanceMatrixPanel: () => null }));
vi.mock('@/components/atlas/MapsDirections', () => ({ MapsDirections: () => null }));
vi.mock('@/components/atlas/RouteStops', () => ({ RouteStops: () => null }));
vi.mock('@/components/atlas/SavedPlaces', () => ({ SavedPlaces: () => null }));
vi.mock('@/components/chat/AtlasPublicView', () => ({ default: () => null }));
vi.mock('@/components/chat/AtlasResearchView', () => ({ default: () => null }));
vi.mock('@/components/chat/AtlasSignalView', () => ({ default: () => null }));
vi.mock('@/components/chat/AtlasOverlay', () => ({ default: () => null }));
vi.mock('@/components/common/MapView', () => ({ default: () => null }));

// next/dynamic → return the (mocked) component synchronously
vi.mock('next/dynamic', () => ({ default: () => () => null }));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
}));

import AtlasLens from '@/app/lenses/atlas/page';

function setQueries(over: Record<string, QueryState>) {
  for (const k of Object.keys(queryStates)) delete queryStates[k];
  Object.assign(queryStates, over);
}

beforeEach(() => {
  for (const k of Object.keys(queryStates)) delete queryStates[k];
  refetchCoverage.mockReset();
  refetchAnomalies.mockReset();
  refetchTile.mockReset();
});

describe('atlas lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while tomography is in flight', async () => {
    setQueries({
      'atlas-coverage': { isLoading: true },
      'atlas-anomalies': { isLoading: true },
    });
    const { container, getByText } = render(<AtlasLens />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Scanning signal tomography/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches (not a reload)', async () => {
    setQueries({
      'atlas-coverage': { isError: true },
      'atlas-anomalies': { isError: true },
    });
    const { container, getByText } = render(<AtlasLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/failed to load/i)).toBeInTheDocument();

    // The Retry button re-invokes the failed queries' refetch (NOT a full reload).
    const beforeCov = refetchCoverage.mock.calls.length;
    const beforeAno = refetchAnomalies.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/^Retry$/i)); });
    await waitFor(() => expect(refetchCoverage.mock.calls.length).toBeGreaterThan(beforeCov));
    expect(refetchAnomalies.mock.calls.length).toBeGreaterThan(beforeAno);
  });

  it('EMPTY: shows the honest empty message + CTA when every source resolved with no rows', async () => {
    setQueries({
      'atlas-coverage': { data: { coverage: 0 } },
      'atlas-taxonomy': { data: { signals: [], total: 0 } },
      'atlas-anomalies': { data: { anomalies: [], total: 0 } },
      'atlas-live': { data: { nodes: [] } },
    });
    const { getByText } = render(<AtlasLens />);
    await waitFor(() => expect(getByText(/No signal coverage yet/i)).toBeInTheDocument());
    // CTA pointing the user at the real next action (query a tile / save a place).
    expect(getByText(/Query a tile/i)).toBeInTheDocument();
  });

  it('POPULATED: renders real node markers + signal/anomaly counts from the query data', async () => {
    setQueries({
      'atlas-coverage': { data: { coverage: 0.42 } },
      'atlas-taxonomy': { data: { signals: [{ id: 's1' }, { id: 's2' }], total: 2 } },
      'atlas-anomalies': { data: { anomalies: [{ id: 'a1' }], total: 1 } },
      'atlas-live': { data: { nodes: [{ lat: 40.7, lng: -74, id: 'node-1', status: 'Active' }] } },
    });
    const { getByText, container } = render(<AtlasLens />);
    // 1 live node ⇒ 1 marker; the stat card + zoom indicator report it.
    await waitFor(() => expect(getByText(/1 markers loaded/i)).toBeInTheDocument());
    // Coverage stat renders the real percentage (0.42 → 42%).
    expect(getByText('42%')).toBeInTheDocument();
    // No empty-state banner when there is real data.
    expect(container.textContent).not.toMatch(/No signal coverage yet/i);
  });
});
