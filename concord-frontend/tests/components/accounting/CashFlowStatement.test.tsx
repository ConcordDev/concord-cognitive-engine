import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  const Chart = ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'chart' }, children);
  const Leaf = () => React.createElement('div', { 'data-testid': 'chart-leaf' });
  return {
    BarChart: Chart, Bar: Leaf, XAxis: Leaf, YAxis: Leaf, Tooltip: Leaf,
    ResponsiveContainer: Passthrough, CartesianGrid: Leaf, ReferenceLine: Leaf,
  };
});

import { CashFlowStatement } from '@/components/accounting/CashFlowStatement';

const POSITIVE = {
  period: { start: '2026-01-01', end: '2026-05-22' },
  series: [{ month: 'Jan', in: 1000, out: 600, net: 400 }],
  totalIn: 1000, totalOut: 600, netCashFlow: 400,
};
const NEGATIVE = { ...POSITIVE, netCashFlow: -200 };

describe('CashFlowStatement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<CashFlowStatement />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the no-activity state when the result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<CashFlowStatement />);
    expect(await screen.findByText(/No cash activity/)).toBeInTheDocument();
  });

  it('shows the no-activity state when the series is empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...POSITIVE, series: [] } } });
    render(<CashFlowStatement />);
    expect(await screen.findByText(/No cash activity/)).toBeInTheDocument();
  });

  it('renders tiles and the chart with a positive net cash flow', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: POSITIVE } });
    render(<CashFlowStatement />);
    expect(await screen.findByText('Cash in')).toBeInTheDocument();
    expect(screen.getByText('Cash out')).toBeInTheDocument();
    expect(screen.getByText('Net cash flow')).toBeInTheDocument();
    expect(screen.getByText('$1000')).toBeInTheDocument();
    expect(screen.getByText('$400')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('renders a negative net cash flow tile', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: NEGATIVE } });
    render(<CashFlowStatement />);
    expect(await screen.findByText('$-200')).toBeInTheDocument();
  });

  it('refetches when the start/end dates change', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: POSITIVE } });
    const { container } = render(<CashFlowStatement />);
    await screen.findByText('Cash in');
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-02-01' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'cashflow-compute', input: expect.objectContaining({ start: '2026-02-01' }) }),
      ),
    );
  });

  it('falls back to the no-activity state on a rejected request', async () => {
    lensRun.mockRejectedValue(new Error('network'));
    render(<CashFlowStatement />);
    expect(await screen.findByText(/No cash activity/)).toBeInTheDocument();
  });
});
