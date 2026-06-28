/**
 * society lens — four-UX-state contract for the DataExplorer "Saved charts"
 * panel (the lens's shareable-permalink ledger, driven by the real
 * society.wb-list-charts macro). Also pins the lensRun envelope-unwrap fix in
 * the DataExplorer `macro()` helper (PRIOR BUG: it read `'ok' in r` off the
 * outer `{ data }` wrapper, so every view rendered nothing).
 *
 * Pins genuine LOADING (role=status + aria-busy) / ERROR (role=alert + a
 * working Retry that re-issues the list call) / EMPTY / POPULATED states
 * against the exact `{ charts, count }` shape server/domains/society.js
 * returns — no fabricated data. lensRun (POST /api/lens/run → the domain) is
 * the only data path the panel uses, so it is the single mock surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Heavy presentational viz children — stub (no fake DATA; they only render
// values the test already provides). Keeps the test hermetic + fast.
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  MapView: () => null,
}));

import { DataExplorer } from '@/components/society/DataExplorer';

const CHART = {
  id: 'soc_abc123',
  title: 'US GDP/cap',
  createdAt: '2026-06-01T00:00:00.000Z',
  permalink: '/lenses/society?chart=soc_abc123',
};

// lensRun resolves to `{ data: { ok, result, error } }`. Resolve wb-list-charts
// to a given shape and answer the on-mount wb-common-indicators call benignly.
function listResolves(
  result: { charts: unknown[]; count: number } | { __error: string },
) {
  return (_domain: string, action: string) => {
    if (action === 'wb-list-charts') {
      if ('__error' in result) {
        return Promise.resolve({ data: { ok: false, result: null, error: result.__error } });
      }
      return Promise.resolve({ data: { ok: true, result, error: null } });
    }
    // wb-common-indicators / wb-load-chart on mount
    return Promise.resolve({ data: { ok: true, result: { indicators: {} }, error: null } });
  };
}

// Render DataExplorer and switch to the "Saved" view (where SavedView mounts).
async function renderSaved() {
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<DataExplorer />); });
  await act(async () => { fireEvent.click(view!.getByRole('button', { name: 'Saved' })); });
  return view!;
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('society DataExplorer Saved panel — four UX states', () => {
  it('LOADING: shows a role=status spinner while the chart list is in flight', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'wb-list-charts') return new Promise(() => {}); // never resolves
      return Promise.resolve({ data: { ok: true, result: { indicators: {} }, error: null } });
    });
    const view = await renderSaved();
    const loading = view.getByTestId('society-saved-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the wb-list-charts call', async () => {
    lensRunMock.mockImplementation(listResolves({ __error: 'boom' }));
    const view = await renderSaved();

    await waitFor(() => expect(view.getByTestId('society-saved-error')).toBeInTheDocument());
    expect(view.getByTestId('society-saved-error')).toHaveAttribute('role', 'alert');
    expect(view.getByTestId('society-saved-error').textContent).toMatch(/boom/);

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'wb-list-charts').length;
    await act(async () => { fireEvent.click(view.getByText('Retry')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'wb-list-charts').length;
    expect(after).toBeGreaterThan(before);
  });

  it('EMPTY: shows an honest empty state when no charts are saved', async () => {
    lensRunMock.mockImplementation(listResolves({ charts: [], count: 0 }));
    const view = await renderSaved();
    await waitFor(() => expect(view.getByTestId('society-saved-empty')).toBeInTheDocument());
    expect(view.getByTestId('society-saved-empty').textContent).toMatch(/no saved charts yet/i);
  });

  it('POPULATED: renders saved charts with an accessible copy-link action (a11y)', async () => {
    lensRunMock.mockImplementation(listResolves({ charts: [CHART], count: 1 }));
    const view = await renderSaved();
    await waitFor(() => expect(view.getByTestId('society-saved-list')).toBeInTheDocument());
    expect(view.getByTestId('society-saved-list').textContent).toMatch(/US GDP\/cap/);
    // a11y: the copy action + refresh control carry accessible names.
    expect(view.getByLabelText('Copy permalink for US GDP/cap')).toBeInTheDocument();
    expect(view.getByLabelText('Refresh saved charts')).toBeInTheDocument();
  });

  it('UNWRAP: macro() reads the real { data: { ok, result } } shape (regression)', async () => {
    // If the prior `'ok' in r` bug were present, result would be the outer
    // `{ data }` wrapper and the list would never populate → EMPTY would show.
    lensRunMock.mockImplementation(listResolves({ charts: [CHART], count: 1 }));
    const view = await renderSaved();
    await waitFor(() => expect(view.getByTestId('society-saved-list')).toBeInTheDocument());
    expect(view.queryByTestId('society-saved-empty')).toBeNull();
  });
});
