/**
 * dx-platform DxWorkbench — four-UX-state contract for the codebase substrate
 * the whole workbench hangs off (Codebases & Chat · PR Review · Search · Team ·
 * Detectors · Analytics · CI). The workbench is driven entirely by the real
 * dx-platform.* macros over POST /api/lens/run (lensRun), so lensRun is the one
 * mock surface — no fabricated data.
 *
 * Pins genuine LOADING (role=status + aria-busy) / ERROR (role=alert + a
 * working Retry that re-issues the listCodebases call) / EMPTY (honest "index
 * one" affordance, no fake rows) / POPULATED (the indexed codebases render and
 * the chat picker becomes available) against the exact { codebases, count }
 * shape server/domains/dx-platform.js#listCodebases returns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// ChartKit is a heavy recharts wrapper only reachable on populated team/analytics
// tabs; stub it (it renders no fake DATA — only series the test would provide).
vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: () => null,
}));

import { DxWorkbench } from '@/components/dx-platform/DxWorkbench';

interface CodebaseRow {
  id: string; name: string; fileCount: number; totalLines: number;
  teamId: string | null; indexedAt: string;
}

const CB: CodebaseRow = {
  id: 'cb_1', name: 'Auth service', fileCount: 2, totalLines: 8,
  teamId: null, indexedAt: '2026-06-01T00:00:00.000Z',
};

// Resolve a listCodebases call to a given result/error shape; every other
// action resolves benignly so panel effects don't explode.
function listResolves(result: { codebases: CodebaseRow[]; count: number } | { __error: string }) {
  return (_domain: string, action: string) => {
    if (action === 'listCodebases') {
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

describe('dx-platform DxWorkbench — four UX states', () => {
  it('LOADING: shows a role=status spinner while the codebase list is in flight', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'listCodebases') return new Promise(() => {}); // never resolves
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<DxWorkbench />); });
    const loading = view!.getByTestId('dx-workbench-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the listCodebases call', async () => {
    lensRunMock.mockImplementation(listResolves({ __error: 'boom' }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<DxWorkbench />); });

    await waitFor(() => expect(view!.getByTestId('dx-workbench-error')).toBeInTheDocument());
    expect(view!.getByTestId('dx-workbench-error')).toHaveAttribute('role', 'alert');
    expect(view!.getByTestId('dx-workbench-error').textContent).toMatch(/boom/);

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'listCodebases').length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'listCodebases').length;
    expect(after).toBeGreaterThan(before);
  });

  it('EMPTY: shows an honest empty surface when no codebases are indexed', async () => {
    lensRunMock.mockImplementation(listResolves({ codebases: [], count: 0 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<DxWorkbench />); });
    await waitFor(() => expect(view!.getByTestId('dx-workbench-empty')).toBeInTheDocument());
    // honest affordance, not a fake row — the index form + a "no codebases" hint
    expect(view!.getByPlaceholderText('Codebase name')).toBeInTheDocument();
    expect(view!.getByText(/No codebases indexed yet/i)).toBeInTheDocument();
  });

  it('POPULATED: renders indexed codebases + an accessible tablist (a11y)', async () => {
    lensRunMock.mockImplementation(listResolves({ codebases: [CB], count: 1 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<DxWorkbench />); });
    await waitFor(() => expect(view!.getByTestId('dx-workbench-codebases')).toBeInTheDocument());
    // the indexed codebase surfaces in the chat picker option
    expect(view!.getByText(/Auth service \(2 files\)/)).toBeInTheDocument();
    // a11y: the workbench exposes a labelled tablist with selectable tabs
    expect(view!.getByRole('tablist', { name: /DX workbench/i })).toBeInTheDocument();
    const tabs = view!.getAllByRole('tab');
    expect(tabs.length).toBe(7);
    expect(tabs.some((t) => t.getAttribute('aria-selected') === 'true')).toBe(true);
  });
});
