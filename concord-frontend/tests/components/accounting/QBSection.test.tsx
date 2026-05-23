import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Stub every imported child panel so QBSection's own logic is isolated.
// NOTE: vi.mock factories are hoisted; we can't reference an outer `stub` variable,
// so each factory inlines its own React.createElement call.
vi.mock('@/components/accounting/AccountingAskBar', async () => {
  const React = await import('react');
  return { AccountingAskBar: () => React.createElement('div', { 'data-testid': 'askbar' }, 'askbar') };
});
vi.mock('@/components/accounting/AccountingDashboard', async () => {
  const React = await import('react');
  return {
    AccountingDashboard: ({ onJumpTo }: { onJumpTo?: (n: string) => void }) =>
      React.createElement('button', { 'data-testid': 'dashboard', onClick: () => onJumpTo?.('bills') }, 'dashboard'),
  };
});
vi.mock('@/components/accounting/BankFeedsInbox', async () => {
  const React = await import('react');
  return { BankFeedsInbox: () => React.createElement('div', { 'data-testid': 'banking' }, 'banking') };
});
vi.mock('@/components/accounting/CustomersPanel', async () => {
  const React = await import('react');
  return { CustomersPanel: () => React.createElement('div', { 'data-testid': 'customers' }, 'customers') };
});
vi.mock('@/components/accounting/VendorsPanel', async () => {
  const React = await import('react');
  return { VendorsPanel: () => React.createElement('div', { 'data-testid': 'vendors' }, 'vendors') };
});
vi.mock('@/components/accounting/BillsPanel', async () => {
  const React = await import('react');
  return { BillsPanel: () => React.createElement('div', { 'data-testid': 'bills' }, 'bills') };
});
vi.mock('@/components/accounting/ExpensesPanel', async () => {
  const React = await import('react');
  return { ExpensesPanel: () => React.createElement('div', { 'data-testid': 'expenses' }, 'expenses') };
});
vi.mock('@/components/accounting/EstimatesPanel', async () => {
  const React = await import('react');
  return { EstimatesPanel: () => React.createElement('div', { 'data-testid': 'estimates' }, 'estimates') };
});
vi.mock('@/components/accounting/RecurringInvoicesPanel', async () => {
  const React = await import('react');
  return { RecurringInvoicesPanel: () => React.createElement('div', { 'data-testid': 'recurring' }, 'recurring') };
});
vi.mock('@/components/accounting/PLStatement', async () => {
  const React = await import('react');
  return { PLStatement: () => React.createElement('div', { 'data-testid': 'pl' }, 'pl') };
});
vi.mock('@/components/accounting/CashFlowStatement', async () => {
  const React = await import('react');
  return { CashFlowStatement: () => React.createElement('div', { 'data-testid': 'cashflow' }, 'cashflow') };
});
vi.mock('@/components/accounting/RunwayForecast', async () => {
  const React = await import('react');
  return { RunwayForecast: () => React.createElement('div', { 'data-testid': 'runway' }, 'runway') };
});
vi.mock('@/components/accounting/APAgingPanel', async () => {
  const React = await import('react');
  return { APAgingPanel: () => React.createElement('div', { 'data-testid': 'aging-ap' }, 'aging-ap') };
});
vi.mock('@/components/accounting/Form1099Panel', async () => {
  const React = await import('react');
  return { Form1099Panel: () => React.createElement('div', { 'data-testid': 'ten99' }, 'ten99') };
});
vi.mock('@/components/accounting/AcPayrollPanel', async () => {
  const React = await import('react');
  return { AcPayrollPanel: () => React.createElement('div', { 'data-testid': 'payroll' }, 'payroll') };
});
vi.mock('@/components/accounting/AcBudgetsPanel', async () => {
  const React = await import('react');
  return { AcBudgetsPanel: () => React.createElement('div', { 'data-testid': 'budgets' }, 'budgets') };
});
vi.mock('@/components/accounting/AcInventoryPanel', async () => {
  const React = await import('react');
  return { AcInventoryPanel: () => React.createElement('div', { 'data-testid': 'inventory' }, 'inventory') };
});
vi.mock('@/components/accounting/AcSalesTaxPanel', async () => {
  const React = await import('react');
  return { AcSalesTaxPanel: () => React.createElement('div', { 'data-testid': 'salestax' }, 'salestax') };
});
vi.mock('@/components/accounting/AcPurchaseOrdersPanel', async () => {
  const React = await import('react');
  return { AcPurchaseOrdersPanel: () => React.createElement('div', { 'data-testid': 'purchaseorders' }, 'purchaseorders') };
});
vi.mock('@/components/accounting/AcRatiosPanel', async () => {
  const React = await import('react');
  return { AcRatiosPanel: () => React.createElement('div', { 'data-testid': 'ratios' }, 'ratios') };
});

import { QBSection } from '@/components/accounting/QBSection';

describe('QBSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({
      data: { ok: true, result: { uncategorizedTxns: 4, openInvCount: 2, openBillsCount: 7 } },
    });
  });

  it('shows the dashboard panel initially and fetches badges', async () => {
    render(<QBSection />);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'accounting', action: 'dashboard-summary' }),
      ),
    );
    // badge "7" (openBillsCount) shows in the nav sidebar
    expect(await screen.findByText('7')).toBeInTheDocument();
  });

  it('navigates to a panel when a sidebar nav button is clicked', () => {
    render(<QBSection />);
    fireEvent.click(screen.getByText('Vendors'));
    expect(screen.getByTestId('vendors')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Payroll'));
    expect(screen.getByTestId('payroll')).toBeInTheDocument();
  });

  it('jumps via the dashboard onJumpTo callback', () => {
    render(<QBSection />);
    fireEvent.click(screen.getByTestId('dashboard'));
    expect(screen.getByTestId('bills')).toBeInTheDocument();
  });

  it('renders placeholders for nav targets without panels', () => {
    render(<QBSection />);
    fireEvent.click(screen.getByText('Invoices'));
    expect(screen.getByText(/Invoices live in the Workbench/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('A/R aging'));
    expect(screen.getByText(/open the Workbench/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ledger'));
    expect(screen.getByText(/Full ledger lives/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chart'));
    expect(screen.getByText(/Chart of accounts/)).toBeInTheDocument();
  });

  it('survives a failed badge fetch without crashing', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<QBSection />);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });
});
