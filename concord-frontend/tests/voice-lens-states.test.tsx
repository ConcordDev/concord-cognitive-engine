/**
 * /lenses/voice — four-UX-state contract for the Voice (Recording Booth) lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the take
 * artifact list (useLensData('voice', 'take') → GET /api/lens/voice), and that
 * the compute-action runner is constructed on the 'voice' domain (a regression
 * to any other id resolves to NO backend receiver for transcriptAnalyze /
 * speakerDiarize / sentimentScore / keywordSpot).
 *
 * a11y: loading is role=status, error is role=alert with a working "Try again"
 * (the page wraps ErrorState's Retry → refetch). This closes the
 * swallowed-fetch → silent-empty defect: a failed voice feed surfaces
 * role=alert + a recovering Retry, NOT a blank "No takes yet" booth. No
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
  api: {
    get: vi.fn(() => Promise.resolve({ data: null })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: {
    lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) },
    voice: { transcribe: vi.fn(() => Promise.resolve({ data: {} })), ingest: vi.fn(() => Promise.resolve({ data: {} })) },
  },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  isForbidden: () => false,
}));

// ── realtime channel (header LiveIndicator + bottom RealtimeDataPanel) ───────
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// ── @tanstack/react-query: useMutation / useQueryClient used by the page ─────
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── ui store (toasts) ────────────────────────────────────────────────────────
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: vi.fn() }) },
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
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
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
// heavy voice children (their own backend macros are covered by the
// voice-lens-macros server test) → inert here.
vi.mock('@/components/voice/VoiceRepos', () => ({ VoiceRepos: () => null }));
vi.mock('@/components/voice/VoiceActionPanel', () => ({ VoiceActionPanel: () => null }));
vi.mock('@/components/voice/VoiceTranscripts', () => ({ VoiceTranscripts: () => null }));
vi.mock('@/components/voice/VoiceOtterSuite', () => ({ VoiceOtterSuite: () => null }));
vi.mock('@/components/voice/VoiceRecorder', () => ({ VoiceRecorder: () => null }));
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

import VoiceLensPage from '@/app/lenses/voice/page';

const TAKE = {
  id: 'take_1',
  title: 'Take 1',
  data: {
    id: 'take_1',
    number: 1,
    name: 'Pitch rehearsal',
    duration: 95,
    timestamp: '2026-06-27T10:00:00.000Z',
    starred: false,
    isBest: false,
    waveformHeights: [0.2, 0.5, 0.3, 0.7],
    transcript: 'Good morning, we will ship the release today.',
  },
  meta: { tags: [], status: 'ready', visibility: 'private' },
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

describe('voice lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the voice domain', () => {
    render(<VoiceLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('voice');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<VoiceLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty feed shows the honest "No takes yet" booth prompt', async () => {
    lensDataState.items = [];
    const { getByText } = render(<VoiceLensPage />);
    await waitFor(() => expect(getByText(/No takes yet/i)).toBeInTheDocument());
    // the prompt is an honest call to action, not a dead/blank label
    expect(getByText(/Press record to begin/i)).toBeInTheDocument();
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('voice store offline');
    const { container, getByText } = render(<VoiceLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/voice store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No takes yet" prompt instead — it must NOT.
    expect(() => getByText(/No takes yet/i)).toThrow();

    // Retry ("Try again") must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real take artifact renders with its name + duration', async () => {
    lensDataState.items = [TAKE];
    const { getByText } = render(<VoiceLensPage />);
    // the take's name renders in the Takes sidebar
    await waitFor(() => expect(getByText('Pitch rehearsal')).toBeInTheDocument());
    // 95s formats as 01:35 (formatTime) — the real duration from the artifact
    expect(getByText('01:35')).toBeInTheDocument();
  });
});
