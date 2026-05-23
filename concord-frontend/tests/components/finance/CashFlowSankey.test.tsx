import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chartkit' }, 'chart'),
}));

import { CashFlowSankey } from '@/components/finance/CashFlowSankey';

const SANKEY = {
  nodes: [
    { id: 'income', label: 'Income' },
    { id: 'spending', label: 'Spending' },
    { id: 'groceries', label: 'Groceries' },
    { id: 'rent', label: 'Rent' },
  ],
  links: [
    { source: 'income', target: 'spending', value: 3000 },
    { source: 'spending', target: 'groceries', value: 800 },
    { source: 'spending', target: 'rent', value: 1500 },
  ],
  income: 4000,
  totalSpend: 2300,
  netCashFlow: 1700,
  month: '2026-05',
};

const TREND = {
  series: [
    { month: '2026-04', income: 4000, spend: 2300, net: 1700, savingsRate: 42 },
    { month: '2026-05', income: 4100, spend: 2200, net: 1900, savingsRate: 46 },
  ],
  avgMonthlySpend: 2250,
  avgMonthlyIncome: 4050,
  avgNet: 1800,
};

describe('CashFlowSankey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'cashflow-sankey') return Promise.resolve({ data: { ok: true, result: { nodes: [], links: [], income: 0, totalSpend: 0, netCashFlow: 0, month: null } } });
      if (action === 'monthly-trend') return Promise.resolve({ data: { ok: true, result: { series: [], avgMonthlySpend: 0, avgMonthlyIncome: 0, avgNet: 0 } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  });

  it('shows empty state with no cash flow data', async () => {
    render(<CashFlowSankey />);
    expect(await screen.findByText(/No cash-flow data yet/)).toBeInTheDocument();
  });

  it('renders sankey flow, category outflows and trend chart (savings path)', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'cashflow-sankey') return Promise.resolve({ data: { ok: true, result: SANKEY } });
      if (action === 'monthly-trend') return Promise.resolve({ data: { ok: true, result: TREND } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<CashFlowSankey />);
    expect(await screen.findByText('Income')).toBeInTheDocument();
    expect(screen.getByText('Spending')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByTestId('chartkit')).toBeInTheDocument();
  });

  it('renders deficit branch when netCashFlow is negative', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'cashflow-sankey') return Promise.resolve({ data: { ok: true, result: { ...SANKEY, netCashFlow: -500 } } });
      if (action === 'monthly-trend') return Promise.resolve({ data: { ok: true, result: { ...TREND, series: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<CashFlowSankey />);
    expect(await screen.findByText('Deficit')).toBeInTheDocument();
  });

  it('changes the month select and re-fetches', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'cashflow-sankey') return Promise.resolve({ data: { ok: true, result: SANKEY } });
      if (action === 'monthly-trend') return Promise.resolve({ data: { ok: true, result: TREND } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<CashFlowSankey />);
    await screen.findByText('Income');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-05' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'cashflow-sankey', { month: '2026-05' }),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<CashFlowSankey />);
    expect(await screen.findByText(/No cash-flow data yet/)).toBeInTheDocument();
  });
});
