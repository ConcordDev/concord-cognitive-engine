import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Isolate the workbench from the Advanced sub-panel.
vi.mock('@/components/accounting/AdvancedAccountingPanel', () => ({
  AdvancedAccountingPanel: () => React.createElement('div', { 'data-testid': 'advanced' }, 'advanced'),
}));

import { AccountingWorkbench } from '@/components/accounting/AccountingWorkbench';

const ACCOUNTS = [
  { id: 'a1', code: '1000', name: 'Cash', category: 'asset', parent: null, archived: false, createdAt: '', updatedAt: '' },
  { id: 'a2', code: '6000', name: 'Rent', category: 'expense', parent: null, archived: false, createdAt: '', updatedAt: '' },
];

function coaResult(accounts = ACCOUNTS) {
  return { data: { ok: true, result: { accounts } } };
}

describe('AccountingWorkbench', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when not open', () => {
    const { container } = render(<AccountingWorkbench open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel and all six tabs when open', async () => {
    lensRun.mockResolvedValue(coaResult());
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    expect(screen.getByText('Accounting Workbench')).toBeInTheDocument();
    expect(screen.getByText('Chart of Accounts')).toBeInTheDocument();
    expect(screen.getByText('Post entry')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('calls onClose when the close button is clicked', async () => {
    lensRun.mockResolvedValue(coaResult());
    const onClose = vi.fn();
    render(<AccountingWorkbench open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close workbench'));
    expect(onClose).toHaveBeenCalled();
  });

  it('lists chart-of-accounts grouped by category', async () => {
    lensRun.mockResolvedValue(coaResult());
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    expect(await screen.findByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
  });

  it('creates a new account from the CoA tab', async () => {
    lensRun.mockResolvedValue(coaResult());
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    await screen.findByText('Cash');
    fireEvent.click(screen.getByText('New account'));
    fireEvent.change(screen.getByPlaceholderText(/Code/), { target: { value: '6400' } });
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Travel' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'coa-create', input: expect.objectContaining({ code: '6400', name: 'Travel' }) }),
      ),
    );
  });

  it('cancels the CoA create form', async () => {
    lensRun.mockResolvedValue(coaResult());
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    await screen.findByText('Cash');
    fireEvent.click(screen.getByText('New account'));
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Name')).toBeNull();
  });

  it('archives an account', async () => {
    lensRun.mockResolvedValue(coaResult());
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    await screen.findByText('Cash');
    fireEvent.click(screen.getAllByLabelText('Archive account')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'coa-archive' })),
    );
  });

  it('posts a balanced journal entry from the Post entry tab', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'coa-list') return Promise.resolve(coaResult());
      if (spec.action === 'je-post') return Promise.resolve({ data: { ok: true, result: { entry: { number: 'JE-1' } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Post entry'));
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'a1' } });
    fireEvent.change(selects[1], { target: { value: 'a2' } });
    const numberInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(numberInputs[0], { target: { value: '100' } }); // debit line 1
    fireEvent.change(numberInputs[3], { target: { value: '100' } }); // credit line 2
    expect(await screen.findByText('Balanced')).toBeInTheDocument();
    // Two "Post entry" buttons exist now: the tab (text-emerald-200) and the
    // submit action (text-emerald-100). Pick the submit button explicitly.
    const postButtons = screen.getAllByText('Post entry').map((el) => el.closest('button') as HTMLElement);
    const submitBtn = postButtons.find((b) => b && b.className.includes('text-emerald-100')) as HTMLElement;
    fireEvent.click(submitBtn);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'je-post' })),
    );
    expect(await screen.findByText(/Posted JE-1/)).toBeInTheDocument();
  });

  it('adds and removes journal entry lines', async () => {
    lensRun.mockResolvedValue(coaResult());
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Post entry'));
    await waitFor(() => expect(screen.getByText('Add line')).toBeInTheDocument());
    // 2 default lines
    expect(screen.getAllByRole('spinbutton')).toHaveLength(4);
    fireEvent.click(screen.getByText('Add line'));
    expect(screen.getAllByRole('spinbutton')).toHaveLength(6);
    fireEvent.click(screen.getAllByLabelText('Remove line')[0]);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(4);
  });

  it('renders the ledger tab empty state', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'coa-list') return Promise.resolve(coaResult());
      if (spec.action === 'ledger-list') return Promise.resolve({ data: { ok: true, result: { rows: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Ledger'));
    expect(await screen.findByText('No entries posted yet.')).toBeInTheDocument();
  });

  it('renders ledger rows when present', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'coa-list') return Promise.resolve(coaResult());
      if (spec.action === 'ledger-list') {
        return Promise.resolve({ data: { ok: true, result: { rows: [
          { entryId: 'e1', number: 'JE-1', date: '2026-05-01', memo: '', accountId: 'a1', debit: 50, credit: 0, lineMemo: '' },
        ] } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Ledger'));
    expect(await screen.findByText('JE-1')).toBeInTheDocument();
    expect(screen.getByText('50.00')).toBeInTheDocument();
  });

  it('renders the balance sheet tab with a balanced sheet', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'balance-sheet-compute') {
        return Promise.resolve({ data: { ok: true, result: {
          asOf: '2026-05-22',
          assets: [{ id: 'a1', code: '1000', name: 'Cash', balance: 100 }],
          liabilities: [], equity: [{ id: 'q1', code: '3000', name: 'Equity', balance: 100 }],
          totals: { assets: 100, liabilities: 0, equity: 100 }, balanced: true, imbalance: 0,
        } } });
      }
      return Promise.resolve(coaResult());
    });
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Balance sheet'));
    expect(await screen.findByText('Balanced')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });

  it('renders the AR aging tab and creates an invoice', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'aging-ar') {
        return Promise.resolve({ data: { ok: true, result: { totalOpen: 0, buckets: [
          { key: 'current', label: 'Current', total: 0, invoices: [] },
        ] } } });
      }
      if (spec.action === 'invoice-create') return Promise.resolve({ data: { ok: true, result: {} } });
      return Promise.resolve(coaResult());
    });
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AR aging'));
    expect(await screen.findByText(/no open invoices in this bucket/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('New invoice'));
    fireEvent.change(screen.getByPlaceholderText('Customer name'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByPlaceholderText('Total'), { target: { value: '500' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice-create' })),
    );
  });

  it('renders the advanced tab mounting the stubbed Advanced panel', async () => {
    lensRun.mockResolvedValue(coaResult());
    render(<AccountingWorkbench open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Advanced'));
    expect(await screen.findByTestId('advanced')).toBeInTheDocument();
  });
});
