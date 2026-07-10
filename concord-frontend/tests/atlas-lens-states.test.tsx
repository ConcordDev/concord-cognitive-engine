/**
 * /lenses/atlas — mode toggle + four-UX-state contract for the Atlas lens.
 *
 * The lens has two backends behind one page: a real places/trips/directions
 * tool (`AtlasSection`, tested independently — mocked here as an inert
 * marker) and a signal-tomography channel (coverage / taxonomy / anomalies /
 * live queries read through @tanstack/react-query). Default mode is "Map &
 * trips"; "Signal tomography" is a secondary mode reached via a tab toggle.
 *
 * This test pins:
 *   • Map mode is the default (AtlasSection mounts, tomography does not).
 *   • Switching to Signal tomography renders genuine loading / error (with a
 *     WORKING Retry) / empty (with a CTA) / populated states against its
 *     real backend channel — role=status / role=alert / honest empty copy /
 *     real query-shape-driven counts. No fabricated data — every state is
 *     mocked at the useQuery boundary the page actually reads.
 *
 * This lens is ALREADY-WIRED (PATH 3 — server/domains/atlas.js via
 * registerLensAction + the inline atlas-tomography REST routes).
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
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/common/SafeCard', () => ({ SafeCard: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }));

// The real places/trips/directions tool owns its own backend channel and is
// tested independently — inert marker here so this file stays scoped to the
// page's mode toggle + the tomography channel.
vi.mock('@/components/atlas/AtlasSection', () => ({
  AtlasSection: () => React.createElement('div', { 'data-testid': 'atlas-section' }, 'Map & trips content'),
}));

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

function switchToTomography(getByText: (m: RegExp | string) => HTMLElement) {
  fireEvent.click(getByText(/Signal tomography/i));
}

beforeEach(() => {
  for (const k of Object.keys(queryStates)) delete queryStates[k];
  refetchCoverage.mockReset();
  refetchAnomalies.mockReset();
  refetchTile.mockReset();
});

describe('atlas lens — mode toggle', () => {
  it('defaults to Map & trips mode, mounting the real places/trips tool', () => {
    const { getByTestId, queryByText } = render(<AtlasLens />);
    expect(getByTestId('atlas-section')).toBeInTheDocument();
    // Tomography-only copy is not rendered until the mode is switched.
    expect(queryByText(/Scanning signal tomography/i)).not.toBeInTheDocument();
  });

  it('switches to Signal tomography mode on toggle click', () => {
    const { getByText, queryByTestId } = render(<AtlasLens />);
    switchToTomography(getByText);
    expect(getByText(/mesh-network signal deltas/i)).toBeInTheDocument();
    expect(queryByTestId('atlas-section')).not.toBeInTheDocument();
  });
});

describe('atlas lens — signal tomography four UX states', () => {
  it('LOADING: shows a role=status indicator while tomography is in flight', async () => {
    setQueries({
      'atlas-coverage': { isLoading: true },
      'atlas-anomalies': { isLoading: true },
    });
    const { container, getByText } = render(<AtlasLens />);
    switchToTomography(getByText);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Scanning signal tomography/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches (not a reload)', async () => {
    setQueries({
      'atlas-coverage': { isError: true },
      'atlas-anomalies': { isError: true },
    });
    const { container, getByText } = render(<AtlasLens />);
    switchToTomography(getByText);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/failed to load/i)).toBeInTheDocument();

    // The Retry button re-invokes the failed queries' refetch (NOT a full reload).
    const beforeCov = refetchCoverage.mock.calls.length;
    const beforeAno = refetchAnomalies.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/^Retry$/i)); });
    await waitFor(() => expect(refetchCoverage.mock.calls.length).toBeGreaterThan(beforeCov));
    expect(refetchAnomalies.mock.calls.length).toBeGreaterThan(beforeAno);
  });

  it('EMPTY: shows the honest empty message when every source resolved with no rows', async () => {
    setQueries({
      'atlas-coverage': { data: { coverage: 0 } },
      'atlas-taxonomy': { data: { signals: [], total: 0 } },
      'atlas-anomalies': { data: { anomalies: [], total: 0 } },
      'atlas-live': { data: { nodes: [] } },
    });
    const { getByText } = render(<AtlasLens />);
    switchToTomography(getByText);
    await waitFor(() => expect(getByText(/No signal coverage yet/i)).toBeInTheDocument());
    // The disclosure banner explains WHY (no mesh ingestion wired), not just that it's empty.
    expect(getByText(/no mesh signal-ingestion pipeline wired/i)).toBeInTheDocument();
  });

  it('POPULATED: renders real node markers + signal/anomaly counts from the query data', async () => {
    setQueries({
      'atlas-coverage': { data: { coverage: 0.42 } },
      'atlas-taxonomy': { data: { signals: [{ id: 's1' }, { id: 's2' }], total: 2 } },
      'atlas-anomalies': { data: { anomalies: [{ id: 'a1' }], total: 1 } },
      'atlas-live': { data: { nodes: [{ lat: 40.7, lng: -74, id: 'node-1', status: 'Active' }] } },
    });
    const { getByText, container } = render(<AtlasLens />);
    switchToTomography(getByText);
    // 1 live node ⇒ 1 marker; the stat card + zoom indicator report it.
    await waitFor(() => expect(getByText(/1 markers loaded/i)).toBeInTheDocument());
    // Coverage stat renders the real percentage (0.42 → 42%).
    expect(getByText('42%')).toBeInTheDocument();
    // No empty-state banner when there is real data.
    expect(container.textContent).not.toMatch(/No signal coverage yet/i);
  });
});
