/**
 * /lenses/photography — four-UX-state contract for the Photography lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channel: the artifact list
 * (useLensData('photography', 'photo') → GET /api/lens/photography), and that
 * the compute-action panel drives the 'photography' domain via useRunArtifact.
 *
 * Load-bearing wiring assertion: the action runner must be constructed on the
 * 'photography' domain — a regression to any other id would resolve to NO
 * backend receiver.
 *
 * a11y: loading is role=status (aria-busy); error is role=alert with a working
 * "Try again" that RE-FETCHES (we assert the underlying refetch fires). No
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

vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({ contextDTUs: [], isLoading: false }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
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
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/photography/PhotographyLightroomSection', () => ({ PhotographyLightroomSection: () => null }));
vi.mock('@/components/photography/PexelsBrowser', () => ({ PexelsBrowser: () => null }));
vi.mock('@/components/photography/PhotographyActionPanel', () => ({ PhotographyActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => React.createElement('img', props as Record<string, unknown>) }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import PhotographyLens from '@/app/lenses/photography/page';

const PHOTO = {
  id: 'art_1',
  title: 'Golden Hour Ridge',
  data: { title: 'Golden Hour Ridge', description: 'A ridge at sunset', tags: ['landscape'], likes: 4, views: 120, createdAt: '2026-06-27' },
  meta: { tags: ['landscape'], status: 'active', visibility: 'private' },
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

describe('photography lens — wiring', () => {
  it('drives the compute-action runner on the photography domain', () => {
    render(<PhotographyLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('photography');
  });
});

describe('photography lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the list is in flight', () => {
    lensDataState.isLoading = true;
    const { container, getByText } = render(<PhotographyLens />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading photography/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('catalog offline');
    const { container, getByText } = render(<PhotographyLens />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(getByText(/catalog offline/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty CTA when the gallery is empty', () => {
    lensDataState.items = [];
    const { getByText } = render(<PhotographyLens />);
    expect(getByText(/No photos yet\. Upload your first shot\./i)).toBeInTheDocument();
    // The CTA is a real button, not decorative text.
    expect(getByText(/Upload Photo/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real photo from the backend list', () => {
    lensDataState.items = [PHOTO];
    const { getAllByText } = render(<PhotographyLens />);
    expect(getAllByText(/Golden Hour Ridge/i).length).toBeGreaterThan(0);
  });
});
