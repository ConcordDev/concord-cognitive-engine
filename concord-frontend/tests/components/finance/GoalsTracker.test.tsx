import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { GoalsTracker } from '@/components/finance/GoalsTracker';

const GOALS = [
  { id: 'g1', name: 'Emergency Fund', target: 10000, saved: 6000, monthlyContribution: 500, category: 'emergency', targetDate: null, remaining: 4000, monthsAtRate: 8, etaDate: '2027-01-01', progressPct: 60 },
  { id: 'g2', name: 'New Car', target: 20000, saved: 20000, monthlyContribution: 0, category: 'car', targetDate: null, remaining: 0, monthsAtRate: null, etaDate: null, progressPct: 100 },
];

describe('GoalsTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { goals: [] } } });
  });

  it('shows empty state with no goals', async () => {
    render(<GoalsTracker />);
    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
  });

  it('renders goals with ETA branch and no-ETA branch', async () => {
    lensRun.mockResolvedValue({ data: { result: { goals: GOALS } } });
    render(<GoalsTracker />);
    expect(await screen.findByText('Emergency Fund')).toBeInTheDocument();
    expect(screen.getByText('New Car')).toBeInTheDocument();
    expect(screen.getByText(/ETA 2027-01-01/)).toBeInTheDocument();
    expect(screen.getByText('Set monthly to see ETA')).toBeInTheDocument();
  });

  it('creates a goal and ignores blank submit', async () => {
    render(<GoalsTracker />);
    await screen.findByText(/No goals yet/);
    fireEvent.click(screen.getByTitle('New goal'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Create goal'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'goals-create' }));
    fireEvent.change(await screen.findByPlaceholderText('Goal name'), { target: { value: 'Vacation' } });
    fireEvent.change(screen.getByPlaceholderText('Target $'), { target: { value: '5000' } });
    fireEvent.change(screen.getByPlaceholderText('$/mo'), { target: { value: '250' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'travel' } });
    lensRun.mockResolvedValue({ data: { result: { goals: [] } } });
    fireEvent.click(screen.getByText('Create goal'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'goals-create', input: expect.objectContaining({ name: 'Vacation', target: 5000, category: 'travel' }) })),
    );
  });

  it('contributes to a goal', async () => {
    lensRun.mockResolvedValue({ data: { result: { goals: GOALS } } });
    render(<GoalsTracker />);
    await screen.findByText('Emergency Fund');
    fireEvent.click(screen.getAllByText('+ Contribute')[0]);
    const amt = await screen.findByPlaceholderText('$ to add');
    fireEvent.change(amt, { target: { value: '300' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'goals-contribute', input: { id: 'g1', amount: 300 } })),
    );
  });

  it('cancels a contribution form', async () => {
    lensRun.mockResolvedValue({ data: { result: { goals: GOALS } } });
    render(<GoalsTracker />);
    await screen.findByText('Emergency Fund');
    fireEvent.click(screen.getAllByText('+ Contribute')[0]);
    expect(await screen.findByPlaceholderText('$ to add')).toBeInTheDocument();
    fireEvent.click(screen.getByText('×'));
    expect(screen.queryByPlaceholderText('$ to add')).not.toBeInTheDocument();
  });

  it('deletes a goal', async () => {
    lensRun.mockResolvedValue({ data: { result: { goals: GOALS } } });
    render(<GoalsTracker />);
    await screen.findByText('Emergency Fund');
    lensRun.mockClear();
    const li = screen.getByText('Emergency Fund').closest('li') as HTMLElement;
    fireEvent.click(li.querySelector('button') as HTMLElement);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'goals-delete', input: { id: 'g1' } })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<GoalsTracker />);
    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
  });
});
