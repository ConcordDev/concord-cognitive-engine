import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RecurringInvoicesPanel } from '@/components/accounting/RecurringInvoicesPanel';

const RECURRING = [
  { id: 'r1', number: 'REC-1', customerName: 'Acme', customerId: 'c1', total: 500, cadence: 'monthly', startAt: '2026-01-01', nextRunAt: '2026-06-01', memo: 'Retainer', active: true, lastRunAt: '2026-05-01', runCount: 5 },
  { id: 'r2', number: 'REC-2', customerName: 'Globex', customerId: null, total: 100, cadence: 'weekly', startAt: '2026-05-01', nextRunAt: '2026-05-23', memo: '', active: false, lastRunAt: null, runCount: 1 },
];

describe('RecurringInvoicesPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<RecurringInvoicesPanel />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no recurring invoices', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { recurring: [] } } });
    render(<RecurringInvoicesPanel />);
    expect(await screen.findByText('No recurring invoices.')).toBeInTheDocument();
  });

  it('renders active and paused recurring invoices with the active count', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { recurring: RECURRING } } });
    render(<RecurringInvoicesPanel />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    expect(screen.getByText('Retainer')).toBeInTheDocument();
    // run-count pluralization: "5 runs" (active row) and "1 run" (paused row)
    expect(screen.getByText(/5 runs/)).toBeInTheDocument();
    expect(screen.getByText(/1 run$/)).toBeInTheDocument();
  });

  it('toggles the create form and rejects missing name/total', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { recurring: RECURRING } } });
    render(<RecurringInvoicesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'recurring-invoices-create' })),
    );
  });

  it('creates a recurring invoice with a name and total', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { recurring: RECURRING } } });
    render(<RecurringInvoicesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByText('New'));
    fireEvent.change(screen.getByPlaceholderText('Customer *'), { target: { value: 'New Co' } });
    fireEvent.change(screen.getByPlaceholderText('Amount *'), { target: { value: '999' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'recurring-invoices-create', input: expect.objectContaining({ customerName: 'New Co', total: 999 }) }),
      ),
    );
  });

  it('toggles a recurring invoice via the pause/resume button', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { recurring: RECURRING } } });
    render(<RecurringInvoicesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByTitle('Pause'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'recurring-invoices-toggle', input: { id: 'r1' } }),
      ),
    );
  });

  it('runs due invoices and alerts the generated count', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'recurring-invoices-list') return Promise.resolve({ data: { ok: true, result: { recurring: RECURRING } } });
      if (spec.action === 'recurring-invoices-run-due') return Promise.resolve({ data: { ok: true, result: { count: 2 } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RecurringInvoicesPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByText('Run due'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Generated 2 invoices.'));
  });

  it('survives a rejected list request', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<RecurringInvoicesPanel />);
    expect(await screen.findByText('No recurring invoices.')).toBeInTheDocument();
  });
});
