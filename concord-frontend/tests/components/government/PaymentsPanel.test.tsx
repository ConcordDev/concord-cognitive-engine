import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PaymentsPanel } from '@/components/government/PaymentsPanel';

const PERMITS = [{ id: 'p1', recordNumber: 'PMT-1', kind: 'building', feeUsd: 100, paid: false }];
const FINES = [{ id: 'f1', payerName: 'Joe', reason: 'Parking', amountUsd: 50, paid: false, caseNumber: 'C1', issuedAt: '2026-01-01' }];
const PAYMENTS = [
  { id: 'pay1', kind: 'permit', refId: 'p9', amountUsd: 200, description: 'Permit fee', status: 'succeeded', createdAt: '2026-01-01', cardLast4: '4242', receiptNumber: 'RC-1' },
  { id: 'pay2', kind: 'fine', refId: 'f9', amountUsd: 30, description: 'Fine', status: 'refunded', createdAt: '2026-01-02', refundReason: 'overcharge' },
];

function mockAll(permits: unknown[], fines: unknown[], payments: unknown[]) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'permits-list') return Promise.resolve({ data: { ok: true, result: { permits } } });
    if (spec.action === 'fines-list') return Promise.resolve({ data: { ok: true, result: { fines } } });
    if (spec.action === 'payments-list') return Promise.resolve({ data: { ok: true, result: { payments } } });
    return Promise.resolve({ data: { ok: true } });
  });
}

describe('PaymentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll([], [], []);
  });

  it('renders empty outstanding and ledger sections', async () => {
    render(<PaymentsPanel />);
    expect(await screen.findByText('No unpaid permit fees or fines.')).toBeInTheDocument();
    expect(screen.getByText('No payments processed yet.')).toBeInTheDocument();
  });

  it('renders outstanding charges, ledger rows and collected total', async () => {
    mockAll(PERMITS, FINES, PAYMENTS);
    render(<PaymentsPanel />);
    expect(await screen.findByText(/PMT-1 — building/)).toBeInTheDocument();
    expect(screen.getByText(/Parking — Joe/)).toBeInTheDocument();
    expect(screen.getByText('Permit fee')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(screen.getByText('refunded')).toBeInTheDocument();
    expect(screen.getByText(/\$200.00 collected/)).toBeInTheDocument();
  });

  it('does not create a fine with invalid amount', async () => {
    render(<PaymentsPanel />);
    await screen.findByText('No payments processed yet.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Issue fine'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'fines-create' }));
  });

  it('creates a fine with valid inputs', async () => {
    mockAll([], [], []);
    render(<PaymentsPanel />);
    await screen.findByText('No payments processed yet.');
    fireEvent.change(screen.getByPlaceholderText('Payer name'), { target: { value: 'Joe' } });
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'Speeding' } });
    fireEvent.change(screen.getByPlaceholderText('$ Amount'), { target: { value: '75' } });
    fireEvent.click(screen.getByText('Issue fine'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fines-create', input: expect.objectContaining({ amountUsd: 75 }) }),
      ),
    );
  });

  it('opens the checkout modal and confirms a payment', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'permits-list') return Promise.resolve({ data: { ok: true, result: { permits: PERMITS } } });
      if (spec.action === 'fines-list') return Promise.resolve({ data: { ok: true, result: { fines: [] } } });
      if (spec.action === 'payments-list') return Promise.resolve({ data: { ok: true, result: { payments: [] } } });
      if (spec.action === 'payments-checkout')
        return Promise.resolve({ data: { ok: true, result: { payment: { id: 'np1', kind: 'permit', refId: 'p1', amountUsd: 100, description: 'PMT-1 fee', status: 'pending', createdAt: '2026-01-01' } } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<PaymentsPanel />);
    await screen.findByText(/PMT-1 — building/);
    fireEvent.click(screen.getByText('Pay'));
    expect(await screen.findByText('Checkout')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('tok_...'), { target: { value: 'tok_abc' } });
    fireEvent.change(screen.getByPlaceholderText('4242'), { target: { value: '1234' } });
    const payBtn = screen.getByText(/Pay \$100.00/);
    fireEvent.click(payBtn);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payments-confirm', input: expect.objectContaining({ methodToken: 'tok_abc' }) }),
      ),
    );
  });

  it('closes the checkout modal via Cancel', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'permits-list') return Promise.resolve({ data: { ok: true, result: { permits: PERMITS } } });
      if (spec.action === 'fines-list') return Promise.resolve({ data: { ok: true, result: { fines: [] } } });
      if (spec.action === 'payments-list') return Promise.resolve({ data: { ok: true, result: { payments: [] } } });
      if (spec.action === 'payments-checkout')
        return Promise.resolve({ data: { ok: true, result: { payment: { id: 'np1', kind: 'permit', refId: 'p1', amountUsd: 100, description: 'fee', status: 'pending', createdAt: '2026-01-01' } } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<PaymentsPanel />);
    await screen.findByText(/PMT-1 — building/);
    fireEvent.click(screen.getByText('Pay'));
    await screen.findByText('Checkout');
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });

  it('refunds a succeeded payment when a reason is given', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('customer request');
    mockAll([], [], PAYMENTS);
    render(<PaymentsPanel />);
    await screen.findByText('Permit fee');
    fireEvent.click(screen.getByTitle('Refund'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payments-refund', input: { paymentId: 'pay1', reason: 'customer request' } }),
      ),
    );
    promptSpy.mockRestore();
  });

  it('does not refund when the prompt is cancelled', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    mockAll([], [], PAYMENTS);
    render(<PaymentsPanel />);
    await screen.findByText('Permit fee');
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Refund'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'payments-refund' }));
    promptSpy.mockRestore();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<PaymentsPanel />);
    expect(await screen.findByText('No unpaid permit fees or fines.')).toBeInTheDocument();
  });
});
