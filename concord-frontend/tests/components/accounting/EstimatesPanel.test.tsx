import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { EstimatesPanel } from '@/components/accounting/EstimatesPanel';

const ESTIMATES = [
  { id: 'e1', number: 'EST-1', customerName: 'Acme', customerId: 'c1', total: 1000, status: 'pending', issuedAt: '2026-05-01', expiresAt: '2026-06-01', memo: 'Phase 1', convertedInvoiceId: null },
  { id: 'e2', number: 'EST-2', customerName: 'Globex', customerId: null, total: 2000, status: 'accepted', issuedAt: '2026-05-02', expiresAt: '2026-06-02', memo: '', convertedInvoiceId: 'inv-9' },
  { id: 'e3', number: 'EST-3', customerName: 'Initech', customerId: null, total: 500, status: 'declined', issuedAt: '2026-05-03', expiresAt: '2026-06-03', memo: '', convertedInvoiceId: null },
];

describe('EstimatesPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<EstimatesPanel />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no estimates', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { estimates: [] } } });
    render(<EstimatesPanel />);
    expect(await screen.findByText('No estimates yet.')).toBeInTheDocument();
  });

  it('renders estimates across all three statuses', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { estimates: ESTIMATES } } });
    render(<EstimatesPanel />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.getByText('declined')).toBeInTheDocument();
    expect(screen.getByText('Phase 1')).toBeInTheDocument();
    // converted estimate shows "→ Invoice" instead of Convert
    expect(screen.getByText('→ Invoice')).toBeInTheDocument();
    expect(screen.getAllByText('Convert').length).toBe(2);
  });

  it('toggles the create form and rejects a missing name or total', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { estimates: ESTIMATES } } });
    render(<EstimatesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'estimates-create' })),
    );
  });

  it('creates an estimate with a name and total', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { estimates: ESTIMATES } } });
    render(<EstimatesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByText('New'));
    fireEvent.change(screen.getByPlaceholderText('Customer name *'), { target: { value: 'New Co' } });
    fireEvent.change(screen.getByPlaceholderText('Total *'), { target: { value: '750' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'estimates-create', input: expect.objectContaining({ customerName: 'New Co', total: 750 }) }),
      ),
    );
  });

  it('converts a pending estimate to an invoice', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { estimates: ESTIMATES } } });
    render(<EstimatesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getAllByText('Convert')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'estimates-convert' })),
    );
  });

  it('alerts when conversion returns an error', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'estimates-list') return Promise.resolve({ data: { ok: true, result: { estimates: ESTIMATES } } });
      if (spec.action === 'estimates-convert') return Promise.resolve({ data: { ok: false, error: 'already converted' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<EstimatesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getAllByText('Convert')[0]);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('already converted'));
  });

  it('survives a rejected list request', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<EstimatesPanel />);
    expect(await screen.findByText('No estimates yet.')).toBeInTheDocument();
  });
});
