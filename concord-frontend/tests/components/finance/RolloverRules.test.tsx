import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RolloverRules } from '@/components/finance/RolloverRules';

const ENVELOPES = [
  { id: 'e1', category: 'Groceries', monthlyTarget: 600, rolloverEnabled: true, currentBalance: 50, spentThisMonth: 400 },
  { id: 'e2', category: 'Dining', monthlyTarget: 200, rolloverEnabled: false, currentBalance: 0, spentThisMonth: 100 },
];
const RULES = [
  { id: 'r1', envelopeId: 'e1', mode: 'capped', cap: 100, goalTarget: 1000, accumulatedGoal: 250 },
];
const APPLIED = {
  applied: [
    { envelopeId: 'e1', category: 'Groceries', leftover: 200, carried: 100, toGoal: 100, mode: 'capped', newBalance: 100, goalProgress: { accumulated: 350, target: 1000, pct: 35 } },
  ],
};

describe('RolloverRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { envelopes: [], rules: [] } } });
  });

  it('shows empty state with no envelopes', async () => {
    render(<RolloverRules />);
    expect(await screen.findByText(/No budget envelopes yet/)).toBeInTheDocument();
  });

  it('shows the no-rules state when envelopes exist', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'envelopes-list') return Promise.resolve({ data: { ok: true, result: { envelopes: ENVELOPES } } });
      return Promise.resolve({ data: { ok: true, result: { rules: [] } } });
    });
    render(<RolloverRules />);
    expect(await screen.findByText(/No rollover rules/)).toBeInTheDocument();
  });

  it('renders rules with goal progress', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'envelopes-list') return Promise.resolve({ data: { ok: true, result: { envelopes: ENVELOPES } } });
      return Promise.resolve({ data: { ok: true, result: { rules: RULES } } });
    });
    render(<RolloverRules />);
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('capped')).toBeInTheDocument();
    expect(screen.getByText(/\$250 \/ \$1,000/)).toBeInTheDocument();
  });

  it('sets a capped rule with cap + goal inputs', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'envelopes-list') return Promise.resolve({ data: { ok: true, result: { envelopes: ENVELOPES } } });
      if (action === 'rollover-rules-list') return Promise.resolve({ data: { ok: true, result: { rules: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<RolloverRules />);
    await screen.findByText(/No rollover rules/);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'e1' } });
    fireEvent.change(selects[1], { target: { value: 'capped' } });
    fireEvent.change(await screen.findByPlaceholderText('Carry cap'), { target: { value: '150' } });
    fireEvent.change(screen.getByPlaceholderText('Goal target'), { target: { value: '2000' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Save rule'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'rollover-rule-set', expect.objectContaining({ envelopeId: 'e1', mode: 'capped', cap: 150, goalTarget: 2000 })),
    );
  });

  it('sets a non-capped rule (shows mode description)', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'envelopes-list') return Promise.resolve({ data: { ok: true, result: { envelopes: ENVELOPES } } });
      if (action === 'rollover-rules-list') return Promise.resolve({ data: { ok: true, result: { rules: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<RolloverRules />);
    await screen.findByText(/No rollover rules/);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'e2' } });
    fireEvent.change(selects[1], { target: { value: 'reset' } });
    expect(screen.getByText(/Drop leftover, start fresh/)).toBeInTheDocument();
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Save rule'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'rollover-rule-set', expect.objectContaining({ envelopeId: 'e2', mode: 'reset' })),
    );
  });

  it('deletes a rule and runs a period close', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'envelopes-list') return Promise.resolve({ data: { ok: true, result: { envelopes: ENVELOPES } } });
      if (action === 'rollover-rules-list') return Promise.resolve({ data: { ok: true, result: { rules: RULES } } });
      if (action === 'rollover-apply') return Promise.resolve({ data: { ok: true, result: APPLIED } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<RolloverRules />);
    await screen.findByText('Groceries');
    fireEvent.click(screen.getByText('Run period close'));
    expect(await screen.findByText(/Last period close/)).toBeInTheDocument();
    lensRun.mockClear();
    fireEvent.click(screen.getByLabelText('Delete rule'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'rollover-rule-delete', { id: 'r1' }),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<RolloverRules />);
    expect(await screen.findByText(/No budget envelopes yet/)).toBeInTheDocument();
  });
});
