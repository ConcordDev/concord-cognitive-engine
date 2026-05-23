import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CategorisationRules } from '@/components/finance/CategorisationRules';

const RULES = [
  { id: 'r1', matchText: 'WHOLEFDS', category: 'Groceries', matchKind: 'contains', priority: 100, createdAt: '2026-01-01' },
  { id: 'r2', matchText: '^UBER', category: 'Transportation', matchKind: 'regex', priority: 50, createdAt: '2026-01-02' },
];

describe('CategorisationRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { rules: [] } } });
  });

  it('shows empty state with no rules', async () => {
    render(<CategorisationRules />);
    expect(await screen.findByText(/No custom rules/)).toBeInTheDocument();
  });

  it('renders rules with regex + contains styling', async () => {
    lensRun.mockResolvedValue({ data: { result: { rules: RULES } } });
    render(<CategorisationRules />);
    expect(await screen.findByText('"WHOLEFDS"')).toBeInTheDocument();
    expect(screen.getByText('"^UBER"')).toBeInTheDocument();
    expect(screen.getByText('2 rules')).toBeInTheDocument();
    expect(screen.getAllByText('regex').length).toBeGreaterThan(0);
  });

  it('ignores create with blank fields', async () => {
    render(<CategorisationRules />);
    await screen.findByText(/No custom rules/);
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'rules-create' }));
  });

  it('creates a rule', async () => {
    render(<CategorisationRules />);
    await screen.findByText(/No custom rules/);
    fireEvent.change(screen.getByPlaceholderText('Match text'), { target: { value: 'NETFLIX' } });
    fireEvent.change(screen.getByPlaceholderText('Category'), { target: { value: 'Subscriptions' } });
    fireEvent.change(screen.getByPlaceholderText('Prio'), { target: { value: '75' } });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'starts_with' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { result: { rules: [] } } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({
        action: 'rules-create',
        input: expect.objectContaining({ matchText: 'NETFLIX', category: 'Subscriptions', matchKind: 'starts_with', priority: 75 }),
      })),
    );
  });

  it('deletes a rule', async () => {
    lensRun.mockResolvedValue({ data: { result: { rules: RULES } } });
    render(<CategorisationRules />);
    await screen.findByText('"WHOLEFDS"');
    lensRun.mockClear();
    const li = screen.getByText('"WHOLEFDS"').closest('li') as HTMLElement;
    fireEvent.click(li.querySelector('button') as HTMLElement);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'rules-delete', input: { id: 'r1' } })),
    );
  });

  it('runs a category test and shows the result', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'rules-apply') return Promise.resolve({ data: { result: { category: 'Groceries', source: 'user_rule' } } });
      return Promise.resolve({ data: { result: { rules: [] } } });
    });
    render(<CategorisationRules />);
    await screen.findByText(/No custom rules/);
    fireEvent.change(screen.getByPlaceholderText(/Test a merchant/), { target: { value: 'WHOLEFDS MKT' } });
    fireEvent.click(screen.getByText('Test'));
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('(user_rule)')).toBeInTheDocument();
  });

  it('does not run test with empty input', async () => {
    render(<CategorisationRules />);
    await screen.findByText(/No custom rules/);
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Test'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'rules-apply' }));
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<CategorisationRules />);
    expect(await screen.findByText(/No custom rules/)).toBeInTheDocument();
  });
});
