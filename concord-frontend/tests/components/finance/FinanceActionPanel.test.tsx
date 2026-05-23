import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn();
const lensRun = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({
    run: async (op: () => Promise<unknown>) => op(),
    status: 'idle', label: '', token: null, remainingMs: 0, windowMs: 0, error: null,
    recall: vi.fn(), dismiss: vi.fn(),
  }),
  RecallSlot: () => React.createElement('div', { 'data-testid': 'recall-slot' }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('div', p, children),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

import { FinanceActionPanel } from '@/components/finance/FinanceActionPanel';

describe('FinanceActionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDomain.mockResolvedValue({ data: { ok: true, result: {} } });
    lensRun.mockResolvedValue({ data: { result: {} } });
    apiPost.mockResolvedValue({ data: { ok: true } });
    apiDelete.mockResolvedValue({ data: { ok: true } });
  });

  it('renders the workbench with all action tiles', () => {
    render(<FinanceActionPanel />);
    expect(screen.getByText('Money workbench')).toBeInTheDocument();
    expect(screen.getByText('Net worth')).toBeInTheDocument();
    expect(screen.getByText('+ Envelope')).toBeInTheDocument();
    expect(screen.getByText('Top move')).toBeInTheDocument();
  });

  it('errors when net-worth has no asset lines', async () => {
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('Net worth'));
    expect(await screen.findByText('Add asset lines.')).toBeInTheDocument();
  });

  it('computes a net-worth snapshot from asset/liability lines', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { netWorth: 50000, assetsTotal: 60000, liabilitiesTotal: 10000 } } });
    render(<FinanceActionPanel />);
    const textareas = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textareas[0], { target: { value: 'house 200000\ncash 5000' } });
    fireEvent.change(textareas[1], { target: { value: 'mortgage 150000' } });
    fireEvent.click(screen.getByText('Net worth'));
    expect(await screen.findByText(/Net worth \$50,000/)).toBeInTheDocument();
  });

  it('errors when envelope name is blank, then creates one', async () => {
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('+ Envelope'));
    expect(await screen.findByText('Envelope name required.')).toBeInTheDocument();
    runDomain.mockResolvedValue({ data: { ok: true, result: { envelope: { id: 'env-12345678' } } } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Groceries'), { target: { value: 'Food' } });
    fireEvent.click(screen.getByText('+ Envelope'));
    expect(await screen.findByText('Envelope: Food.')).toBeInTheDocument();
  });

  it('runs a tax estimate', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { estimatedTax: 12000, effectiveRate: 15, bracket: '22%' } } });
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('Tax est'));
    expect(await screen.findByText(/Tax: \$12,000/)).toBeInTheDocument();
  });

  it('runs a monte-carlo simulation and enables publish', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { successRate: 88, medianFinal: 1500000 } } });
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('Retire MC'));
    expect(await screen.findByText(/MC success rate: 88%/)).toBeInTheDocument();
  });

  it('detects subscriptions', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { subscriptions: [{ name: 'Netflix', monthlyAmount: 15, flagged: true }], monthlyTotal: 15 } } });
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('Subs'));
    expect(await screen.findByText(/1 subscriptions detected/)).toBeInTheDocument();
  });

  it('mints a private finance DTU', async () => {
    lensRun.mockResolvedValue({ data: { result: { dtu: { id: 'dtu-abcdefgh' } } } });
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('Mint'));
    await waitFor(() => expect(screen.getByText(/Finance DTU dtu-abcd/)).toBeInTheDocument());
  });

  it('errors when DM recipient is blank', async () => {
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('DM'));
    expect(await screen.findByText('Enter a recipient.')).toBeInTheDocument();
  });

  it('sends a DM when a recipient is set', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'msg-1' } } });
    render(<FinanceActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/accountant \/ advisor/), { target: { value: 'advisor1' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText(/Sent to advisor1/)).toBeInTheDocument());
  });

  it('publish is disabled until a monte-carlo result exists', async () => {
    render(<FinanceActionPanel />);
    const publishBtn = screen.getByText('Publish MC').closest('button')!;
    expect(publishBtn).toBeDisabled();
  });

  it('runs the agent top-move action', async () => {
    lensRun.mockResolvedValue({ data: { result: { reply: 'Pay off the credit card.' } } });
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('Top move'));
    expect(await screen.findByText('Pay off the credit card.')).toBeInTheDocument();
  });

  it('surfaces a macro error', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'macro blew up' } });
    render(<FinanceActionPanel />);
    fireEvent.click(screen.getByText('Tax est'));
    expect(await screen.findByText('macro blew up')).toBeInTheDocument();
  });
});
