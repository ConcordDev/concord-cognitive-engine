/**
 * /lenses/forestry — four-UX-state contract for the Forestry lens.
 *
 * The forestry lens's primary STATE-backed surface is <StandManager/>, which
 * drives its stand list + dashboard through lensRun('forestry','stand-list') and
 * lensRun('forestry','forestry-dashboard') at mount. This pins that it renders
 * genuine loading / error (with a WORKING Try-again that RE-FETCHES) / empty /
 * populated states against that real channel.
 *
 * SWALLOWED-FETCH FIX (Phase-2 gate): StandManager.refresh used to `setStands(
 * sl.data?.result?.stands || [])` with NO error branch, so a backend failure
 * ({ ok:false } OR a thrown lensRun) rendered IDENTICALLY to a genuinely-empty
 * stand list ("No stands yet.") — a silent-empty that hid outages. refresh now
 * tracks loadError and surfaces a role=alert with a working retry; these tests
 * pin that an unreachable / { ok:false } stand-list is DISTINGUISHABLE from
 * genuinely-empty.
 *
 * No fabricated data: every state is driven by a mocked lensRun returning
 * exactly the { ok, result } envelope the stand-list/forestry-dashboard macros
 * return. The live wildfire feed button does its own fetch and is irrelevant to
 * the list state machine, so we let it sit inert (it never fires at mount).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';

// ── mock the lens run channel + the feed button (it fetches on click only) ──
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/lens/LensFeedButton', () => ({
  LensFeedButton: () => null,
}));

// Import AFTER mocks are registered.
import { StandManager } from '@/components/forestry/StandManager';

// ── envelope helpers ─────────────────────────────────────────────────────────
const env = (result: unknown, ok = true) => ({ data: { ok, result } });
const STANDS_EMPTY = env({ stands: [], count: 0, totalAcres: 0 });
const DASH_EMPTY = env({ stands: 0, totalAcres: 0, activities: 0, bySpecies: {} });
const STANDS_POPULATED = env({
  stands: [
    { id: 'std_1', name: 'North 40', species: 'douglas_fir', acres: 40, ageYears: 25, treesPerAcre: 200, estimatedTrees: 8000, activities: [], activityCount: 0 },
  ],
  count: 1, totalAcres: 40,
});
const DASH_POPULATED = env({ stands: 1, totalAcres: 40, activities: 0, bySpecies: { douglas_fir: 1 } });

// route the two parallel mount calls (stand-list + forestry-dashboard) to the
// right envelope so the test controls each independently.
function routeMount(standList: unknown, dashboard: unknown = DASH_EMPTY) {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'stand-list') return Promise.resolve(standList);
    if (action === 'forestry-dashboard') return Promise.resolve(dashboard);
    return Promise.resolve(env({}));
  });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('forestry lens — wiring', () => {
  it('drives stand-list + forestry-dashboard on the forestry domain at mount', async () => {
    routeMount(STANDS_EMPTY);
    render(<StandManager />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    const actions = lensRun.mock.calls.map((c) => [c[0], c[1]]);
    expect(actions).toContainEqual(['forestry', 'stand-list']);
    expect(actions).toContainEqual(['forestry', 'forestry-dashboard']);
  });
});

describe('forestry lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the stand list is in flight', async () => {
    // never-resolving lensRun → stays in initial loading.
    lensRun.mockImplementation(() => new Promise(() => {}));
    const { getByRole, getByText } = render(<StandManager />);
    await waitFor(() => expect(getByRole('status')).toBeInTheDocument());
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading stands/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest empty cue once an empty list resolves (not the loading state)', async () => {
    routeMount(STANDS_EMPTY);
    const { getByText, queryByRole } = render(<StandManager />);
    await waitFor(() => expect(getByText(/No stands yet/i)).toBeInTheDocument());
    // empty is distinct from loading: the role=status spinner is gone.
    expect(queryByRole('status')).toBeNull();
  });

  it('ERROR: an unreachable stand-list shows role=alert + a working Try-again that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (fail) return Promise.reject(new Error('network down'));
      if (action === 'stand-list') return Promise.resolve(STANDS_POPULATED);
      return Promise.resolve(DASH_POPULATED);
    });
    const { container, getByText, queryByText } = render(<StandManager />);
    // swallowed-fetch must NOT silently render "No stands yet." — it surfaces an alert.
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Could not reach the forestry service/i)).toBeInTheDocument();
    expect(queryByText(/No stands yet/i)).toBeNull();

    // Try-again must re-invoke the backend and recover to populated.
    fail = false;
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    const retry = within(alert).getByRole('button', { name: /Try again/i });
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeFalsy());
    expect(getByText('North 40')).toBeInTheDocument();
  });

  it('ERROR: a { ok:false } verdict (not just a thrown call) also surfaces, never silent-empty', async () => {
    routeMount(env({ stands: [] }, false), env({}, false));
    // attach an error message so the alert is informative.
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'stand-list') return Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } });
      return Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } });
    });
    const { container, getByText, queryByText } = render(<StandManager />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();
    expect(queryByText(/No stands yet/i)).toBeNull();
  });

  it('POPULATED: renders the real stand row + dashboard counts from the macro body', async () => {
    routeMount(STANDS_POPULATED, DASH_POPULATED);
    const { getByText } = render(<StandManager />);
    await waitFor(() => expect(getByText('North 40')).toBeInTheDocument());
    // derived estimatedTrees (8,000) + activity count render from the row.
    expect(getByText(/8,000 trees/i)).toBeInTheDocument();
  });
});
