/**
 * /lenses/eco — four-UX-state contract for the eco lens.
 *
 * The eco page drives its substrate through TWO real macro channels:
 *   1. raw  api.post('/api/lens/run', { domain:'eco', action, input })  — the
 *      BiodiversityLog "life list" tab. /api/lens/run single-unwraps the handler
 *      envelope, so a handler REJECTION lands at res.data.result = { ok:false,
 *      error } (NOT res.data.ok). BiodiversityLog must surface that as an error,
 *      never collapse into the empty CTA (the silent-empty defect class).
 *   2. lensRun('eco', action, input)  — the EcoChallenges tab. lensRun fully
 *      unwraps, so a handler rejection surfaces as r.data.ok === false.
 *
 * This pins genuine loading / error (with a WORKING Retry that RE-FETCHES) /
 * empty (honest CTA) / populated states against BOTH channels — no fabricated
 * rows, and an error is DISTINGUISHABLE from genuinely-empty.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent, within } from '@testing-library/react';
import React from 'react';

// ── mock BOTH macro channels ────────────────────────────────────────────────
const apiPostMock = vi.fn();
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => apiPostMock(...args) },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { BiodiversityLog } from '@/components/eco/BiodiversityLog';
import { EcoChallenges } from '@/components/eco/EcoChallenges';

// ── fixtures ────────────────────────────────────────────────────────────────
// /api/lens/run transport always succeeds (axios resolves); a handler rejection
// rides INSIDE res.data.result = { ok:false, error } because the server
// single-unwraps the envelope. A POPULATED handler success rides as
// res.data.result = <payload>.
function postOk(payload: unknown) {
  return Promise.resolve({ data: { ok: true, result: payload } });
}
function postHandlerReject(message: string) {
  return Promise.resolve({ data: { ok: true, result: { ok: false, error: message } } });
}
function postNetworkThrow(message: string) {
  return Promise.reject(new Error(message));
}

// lensRun fully unwraps: handler rejection → { data: { ok:false, error } }.
function runOk(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function runReject(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const REAL_OBS = {
  id: 'obs_1',
  commonName: 'Red-tailed Hawk',
  scientificName: 'Buteo jamaicensis',
  observedAt: '2026-06-20T00:00:00.000Z',
  lat: 37.7,
  lng: -122.4,
  notes: 'perched on a snag',
};

const REAL_CHALLENGE = {
  slug: 'meatless-monday',
  title: 'Meatless Monday',
  category: 'food',
  cadence: 'weekly',
  points: 25,
  kgCo2eSavedPerCheckIn: 2.3,
  description: 'Swap one meat-based day for plant-based meals.',
  citation: 'Poore & Nemecek (2018)',
};

beforeEach(() => { apiPostMock.mockReset(); lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
// Channel 1 — BiodiversityLog (raw api.post('/api/lens/run'))
// ─────────────────────────────────────────────────────────────────────────────
describe('eco lens (BiodiversityLog, raw api.post channel) — wiring', () => {
  it('drives biodiversity-list on the eco domain at mount', async () => {
    apiPostMock.mockImplementation(() => postOk({ observations: [], total: 0 }));
    await act(async () => { render(<BiodiversityLog />); });
    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    const [url, body] = apiPostMock.mock.calls[0];
    expect(url).toBe('/api/lens/run');
    expect(body.domain).toBe('eco');
    expect(body.action).toBe('biodiversity-list');
  });
});

describe('eco lens (BiodiversityLog) — four UX states', () => {
  it('LOADING: shows a role=status cue and no fabricated rows while in flight', () => {
    apiPostMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByRole, queryByText } = render(<BiodiversityLog />);
    expect(getByRole('status')).toBeInTheDocument();
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(queryByText(/No species observed yet/i)).toBeNull();
    expect(queryByText(/Red-tailed Hawk/i)).toBeNull();
  });

  it('EMPTY: an empty list shows the honest CTA, distinct from loading + error', async () => {
    apiPostMock.mockImplementation(() => postOk({ observations: [], total: 0 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<BiodiversityLog />); });
    await waitFor(() => expect(view!.getByText(/No species observed yet/i)).toBeInTheDocument());
    expect(view!.queryByRole('status')).toBeNull();
    expect(view!.queryByRole('alert')).toBeNull();
    expect(view!.queryByText(/Red-tailed Hawk/i)).toBeNull();
  });

  it('ERROR (handler reject in res.data.result): surfaces role=alert, never silent-empty', async () => {
    apiPostMock.mockImplementation(() => postHandlerReject('eco STATE unavailable'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<BiodiversityLog />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/eco STATE unavailable/i)).toBeInTheDocument();
    // distinct from genuinely-empty
    expect(view!.queryByText(/No species observed yet/i)).toBeNull();
  });

  it('ERROR (network throw): surfaces an alert, not a stuck spinner', async () => {
    apiPostMock.mockImplementation(() => postNetworkThrow('network down'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<BiodiversityLog />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/network down/i)).toBeInTheDocument();
    expect(view!.queryByRole('status')).toBeNull();
  });

  it('ERROR → Retry RE-FETCHES the macro and recovers to populated', async () => {
    let fail = true;
    apiPostMock.mockImplementation(() =>
      fail ? postHandlerReject('temporary outage') : postOk({ observations: [REAL_OBS], total: 1 }),
    );
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<BiodiversityLog />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    const callsBefore = apiPostMock.mock.calls.length;

    fail = false;
    const alert = view!.getByRole('alert');
    const retry = within(alert).getByRole('button', { name: /Retry/i });
    await act(async () => { fireEvent.click(retry); });

    await waitFor(() => expect(view!.queryByRole('alert')).toBeNull());
    expect(apiPostMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(view!.getByText(/Red-tailed Hawk/i)).toBeInTheDocument();
  });

  it('POPULATED: a real observation renders with its fields', async () => {
    apiPostMock.mockImplementation(() => postOk({ observations: [REAL_OBS], total: 1 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<BiodiversityLog />); });
    await waitFor(() => expect(view!.getByText(/Red-tailed Hawk/i)).toBeInTheDocument());
    expect(view!.getByText(/Buteo jamaicensis/i)).toBeInTheDocument();
    expect(view!.queryByText(/No species observed yet/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel 2 — EcoChallenges (lensRun)
// ─────────────────────────────────────────────────────────────────────────────
function wireChallenges(
  catalog: () => Promise<unknown>,
  mine: () => Promise<unknown> = () => runOk({ enrollments: [], totalPoints: 0, totalKgSaved: 0, bestStreak: 0, activeCount: 0 }),
) {
  lensRunMock.mockImplementation((_domain: string, name: string) => {
    if (name === 'challenges-catalog') return catalog();
    if (name === 'challenges-mine') return mine();
    return runOk({});
  });
}

describe('eco lens (EcoChallenges, lensRun channel) — wiring + states', () => {
  it('drives challenges-catalog + challenges-mine on the eco domain at mount', async () => {
    wireChallenges(() => runOk({ challenges: [], count: 0 }));
    await act(async () => { render(<EcoChallenges />); });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const names = lensRunMock.mock.calls.map((c) => c[1]);
    expect(names).toContain('challenges-catalog');
    expect(names).toContain('challenges-mine');
    expect(lensRunMock.mock.calls[0][0]).toBe('eco');
  });

  it('LOADING: shows the loading cue, no fabricated challenge rows', () => {
    wireChallenges(() => new Promise(() => {}), () => new Promise(() => {}));
    const { getByText, queryByText } = render(<EcoChallenges />);
    expect(getByText(/Loading challenges/i)).toBeInTheDocument();
    expect(queryByText(/Meatless Monday/i)).toBeNull();
  });

  it('ERROR (both channels reject): surfaces an error, never silent-empty', async () => {
    wireChallenges(() => runReject('challenges index corrupt'), () => runReject('challenges index corrupt'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EcoChallenges />); });
    await waitFor(() => expect(view!.getByText(/Could not load challenges/i)).toBeInTheDocument());
  });

  it('POPULATED: a real catalog challenge renders with its fields', async () => {
    wireChallenges(() => runOk({ challenges: [REAL_CHALLENGE], count: 1 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EcoChallenges />); });
    await waitFor(() => expect(view!.getByText(/Meatless Monday/i)).toBeInTheDocument());
    expect(view!.getByText(/Poore & Nemecek/i)).toBeInTheDocument();
  });
});
