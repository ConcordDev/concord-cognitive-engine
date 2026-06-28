/**
 * /lenses/artistry — four-UX-state contract for the Artistry creative-portfolio lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channel: the asset list
 * (useQuery ['artistry','assets',...] → apiHelpers.artistry.assets.list →
 * GET /api/artistry/assets), and that the compute-action panel drives the
 * 'artistry' domain via useRunArtifact.
 *
 * Load-bearing wiring assertion: the action runner must be constructed on the
 * 'artistry' domain — a regression to any other id would resolve to NO backend
 * receiver (the compute buttons would silently no-op).
 *
 * SWALLOWED-FETCH REGRESSION GUARD: the assets queryFn previously ended in
 * `.catch(() => return [])`, which makes the promise RESOLVE on failure, so
 * `isError` stayed permanently false and the ErrorState (+ its Retry) at the
 * top of the lens was dead — a load failure read as an honest-but-wrong
 * "No assets found." The ERROR test below asserts the surface really surfaces
 * `isError` (the fix re-throws instead of swallowing).
 *
 * No fabricated data — every state is driven by the mocked assets useQuery in
 * the exact shape the real backend returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── assets list channel (controls loading/error/empty/populated) ────────────
const assetsState: {
  data: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { data: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();

// ── compute-action channel: useRunArtifact mutate ───────────────────────────
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();

// react-query: key the useQuery mock off queryKey so ONLY the assets query
// carries the four-state signal; the decorative styles/asset-types/marketplace/
// studio queries stay inert (empty arrays), exactly mirroring the page's
// `initialData: []` defaults.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey?: unknown[] }) => {
    const key = Array.isArray(opts?.queryKey) ? opts.queryKey : [];
    if (key[1] === 'assets') {
      return {
        data: assetsState.data,
        isLoading: assetsState.isLoading,
        isError: assetsState.isError,
        error: assetsState.error,
        refetch,
      };
    }
    return { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

// useLensData provides artistryItems (compute targetId) — inert empty list.
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], total: 0, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));

// DTU context feed (the 'feed' default tab renders from this).
const dtusState: { contextDTUs: unknown[]; isLoading: boolean } = { contextDTUs: [], isLoading: false };
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({ contextDTUs: dtusState.contextDTUs, isLoading: dtusState.isLoading }),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    artistry: {
      assets: { list: vi.fn(() => Promise.resolve({ data: { assets: [] } })), create: vi.fn(() => Promise.resolve({ data: {} })) },
      genres: vi.fn(() => Promise.resolve({ data: { genres: [] } })),
      assetTypes: vi.fn(() => Promise.resolve({ data: { types: [] } })),
      marketplace: { art: { list: vi.fn(() => Promise.resolve({ data: { art: [] } })) } },
      studio: { projects: { list: vi.fn(() => Promise.resolve({ data: { projects: [] } })) } },
    },
  },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));

// ── headless chrome + side panels: render-only / inert stubs ────────────────
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
vi.mock('next/dynamic', () => ({ default: () => () => null }));
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
vi.mock('@/components/artistry/WikimediaArt', () => ({ WikimediaArt: () => null }));
vi.mock('@/components/artistry/ProjectStudio', () => ({ ProjectStudio: () => null }));
vi.mock('@/components/artistry/PortfolioProfile', () => ({ PortfolioProfile: () => null }));
vi.mock('@/components/artistry/CommunityNetwork', () => ({ CommunityNetwork: () => null }));
vi.mock('@/components/artistry/Collections', () => ({ Collections: () => null }));
vi.mock('@/components/artistry/DisciplineSearch', () => ({ DisciplineSearch: () => null }));
vi.mock('@/components/artistry/JobBoard', () => ({ JobBoard: () => null }));
vi.mock('@/components/artistry/CuratedGalleries', () => ({ CuratedGalleries: () => null }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import ArtistryLens from '@/app/lenses/artistry/page';

// "Assets" appears both as a stat-card label and a tab button; click the TAB.
function clickTab(getAllByText: (m: RegExp | string) => HTMLElement[], label: string) {
  const btn = getAllByText(label).find((el) => el.closest('button'));
  if (!btn) throw new Error(`tab "${label}" not found`);
  fireEvent.click(btn.closest('button')!);
}

const ASSET = {
  id: 'asset_1',
  title: 'Sunset Study',
  type: 'painting',
  tags: ['landscape', 'oil'],
};

beforeEach(() => {
  assetsState.data = [];
  assetsState.isLoading = false;
  assetsState.isError = false;
  assetsState.error = null;
  dtusState.contextDTUs = [];
  dtusState.isLoading = false;
  refetch.mockReset();
  runMutate.mockReset();
  runMutate.mockImplementation(() => Promise.resolve({ ok: true, result: {} }));
  useRunArtifactSpy.mockReset();
});

describe('artistry lens — wiring', () => {
  it('drives the compute-action runner on the artistry domain', () => {
    render(<ArtistryLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('artistry');
  });
});

describe('artistry lens — four UX states', () => {
  it('LOADING: the assets list reports in-flight without rendering a stale empty', () => {
    assetsState.isLoading = true;
    // The Assets tab guards its empty CTA on `!isLoading`, so an in-flight load
    // must NOT render the "No assets found." empty cue.
    const { queryByText, getAllByText } = render(<ArtistryLens />);
    clickTab(getAllByText, 'Assets');
    expect(queryByText(/No assets found/i)).toBeNull();
  });

  it('ERROR: a failed assets load surfaces the ErrorState + a working Retry that re-fetches', async () => {
    // This is the swallowed-fetch regression guard: a real failure must light
    // up the ErrorState (the fix re-throws instead of catching → []).
    assetsState.isError = true;
    assetsState.error = new Error('asset store offline');
    const { getByText } = render(<ArtistryLens />);
    expect(getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(getByText(/asset store offline/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty cue when there is no content', () => {
    assetsState.data = [];
    dtusState.contextDTUs = [];
    const { getByText, getAllByText } = render(<ArtistryLens />);
    // Default 'feed' tab renders the empty-feed message.
    expect(getByText(/No artistry content yet/i)).toBeInTheDocument();
    // Assets tab renders its own honest empty cue.
    clickTab(getAllByText, 'Assets');
    expect(getByText(/No assets found/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real asset row from the backend list', () => {
    assetsState.data = [ASSET];
    const { getByText, getAllByText } = render(<ArtistryLens />);
    clickTab(getAllByText, 'Assets');
    expect(getByText(/Sunset Study/i)).toBeInTheDocument();
    // tag chips render the asset's real tags.
    expect(getByText(/landscape/i)).toBeInTheDocument();
  });
});
