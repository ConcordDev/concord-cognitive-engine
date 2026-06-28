/**
 * /lenses/bio — four-UX-state contract for the Bio lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry that
 * RE-FETCHES) / empty (with the Add-Organism CTA) / populated states against
 * its real backend channel: the artifact list
 *   useLensData('bio','system') → GET /api/lens/bio
 * plus the growth-status useQuery the stat row reads.
 *
 * No fabricated data — every state is mocked at the hook boundary the page
 * actually reads (useLensData + useQuery), and we assert refetch fires on Retry
 * so a swallowed-fetch → silent-empty regression surfaces here.
 *
 * This lens is ALREADY-WIRED (PATH 3 — server/domains/bio.js via
 * registerLensAction). The domain id 'bio' has no dash, so there is no
 * hyphenation contract to assert; this test asserts the four states render.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channels: useLensData (artifact list) + useQuery (growth status) ──
const lensData = vi.fn();
const refetch = vi.fn();
const refetchGrowth = vi.fn();
const growthState: { isError: boolean; error: unknown; data: unknown } = {
  isError: false, error: null, data: { bioAge: '0.00', maturationLevel: 0, organs: [] },
};

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (...a: unknown[]) => lensData(...a),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
// useQuery drives the growth-status stat row; route by queryKey so only the
// growth query is controllable from the test.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: growthState.data,
    isError: growthState.isError,
    error: growthState.error,
    refetch: refetchGrowth,
  }),
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
vi.mock('@/components/lens/LiveFeed', () => ({
  __esModule: true,
  default: () => null,
  adaptToLiveFeedArticles: () => [],
}));
vi.mock('@/components/research/ArxivPanel', () => ({ ArxivPanel: () => null }));
vi.mock('@/components/research/PubMedPanel', () => ({ PubMedPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// bio child workbenches → inert (each owns its own bio.* macro channel; covered
// by server/tests/bio-lens-macros.test.js).
vi.mock('@/components/bio/BioWorkbench', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/bio/MolecularWorkbench', () => ({ MolecularWorkbench: () => null }));
vi.mock('@/components/bio/SequenceAnalyzer', () => ({ SequenceAnalyzer: () => null }));
vi.mock('@/components/bio/BioActionPanel', () => ({ BioActionPanel: () => null }));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import BioLens from '@/app/lenses/bio/page';

const ORGANISM_ITEM = {
  id: 'bio_1',
  title: 'Tardigrade culture',
  data: { type: 'organism' },
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
}

beforeEach(() => {
  lensData.mockReset();
  refetch.mockReset();
  refetchGrowth.mockReset();
  growthState.isError = false;
  growthState.error = null;
  growthState.data = { bioAge: '0.00', maturationLevel: 0, organs: [] };
});

describe('bio lens — four UX states', () => {
  it('LOADING: shows the loading indicator while the organism list is in flight', async () => {
    mockLensData({ isLoading: true });
    const { getByText } = render(<BioLens />);
    await waitFor(() => expect(getByText(/Loading\.\.\./i)).toBeInTheDocument());
  });

  it('ERROR: a failed load shows the error state + a working Retry that re-fetches', async () => {
    mockLensData({ isError: true, error: { message: 'bio backend offline' } });
    const { getByText } = render(<BioLens />);
    await waitFor(() => expect(getByText(/Something went wrong/i)).toBeInTheDocument());
    expect(getByText(/bio backend offline/i)).toBeInTheDocument();

    // The Retry button re-invokes refetch (swallowed-fetch → silent-empty guard).
    const before = refetch.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(refetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows the Add-Organism CTA and no organism rows when the list is empty', async () => {
    mockLensData({ items: [], total: 0 });
    const { getByText, queryByText } = render(<BioLens />);
    await waitFor(() => expect(getByText(/Add Organism/i)).toBeInTheDocument());
    // No fabricated rows — the empty list renders nothing for the seeded item.
    expect(queryByText('Tardigrade culture')).toBeNull();
  });

  it('POPULATED: renders the real organism row from the artifact list', async () => {
    mockLensData({ items: [ORGANISM_ITEM], total: 1 });
    const { getByText } = render(<BioLens />);
    await waitFor(() => expect(getByText('Tardigrade culture')).toBeInTheDocument());
  });
});
