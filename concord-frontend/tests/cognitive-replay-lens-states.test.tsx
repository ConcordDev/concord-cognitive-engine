/**
 * /lenses/cognitive-replay — four-UX-state contract.
 *
 * Pins that the Cognitive Replay lens renders genuine loading / error (with a
 * WORKING Retry that re-fetches) / empty / populated states against the real
 * backend channels:
 *   • the page's primary timeline load → POST /api/lens/run { chat.timeline }
 *   • the StatsBar child → lensRun('cognitive-replay','stats', …)
 *
 * The load-bearing regression this guards: a transport/fetch failure on the
 * timeline load must surface a role=alert error with a Retry, NOT be swallowed
 * into a silently-empty "No timeline events yet" page (that defect makes an
 * offline backend read identical to "no activity").
 *
 * No fabricated data: every state is driven by a mocked fetch / lensRun standing
 * in for the real backend, in exactly the shapes the macros return. The headless
 * LensShell + lens chrome + sibling fetching children are stubbed inert so each
 * assertion stays on the surface under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the children's backend channel ───────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }) }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
// Sibling tab children that fetch on their own — inert unless under test.
vi.mock('@/components/cognitive-replay/WrappedCards', () => ({ WrappedCards: () => React.createElement('div', { 'data-testid': 'tab-wrapped' }) }));
vi.mock('@/components/cognitive-replay/ActivityHeatmap', () => ({ ActivityHeatmap: () => null }));
vi.mock('@/components/cognitive-replay/FilteredTimeline', () => ({ FilteredTimeline: () => null }));
vi.mock('@/components/cognitive-replay/WindowCompare', () => ({ WindowCompare: () => null }));
vi.mock('@/components/cognitive-replay/SnapshotPanel', () => ({ SnapshotPanel: () => null }));
vi.mock('@/components/cognitive-replay/EventDetailModal', () => ({ EventDetailModal: () => null }));
vi.mock('@/components/cognitive-replay/TimelineExport', () => ({ TimelineExport: () => null }));
// StatsBar is the one child we DON'T stub — it exercises the lensRun stats path.

// Import AFTER mocks are registered.
import CognitiveReplayPage from '@/app/lenses/cognitive-replay/page';
import { StatsBar } from '@/components/cognitive-replay/StatsBar';

// fetch helpers — the page's primary timeline channel.
function fetchOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const EVENTS = [
  { ts: 1700000000000, role: 'user', brainsUsed: [], toolCalls: [], dtusCited: [], tokenCount: 20, contentPreview: 'hello', sessionId: 's1' },
  { ts: 1700003600000, role: 'assistant', brainsUsed: ['conscious'], toolCalls: [], dtusCited: ['dtu_1'], tokenCount: 100, contentPreview: 'a reply', sessionId: 's1' },
];

function lensReply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

beforeEach(() => {
  lensRun.mockReset();
  // StatsBar fires on mount in the populated page — give it a benign default.
  lensRun.mockImplementation(() => lensReply({
    sinceDays: 7, turns: 2, sessions: 1, totalTokens: 120, avgTokensPerTurn: 60,
    totalToolCalls: 0, totalCitations: 1, topBrain: { brain: 'conscious', turns: 1 },
    topTool: null, busiestDay: { day: '2023-11-14', turns: 2 }, brainCounts: { conscious: 1 }, spanDays: 1,
  }));
});

describe('cognitive-replay lens — page primary-load four UX states', () => {
  it('LOADING: shows a role=status indicator while the timeline load is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    const { container, getByText } = render(<CognitiveReplayPage />);
    await waitFor(() => expect(getByText(/Loading your cognitive timeline/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: a successful load with zero events shows the honest empty CTA, NOT an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fetchOk({ ok: true, events: [] })));
    const { getByText, container } = render(<CognitiveReplayPage />);
    await waitFor(() => expect(getByText(/No timeline events yet/i)).toBeInTheDocument());
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    // empty state offers a real CTA to go start a chat.
    expect(getByText(/Start a chat session/i)).toBeInTheDocument();
  });

  it('ERROR: a failed timeline fetch shows role=alert + a working Retry that re-fetches (not swallowed into empty)', async () => {
    let fail = true;
    const fetchMock = vi.fn(() => {
      if (fail) return Promise.reject(new Error('network down'));
      return fetchOk({ ok: true, events: EVENTS });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<CognitiveReplayPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Couldn't load your cognitive timeline/i)).toBeInTheDocument();
    // CRITICAL: the failure is NOT presented as the empty "no activity" state.
    expect(container.textContent).not.toMatch(/No timeline events yet/i);

    const before = fetchMock.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated — the error alert is gone and real content renders.
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeFalsy());
    expect(container.textContent).toMatch(/120 tokens/i);
    expect(container.textContent).not.toMatch(/No timeline events yet/i);
  });

  it('POPULATED: a successful load renders the real turn/token rollup header', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fetchOk({ ok: true, events: EVENTS })));
    const { container } = render(<CognitiveReplayPage />);
    // header is computed from the real events: 2 turns · 120 tokens · 1 DTU citation
    await waitFor(() => expect(container.textContent).toMatch(/120 tokens/i));
    expect(container.textContent).toMatch(/2 turns/i);
    expect(container.textContent).toMatch(/1 DTU citation/i);
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('a non-ok JSON body (ok:false) surfaces an error, not a silently-empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fetchOk({ ok: false, error: 'timeline unavailable' })));
    const { container, getByText } = render(<CognitiveReplayPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/timeline unavailable/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/No timeline events yet/i);
  });
});

describe('cognitive-replay lens — StatsBar child four UX states', () => {
  it('LOADING: StatsBar shows a role=status indicator while stats is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {}));
    const { container, getByText } = render(<StatsBar sinceDays={7} />);
    await waitFor(() => expect(getByText(/Computing aggregate stats/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('ERROR: a failed stats load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(() => {
      if (fail) return Promise.resolve({ data: { ok: false, error: 'stats offline' } });
      return lensReply({
        sinceDays: 7, turns: 3, sessions: 2, totalTokens: 320, avgTokensPerTurn: 107,
        totalToolCalls: 3, totalCitations: 3, topBrain: { brain: 'conscious', turns: 2 },
        topTool: null, busiestDay: { day: '2023-11-14', turns: 2 }, brainCounts: { conscious: 2 }, spanDays: 4,
      });
    });
    const { container, getByText } = render(<StatsBar sinceDays={7} />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/stats offline/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers to the real computed rollup (320 tokens).
    await waitFor(() => expect(getByText('320')).toBeInTheDocument());
  });

  it('POPULATED: renders the real aggregate values from the stats macro', async () => {
    lensRun.mockImplementation(() => lensReply({
      sinceDays: 7, turns: 3, sessions: 2, totalTokens: 320, avgTokensPerTurn: 107,
      totalToolCalls: 3, totalCitations: 3, topBrain: { brain: 'conscious', turns: 2 },
      topTool: null, busiestDay: { day: '2023-11-14', turns: 2 }, brainCounts: { conscious: 2 }, spanDays: 4,
    }));
    const { getByText } = render(<StatsBar sinceDays={7} />);
    await waitFor(() => expect(getByText('320')).toBeInTheDocument());
    expect(getByText('conscious')).toBeInTheDocument();
    expect(getByText(/2 sessions/i)).toBeInTheDocument();
  });
});
