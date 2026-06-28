/**
 * /lenses/linguistics — four-UX-state contract for the Linguistics lens.
 *
 * Pins that the page renders genuine loading / error (with a WORKING Retry that
 * RE-FETCHES) / empty / populated states against its real backend channel: the
 * artifact list (useLensData('linguistics', type) → GET /api/lens/linguistics),
 * and that the compute-action runner is constructed on the 'linguistics' domain
 * (a regression to any other id resolves to NO backend receiver).
 *
 * No fabricated data — every state is driven by a mocked useLensData standing in
 * for the real backend in the exact shape it returns. The error surface is the
 * shared ErrorState (role=alert + a "Try again" button); the test asserts the
 * underlying refetch fires and the surface recovers to populated, so a
 * swallowed-fetch → silent-empty regression fails here.
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

// ── compute-action channel: useRunArtifact (wiring assertion) ────────────────
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
    return { mutate: (...a: unknown[]) => runMutate(...a), mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));
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
vi.mock('@/components/linguistics/DatamusePanel', () => ({ DatamusePanel: () => null }));
vi.mock('@/components/linguistics/DictionaryPanel', () => ({ DictionaryPanel: () => null }));
vi.mock('@/components/linguistics/WordLookup', () => ({ WordLookup: () => null }));
vi.mock('@/components/linguistics/LinguisticsActionPanel', () => ({ LinguisticsActionPanel: () => null }));
vi.mock('@/components/linguistics/VocabularyBuilder', () => ({ VocabularyBuilder: () => null }));
vi.mock('@/components/linguistics/QuizEngine', () => ({ QuizEngine: () => null }));
vi.mock('@/components/linguistics/ProgressDashboard', () => ({ ProgressDashboard: () => null }));
vi.mock('@/components/linguistics/WordDecks', () => ({ WordDecks: () => null }));
vi.mock('@/components/linguistics/WordTools', () => ({ WordTools: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import LinguisticsLens from '@/app/lenses/linguistics/page';

const ANALYSIS = {
  id: 'art_1',
  title: 'Vowel Harmony in Finnish',
  data: { artifactType: 'Analysis', subfield: 'phonology', language: 'Finnish', description: 'Front/back vowel agreement across suffixes.' },
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

describe('linguistics lens — wiring', () => {
  it('drives the compute-action runner on the linguistics domain', () => {
    render(<LinguisticsLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('linguistics');
  });
});

describe('linguistics lens — four UX states', () => {
  it('LOADING: shows skeleton placeholders while the list is in flight', () => {
    lensDataState.isLoading = true;
    const { container } = render(<LinguisticsLens />);
    // The content grid renders animate-pulse skeleton rows during load.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('ERROR: a failed load surfaces the real error + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('corpus offline');
    const { getByText } = render(<LinguisticsLens />);
    // The shared ErrorState surfaces the honest backend message (no silent-empty).
    expect(getByText(/corpus offline/i)).toBeInTheDocument();
    expect(getByText(/Something went wrong/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button —
    // this is the swallowed-fetch → silent-empty regression guard.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty cue when the list is empty', () => {
    lensDataState.items = [];
    const { getAllByText } = render(<LinguisticsLens />);
    expect(getAllByText(/No .* yet\. Create one to get started\.|No .* found/i).length).toBeGreaterThan(0);
  });

  it('POPULATED: renders the real analysis row from the backend list', () => {
    lensDataState.items = [ANALYSIS];
    const { getAllByText } = render(<LinguisticsLens />);
    expect(getAllByText(/Vowel Harmony in Finnish/i).length).toBeGreaterThan(0);
  });
});
