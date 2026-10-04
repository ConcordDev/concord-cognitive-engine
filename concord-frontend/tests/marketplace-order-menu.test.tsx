import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: Record<string, unknown>) => input,
}));

import { MarketplaceOrderMenu, PayOrderButton } from '@/components/marketplace/MarketplaceOrderMenu';

const waiting = {
  id: 'ord_1',
  number: 'O-00001',
  sellerId: 's1',
  listingTitle: 'Mug',
  status: 'pending',
  paymentStatus: 'awaiting_payment',
  totalUsd: 20,
};

const paid = {
  ...waiting,
  status: 'paid',
  paymentStatus: 'settled',
  paidCc: 20,
  batchId: 'batch_1',
  feeCc: 1.09,
  sellerNetCc: 18.91,
};

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('marketplace pay and receipt controls', () => {
  it('pays through the ledger and only then offers a receipt', async () => {
    lensRunMock.mockImplementation(async (domainOrSpec: string | { domain: string; name?: string; action?: string }, actionArg?: string) => {
      const domain = typeof domainOrSpec === 'string' ? domainOrSpec : domainOrSpec.domain;
      const action = typeof domainOrSpec === 'string' ? (actionArg || '') : (domainOrSpec.action || domainOrSpec.name);
      if (domain === 'marketplace' && action === 'orders-pay') {
        return { data: { ok: true, result: { order: paid, paidSentence: 'Paid 20.00 CC. Ledger batch_1. Shop sticker $20.00. No card was charged.' } } };
      }
      return { data: { ok: false, result: null, error: 'unexpected' } };
    });
    const onPaid = vi.fn();
    render(<PayOrderButton order={waiting} onPaid={onPaid} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay with Concord Coin' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Paid 20.00 CC. Ledger batch_1.'));
    expect(screen.getByRole('status').textContent).toContain('No card was charged.');
    expect(onPaid).toHaveBeenCalled();
    const payCall = lensRunMock.mock.calls[0];
    expect(payCall[0]).toBe('marketplace');
    expect(payCall[1]).toBe('orders-pay');
    expect(payCall[2]).toEqual({ id: 'ord_1' });
  });

  it('does not say paid when the ledger refuses', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'insufficient_balance' } });
    render(<PayOrderButton order={waiting} onPaid={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay with Concord Coin' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not paid.'));
    expect(screen.getByRole('status').textContent).toContain('not moved');
    expect(screen.getByRole('status').textContent).not.toMatch(/^Paid/);
  });

  it('saves only after read-back, then sends that DTU to Finance', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; name?: string; action?: string }) => {
      const action = spec.action || spec.name;
      if (spec.domain === 'dtu' && action === 'create') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'dtu' && action === 'get') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      }
      if (spec.domain === 'finance') {
        return { data: { ok: true, result: { receipt: { id: 'rcpt_9', citedDtuId: 'dtu_9' } } } };
      }
      return { data: { ok: false, result: null, error: 'unexpected' } };
    });
    render(<MarketplaceOrderMenu order={paid} />);
    expect(screen.getByText(/Paid 20.00 CC. Ledger batch_1./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save receipt as DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved as private DTU dtu_9. No card was charged.'));
    fireEvent.click(screen.getByRole('button', { name: 'Send this DTU to Finance' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sent DTU dtu_9 to Finance as receipt rcpt_9. Concord Coin was not moved again.'));
    const sendCall = lensRunMock.mock.calls.map((c) => c[0]).find((spec) => spec.domain === 'finance');
    expect(sendCall.input.source).toBe('marketplace-order');
    expect(sendCall.input.citedDtuId).toBe('dtu_9');
    expect(sendCall.input.batchId).toBe('batch_1');
  });

  it('does not say saved when the DTU cannot be read back', async () => {
    lensRunMock.mockImplementation(async (spec: { name?: string; action?: string }) => {
      const action = spec.action || spec.name;
      if (action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_missing' } } } };
      return { data: { ok: false, result: null, error: 'DTU not found' } };
    });
    render(<MarketplaceOrderMenu order={paid} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save receipt as DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not be read back/));
    expect(screen.getByRole('status').textContent).not.toMatch(/^Saved/);
    expect(screen.queryByRole('button', { name: 'Send this DTU to Finance' })).toBeNull();
  });
});
