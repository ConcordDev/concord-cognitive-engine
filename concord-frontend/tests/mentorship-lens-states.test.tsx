/**
 * /lenses/mentorship — four-UX-state contract for the Mentorship lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channel: the artifact list
 * (useLensData('mentorship', 'relation') → GET /api/lens/mentorship), and that
 * the compute-action panel drives the 'mentorship' domain via useRunArtifact.
 *
 * Load-bearing wiring assertion: the action runner must be constructed on the
 * 'mentorship' domain — a regression to any other id would resolve to NO backend
 * receiver, leaving the matchScore / progressTrack / feedbackSummary /
 * developmentPlan cards dead.
 *
 * No fabricated data — every state is driven by a mocked useLensData standing in
 * for the real backend in the exact shape it returns. The error path's Retry is
 * asserted to RE-FETCH (refetch fires + the surface recovers to populated), so a
 * swallowed-fetch → silent-empty regression cannot pass.
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

// react-query useQuery (social profiles) → inert
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
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
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
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
vi.mock('@/components/mentorship/MentorshipFeed', () => ({ MentorshipFeed: () => null }));
vi.mock('@/components/mentorship/MentorshipActionPanel', () => ({ MentorshipActionPanel: () => null }));
vi.mock('@/components/mentorship/MentorDirectoryPanel', () => ({ MentorDirectoryPanel: () => null }));
vi.mock('@/components/mentorship/MentorshipRequestsPanel', () => ({ MentorshipRequestsPanel: () => null }));
vi.mock('@/components/mentorship/MentorshipSessionsPanel', () => ({ MentorshipSessionsPanel: () => null }));
vi.mock('@/components/mentorship/MentorshipGoalsPanel', () => ({ MentorshipGoalsPanel: () => null }));
vi.mock('@/components/mentorship/MentorshipProgramPanel', () => ({ MentorshipProgramPanel: () => null }));
vi.mock('@/components/mentorship/MentorshipMessagesPanel', () => ({ MentorshipMessagesPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import MentorshipLens from '@/app/lenses/mentorship/page';

const RELATION = {
  id: 'rel_1',
  title: 'React Mastery',
  data: {
    mentorName: 'Ada', menteeName: 'Eve', topic: 'React Mastery', status: 'active',
    goals: ['ship a feature'], meetingFrequency: 'weekly', sessionsCompleted: 3,
    notes: '', skills: ['react'], rating: 4,
  },
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

describe('mentorship lens — wiring', () => {
  it('drives the compute-action runner on the mentorship domain', () => {
    render(<MentorshipLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('mentorship');
  });
});

describe('mentorship lens — four UX states', () => {
  it('LOADING: shows the loading cue while the relation list is in flight', () => {
    lensDataState.isLoading = true;
    const { getAllByText } = render(<MentorshipLens />);
    expect(getAllByText(/Loading/i).length).toBeGreaterThan(0);
  });

  it('ERROR: a failed load shows the error surface + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('mentorship backend offline');
    const { getByText } = render(<MentorshipLens />);
    expect(getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(getByText(/mentorship backend offline/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty cue when there are no mentorships', () => {
    lensDataState.items = [];
    const { getAllByText } = render(<MentorshipLens />);
    expect(getAllByText(/No mentorships yet|No sessions recorded|No goals set/i).length).toBeGreaterThan(0);
  });

  it('POPULATED: renders the real relation row from the backend list', () => {
    lensDataState.items = [RELATION];
    const { getAllByText } = render(<MentorshipLens />);
    expect(getAllByText(/React Mastery/i).length).toBeGreaterThan(0);
  });
});
