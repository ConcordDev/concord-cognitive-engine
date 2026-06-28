/**
 * ops lens — four-UX-state contract for IncidentConsole's primary surface (the
 * live incident list, driven by the real ops.incidentList macro).
 *
 * BACKGROUND: the `ops.*` domain was a dead saved-class domain (legacy
 * registerLensAction convention + never imported by server.js → every ops.*
 * call hit unknown_macro), so IncidentConsole was fully dead-wired despite
 * being built front-to-back. After the canonical-register fix the macros are
 * live; this test pins the four honest UX states the primary view now renders:
 * LOADING (role=status + aria-busy) / ERROR (role=alert + a working Retry that
 * re-issues the incidentList call) / EMPTY / POPULATED — against the exact
 * `{ incidents, total, open }` shape server/domains/ops.js#incidentList returns.
 *
 * lensRun (POST /api/lens/run → the domain) is the only data path the console
 * uses for incidents, so it is the single mock surface. The viz children are
 * stubbed (presentational only; no fabricated DATA).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Heavy presentational viz children — stub. They only render values the test
// already controls; keeps the test hermetic + fast.
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
  TreeDiagram: () => null,
}));

import { IncidentConsole } from '@/components/ops/IncidentConsole';

const INCIDENT = {
  id: 'inc_abc123',
  number: 1,
  title: 'Checkout 5xx spike',
  severity: 'sev1',
  status: 'triggered',
  source: 'manual',
  createdAt: '2026-06-27T00:00:00.000Z',
  timeline: [{ at: '2026-06-27T00:00:00.000Z', event: 'triggered' }],
};

// lensRun resolves to `{ data: { ok, result, error } }`. Resolve incidentList
// to a given shape; answer every OTHER on-mount loader benignly (empty result).
function incidentListResolves(
  result: { incidents: unknown[]; total: number; open: number } | { __error: string },
) {
  return (_domain: string, action: string) => {
    if (action === 'incidentList') {
      if ('__error' in result) {
        return Promise.resolve({ data: { ok: false, result: null, error: result.__error } });
      }
      return Promise.resolve({ data: { ok: true, result, error: null } });
    }
    // alertList / serviceList / serviceGraph / policyList / calendarView /
    // notifyList / analytics / statusPage on mount — benign empties.
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('ops IncidentConsole — four UX states (primary incident list)', () => {
  it('LOADING: shows a role=status spinner while the incident list is in flight', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'incidentList') return new Promise(() => {}); // never resolves
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<IncidentConsole />); });
    const loading = view!.getByTestId('ops-incidents-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the incidentList call', async () => {
    lensRunMock.mockImplementation(incidentListResolves({ __error: 'state unavailable' }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<IncidentConsole />); });

    await waitFor(() => expect(view!.getByTestId('ops-incidents-error')).toBeInTheDocument());
    const errEl = view!.getByTestId('ops-incidents-error');
    expect(errEl).toHaveAttribute('role', 'alert');
    expect(errEl.textContent).toMatch(/state unavailable/);

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'incidentList').length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'incidentList').length;
    expect(after).toBeGreaterThan(before);
  });

  it('EMPTY: shows an honest empty state when no incidents exist', async () => {
    lensRunMock.mockImplementation(incidentListResolves({ incidents: [], total: 0, open: 0 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<IncidentConsole />); });
    await waitFor(() => expect(view!.getByTestId('ops-incidents-empty')).toBeInTheDocument());
    expect(view!.getByTestId('ops-incidents-empty').textContent).toMatch(/no incidents yet/i);
  });

  it('POPULATED: renders the real incident rows from the macro result', async () => {
    lensRunMock.mockImplementation(incidentListResolves({ incidents: [INCIDENT], total: 1, open: 1 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<IncidentConsole />); });
    await waitFor(() => expect(view!.getByTestId('ops-incidents-list')).toBeInTheDocument());
    expect(view!.getByTestId('ops-incidents-list').textContent).toMatch(/Checkout 5xx spike/);
    // a11y: the open-count badge is real text, not a fabricated number.
    expect(view!.getByText('1 open')).toBeInTheDocument();
    // empty/error/loading are mutually exclusive with populated.
    expect(view!.queryByTestId('ops-incidents-empty')).toBeNull();
    expect(view!.queryByTestId('ops-incidents-error')).toBeNull();
  });
});
