/**
 * /lenses/ledger — four-UX-state contract (The Ledger, the Sere satire payoff).
 *
 * Pins that the Ledger lens renders genuine loading / error (with a WORKING
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('ledger', 'anomalies', { worldId }) → POST /api/lens/run that
 * server/domains/ledger.js answers), plus a11y (loading is role=status, error
 * is role=alert with a working Retry).
 *
 * THE LOAD-BEARING REGRESSION: a backend failure (no_db / handler throw)
 * surfaces at the ENVELOPE level (r.data.ok === false, result === null). The
 * page must render that as an ERROR (with Retry), NOT silently fall through to
 * the "record looks clean" empty state — which would lie to the auditor that a
 * closed ledger is a clean one. This file pins the fix.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, in exactly the { managedParity, extractionLiens, total }
 * shape the `anomalies` macro returns. The headless LensShell + the watchlist
 * substrate hook (useLensData) are stubbed inert so the test stays on the
 * page's own audit state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the page's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell: render-only stub ────────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

// ── watchlist substrate: inert (no real artifact backend in the unit test) ──
const createWatch = vi.fn();
const removeWatch = vi.fn();
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [],
    total: 0,
    isLoading: false,
    isError: false,
    error: null,
    create: createWatch,
    update: vi.fn(),
    remove: removeWatch,
    refetch: vi.fn(),
  }),
}));

// Import AFTER mocks are registered.
import LedgerLensPage from '@/app/lenses/ledger/page';

// lensRun returns the unwrapped { data: { ok, result, error } } envelope.
function reply(result: Record<string, unknown> | null, ok = true, error: string | null = null) {
  return Promise.resolve({ data: { ok, result, error } });
}

const POPULATED = {
  ok: true,
  worldId: 'sere',
  managedParity: [
    { kind: 'managed_parity', funder: 'the_tessera', fundsBothSidesOf: ['house_pell', 'house_varn'], detail: 'the war is kept lit' },
  ],
  extractionLiens: [
    { kind: 'extraction_lien', creditor: 'the_mercy_fund', debtor: { kind: 'realm', id: 'house_pell' }, amount: 9000, collateral: { kind: 'building', id: 'tea_house' }, dueAt: 9, detail: 'rescue as acquisition' },
  ],
  total: 2,
};

const EMPTY = { ok: true, worldId: 'concordia-hub', managedParity: [], extractionLiens: [], total: 0 };

beforeEach(() => {
  lensRun.mockReset();
  createWatch.mockReset();
  removeWatch.mockReset();
});

describe('ledger lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the audit is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { container } = render(<LedgerLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/Reading the books/i);
  });

  it('POPULATED: renders the real managed-parity + extraction-lien rows from the macro', async () => {
    lensRun.mockImplementation(() => reply(POPULATED));
    const { getByText, getByTestId } = render(<LedgerLensPage />);
    await waitFor(() => expect(getByTestId('managed-parity')).toBeInTheDocument());
    expect(getByTestId('extraction-liens')).toBeInTheDocument();
    // real values flow through, not placeholders
    expect(getByText(/the_tessera/)).toBeInTheDocument();
    expect(getByText(/house_pell and house_varn/)).toBeInTheDocument();
    expect(getByText(/the_mercy_fund/)).toBeInTheDocument();
    expect(getByText(/9000/)).toBeInTheDocument();
  });

  it('EMPTY: a clean world shows the honest "record looks clean" copy, not an error', async () => {
    lensRun.mockImplementation(() => reply(EMPTY));
    const { getByText, container } = render(<LedgerLensPage />);
    await waitFor(() => expect(getByText(/No anomalous flows surfaced/i)).toBeInTheDocument());
    // empty is NOT an error
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('ERROR (envelope ok:false): a closed ledger renders role=alert + working Retry — NOT a silent empty', async () => {
    // The load-bearing regression: result === null at the envelope level. The
    // page must show the error, never the "record looks clean" empty state.
    let fail = true;
    lensRun.mockImplementation(() => {
      if (fail) return reply(null, false, 'no_db');
      return reply(POPULATED);
    });
    const { getByText, container, queryByText } = render(<LedgerLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Couldn.t read the ledger/i)).toBeInTheDocument();
    expect(getByText(/no_db/)).toBeInTheDocument();
    // Crucially: the empty "record looks clean" copy must NOT be showing.
    expect(queryByText(/No anomalous flows surfaced/i)).toBeNull();

    // Retry actually re-fetches and recovers to populated.
    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(getByText(/the_tessera/)).toBeInTheDocument());
  });

  it('ERROR (request_failed): a thrown lensRun is surfaced as role=alert, not swallowed', async () => {
    lensRun.mockImplementation(() => Promise.reject(new Error('network down')));
    const { container } = render(<LedgerLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/request_failed/i);
  });

  it('a11y: the world selector + Refresh are real, accessible controls', async () => {
    lensRun.mockImplementation(() => reply(EMPTY));
    const { getByRole } = render(<LedgerLensPage />);
    await waitFor(() => expect(getByRole('combobox', { name: /World to audit/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
  });
});
