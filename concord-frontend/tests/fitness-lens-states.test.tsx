/**
 * /lenses/fitness — four-UX-state contract for the fitness lens.
 *
 * The fitness page's Apple-Fitness ring surface is ActivityRings, which drives
 * its day data through the REAL macro channel:
 *   lensRun({ domain:'fitness', action:'activity-summary', input:{ days:7 } })
 *     → POST /api/lens/run
 * (answered by the fitness-domain registerLensAction handler in
 * server/domains/fitness.js). This pins that ActivityRings renders genuine
 * loading / error (with a WORKING Retry that RE-FETCHES) / empty / populated
 * states against that real channel — no fabricated rows, and an error is
 * DISTINGUISHABLE from genuinely-empty (the silent-empty defect class the
 * component previously had — it swallowed errors into console.error and fell to
 * the empty CTA).
 *
 * DISPATCH FIDELITY: lensRun() returns { data: { ok, result, error } } with one
 * { ok, result } layer already unwrapped, so a handler rejection surfaces as
 * res.data.ok === false. The error fixtures cover BOTH a transport failure
 * ({ ok:false }) AND a thrown promise — ActivityRings must surface either, not
 * collapse into the empty CTA.
 *
 * SleepRecovery is covered too — it shares the same harden-against-silent-empty
 * pattern and renders the recovery-history field contract.
 *
 * No fabricated data: every state is driven by a mocked lensRun returning
 * exactly the { data: { ok, result } } shapes the fitness macros return.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent, within } from '@testing-library/react';
import React from 'react';

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { ActivityRings } from '@/components/fitness/ActivityRings';
import { SleepRecovery } from '@/components/fitness/SleepRecovery';

// ── fixtures — exact fitness-macro dispatch shapes ──────────────────────────
// lensRun unwraps one { ok, result } layer; transport success → res.data.ok=true.
function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
// Transport/handler rejection unwrapped into res.data.ok===false (real shape).
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

// A real activity-summary day row, in the shape the handler emits (the rendered
// field contract: moveCalories / moveGoal / exerciseMinutes / standHours / …).
const REAL_DAY = {
  date: '2026-06-27',
  moveCalories: 500, moveGoal: 600,
  exerciseMinutes: 40, exerciseGoal: 30,
  standHours: 8, standGoal: 12,
  steps: 9000, stepsGoal: 10000,
};

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe('fitness lens (ActivityRings) — wiring', () => {
  it('drives the activity-summary macro on the fitness domain at mount', async () => {
    lensRunMock.mockImplementation(() => ok({ days: [REAL_DAY] }));
    await act(async () => { render(<ActivityRings />); });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const spec = lensRunMock.mock.calls[0][0] as { domain: string; action: string };
    expect(spec.domain).toBe('fitness');
    expect(spec.action).toBe('activity-summary');
  });
});

describe('fitness lens (ActivityRings) — four UX states', () => {
  it('LOADING: shows a role=status cue and no fabricated rows while in flight', () => {
    lensRunMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByRole, queryByText } = render(<ActivityRings />);
    expect(getByRole('status')).toBeInTheDocument();
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(queryByText(/No activity data yet/i)).toBeNull();
  });

  it('EMPTY: an empty list shows the honest CTA, distinct from loading + no alert', async () => {
    lensRunMock.mockImplementation(() => ok({ days: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ActivityRings />); });
    await waitFor(() => expect(view!.getByText(/No activity data yet/i)).toBeInTheDocument());
    expect(view!.queryByRole('status')).toBeNull();
    expect(view!.queryByRole('alert')).toBeNull();
  });

  it('ERROR (handler/transport reject): res.data.ok===false surfaces role=alert, never silent-empty', async () => {
    lensRunMock.mockImplementation(() => err('fitness STATE unavailable'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ActivityRings />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/fitness STATE unavailable/i)).toBeInTheDocument();
    expect(view!.queryByText(/No activity data yet/i)).toBeNull();
  });

  it('ERROR: a thrown/rejected lensRun (network down) surfaces an alert, not a stuck spinner', async () => {
    lensRunMock.mockImplementation(() => Promise.reject(new Error('network down')));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ActivityRings />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/network down/i)).toBeInTheDocument();
    expect(view!.queryByRole('status')).toBeNull();
  });

  it('ERROR → Retry RE-FETCHES the macro and recovers to populated', async () => {
    let fail = true;
    lensRunMock.mockImplementation(() => (fail ? err('temporary outage') : ok({ days: [REAL_DAY] })));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ActivityRings />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    const callsBefore = lensRunMock.mock.calls.length;

    fail = false;
    const alert = view!.getByRole('alert');
    const retry = within(alert).getByRole('button', { name: /Retry/i });
    await act(async () => { fireEvent.click(retry); });

    await waitFor(() => expect(view!.queryByRole('alert')).toBeNull());
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(view!.getByText(/Activity rings/i)).toBeInTheDocument();
  });

  it('POPULATED: a real day from the macro renders its move/steps values', async () => {
    lensRunMock.mockImplementation(() => ok({ days: [REAL_DAY] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ActivityRings />); });
    await waitFor(() => expect(view!.getByText(/Activity rings/i)).toBeInTheDocument());
    // real move + steps values render (500 / 600, 9,000 / 10,000)
    expect(view!.getByText(/500 \/ 600/)).toBeInTheDocument();
    expect(view!.getByText(/9,000 \/ 10,000/)).toBeInTheDocument();
    expect(view!.queryByText(/No activity data yet/i)).toBeNull();
  });
});

// ── SleepRecovery — same silent-empty hardening + field contract ────────────
const REAL_RECOVERY = {
  date: '2026-06-27',
  recoveryScore: 80,
  sleepDurationHours: 7.5,
  sleepQualityPct: 88,
  restingHr: 50,
  hrv: 65,
  strainYesterday: 12.3,
};

describe('fitness lens (SleepRecovery) — error is distinct from empty', () => {
  it('EMPTY: no rows → honest CTA, no alert', async () => {
    lensRunMock.mockImplementation(() => ok({ days: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<SleepRecovery />); });
    await waitFor(() => expect(view!.getByText(/No recovery data/i)).toBeInTheDocument());
    expect(view!.queryByRole('alert')).toBeNull();
  });

  it('ERROR: res.data.ok===false surfaces an alert with a working Retry, never silent-empty', async () => {
    let fail = true;
    lensRunMock.mockImplementation(() => (fail ? err('recovery index corrupt') : ok({ days: [REAL_RECOVERY] })));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<SleepRecovery />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/recovery index corrupt/i)).toBeInTheDocument();
    expect(view!.queryByText(/No recovery data/i)).toBeNull();

    fail = false;
    const retry = within(view!.getByRole('alert')).getByRole('button', { name: /Retry/i });
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(view!.queryByRole('alert')).toBeNull());
    // the recovery-history field contract renders (sleep 7.5h)
    expect(view!.getByText(/7\.5h/)).toBeInTheDocument();
  });

  it('POPULATED: a real recovery row renders recovery % + sleep hours', async () => {
    lensRunMock.mockImplementation(() => ok({ days: [REAL_RECOVERY] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<SleepRecovery />); });
    await waitFor(() => expect(view!.getByText(/80%/)).toBeInTheDocument());
    expect(view!.getByText(/7\.5h/)).toBeInTheDocument();
  });
});
