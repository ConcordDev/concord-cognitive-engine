/**
 * /lenses/ethics — four-UX-state contract for the ethics DecisionToolkit.
 *
 * DecisionToolkit defaults to the Multi-Framework tab, whose load-bearing data
 * panel (MultiFrameworkPanel) drives its analysis list through the real macro
 * channel: lensRun('ethics', 'listMultiFramework', {}) → POST /api/lens/run
 * { domain:'ethics', name:'listMultiFramework' } (answered by the ethics-domain
 * macros). lensRun unwraps the { ok, result } envelope, so a handler rejection
 * lands as r.data.ok === false with r.data.error.
 *
 * This pins that the panel renders genuine LOADING / ERROR / EMPTY / POPULATED
 * states against that real channel — no fabricated rows, and an ERROR is
 * DISTINGUISHABLE from genuinely-EMPTY (the silent-empty defect class the prior
 * attempt left in place: `if (r.data.ok && r.data.result) setRecords(...)` with
 * no else rendered a failed load identically to an empty one). The ERROR state
 * also exposes a WORKING retry that RE-RUNS the loader — the test asserts the
 * second call fires and resolves to the populated list.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// ChartKit pulls in recharts/viz; the populated state renders it, so stub it to
// a marker so the four-state assertions stay focused on the load states.
vi.mock('@/components/viz', () => ({
  ChartKit: () => <div data-testid="chartkit" />,
}));

// Import AFTER the mocks are registered.
import { DecisionToolkit } from '@/components/ethics/DecisionToolkit';

// ── fixtures — exact ethics-macro result shapes ─────────────────────────────
function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const realAnalysis = {
  id: 'mfa-1',
  dilemma: 'Should we ship the contested feature?',
  options: [
    {
      name: 'Ship now',
      description: 'fast',
      scores: { utilitarian: 70, deontological: 40, virtue: 55 },
      composite: 55,
      agreement: 'mild-disagreement',
      benefit: 60,
      harm: 30,
    },
  ],
  recommended: 'Ship now',
  conflicted: [],
  createdAt: '2026-06-20T12:00:00.000Z',
};

// Dispatch the mock by macro name. listMultiFramework is the load-bearing list;
// the other macros the default panel may touch return benign success.
function wireLensRun(listResp: () => Promise<unknown>) {
  lensRunMock.mockImplementation((_domain: string, name: string) => {
    if (name === 'listMultiFramework') return listResp();
    return ok({});
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ethics lens (DecisionToolkit / Multi-Framework) — four UX states', () => {
  it('LOADING: shows the loading cue and no fabricated rows', () => {
    // listMultiFramework never resolves → panel stays in loading.
    wireLensRun(() => new Promise(() => {}));
    const { getByText, queryByText } = render(<DecisionToolkit />);
    expect(getByText(/Loading multi-framework analyses/i)).toBeInTheDocument();
    // no empty CTA and no record while loading.
    expect(queryByText(/No multi-framework analyses yet/i)).toBeNull();
    expect(queryByText(/Should we ship the contested feature/i)).toBeNull();
  });

  it('ERROR: a backend { error } surfaces a red alert distinct from empty', async () => {
    wireLensRun(() => err('ethics backend unreachable'));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<DecisionToolkit />);
    });
    await waitFor(() => {
      expect(view!.getByText(/ethics backend unreachable/i)).toBeInTheDocument();
    });
    // The red alert proves it did NOT silently collapse into the empty CTA —
    // the empty hint must NOT be present in the error state.
    expect(view!.getByRole('alert')).toBeInTheDocument();
    expect(view!.queryByText(/No multi-framework analyses yet/i)).toBeNull();
  });

  it('ERROR → retry RE-FETCHES and resolves to the populated list', async () => {
    // First load errors, retry succeeds with a real record.
    let calls = 0;
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name !== 'listMultiFramework') return ok({});
      calls += 1;
      return calls === 1
        ? err('transient outage')
        : ok({ analyses: [realAnalysis] });
    });
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<DecisionToolkit />);
    });
    await waitFor(() => {
      expect(view!.getByText(/transient outage/i)).toBeInTheDocument();
    });
    // Click the WORKING retry — it must re-run listMultiFramework.
    await act(async () => {
      fireEvent.click(view!.getByText(/Retry/i));
    });
    await waitFor(() => {
      expect(view!.getByText(/Should we ship the contested feature/i)).toBeInTheDocument();
    });
    // Two listMultiFramework calls fired (initial + retry).
    const listCalls = lensRunMock.mock.calls.filter((c) => c[1] === 'listMultiFramework');
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
    expect(view!.queryByText(/transient outage/i)).toBeNull();
  });

  it('EMPTY: an empty analysis list shows the honest CTA and no fabricated rows', async () => {
    wireLensRun(() => ok({ analyses: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<DecisionToolkit />);
    });
    await waitFor(() => {
      expect(view!.getByText(/No multi-framework analyses yet/i)).toBeInTheDocument();
    });
    expect(view!.queryByText(/Should we ship the contested feature/i)).toBeNull();
    // empty is NOT an error.
    expect(view!.queryByRole('alert')).toBeNull();
  });

  it('POPULATED: a real analysis from the macro renders in the list', async () => {
    wireLensRun(() => ok({ analyses: [realAnalysis] }));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<DecisionToolkit />);
    });
    await waitFor(() => {
      expect(view!.getByText(/Should we ship the contested feature/i)).toBeInTheDocument();
    });
    // recommended option name is rendered from the macro record (appears in
    // both the "Recommended:" line and the per-option breakdown row).
    expect(view!.getAllByText(/Ship now/).length).toBeGreaterThanOrEqual(1);
    expect(view!.queryByText(/No multi-framework analyses yet/i)).toBeNull();
  });
});
