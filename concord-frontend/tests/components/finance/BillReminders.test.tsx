import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { BillReminders } from '@/components/finance/BillReminders';

const REMINDERS = {
  reminders: [
    { billId: 'b1', name: 'Rent', amount: 1500, dueDate: '2026-06-01', daysUntil: 3, status: 'due_soon', autopay: false, notify: true, message: 'Due in 3 days' },
    { billId: 'b2', name: 'Netflix', amount: 15.99, dueDate: '2026-05-20', daysUntil: -2, status: 'overdue', autopay: true, notify: true, message: 'Overdue' },
    { billId: 'b3', name: 'Gym', amount: 40, dueDate: '2026-05-10', daysUntil: 0, status: 'paid', autopay: false, notify: false, message: 'Paid' },
  ],
  actionable: [],
  overdueCount: 1,
  dueSoonCount: 1,
  leadDays: 5,
};

describe('BillReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { reminders: [], actionable: [], overdueCount: 0, dueSoonCount: 0, leadDays: 5 } } });
  });

  it('shows empty state with no bills', async () => {
    render(<BillReminders />);
    expect(await screen.findByText(/No upcoming or overdue bills/)).toBeInTheDocument();
  });

  it('renders reminders with overdue/due-soon banner and autopay tag', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: REMINDERS } });
    render(<BillReminders />);
    expect(await screen.findByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByText('1 due soon')).toBeInTheDocument();
    expect(screen.getByText('autopay')).toBeInTheDocument();
  });

  it('changes the lead-days select and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: REMINDERS } });
    render(<BillReminders />);
    await screen.findByText('Rent');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '10' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'bill-reminders', { leadDays: 10 }),
    );
  });

  it('pays a bill', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: REMINDERS } });
    render(<BillReminders />);
    await screen.findByText('Rent');
    lensRun.mockClear();
    fireEvent.click(screen.getAllByText('Mark paid')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'bills-pay', { id: 'b1' }),
    );
  });

  it('snoozes a bill', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: REMINDERS } });
    render(<BillReminders />);
    await screen.findByText('Rent');
    lensRun.mockClear();
    fireEvent.click(screen.getAllByText('Snooze')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'bill-reminder-snooze', { id: 'b1', days: 3 }),
    );
  });

  it('does not render snooze/pay for already-paid bill', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: REMINDERS } });
    render(<BillReminders />);
    await screen.findByText('Gym');
    // only 2 actionable rows (Rent, Netflix)
    expect(screen.getAllByText('Snooze')).toHaveLength(2);
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<BillReminders />);
    expect(await screen.findByText(/No upcoming or overdue bills/)).toBeInTheDocument();
  });
});
