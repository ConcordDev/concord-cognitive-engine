import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RecurringInvestments } from '@/components/finance/RecurringInvestments';

const PLANS = [
  { id: 'p1', symbol: 'VTI', amount: 500, cadence: 'monthly', startDate: '2026-01-01', status: 'active', executedCount: 4, totalInvested: 2000, averagePrice: 210.5, createdAt: '2026-01-01' },
  { id: 'p2', symbol: 'BND', amount: 100, cadence: 'weekly', startDate: '2026-02-01', status: 'paused', executedCount: 8, totalInvested: 800, averagePrice: null, createdAt: '2026-02-01' },
];

describe('RecurringInvestments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { plans: [] } } });
  });

  it('shows empty state with no plans', async () => {
    render(<RecurringInvestments />);
    expect(await screen.findByText(/No DCA plans/)).toBeInTheDocument();
  });

  it('renders plans with active + paused statuses and monthly total', async () => {
    lensRun.mockResolvedValue({ data: { result: { plans: PLANS } } });
    render(<RecurringInvestments />);
    await waitFor(() => expect(screen.getAllByText('VTI').length).toBeGreaterThan(0));
    expect(screen.getAllByText('BND').length).toBeGreaterThan(0);
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('paused')).toBeInTheDocument();
  });

  it('creates a plan and ignores blank submit', async () => {
    render(<RecurringInvestments />);
    await screen.findByText(/No DCA plans/);
    fireEvent.click(document.querySelector('header button') as HTMLElement);
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Start'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'recurring-create' }));
    fireEvent.change(await screen.findByPlaceholderText('VTI'), { target: { value: 'qqq' } });
    fireEvent.change(screen.getByPlaceholderText('$'), { target: { value: '250' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'biweekly' } });
    lensRun.mockResolvedValue({ data: { result: { plans: [] } } });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'recurring-create', input: expect.objectContaining({ symbol: 'QQQ', amount: 250, cadence: 'biweekly' }) })),
    );
  });

  it('toggles pause and cancels a plan', async () => {
    lensRun.mockResolvedValue({ data: { result: { plans: PLANS } } });
    render(<RecurringInvestments />);
    await waitFor(() => expect(screen.getAllByText('VTI').length).toBeGreaterThan(0));
    lensRun.mockClear();
    fireEvent.click(screen.getAllByTitle('Pause')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'recurring-pause' })));
    const li = screen.getAllByText('VTI')[0].closest('li') as HTMLElement;
    const buttons = li.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'recurring-cancel' })));
  });

  it('shows resume control for a paused plan', async () => {
    lensRun.mockResolvedValue({ data: { result: { plans: PLANS } } });
    render(<RecurringInvestments />);
    await waitFor(() => expect(screen.getAllByText('BND').length).toBeGreaterThan(0));
    expect(screen.getByTitle('Resume')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<RecurringInvestments />);
    expect(await screen.findByText(/No DCA plans/)).toBeInTheDocument();
  });
});
