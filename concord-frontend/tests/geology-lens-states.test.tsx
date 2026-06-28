/**
 * /lenses/geology — four-UX-state contract for the geology lens.
 *
 * The geology page's load-bearing field-data panel is FieldLog, which drives
 * its observation journal through the REAL macro channel:
 *   lensRun('geology', 'observation-list', {…})  → POST /api/lens/run
 *   lensRun('geology', 'field-dashboard', {})     → POST /api/lens/run
 * (answered by the geology-domain registerLensAction handlers in
 * server/domains/geology.js). This pins that FieldLog renders genuine
 * loading / error (with a WORKING Retry that RE-FETCHES) / empty / populated
 * states against that real channel — no fabricated rows, and an error is
 * DISTINGUISHABLE from genuinely-empty (the silent-empty defect class).
 *
 * DISPATCH FIDELITY: /api/lens/run unwraps exactly one { ok, result } layer, so
 * the transport flag r.data.ok is ALWAYS true on a dispatched call and a handler
 * rejection surfaces as r.data.result.ok === false. The error fixtures cover
 * BOTH a transport failure ({ ok:false }) AND a handler rejection
 * ({ ok:true, result:{ ok:false, error } }) — FieldLog must surface either, not
 * collapse into the empty CTA.
 *
 * No fabricated data: every state is driven by a mocked lensRun returning
 * exactly the { data: { ok, result } } shapes the geology macros return.
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
import { FieldLog } from '@/components/geology/FieldLog';

// ── fixtures — exact geology-macro dispatch shapes ──────────────────────────
// Transport always succeeds (r.data.ok=true); the handler payload is r.data.result.
function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
// Transport-level failure (e.g. 401/500/STATE unavailable surfaced at r.data.ok).
function transportErr(message: string) {
  return Promise.resolve({ data: { ok: false, error: message } });
}
// Handler rejection unwrapped into result.ok===false (the real dispatch shape).
function handlerReject(message: string) {
  return Promise.resolve({ data: { ok: true, result: { ok: false, error: message } } });
}

const REAL_OBS = {
  id: 'obs_1',
  name: 'Marcellus roadcut',
  kind: 'outcrop',
  lat: 42.1,
  lon: -76.2,
  locationName: 'Hwy 9',
  formation: 'Marcellus',
  notes: 'black shale, fissile',
  tags: ['shale'],
  collectedAt: '2026-06-20',
};
const REAL_DASH = { totalObservations: 1, byKind: { outcrop: 1 }, geotagged: 1, formations: 1 };

// Route the mock by macro name so observation-list / field-dashboard each get
// the right response.
function wireLensRun(listResp: () => Promise<unknown>, dashResp: () => Promise<unknown> = () => ok(REAL_DASH)) {
  lensRunMock.mockImplementation((_domain: string, name: string) => {
    if (name === 'observation-list') return listResp();
    if (name === 'field-dashboard') return dashResp();
    return ok({});
  });
}

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe('geology lens (FieldLog) — wiring', () => {
  it('drives the observation-list macro on the geology domain at mount', async () => {
    wireLensRun(() => ok({ observations: [] }));
    await act(async () => { render(<FieldLog />); });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const calledNames = lensRunMock.mock.calls.map((c) => c[1]);
    expect(calledNames).toContain('observation-list');
    expect(calledNames).toContain('field-dashboard');
    expect(lensRunMock.mock.calls[0][0]).toBe('geology');
  });
});

describe('geology lens (FieldLog) — four UX states', () => {
  it('LOADING: shows a role=status cue and no fabricated rows while observation-list is in flight', () => {
    // never-resolving → stays in initial loading
    wireLensRun(() => new Promise(() => {}), () => new Promise(() => {}));
    const { getByRole, queryByText } = render(<FieldLog />);
    expect(getByRole('status')).toBeInTheDocument();
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(queryByText(/No observations logged yet/i)).toBeNull();
    expect(queryByText(/Marcellus roadcut/i)).toBeNull();
  });

  it('EMPTY: an empty list shows the honest CTA, distinct from loading, with no rows', async () => {
    wireLensRun(() => ok({ observations: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<FieldLog />); });
    await waitFor(() => expect(view!.getByText(/No observations logged yet/i)).toBeInTheDocument());
    // empty ≠ loading: the status spinner is gone, and no alert.
    expect(view!.queryByRole('status')).toBeNull();
    expect(view!.queryByRole('alert')).toBeNull();
    expect(view!.queryByText(/Marcellus roadcut/i)).toBeNull();
  });

  it('ERROR (transport): a { ok:false } verdict surfaces role=alert, never silent-empty', async () => {
    wireLensRun(() => transportErr('geology STATE unavailable'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<FieldLog />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/geology STATE unavailable/i)).toBeInTheDocument();
    // distinct from genuinely-empty
    expect(view!.queryByText(/No observations logged yet/i)).toBeNull();
  });

  it('ERROR (handler reject): an unwrapped result.ok===false also surfaces, never silent-empty', async () => {
    wireLensRun(() => handlerReject('observation index corrupt'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<FieldLog />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/observation index corrupt/i)).toBeInTheDocument();
    expect(view!.queryByText(/No observations logged yet/i)).toBeNull();
  });

  it('ERROR: a thrown/rejected lensRun (network down) surfaces an alert, not a stuck spinner', async () => {
    wireLensRun(() => Promise.reject(new Error('network down')));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<FieldLog />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/network down/i)).toBeInTheDocument();
    // not stuck loading
    expect(view!.queryByRole('status')).toBeNull();
  });

  it('ERROR → Retry RE-FETCHES the macro and recovers to populated', async () => {
    let fail = true;
    wireLensRun(() => (fail ? transportErr('temporary outage') : ok({ observations: [REAL_OBS] })));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<FieldLog />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    const callsBefore = lensRunMock.mock.calls.length;

    fail = false;
    const alert = view!.getByRole('alert');
    const retry = within(alert).getByRole('button', { name: /Retry/i });
    await act(async () => { fireEvent.click(retry); });

    // retry must re-invoke the backend (not window.reload) and recover.
    await waitFor(() => expect(view!.queryByRole('alert')).toBeNull());
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(view!.getByText(/Marcellus roadcut/i)).toBeInTheDocument();
  });

  it('POPULATED: a real observation from the macro renders with its fields', async () => {
    wireLensRun(() => ok({ observations: [REAL_OBS] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<FieldLog />); });
    await waitFor(() => expect(view!.getByText(/Marcellus roadcut/i)).toBeInTheDocument());
    // dashboard totals from field-dashboard render too
    expect(view!.getAllByText('1').length).toBeGreaterThan(0);
    expect(view!.queryByText(/No observations logged yet/i)).toBeNull();
  });
});
