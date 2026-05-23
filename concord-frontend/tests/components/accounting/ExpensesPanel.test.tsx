import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ExpensesPanel } from '@/components/accounting/ExpensesPanel';

const ACCOUNTS = [
  { id: 'a1', code: '6000', name: 'Supplies', category: 'expense', archived: false },
  { id: 'a2', code: '5000', name: 'COGS', category: 'cogs', archived: false },
  { id: 'a3', code: '1000', name: 'Cash', category: 'asset', archived: false },
];
const EXPENSES = [
  { id: 'x1', number: 'EXP-1', date: '2026-05-01', vendor: 'Staples', accountId: 'a1', amount: 49.99, memo: 'Paper', receiptUrl: 'http://r/1' },
  { id: 'x2', number: 'EXP-2', date: '2026-05-02', vendor: '', accountId: 'unknown', amount: 10, memo: '', receiptUrl: '' },
];

function wire(opts: { expenses?: unknown; accounts?: unknown } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'expenses-list') return Promise.resolve({ data: { ok: true, result: { expenses: opts.expenses ?? EXPENSES } } });
    if (spec.action === 'coa-list') return Promise.resolve({ data: { ok: true, result: { accounts: opts.accounts ?? ACCOUNTS } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('ExpensesPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<ExpensesPanel />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no expenses', async () => {
    wire({ expenses: [] });
    render(<ExpensesPanel />);
    expect(await screen.findByText('No expenses logged.')).toBeInTheDocument();
  });

  it('renders expenses with resolved account names and receipt links', async () => {
    wire();
    render(<ExpensesPanel />);
    expect(await screen.findByText('Staples')).toBeInTheDocument();
    expect(screen.getByText('6000 Supplies')).toBeInTheDocument();
    expect(screen.getByText('Paper')).toBeInTheDocument();
    expect(screen.getByText('−$49.99')).toBeInTheDocument();
    // receipt link present for the first expense
    expect(screen.getByTitle('Receipt')).toBeInTheDocument();
  });

  it('toggles the create form and rejects a missing account or amount', async () => {
    wire();
    render(<ExpensesPanel />);
    await screen.findByText('Staples');
    fireEvent.click(screen.getByText('New expense'));
    fireEvent.click(screen.getByText(/Post expense/));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'expenses-create' })),
    );
  });

  it('creates an expense with an account and amount', async () => {
    wire();
    render(<ExpensesPanel />);
    await screen.findByText('Staples');
    fireEvent.click(screen.getByText('New expense'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a1' } });
    fireEvent.change(screen.getByPlaceholderText('Amount *'), { target: { value: '25' } });
    fireEvent.click(screen.getByText(/Post expense/));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'expenses-create', input: expect.objectContaining({ accountId: 'a1', amount: 25 }) }),
      ),
    );
  });

  it('only offers expense / cogs accounts in the create dropdown', async () => {
    wire();
    render(<ExpensesPanel />);
    await screen.findByText('Staples');
    fireEvent.click(screen.getByText('New expense'));
    const select = screen.getByRole('combobox');
    // expense + cogs + placeholder = 3 options, asset excluded
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });

  it('survives a rejected list request', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<ExpensesPanel />);
    expect(await screen.findByText('No expenses logged.')).toBeInTheDocument();
  });
});
