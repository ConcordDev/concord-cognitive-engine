import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PLStatement } from '@/components/accounting/PLStatement';

const PROFIT = {
  period: { start: '2026-01-01', end: '2026-05-22' },
  revenue: { lines: [{ id: 'r1', code: '4000', name: 'Sales', amount: 100000 }], total: 100000 },
  cogs: { lines: [{ id: 'c1', code: '5000', name: 'Materials', amount: 30000 }], total: 30000 },
  grossProfit: 70000, grossMarginPct: 70,
  operatingExpenses: { lines: [{ id: 'e1', code: '6000', name: 'Rent', amount: 20000 }], total: 20000 },
  netIncome: 50000, netMarginPct: 50,
};
const LOSS = {
  ...PROFIT,
  revenue: { lines: [], total: 0 },
  netIncome: -10000, netMarginPct: -100,
};

describe('PLStatement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<PLStatement />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the no-data state when the result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<PLStatement />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });

  it('renders revenue, COGS, expenses and subtotals when profitable', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: PROFIT } });
    render(<PLStatement />);
    expect(await screen.findByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Materials')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Gross profit')).toBeInTheDocument();
    expect(screen.getByText('Net income')).toBeInTheDocument();
    expect(screen.getByText('$50000.00')).toBeInTheDocument();
    expect(screen.getByText('50.0% margin')).toBeInTheDocument();
  });

  it('renders the no-entries placeholder for an empty section and a negative net income', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LOSS } });
    render(<PLStatement />);
    expect(await screen.findByText('No entries')).toBeInTheDocument();
    expect(screen.getByText('$-10000.00')).toBeInTheDocument();
  });

  it('refetches when the date range changes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: PROFIT } });
    const { container } = render(<PLStatement />);
    await screen.findByText('Sales');
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[1], { target: { value: '2026-06-30' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'pl-compute', input: expect.objectContaining({ end: '2026-06-30' }) }),
      ),
    );
  });

  it('falls back to the no-data state on a rejected request', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<PLStatement />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });
});
