import { describe, expect, it } from 'vitest';
import { signedLedgerAmount } from '@/lib/economy/signed-ledger';
import { flattenHistoryPages } from '@/components/wallet/useWalletQueries';

describe('signedLedgerAmount', () => {
  it('shows an escrow the viewer paid as a debit', () => {
    expect(signedLedgerAmount(
      { amount: 10, from_user_id: 'me', to_user_id: 'escrow', type: 'STAKE_ESCROW' } as { amount: number; from_user_id: string; to_user_id: string },
      'me',
    )).toBe(-10);
  });

  it('shows a credit the viewer received as a credit', () => {
    expect(signedLedgerAmount(
      { amount: 136, from_user_id: null, to_user_id: 'me' },
      'me',
    )).toBe(136);
  });

  it('leaves a row alone when the page has no viewer id', () => {
    expect(signedLedgerAmount({ amount: 10 })).toBe(10);
  });
});

describe('flattenHistoryPages', () => {
  it('signs each page with that page viewer', () => {
    const rows = flattenHistoryPages([
      {
        userId: 'me',
        items: [
          { id: '1', type: 'STAKE_ESCROW', amount: 10, from_user_id: 'me', to_user_id: 'pool', created_at: '2026-01-01' },
          { id: '2', type: 'TIP', amount: 4, from_user_id: 'other', to_user_id: 'me', created_at: '2026-01-02' },
        ],
      },
    ]);
    expect(rows.map((row) => row.amount)).toEqual([-10, 4]);
  });
});
