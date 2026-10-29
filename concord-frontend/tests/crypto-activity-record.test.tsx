/**
 * ActivityPanel — transactions-record wiring (HANDOFF-3 batch L16b).
 *
 * The Activity tab listed transactions but offered no way to record
 * one manually: the backend `transactions-record` macro had no UI
 * caller, so an external/manual movement (e.g. a receive that did not
 * arrive through a panel action or CSV import) could not be logged.
 * This pins the record flow: open the form, fill kind/symbol/qty,
 * submit dispatches transactions-record, and the list refreshes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: mocks.lensRun }));

import { ActivityPanel } from '@/components/crypto/CryptoPanels';

describe('ActivityPanel record flow', () => {
  beforeEach(() => {
    mocks.lensRun.mockReset();
    mocks.lensRun.mockImplementation((req: { action: string }) => {
      if (req.action === 'transactions-list') return Promise.resolve({ data: { ok: true, result: { transactions: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  });

  it('records a transaction through the real transactions-record macro', async () => {
    render(<ActivityPanel />);
    fireEvent.click(await screen.findByTitle('Record a transaction manually'));

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'BTC' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('Total USD'), { target: { value: '30000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record transaction' }));

    await waitFor(() => {
      expect(mocks.lensRun).toHaveBeenCalledWith({
        domain: 'crypto',
        action: 'transactions-record',
        input: { kind: 'receive', symbol: 'btc', qty: 0.5, totalUsd: 30000, chain: 'ethereum', notes: '' },
      });
    });
    await waitFor(() => {
      expect(mocks.lensRun.mock.calls.filter((c) => c[0]?.action === 'transactions-list').length).toBeGreaterThan(1);
    });
  });
});
