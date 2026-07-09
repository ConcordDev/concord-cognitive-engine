/**
 * /lenses/mentorship — UX-state + tab-wiring contract for the rebuilt
 * Mentorship lens (Frontend Rebuild Program, Wave 2).
 *
 * Rewritten alongside the Wave-2 rebuild: the page no longer reads a
 * DTU-artifact "relation" list via `useLensData`/`useRunArtifact` (that
 * legacy CRUD surface — including its client-computed, non-backend "match
 * score" heuristic — was retired). The real page now (a) drives its header
 * KPI strip off the real `mentorship.program-report` macro via
 * `useMacroDispatchFeedback`, honestly showing loading/error/populated for
 * THAT channel, and (b) mounts one real macro-backed panel per tab
 * (MentorDirectoryPanel / MentorshipRequestsPanel / ... / MentorshipProgramPanel).
 *
 * Load-bearing wiring assertion: tab selection must mount the matching real
 * panel component — a regression that always rendered MentorDirectoryPanel
 * regardless of the selected tab would silently strand 7 of the 8 real
 * backend surfaces behind dead navigation.
 *
 * No fabricated data — every state is driven by a mocked
 * `useMacroDispatchFeedback` standing in for the real backend in the exact
 * shape the hook returns. The error path's Retry is asserted to re-dispatch
 * (the mocked `dispatch` fires again), so a swallowed-fetch → silent-empty
 * regression cannot pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ── header KPI channel: useMacroDispatchFeedback (mentorship.program-report) ──
type Status = 'idle' | 'dispatched' | 'running' | 'done' | 'error';
const statsState: { status: Status; result: Record<string, unknown> | null; error: string | null } = {
  status: 'idle', result: null, error: null,
};
const dispatchSpy = vi.fn(() => Promise.resolve(null));

vi.mock('@/hooks/useMacroDispatchFeedback', () => ({
  useMacroDispatchFeedback: () => ({
    status: statsState.status,
    runId: null,
    domain: 'mentorship',
    action: 'program-report',
    result: statsState.result,
    error: statsState.error,
    ms: null,
    stage: null,
    dispatch: dispatchSpy,
    reset: vi.fn(),
  }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/mentorship/MentorshipFeed', () => ({ MentorshipFeed: () => React.createElement('div', { 'data-testid': 'panel-community' }) }));
vi.mock('@/components/mentorship/MentorshipActionPanel', () => ({ MentorshipActionPanel: () => React.createElement('div', { 'data-testid': 'panel-tools' }) }));
vi.mock('@/components/mentorship/MentorDirectoryPanel', () => ({ MentorDirectoryPanel: () => React.createElement('div', { 'data-testid': 'panel-directory' }) }));
vi.mock('@/components/mentorship/MentorshipRequestsPanel', () => ({ MentorshipRequestsPanel: () => React.createElement('div', { 'data-testid': 'panel-requests' }) }));
vi.mock('@/components/mentorship/MentorshipSessionsPanel', () => ({ MentorshipSessionsPanel: () => React.createElement('div', { 'data-testid': 'panel-sessions' }) }));
vi.mock('@/components/mentorship/MentorshipGoalsPanel', () => ({ MentorshipGoalsPanel: () => React.createElement('div', { 'data-testid': 'panel-goals' }) }));
vi.mock('@/components/mentorship/MentorshipProgramPanel', () => ({ MentorshipProgramPanel: () => React.createElement('div', { 'data-testid': 'panel-program' }) }));
vi.mock('@/components/mentorship/MentorshipMessagesPanel', () => ({ MentorshipMessagesPanel: () => React.createElement('div', { 'data-testid': 'panel-messages' }) }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import MentorshipLens from '@/app/lenses/mentorship/page';

beforeEach(() => {
  statsState.status = 'idle';
  statsState.result = null;
  statsState.error = null;
  dispatchSpy.mockClear();
});

describe('mentorship lens — tab wiring', () => {
  it('mounts the real Directory panel by default', () => {
    render(<MentorshipLens />);
    expect(screen.getByTestId('panel-directory')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-program')).not.toBeInTheDocument();
  });

  it('switching to each tab mounts its own real macro-backed panel', () => {
    render(<MentorshipLens />);
    // Tab buttons also render a leading hotkey digit in a sibling <span>, so
    // the button's full textContent is "<digit><Label>" — match as a
    // substring (no ^$ anchors) rather than an exact string.
    const cases: Array<[RegExp, string]> = [
      [/Requests/, 'panel-requests'],
      [/Sessions/, 'panel-sessions'],
      [/Goals/, 'panel-goals'],
      [/Messages/, 'panel-messages'],
      [/Coaching Tools/, 'panel-tools'],
      [/Program/, 'panel-program'],
      [/Community/, 'panel-community'],
    ];
    for (const [label, testId] of cases) {
      fireEvent.click(screen.getByText(label));
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('dispatches the real program-report macro on mount (not a client-computed heuristic)', () => {
    render(<MentorshipLens />);
    expect(dispatchSpy).toHaveBeenCalledWith('mentorship', 'program-report', {});
  });
});

describe('mentorship lens — header KPI states', () => {
  it('LOADING: shows skeleton placeholders while program-report is in flight', () => {
    statsState.status = 'dispatched';
    render(<MentorshipLens />);
    expect(screen.getAllByText(/Loading/i).length).toBeGreaterThan(0);
  });

  it('ERROR: shows the real error message + a working Retry that re-dispatches', async () => {
    statsState.status = 'error';
    statsState.error = 'mentorship backend offline';
    render(<MentorshipLens />);
    expect(screen.getByText(/mentorship backend offline/i)).toBeInTheDocument();

    dispatchSpy.mockClear();
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith('mentorship', 'program-report', {}));
  });

  it('POPULATED: renders real program-report numbers, never a fabricated match %', () => {
    statsState.status = 'done';
    statsState.result = {
      mentors: 5, activeMatches: 2, matchAcceptanceRate: 80,
      sessions: { total: 10, completed: 7 }, sessionCompletionRate: 70,
      goals: { total: 4, done: 2 }, goalCompletionRate: 50,
      avgSessionRating: 4.2, avgMentorRating: 4.5,
    };
    render(<MentorshipLens />);
    // Scope to the KPI list (role="list" from StatTileGrid) — single-digit
    // stat values (e.g. mentors: 5) can otherwise collide in the DOM with
    // the tab bar's own single-digit hotkey labels (nav is 1-8).
    const kpis = within(screen.getByRole('list'));
    expect(kpis.getByText('5')).toBeInTheDocument(); // Mentors listed
    expect(kpis.getByText(/80% acceptance/)).toBeInTheDocument();
    // avgMentorRating is passed through StatTile's own compact-integer
    // formatter (by design — see formatCompactStatValue); the caption is a
    // literal string this page controls directly and keeps the real decimal.
    expect(kpis.getByText(/4\.2\/5 session avg/)).toBeInTheDocument();
  });
});
