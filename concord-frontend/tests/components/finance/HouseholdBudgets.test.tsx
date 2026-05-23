import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { HouseholdBudgets } from '@/components/finance/HouseholdBudgets';

const HOUSEHOLD = {
  id: 'hh1',
  name: 'The Smiths',
  ownerId: 'u1',
  members: [
    { userId: 'u1', role: 'owner', joinedAt: '2026-01-01' },
    { userId: 'u2', role: 'member', joinedAt: '2026-01-02' },
  ],
  sharedBudgets: [
    { id: 'b1', category: 'Groceries', monthlyTarget: 800, spent: 950, contributions: [{ memberId: 'u1', amount: 500, note: 'shop', at: '2026-05-01' }], createdBy: 'u1' },
    { id: 'b2', category: 'Utilities', monthlyTarget: 300, spent: 200, contributions: [], createdBy: 'u1' },
  ],
};

describe('HouseholdBudgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { household: null } } });
  });

  it('shows the no-household create state', async () => {
    render(<HouseholdBudgets />);
    expect(await screen.findByText(/No household yet/)).toBeInTheDocument();
  });

  it('creates a household', async () => {
    render(<HouseholdBudgets />);
    await screen.findByText(/No household yet/);
    fireEvent.change(screen.getByPlaceholderText('Household name'), { target: { value: 'Casa' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true, result: { household: null } } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'household-create', { name: 'Casa' }),
    );
  });

  it('renders an existing household with members and budgets', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { household: HOUSEHOLD } } });
    render(<HouseholdBudgets />);
    expect(await screen.findByText('The Smiths')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Utilities')).toBeInTheDocument();
    expect(screen.getByText(/1 contribution\(s\)/)).toBeInTheDocument();
  });

  it('adds and removes a member', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'household-get') return Promise.resolve({ data: { ok: true, result: { household: HOUSEHOLD } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<HouseholdBudgets />);
    await screen.findByText('The Smiths');
    fireEvent.change(screen.getByPlaceholderText('Member user ID'), { target: { value: 'u3' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('finance', 'household-add-member', { memberId: 'u3' }));
    fireEvent.click(screen.getByLabelText('Remove member'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('finance', 'household-remove-member', { memberId: 'u2' }));
  });

  it('creates a shared budget and logs spend', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'household-get') return Promise.resolve({ data: { ok: true, result: { household: HOUSEHOLD } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<HouseholdBudgets />);
    await screen.findByText('The Smiths');
    fireEvent.change(screen.getByPlaceholderText('Category'), { target: { value: 'Travel' } });
    fireEvent.change(screen.getByPlaceholderText('Monthly target'), { target: { value: '400' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Budget'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'household-budget-create', { category: 'Travel', monthlyTarget: 400 }),
    );
    fireEvent.click(screen.getAllByText('Log spend')[0]);
    fireEvent.change(await screen.findByPlaceholderText('Amount'), { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText('Note (optional)'), { target: { value: 'milk' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'household-budget-spend', { budgetId: 'b1', amount: 50, note: 'milk' }),
    );
  });

  it('does not create a budget with invalid target', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { household: HOUSEHOLD } } });
    render(<HouseholdBudgets />);
    await screen.findByText('The Smiths');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Budget'));
    expect(lensRun).not.toHaveBeenCalledWith('finance', 'household-budget-create', expect.anything());
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<HouseholdBudgets />);
    expect(await screen.findByText(/No household yet/)).toBeInTheDocument();
  });
});
