import { describe, expect, it } from 'vitest';
import {
  dtuReadBackMatches,
  dtuRecordId,
  ledgerSentence,
  receiptDtuCall,
  sendReceiptOutcome,
  sendReceiptToFinanceCall,
  type LedgerReceipt,
} from '@/components/wallet/walletReceipt';

const paid: LedgerReceipt = {
  kind: 'request',
  sourceId: 'req_1',
  amount: 1.25,
  batchId: 'batch_1',
  counterparty: 'user_b',
  note: 'lunch',
};

describe('wallet receipt', () => {
  it('says paid or sent only when a ledger batch exists', () => {
    expect(ledgerSentence(paid)).toBe('Paid 1.25 CC. Ledger batch_1.');
    expect(ledgerSentence({ ...paid, kind: 'schedule' })).toBe('Sent 1.25 CC. Ledger batch_1.');
    expect(ledgerSentence({ ...paid, kind: 'split' })).toBe('Paid 1.25 CC. Ledger batch_1.');
    expect(ledgerSentence({ ...paid, batchId: '' })).toBeNull();
    expect(ledgerSentence({ ...paid, amount: 0 })).toBeNull();
  });

  it('builds a private receipt DTU from the ledger sentence', () => {
    const call = receiptDtuCall(paid);
    expect(call?.domain).toBe('dtu');
    expect(call?.action).toBe('create');
    expect(call?.input.source).toBe('wallet-lens:receipt');
    expect(call?.input.meta).toMatchObject({
      visibility: 'private',
      createdFrom: 'wallet',
      wallet: { kind: 'request', batchId: 'batch_1', sourceId: 'req_1' },
    });
    expect(String((call?.input.human as { summary: string }).summary)).toContain('Paid 1.25 CC. Ledger batch_1.');
    expect(receiptDtuCall({ ...paid, batchId: ' ' })).toBeNull();
  });

  it('accepts a DTU only after get returns the same id', () => {
    const created = { ok: true, result: { ok: true, dtu: { id: 'dtu_9' } } };
    expect(dtuRecordId(created)).toBe('dtu_9');
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'dtu_9' } } })).toBe(true);
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'dtu_8' } } })).toBe(false);
    expect(dtuRecordId({ ok: false, result: null })).toBe('');
  });

  it('sends the DTU to Finance only when the stored cite matches', () => {
    const call = sendReceiptToFinanceCall(paid, 'dtu_9');
    expect(call).toMatchObject({
      domain: 'finance',
      action: 'receipt-record',
      input: { citedDtuId: 'dtu_9', source: 'wallet-request', batchId: 'batch_1', amount: 1.25 },
    });
    expect(sendReceiptToFinanceCall(paid, 'not an id')).toBeNull();
    expect(sendReceiptToFinanceCall({ ...paid, batchId: '' }, 'dtu_9')).toBeNull();

    const sent = sendReceiptOutcome('dtu_9', {
      ok: true,
      result: { receipt: { id: 'rcpt_1', citedDtuId: 'dtu_9' } },
    });
    expect(sent.claimed).toBe(true);
    expect(sent.text).toBe('Sent DTU dtu_9 to Finance as receipt rcpt_1. Concord Coin was not moved again.');

    const missing = sendReceiptOutcome('dtu_9', {
      ok: true,
      result: { receipt: { id: 'rcpt_1', citedDtuId: '' } },
    });
    expect(missing.claimed).toBe(false);
    expect(missing.text).toContain('without DTU dtu_9');
    expect(missing.text).toContain('not moved again');

    const refused = sendReceiptOutcome('dtu_9', { ok: false, error: 'citedDtuId required', result: null });
    expect(refused.text).toBe('Not sent. citedDtuId required');
  });
});
