/**
 * cognition lens — four-UX-state contract for the TraceExports panel (the
 * lens's own per-user reasoning-trace export ledger, driven by the real
 * cognition.listExports / exportTrace / getExport / deleteExport macros).
 *
 * Pins genuine loading (role=status + aria-busy) / error (role=alert + a
 * working Retry that re-issues the list call) / empty / populated states
 * against the exact { exports, count } shape server/domains/cognition.js
 * returns — no fabricated data. lensRun (POST /api/lens/run → the domain) is
 * the only data path the panel uses, so it is the single mock surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// ReasoningTraceTree is a heavy presentational child; stub it (no fake DATA —
// it only renders a trace the test already provides).
vi.mock('@/components/cognition/ReasoningTraceTree', () => ({
  ReasoningTraceTree: () => null,
}));

import { TraceExports } from '@/components/cognition/TraceExports';

const EXPORT_META = {
  id: 'cogexp_1',
  title: 'My deduction',
  mode: 'deductive',
  traceId: 't_123',
  note: 'keep',
  createdAt: '2026-06-01T00:00:00.000Z',
};

// Resolve a listExports call to a given result/error shape.
function listResolves(result: { exports: unknown[]; count: number } | { __error: string }) {
  return (_domain: string, action: string) => {
    if (action === 'listExports') {
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

describe('cognition TraceExports — four UX states', () => {
  it('LOADING: shows a role=status spinner while the export list is in flight', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'listExports') return new Promise(() => {}); // never resolves
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TraceExports pendingTrace={null} />); });
    const loading = view!.getByTestId('trace-exports-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the listExports call', async () => {
    lensRunMock.mockImplementation(listResolves({ __error: 'boom' }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TraceExports pendingTrace={null} />); });

    await waitFor(() => expect(view!.getByTestId('trace-exports-error')).toBeInTheDocument());
    expect(view!.getByTestId('trace-exports-error')).toHaveAttribute('role', 'alert');
    expect(view!.getByTestId('trace-exports-error').textContent).toMatch(/boom/);

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'listExports').length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'listExports').length;
    expect(after).toBeGreaterThan(before);
  });

  it('EMPTY: shows an honest empty state when no exports are saved', async () => {
    lensRunMock.mockImplementation(listResolves({ exports: [], count: 0 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TraceExports pendingTrace={null} />); });
    await waitFor(() => expect(view!.getByTestId('trace-exports-empty')).toBeInTheDocument());
    expect(view!.getByTestId('trace-exports-empty').textContent).toMatch(/no exports yet/i);
  });

  it('POPULATED: renders saved exports with their accessible row actions (a11y)', async () => {
    lensRunMock.mockImplementation(listResolves({ exports: [EXPORT_META], count: 1 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TraceExports pendingTrace={null} />); });
    await waitFor(() => expect(view!.getByTestId('trace-exports-list')).toBeInTheDocument());
    expect(view!.getByTestId('trace-exports-list').textContent).toMatch(/My deduction/);
    // a11y: each row's view/delete actions carry accessible names.
    expect(view!.getByLabelText('View trace')).toBeInTheDocument();
    expect(view!.getByLabelText('Delete export')).toBeInTheDocument();
  });
});
