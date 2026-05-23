import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { TransactionFeed } from '@/components/finance/TransactionFeed';

const TXNS = [
  { id: 't1', date: '2026-05-01', description: 'Whole Foods', amount: -82.1, category: 'Groceries', autoCategorised: true, categorySource: 'rules', accountId: 'a1' },
  { id: 't2', date: '2026-05-02', description: 'Payroll Deposit', amount: 3000, category: 'Income', autoCategorised: false, categorySource: 'manual', accountId: 'a1' },
  { id: 't3', date: '2026-05-03', description: 'Uber Ride', amount: -24.5, category: 'Transportation', autoCategorised: true, categorySource: 'user_rule', accountId: null },
];

const LIST = { transactions: TXNS, totalSpend: 106.6, totalIncome: 3000, count: 3 };

describe('TransactionFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { transactions: [], totalSpend: 0, totalIncome: 0, count: 0 } } });
  });

  it('shows empty state with no transactions', async () => {
    render(<TransactionFeed />);
    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument();
  });

  it('renders transactions with all category-source badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LIST } });
    render(<TransactionFeed />);
    expect(await screen.findByText('Whole Foods')).toBeInTheDocument();
    expect(screen.getByText('Payroll Deposit')).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.getByText('rule')).toBeInTheDocument();
  });

  it('filters transactions by description', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LIST } });
    render(<TransactionFeed />);
    await screen.findByText('Whole Foods');
    fireEvent.change(screen.getByPlaceholderText(/Filter transactions/), { target: { value: 'uber' } });
    expect(screen.getByText('Uber Ride')).toBeInTheDocument();
    expect(screen.queryByText('Whole Foods')).not.toBeInTheDocument();
  });

  it('shows the no-results state when the filter matches nothing', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LIST } });
    render(<TransactionFeed />);
    await screen.findByText('Whole Foods');
    fireEvent.change(screen.getByPlaceholderText(/Filter transactions/), { target: { value: 'zzzzz' } });
    expect(screen.getByText(/No transactions yet/)).toBeInTheDocument();
  });

  it('ingests a transaction and ignores blank submit', async () => {
    render(<TransactionFeed />);
    await screen.findByText(/No transactions yet/);
    fireEvent.click(screen.getByLabelText('Add transaction'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText(/Add transaction \(auto/));
    expect(lensRun).not.toHaveBeenCalledWith('finance', 'transactions-ingest', expect.anything());
    fireEvent.change(await screen.findByPlaceholderText(/Description \/ merchant/), { target: { value: 'Coffee' } });
    fireEvent.change(screen.getByPlaceholderText(/Amount \(neg/), { target: { value: '-4.5' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dining' } });
    lensRun.mockResolvedValue({ data: { ok: true, result: { transactions: [], totalSpend: 0, totalIncome: 0, count: 0 } } });
    fireEvent.click(screen.getByText(/Add transaction \(auto/));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'transactions-ingest', expect.objectContaining({ description: 'Coffee', amount: -4.5, category: 'Dining' })),
    );
  });

  it('recategorises a transaction', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LIST } });
    render(<TransactionFeed />);
    await screen.findByText('Whole Foods');
    fireEvent.click(screen.getByText('Groceries'));
    const select = await screen.findByDisplayValue('Groceries');
    fireEvent.change(select, { target: { value: 'Shopping' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByLabelText('Save category'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'transactions-recategorise', { id: 't1', category: 'Shopping' }),
    );
  });

  it('cancels category editing', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LIST } });
    render(<TransactionFeed />);
    await screen.findByText('Whole Foods');
    fireEvent.click(screen.getByText('Groceries'));
    expect(await screen.findByLabelText('Cancel')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(screen.queryByLabelText('Save category')).not.toBeInTheDocument();
  });

  it('deletes a transaction', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LIST } });
    render(<TransactionFeed />);
    await screen.findByText('Whole Foods');
    lensRun.mockClear();
    fireEvent.click(screen.getAllByLabelText('Delete transaction')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'transactions-delete', { id: 't1' }),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<TransactionFeed />);
    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument();
  });
});
