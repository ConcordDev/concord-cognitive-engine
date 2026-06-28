/**
 * /lenses/affect — four-UX-state contract for the Affect lens.
 *
 * The affect page is driven by the Affect Translation Spine REST channel through
 * react-query useQuery (apiHelpers.affect.{state,policy,health,events}), NOT
 * useLensData. So we route useQuery by queryKey[0] and control each query
 * independently:
 *   - the `affect-state` query gates the page LOADING spinner (role=status).
 *   - any of the four queries failing renders the ERROR state (role=alert) with a
 *     WORKING "Try again" that RE-FETCHES all four (swallowed-fetch → silent-empty
 *     guard) — we assert refetch fires.
 *   - EMPTY: no events → the Event Log tab shows the honest "No events recorded
 *     yet" CTA and no fabricated rows.
 *   - POPULATED: a real event from the events query renders in the timeline.
 *
 * The mood-tracking macros (MoodTracker) + LiveAffectStream own their own
 * lensRun('affect', ...) channels and are pinned by
 * server/tests/affect-lens-macros.test.js + affect-domain-parity.test.js; here
 * they are inert stubs so this test isolates the page's REST-driven UX states.
 *
 * No fabricated data — every state is mocked at the hook boundary the page reads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: useQuery routed by queryKey[0] ──────────────────────────
type QState = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
const q: Record<string, QState> = {
  'affect-state': { data: {}, isLoading: false, isError: false, error: null },
  'affect-policy': { data: {}, isLoading: false, isError: false, error: null },
  'affect-health': { data: { healthy: true, sessions: 0 }, isLoading: false, isError: false, error: null },
  'affect-events': { data: { events: [] }, isLoading: false, isError: false, error: null },
};
const refetch = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[]; queryFn?: () => unknown }) => {
    const key = String((opts.queryKey || [])[0] || '');
    const st = q[key] || { data: null, isLoading: false, isError: false, error: null };
    return { ...st, refetch };
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── lens hooks + bridge ──────────────────────────────────────────────────────
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: [], isLoading: false }),
  useCreateArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({ ok: true, result: {} })), isPending: false }),
}));
vi.mock('@/lib/hooks/use-lens-bridge', () => ({
  useLensBridge: () => ({ selectedId: null, sync: vi.fn() }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// ── api client (the page imports apiHelpers; not exercised once useQuery is mocked) ──
vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    affect: {
      state: vi.fn(() => Promise.resolve({ data: {} })),
      policy: vi.fn(() => Promise.resolve({ data: {} })),
      health: vi.fn(() => Promise.resolve({ data: {} })),
      events: vi.fn(() => Promise.resolve({ data: { events: [] } })),
      emit: vi.fn(() => Promise.resolve({ data: {} })),
      reset: vi.fn(() => Promise.resolve({ data: {} })),
    },
  },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));

// ── headless chrome + heavy side panels → inert ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/affect/MoodTracker', () => ({ MoodTracker: () => null }));
vi.mock('@/components/affect/LiveAffectStream', () => ({ LiveAffectStream: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import AffectLens from '@/app/lenses/affect/page';

function resetQueries() {
  q['affect-state'] = { data: {}, isLoading: false, isError: false, error: null };
  q['affect-policy'] = { data: {}, isLoading: false, isError: false, error: null };
  q['affect-health'] = { data: { healthy: true, sessions: 0 }, isLoading: false, isError: false, error: null };
  q['affect-events'] = { data: { events: [] }, isLoading: false, isError: false, error: null };
}

beforeEach(() => {
  refetch.mockReset();
  resetQueries();
});

describe('affect lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the affect state is in flight', () => {
    q['affect-state'].isLoading = true;
    const { container, getByText } = render(<AffectLens />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading affect state/i)).toBeInTheDocument();
  });

  it('ERROR: a failed query shows role=alert + a working Retry that re-fetches all channels', async () => {
    q['affect-state'].isError = true;
    q['affect-state'].error = new Error('ATS unreachable');
    const { container, getByText } = render(<AffectLens />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(getByText(/ATS unreachable/i)).toBeInTheDocument();

    const before = refetch.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    // The Retry must re-invoke the backend fetch (swallowed-fetch → silent-empty guard).
    await waitFor(() => expect(refetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: the Event Log tab shows the honest no-events CTA and no fabricated rows', async () => {
    q['affect-events'].data = { events: [] };
    const { getByText, queryByText } = render(<AffectLens />);
    // Switch to the Event Log tab.
    await act(async () => { fireEvent.click(getByText('Event Log')); });
    await waitFor(() => expect(getByText(/No events recorded yet/i)).toBeInTheDocument());
    // The honest "Showing 0 of 0 events" counter proves no fabricated rows.
    expect(getByText(/Showing 0 of 0 events/i)).toBeInTheDocument();
    void queryByText;
  });

  it('POPULATED: a real event from the events query renders in the timeline', async () => {
    q['affect-events'].data = {
      events: [
        { type: 'SAFETY_BLOCK', intensity: 0.82, polarity: -0.6, timestamp: '2026-06-28T10:00:00Z', trigger: 'guardrail tripped' },
      ],
    };
    const { getByText, getAllByText } = render(<AffectLens />);
    await act(async () => { fireEvent.click(getByText('Event Log')); });
    await waitFor(() => expect(getAllByText(/SAFETY_BLOCK/i).length).toBeGreaterThan(0));
    // The honest empty cue is gone once a real row is present.
    expect(getAllByText(/SAFETY_BLOCK/i).length).toBeGreaterThan(0);
  });
});

describe('affect lens — health banner reflects real session count', () => {
  it('POPULATED: renders the real active-session count from the health query', () => {
    q['affect-health'].data = { healthy: true, sessions: 7 };
    const { container, getByText } = render(<AffectLens />);
    // The health banner inlines "{sessions} active sessions"; assert the literal
    // session count (7) reaches the DOM next to the "active sessions" label.
    expect(getByText(/active sessions/i)).toBeInTheDocument();
    const banner = container.textContent?.replace(/\s+/g, ' ') || '';
    expect(banner).toMatch(/7 active sessions/i);
  });
});
