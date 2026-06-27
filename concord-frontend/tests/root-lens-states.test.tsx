/**
 * root lens — four-UX-state contract for the ComputationNotebook (the lens's
 * own per-user saved-computation ledger, driven by the real root.history /
 * root.reload / root.deleteComputation / root.share macros over POST
 * /api/lens/run).
 *
 * Pins genuine loading (role=status + aria-busy) / error (role=alert + a
 * working Retry that re-issues the history call) / empty / populated states
 * against the exact { computations, total } shape server/domains/root.js
 * returns — no fabricated data. lensRun is the only data path the notebook
 * uses, so it is the single mock surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ComputationNotebook } from '@/components/root/ComputationNotebook';

const SAVED = {
  id: 'rc_1',
  kind: 'operation' as const,
  a: 4,
  b: 7,
  op: '+',
  label: '4 + 7',
  resultGlyph: '⟲⟲',
  resultDecimal: 11,
  createdAt: '2026-06-01T00:00:00.000Z',
};

// Resolve a history call to a given result/error shape; other macros succeed.
function historyResolves(
  result: { computations: unknown[]; total: number } | { __error: string },
) {
  return (_domain: string, action: string) => {
    if (action === 'history') {
      if ('__error' in result) {
        return Promise.resolve({ data: { ok: false, result: null, error: result.__error } });
      }
      return Promise.resolve({ data: { ok: true, result, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('root ComputationNotebook — four UX states', () => {
  it('LOADING: shows a role=status spinner while the history call is in flight', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'history') return new Promise(() => {}); // never resolves
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ComputationNotebook />); });
    const loading = view!.getByTestId('notebook-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the history call', async () => {
    lensRunMock.mockImplementation(historyResolves({ __error: 'Could not load history' }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ComputationNotebook />); });

    await waitFor(() => expect(view!.getByTestId('notebook-error')).toBeInTheDocument());
    expect(view!.getByTestId('notebook-error')).toHaveAttribute('role', 'alert');
    expect(view!.getByTestId('notebook-error').textContent).toMatch(/could not load history/i);

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'history').length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'history').length;
    expect(after).toBeGreaterThan(before);
  });

  it('EMPTY: shows an honest empty state when no computations are saved', async () => {
    lensRunMock.mockImplementation(historyResolves({ computations: [], total: 0 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ComputationNotebook />); });
    await waitFor(() => expect(view!.getByTestId('notebook-empty')).toBeInTheDocument());
    expect(view!.getByTestId('notebook-empty').textContent).toMatch(/no saved computations yet/i);
  });

  it('POPULATED: renders saved computations with accessible row actions (a11y)', async () => {
    lensRunMock.mockImplementation(historyResolves({ computations: [SAVED], total: 1 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ComputationNotebook />); });
    await waitFor(() => expect(view!.getByTestId('notebook-list')).toBeInTheDocument());
    expect(view!.getByTestId('notebook-list').textContent).toMatch(/4 \+ 7/);
    expect(view!.getByTestId('notebook-list').textContent).toMatch(/⟲⟲/);
    // a11y: each row's reload/share/delete actions carry accessible names.
    expect(view!.getByLabelText('Reload computation')).toBeInTheDocument();
    expect(view!.getByLabelText('Share computation')).toBeInTheDocument();
    expect(view!.getByLabelText('Delete computation')).toBeInTheDocument();
  });
});
