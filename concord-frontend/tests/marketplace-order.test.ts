import { describe, expect, it } from 'vitest';
import {
  checkoutFromLensResult,
  dtuReadBackMatches,
  dtuRecordId,
  offlineSentence,
  orderDtuCall,
  paidSentence,
  payRefusal,
  sendOrderOutcome,
  sendOrderToFinanceCall,
  type SettledOrder,
} from '@/components/marketplace/marketplaceOrder';

const paid: SettledOrder = {
  id: 'ord_1',
  number: 'O-00001',
  sellerId: 's1',
  listingTitle: 'Mug',
  totalUsd: 20,
  paidCc: 20,
  batchId: 'batch_1',
  feeCc: 1.09,
  sellerNetCc: 18.91,
};

describe('marketplace order payment', () => {
  it('reads the checkout object the server actually returns', () => {
    const nested = checkoutFromLensResult({
      checkout: {
        number: 'CO-00001',
        grandTotalUsd: 20,
        orders: [{ orderId: 'ord_1', number: 'O-00001', sellerId: 's1', totalUsd: 20 }],
      },
    });
    expect(nested?.orders[0].orderId).toBe('ord_1');
    expect(nested?.number).toBe('CO-00001');
    expect(checkoutFromLensResult({ number: 'CO-00002', grandTotalUsd: 20, orders: [] })).toBeNull();
    expect(checkoutFromLensResult({ listings: [] })).toBeNull();
  });

  it('says paid only when a ledger batch exists', () => {
    expect(paidSentence(paid)).toBe('Paid 20.00 CC. Ledger batch_1. Shop sticker $20.00. No card was charged.');
    expect(paidSentence({ ...paid, batchId: '' })).toBeNull();
    expect(paidSentence({ ...paid, paidCc: 0 })).toBeNull();
    expect(payRefusal('insufficient_balance')).toContain('Not paid.');
    expect(payRefusal('insufficient_balance')).toContain('not moved');
    expect(offlineSentence({ status: 'paid', paymentStatus: 'recorded_offline' })).toBe('Recorded offline. Concord Coin was not moved.');
    expect(offlineSentence(paid)).toBeNull();
  });

  it('builds a private receipt DTU from the ledger sentence', () => {
    const call = orderDtuCall(paid);
    expect(call?.domain).toBe('dtu');
    expect(call?.action).toBe('create');
    expect(call?.input.source).toBe('marketplace-lens:order');
    expect(call?.input.meta).toMatchObject({
      visibility: 'private',
      createdFrom: 'marketplace',
      marketplace: { orderId: 'ord_1', batchId: 'batch_1', paidCc: 20 },
    });
    expect(String((call?.input.human as { summary: string }).summary)).toContain('Paid 20.00 CC. Ledger batch_1.');
    expect(orderDtuCall({ ...paid, batchId: ' ' })).toBeNull();
  });

  it('accepts a DTU only after get returns the same id', () => {
    const created = { ok: true, result: { ok: true, dtu: { id: 'dtu_9' } } };
    expect(dtuRecordId(created)).toBe('dtu_9');
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'dtu_9' } } })).toBe(true);
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'dtu_8' } } })).toBe(false);
    expect(dtuRecordId({ ok: false, result: null })).toBe('');
  });

  it('sends the DTU to Finance only when the stored cite matches', () => {
    const call = sendOrderToFinanceCall(paid, 'dtu_9');
    expect(call).toMatchObject({
      domain: 'finance',
      action: 'receipt-record',
      input: { citedDtuId: 'dtu_9', source: 'marketplace-order', batchId: 'batch_1', amount: 20, sourceId: 'ord_1' },
    });
    expect(sendOrderToFinanceCall(paid, 'not an id')).toBeNull();
    expect(sendOrderToFinanceCall({ ...paid, batchId: '' }, 'dtu_9')).toBeNull();

    const sent = sendOrderOutcome('dtu_9', {
      ok: true,
      result: { receipt: { id: 'rcpt_1', citedDtuId: 'dtu_9' } },
    });
    expect(sent.claimed).toBe(true);
    expect(sent.text).toBe('Sent DTU dtu_9 to Finance as receipt rcpt_1. Concord Coin was not moved again.');

    const missing = sendOrderOutcome('dtu_9', {
      ok: true,
      result: { receipt: { id: 'rcpt_1', citedDtuId: '' } },
    });
    expect(missing.claimed).toBe(false);
    expect(missing.text).toContain('without DTU dtu_9');

    const refused = sendOrderOutcome('dtu_9', { ok: false, error: 'citedDtuId required', result: null });
    expect(refused.text).toBe('Not sent. citedDtuId required');
  });
});
