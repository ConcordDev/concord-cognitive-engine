/**
 * /lenses/urban-planning — four-UX-state contract (Scenario Studio surface).
 *
 * Pins that the Urban Planning lens's ScenarioStudio tab renders genuine
 * loading / error (with a working Retry that re-fetches) / empty (CTA) /
 * populated states against the real macro surface
 * (lensRun('urban-planning', 'scenario-list' | 'scenario-create', …) → POST
 * /api/lens/run that server/domains/urbanplanning.js answers), plus a11y
 * (loading is role=status, error is role=alert with a working Retry button).
 *
 * Regression this guards: a scenario-list load FAILURE must NOT be swallowed
 * into a silently-empty "No scenarios yet" page (the defect fixed in ~12
 * sibling lenses) — a failed load now surfaces a role=alert with Retry.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, returning exactly the { scenarios: [...] } shape the
 * scenario-list macro returns (each scenario carrying the real computed
 * massing `impacts` bundle). ChartKit is stubbed inert so the surface mounts
 * headless.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the component's single backend channel ───────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ChartKit (used by the comparison view) — render a stub so the surface mounts.
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
}));

// Import AFTER mocks are registered.
import { ScenarioStudio } from '@/components/urban-planning/ScenarioStudio';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

// A real scenario shape, carrying the computed massing `impacts` the
// scenario-list macro folds in (mixed-use 20k-sqft lot → 35 units, 60 jobs).
const SCENARIO = {
  id: 'scn_abc',
  name: 'Transit Village',
  description: 'Mixed-use TOD',
  zoneType: 'mixed',
  lotSizeSqFt: 20000,
  useMix: 'mixed',
  efficiency: 0.82,
  impacts: {
    zoneType: 'mixed',
    lotSizeSqFt: 20000,
    floorAreaRatio: 3.0,
    lotCoveragePct: 80,
    footprintSqFt: 16000,
    floors: 4,
    buildingHeightFt: 44,
    maxHeightFt: 85,
    setbackFt: 5,
    grossFloorAreaSqFt: 64000,
    netFloorAreaSqFt: 52480,
    dwellingUnits: 35,
    jobs: 60,
    population: 84,
    emissionsTonnesPerYear: 287,
    envelope: { widthFt: 126, depthFt: 126, heightFt: 44 },
  },
};

beforeEach(() => { lensRun.mockReset(); });

describe('urban-planning ScenarioStudio — four UX states', () => {
  it('LOADING: shows a role=status indicator while scenario-list is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = render(<ScenarioStudio />);
    await waitFor(() => expect(getByText(/Loading scenarios/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: shows the honest "No scenarios yet" CTA when the list is empty', async () => {
    lensRun.mockImplementation(() => reply({ scenarios: [] }));
    const { getByText } = render(<ScenarioStudio />);
    await waitFor(() => expect(getByText(/No scenarios yet/i)).toBeInTheDocument());
  });

  it('ERROR: a failed scenario-list shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'scenario-list') {
        if (fail) return Promise.resolve({ data: { ok: false, error: 'scenario store offline' } });
        return reply({ scenarios: [SCENARIO] });
      }
      return reply({});
    });
    const { getByText, queryByText, container } = render(<ScenarioStudio />);

    // The failure surfaces as a role=alert — NOT the silently-empty CTA.
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/scenario store offline/i)).toBeInTheDocument();
    expect(queryByText(/No scenarios yet/i)).toBeNull();

    // Retry re-fetches and recovers to the populated state.
    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(getByText('Transit Village')).toBeInTheDocument());
  });

  it('POPULATED: renders the real scenario with its computed massing yield', async () => {
    lensRun.mockImplementation(() => reply({ scenarios: [SCENARIO] }));
    const { getByText, getAllByText } = render(<ScenarioStudio />);
    await waitFor(() => expect(getByText('Transit Village')).toBeInTheDocument());
    // the real computed massing values from the macro are rendered, not faked.
    expect(getAllByText(/44 ft/).length).toBeGreaterThan(0); // building height in MassingBox
    // 35 dwelling units appears in the impact grid.
    expect(getAllByText('35').length).toBeGreaterThan(0);
    expect(getAllByText('60').length).toBeGreaterThan(0); // jobs
  });

  it('a11y: the primary actions are real buttons with accessible text', async () => {
    lensRun.mockImplementation(() => reply({ scenarios: [] }));
    const { getByRole } = render(<ScenarioStudio />);
    await waitFor(() => expect(getByRole('button', { name: /Add Scenario/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Compare All/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /Refresh scenarios/i })).toBeInTheDocument();
  });
});
