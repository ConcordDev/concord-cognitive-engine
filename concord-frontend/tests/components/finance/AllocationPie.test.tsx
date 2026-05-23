import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  return {
    PieChart: Pass, Pie: Pass, Cell: () => null,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { style: { width: 400, height: 400 } }, children),
    Tooltip: () => null, Legend: () => null,
  };
});

import { AllocationPie } from '@/components/finance/AllocationPie';

const HOLDINGS = [
  { id: 'h1', symbol: 'VTI', name: 'Total Mkt', shares: 10, price: 200, value: 2000, assetClass: 'equity_us', sector: 'Diversified' },
  { id: 'h2', symbol: 'BND', name: 'Bonds', shares: 5, price: 80, value: 400, assetClass: 'bonds', sector: 'Fixed Income' },
  { id: 'h3', symbol: 'BTC', name: 'Bitcoin', shares: 1, price: 60000, value: 600, assetClass: 'crypto', sector: 'Crypto' },
];

describe('AllocationPie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { holdings: [] } } });
  });

  it('shows empty state with no holdings', async () => {
    render(<AllocationPie />);
    expect(await screen.findByText(/Add holdings to see your allocation/)).toBeInTheDocument();
  });

  it('renders pie data for holdings and shows total', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { holdings: HOLDINGS } } });
    render(<AllocationPie />);
    await waitFor(() => expect(screen.getByText('$3000')).toBeInTheDocument());
  });

  it('switches mode to sector then position', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { holdings: HOLDINGS } } });
    render(<AllocationPie />);
    await waitFor(() => expect(screen.getByText('$3000')).toBeInTheDocument());
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'sector' } });
    expect((select as HTMLSelectElement).value).toBe('sector');
    fireEvent.change(select, { target: { value: 'position' } });
    expect((select as HTMLSelectElement).value).toBe('position');
  });

  it('handles holdings missing an assetClass key (falls to other)', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { holdings: [{ id: 'x', symbol: 'X', name: 'X', shares: 1, price: 1, value: 100 }] } } });
    render(<AllocationPie />);
    await waitFor(() => expect(screen.getByText('$100')).toBeInTheDocument());
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<AllocationPie />);
    expect(await screen.findByText(/Add holdings to see your allocation/)).toBeInTheDocument();
  });
});
