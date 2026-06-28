/**
 * /lenses/household — four-UX-state contract for the household lens.
 *
 * The load-bearing data surface tested here is the ChoreBoard component (the
 * Tody-shape condition-based cleaning board mounted on the household page). It
 * drives household.{room-list,chore-board,assignee-leaderboard,household-dashboard}
 * through lensRun() at mount and is the component a user reads first.
 *
 * SWALLOWED-FETCH FIX (Phase-2 gate): lensRun() never throws — it resolves to
 * { data: { ok, result, error } }. The board previously read result?.board || []
 * and ignored ok, so a failed/unreachable chore-board rendered IDENTICALLY to a
 * genuinely-empty board (silent-empty hiding a backend outage). The component now
 * tracks an error + surfaces a role=alert with a WORKING "Try again" that
 * RE-FETCHES; these tests pin that an { ok:false } chore-board is DISTINGUISHABLE
 * from genuinely-empty, and that loading / empty / populated are each genuine.
 *
 * No fabricated data: every state is driven by a mocked lensRun returning exactly
 * the { ok, result } envelope the real macros return.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';

// Mock lensRun — the single channel ChoreBoard uses. Per-macro responses are
// supplied via the `responder` indirection so each test scripts its own backend.
let responder: (action: string) => { ok: boolean; result?: unknown; error?: string };
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string) => {
    const r = responder(action);
    return { data: { ok: r.ok, result: r.result ?? null, error: r.error ?? null } };
  }),
}));

// Import AFTER the mock is registered.
import { ChoreBoard } from '@/components/household/ChoreBoard';

const EMPTY = (action: string) => {
  switch (action) {
    case 'room-list': return { ok: true, result: { rooms: [], count: 0 } };
    case 'chore-board': return { ok: true, result: { board: [], needsAttention: 0, gettingDirty: 0, paused: false } };
    case 'assignee-leaderboard': return { ok: true, result: { leaderboard: [], totalChoresLogged: 0 } };
    case 'household-dashboard': return { ok: true, result: { rooms: 0, tasks: 0, cleanlinessPct: 100, needsAttention: 0, choresLoggedAllTime: 0, paused: false } };
    default: return { ok: true, result: {} };
  }
};
const POPULATED = (action: string) => {
  switch (action) {
    case 'room-list': return { ok: true, result: { rooms: [{ id: 'rm1', name: 'Kitchen', taskCount: 1 }], count: 1 } };
    case 'chore-board': return { ok: true, result: { board: [{ id: 'tk1', name: 'Wash dishes', room: 'Kitchen', assignee: 'Sam', effort: 'light', condition: { ratio: 1.2, state: 'needs_attention', daysOverdue: 2 } }], needsAttention: 1, gettingDirty: 0, paused: false } };
    case 'assignee-leaderboard': return { ok: true, result: { leaderboard: [{ person: 'Sam', points: 25, choresDone: 3 }], totalChoresLogged: 3 } };
    case 'household-dashboard': return { ok: true, result: { rooms: 1, tasks: 1, cleanlinessPct: 0, needsAttention: 1, choresLoggedAllTime: 3, paused: false } };
    default: return { ok: true, result: {} };
  }
};

beforeEach(() => { vi.clearAllMocks(); responder = EMPTY; });
afterEach(() => { vi.restoreAllMocks(); });

describe('household lens (ChoreBoard) — wiring', () => {
  it('drives household.chore-board through lensRun at mount', async () => {
    const { lensRun } = await import('@/lib/api/client');
    render(<ChoreBoard />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    const calls = (lensRun as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const actions = calls.map((c) => c[1]);
    expect(calls.every((c) => c[0] === 'household')).toBe(true);
    expect(actions).toContain('chore-board');
    expect(actions).toContain('household-dashboard');
  });
});

describe('household lens (ChoreBoard) — four UX states', () => {
  it('LOADING: shows a role=status indicator while the board is in flight', async () => {
    // never-resolving lensRun → stays in initial loading.
    const { lensRun } = await import('@/lib/api/client');
    (lensRun as unknown as { mockImplementation: (f: () => Promise<unknown>) => void })
      .mockImplementation(() => new Promise(() => {}));
    const { getByRole } = render(<ChoreBoard />);
    await waitFor(() => expect(getByRole('status')).toBeTruthy());
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('EMPTY: honest CTA (no fabricated rows), distinct from loading', async () => {
    responder = EMPTY;
    const { getByText, queryByRole } = render(<ChoreBoard />);
    await waitFor(() => expect(getByText(/No chores yet/i)).toBeTruthy());
    // empty is distinct from loading: the spinner is gone.
    expect(queryByRole('status')).toBeNull();
    // and no leaderboard rows were fabricated.
    expect(getByText(/No chores logged/i)).toBeTruthy();
  });

  it('ERROR: an { ok:false } chore-board surfaces role=alert + a working Try-again that re-fetches', async () => {
    let fail = true;
    responder = (action) => {
      if (fail && action === 'chore-board') return { ok: false, error: 'STATE unavailable' };
      return fail ? EMPTY(action) : POPULATED(action);
    };
    const { container, getByText, queryByText } = render(<ChoreBoard />);
    // swallowed-fetch must NOT silently render "No chores yet" — it surfaces an alert.
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Could not reach the chore board/i)).toBeTruthy();
    expect(getByText(/STATE unavailable/i)).toBeTruthy();
    // and it is NOT the genuinely-empty cue.
    expect(queryByText(/No chores yet/i)).toBeNull();

    // Try-again must re-invoke the backend and recover to populated.
    fail = false;
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    const retry = within(alert).getByRole('button', { name: /Try again/i });
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeFalsy());
    expect(getByText('Wash dishes')).toBeTruthy();
  });

  it('POPULATED: renders real board rows + leaderboard from the macro result', async () => {
    responder = POPULATED;
    const { getByText } = render(<ChoreBoard />);
    await waitFor(() => expect(getByText('Wash dishes')).toBeTruthy());
    // the overdue cue from the real condition is rendered.
    expect(getByText(/2d overdue/i)).toBeTruthy();
    // leaderboard person + points from the real result.
    expect(getByText('Sam')).toBeTruthy();
    expect(getByText('25')).toBeTruthy();
  });
});
