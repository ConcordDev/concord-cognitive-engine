import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// LensShell pulls in next/dynamic + the UI store + a11y hooks; stub it to a
// passthrough so this test isolates the ledger page's own four states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

// useLensData hits react-query + axios for the persisted watchlist; stub it to a
// quiet no-op so the test focuses on the ledger.anomalies surface.
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [],
    total: 0,
    isLoading: false,
    create: vi.fn(),
    remove: vi.fn(),
    refetch: vi.fn(),
  }),
}));

// lensRun is the real data path. Each test installs its own resolver.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// The server wraps a macro result as { ok, result, error }; lensRun returns
// { data: <that wrapper> }. Helper to build the real envelope shape.
function envelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

async function renderPage() {
  const { default: LedgerLensPage } = await import('@/app/lenses/ledger/page');
  render(React.createElement(LedgerLensPage));
}

describe('LedgerLensPage — four UX states', () => {
  beforeEach(() => { vi.resetModules(); lensRunMock.mockReset(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('LOADING: shows a polite reading status while the call is in flight', async () => {
    lensRunMock.mockReturnValue(new Promise(() => {})); // never resolves
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByText(/reading the books/i)).toBeInTheDocument();
  });

  it('ERROR: surfaces an honest alert + Retry when the macro returns ok:false', async () => {
    lensRunMock.mockResolvedValue(envelope({ ok: false, reason: 'no_db' }));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't read the ledger/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('EMPTY: shows the clean-record message when there are no anomalous flows', async () => {
    lensRunMock.mockResolvedValue(
      envelope({ ok: true, worldId: 'sere', managedParity: [], extractionLiens: [], total: 0 }),
    );
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/the record looks clean/i)).toBeInTheDocument();
    });
    // Not loading, not error.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('POPULATED: renders the real managed-parity funder + extraction lien from the data', async () => {
    lensRunMock.mockResolvedValue(
      envelope({
        ok: true,
        worldId: 'sere',
        managedParity: [
          { funder: 'the_tessera', fundsBothSidesOf: ['house_pell', 'house_varn'], detail: 'kept lit' },
        ],
        extractionLiens: [
          { creditor: 'the_mercy_fund', debtor: { kind: 'realm', id: 'house_pell' }, amount: 9000, collateral: { kind: 'building', id: 'tea_house' }, detail: 'rescue as acquisition' },
        ],
        total: 2,
      }),
    );
    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('managed-parity')).toBeInTheDocument();
    });
    // Real values from the data, not authored prose.
    expect(screen.getByText('the_tessera')).toBeInTheDocument();
    expect(screen.getByText(/house_pell and house_varn/)).toBeInTheDocument();
    expect(screen.getByTestId('extraction-liens')).toBeInTheDocument();
    expect(screen.getByText('the_mercy_fund')).toBeInTheDocument();
    expect(screen.getByText(/collateral: tea_house/)).toBeInTheDocument();
  });

  it('A11Y + WORKSPACE: exposes a world selector, refresh, and export controls', async () => {
    lensRunMock.mockResolvedValue(
      envelope({
        ok: true,
        worldId: 'sere',
        managedParity: [{ funder: 'the_tessera', fundsBothSidesOf: ['a', 'b'], detail: 'd' }],
        extractionLiens: [],
        total: 1,
      }),
    );
    await renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/world to audit/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export json/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /ledger controls/i })).toBeInTheDocument();
  });
});
