/**
 * sentinel lens — four-UX-state contract for the SentinelTriage workbench (the
 * threat-console's case state machine, driven by the real sentinel.triage.list
 * macro in server/domains/sentinel.js).
 *
 * Pins genuine LOADING (role=status + aria-busy) / ERROR (role=alert + a working
 * Retry that re-issues the triage.list call) / EMPTY / POPULATED states against
 * the exact `{ cases, total, byState }` shape the domain returns — no fabricated
 * data. lensRun (POST /api/lens/run → the domain) is the only data path the panel
 * uses, so it is the single mock surface. This also guards the saved-class wiring
 * fix: before the canonical-register rewrite every sentinel.* call hit
 * unknown_macro, so the panel could only ever render ERROR/EMPTY.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SentinelTriage } from '@/components/sentinel/SentinelTriage';

const CASE = {
  caseId: 'case_abc',
  threatId: 't-001',
  title: 'C2 beacon',
  severity: 'critical',
  state: 'open',
  assignee: null,
  description: 'Outbound beacon to known C2',
  vector: 'network',
  notes: [],
  correlatedIntel: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

// lensRun resolves to `{ data: { ok, result, error } }`.
function listResolves(
  result: { cases: unknown[]; total: number; byState: Record<string, number> } | { __error: string },
) {
  return (_domain: string, action: string) => {
    if (action === 'triage.list') {
      if ('__error' in result) {
        return Promise.resolve({ data: { ok: false, result: null, error: result.__error } });
      }
      return Promise.resolve({ data: { ok: true, result, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

async function renderTriage() {
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<SentinelTriage />); });
  return view!;
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('sentinel SentinelTriage — four UX states', () => {
  it('LOADING: shows a role=status spinner while triage.list is in flight', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'triage.list') return new Promise(() => {}); // never resolves
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    const view = await renderTriage();
    const loading = view.getByTestId('sentinel-triage-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the triage.list call', async () => {
    lensRunMock.mockImplementation(listResolves({ __error: 'unknown_macro' }));
    const view = await renderTriage();

    await waitFor(() => expect(view.getByTestId('sentinel-triage-error')).toBeInTheDocument());
    expect(view.getByTestId('sentinel-triage-error')).toHaveAttribute('role', 'alert');
    expect(view.getByTestId('sentinel-triage-error').textContent).toMatch(/unknown_macro/);

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'triage.list').length;
    await act(async () => { fireEvent.click(view.getByLabelText('Retry loading triage cases')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'triage.list').length;
    expect(after).toBeGreaterThan(before);
  });

  it('EMPTY: shows an honest empty state when no cases exist', async () => {
    lensRunMock.mockImplementation(listResolves({ cases: [], total: 0, byState: {} }));
    const view = await renderTriage();
    await waitFor(() => expect(view.getByTestId('sentinel-triage-empty')).toBeInTheDocument());
    expect(view.getByTestId('sentinel-triage-empty').textContent).toMatch(/no triage cases/i);
  });

  it('POPULATED: renders cases with accessible filter controls (a11y)', async () => {
    lensRunMock.mockImplementation(
      listResolves({ cases: [CASE], total: 1, byState: { open: 1 } }),
    );
    const view = await renderTriage();
    await waitFor(() => expect(view.getByTestId('sentinel-triage-list')).toBeInTheDocument());
    expect(view.getByTestId('sentinel-triage-list').textContent).toMatch(/C2 beacon/);
    // a11y: the state filter buttons expose aria-pressed.
    const allFilter = view.getByRole('button', { name: /^all$/i });
    expect(allFilter).toHaveAttribute('aria-pressed', 'true');
  });

  it('WIRED: triage.list is actually invoked (saved-class wiring regression)', async () => {
    lensRunMock.mockImplementation(
      listResolves({ cases: [CASE], total: 1, byState: { open: 1 } }),
    );
    await renderTriage();
    await waitFor(() =>
      expect(lensRunMock.mock.calls.some((c) => c[0] === 'sentinel' && c[1] === 'triage.list')).toBe(true),
    );
  });
});
