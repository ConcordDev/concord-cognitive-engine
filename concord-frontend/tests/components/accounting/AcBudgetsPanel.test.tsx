import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AcBudgetsPanel } from '@/components/accounting/AcBudgetsPanel';

const BUDGETS = [
  { id: 'b1', name: 'FY26', fiscalYear: 2026, lines: {} },
  { id: 'b2', name: 'FY25', fiscalYear: 2025, lines: {} },
];
const ACCOUNTS = [
  { id: 'a1', code: '6000', name: 'Marketing' },
  { id: 'a2', code: '6100', name: 'Travel' },
];
const BVA = {
  rows: [
    { accountId: 'a1', account: '6000 Marketing', budgeted: 1000, actual: 800, variance: 200 },
    { accountId: 'a2', account: '6100 Travel', budgeted: 500, actual: 700, variance: -200 },
  ],
  totalBudgeted: 1500, totalActual: 1500,
};

function wire(opts: { budgets?: unknown; accounts?: unknown; bva?: unknown } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'budget-list') return Promise.resolve({ data: { ok: true, result: { budgets: opts.budgets ?? BUDGETS } } });
    if (spec.action === 'coa-list') return Promise.resolve({ data: { ok: true, result: { accounts: opts.accounts ?? ACCOUNTS } } });
    if (spec.action === 'budget-vs-actual') return Promise.resolve({ data: { ok: true, result: opts.bva ?? BVA } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('AcBudgetsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AcBudgetsPanel />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the empty state when no budgets exist', async () => {
    wire({ budgets: [], bva: null });
    render(<AcBudgetsPanel />);
    expect(await screen.findByText('Create a budget to start.')).toBeInTheDocument();
  });

  it('renders the budget selector and budget-vs-actual rows when populated', async () => {
    wire();
    render(<AcBudgetsPanel />);
    expect(await screen.findByText(/Budget vs actual/)).toBeInTheDocument();
    expect(screen.getAllByText('6000 Marketing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('6100 Travel').length).toBeGreaterThan(0);
    // positive variance prefixed with +, negative without
    expect(screen.getByText('+200')).toBeInTheDocument();
    expect(screen.getByText('-200')).toBeInTheDocument();
  });

  it('renders the no-budget-lines empty state when bva rows are empty', async () => {
    wire({ bva: { rows: [], totalBudgeted: 0, totalActual: 0 } });
    render(<AcBudgetsPanel />);
    expect(await screen.findByText('No budget lines set.')).toBeInTheDocument();
  });

  it('does not create a budget when the name is blank', async () => {
    wire();
    render(<AcBudgetsPanel />);
    await screen.findByText(/Budget vs actual/);
    fireEvent.click(screen.getByText('Budget'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'budget-create' })),
    );
  });

  it('creates a budget when a name is entered', async () => {
    wire();
    render(<AcBudgetsPanel />);
    await screen.findByText(/Budget vs actual/);
    fireEvent.change(screen.getByPlaceholderText('Budget name'), { target: { value: 'FY27' } });
    fireEvent.click(screen.getByText('Budget'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'budget-create', input: expect.objectContaining({ name: 'FY27' }) }),
      ),
    );
  });

  it('sets a budget line when an account is selected', async () => {
    wire();
    render(<AcBudgetsPanel />);
    await screen.findByText(/Budget vs actual/);
    const selects = screen.getAllByRole('combobox');
    // the account-picker select has the "Account…" default option
    const acctSelect = selects.find((s) => s.querySelector('option[value=""]'))!;
    fireEvent.change(acctSelect, { target: { value: 'a1' } });
    fireEvent.change(screen.getByPlaceholderText('Annual amount'), { target: { value: '900' } });
    fireEvent.click(screen.getByText('Set'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'budget-set-line', input: expect.objectContaining({ accountId: 'a1', annualAmount: 900 }) }),
      ),
    );
  });

  it('does not set a line when no account is chosen', async () => {
    wire();
    render(<AcBudgetsPanel />);
    await screen.findByText(/Budget vs actual/);
    fireEvent.click(screen.getByText('Set'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'budget-set-line' })),
    );
  });

  it('deletes a budget', async () => {
    wire();
    render(<AcBudgetsPanel />);
    await screen.findByText(/Budget vs actual/);
    fireEvent.click(screen.getByText('Delete budget'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'budget-delete' })),
    );
  });

  it('switches the active budget via the selector', async () => {
    wire();
    render(<AcBudgetsPanel />);
    await screen.findByText(/Budget vs actual/);
    const selects = screen.getAllByRole('combobox');
    const budgetSelect = selects.find((s) => s.querySelector('option[value="b2"]'))!;
    fireEvent.change(budgetSelect, { target: { value: 'b2' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'budget-vs-actual', input: { budgetId: 'b2' } }),
      ),
    );
  });
});
