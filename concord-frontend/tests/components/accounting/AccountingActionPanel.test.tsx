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

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: (cfg: { label: string }) => ({
    label: cfg.label,
    run: async (fn: () => Promise<unknown>) => fn(),
  }),
  RecallSlot: () => React.createElement('div', { 'data-testid': 'recall-slot' }),
}));

import { AccountingActionPanel } from '@/components/accounting/AccountingActionPanel';

describe('AccountingActionPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all eight action buttons and the four JSON textareas', () => {
    render(<AccountingActionPanel />);
    expect(screen.getByText('Trial bal')).toBeInTheDocument();
    expect(screen.getByText('P&L')).toBeInTheDocument();
    expect(screen.getByText('AR aging')).toBeInTheDocument();
    expect(screen.getByText('Variance')).toBeInTheDocument();
    expect(screen.getByText('Mint')).toBeInTheDocument();
    expect(screen.getByText('DM')).toBeInTheDocument();
    expect(screen.getByText('Publish')).toBeInTheDocument();
    expect(screen.getByText('Brief')).toBeInTheDocument();
  });

  it('shows an error when running trial balance with empty input', async () => {
    render(<AccountingActionPanel />);
    fireEvent.click(screen.getByText('Trial bal'));
    expect(await screen.findByText('Paste TB JSON first.')).toBeInTheDocument();
  });

  it('shows an error for invalid trial-balance JSON', async () => {
    render(<AccountingActionPanel />);
    const tb = screen.getByPlaceholderText(/"entries"/);
    fireEvent.change(tb, { target: { value: '{not json' } });
    fireEvent.click(screen.getByText('Trial bal'));
    expect(await screen.findByText('Invalid TB JSON.')).toBeInTheDocument();
  });

  it('runs trial balance and renders a balanced result card', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { balanced: true, totalDebits: 100, totalCredits: 100, difference: 0, entries: [], accountCount: 3 } } } });
    render(<AccountingActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/"entries"/), { target: { value: '{"entries":[]}' } });
    fireEvent.click(screen.getByText('Trial bal'));
    expect(await screen.findByText('Trial balance')).toBeInTheDocument();
    expect(screen.getAllByText(/balanced/).length).toBeGreaterThan(0);
  });

  it('runs P&L and renders a net-income result card', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { period: 'Q1', revenue: 1000, expenses: 600, netIncome: 400, grossMargin: 40 } } } });
    render(<AccountingActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/"period"/), { target: { value: '{"period":"Q1"}' } });
    fireEvent.click(screen.getByText('P&L'));
    expect(await screen.findByText('P&L · Q1')).toBeInTheDocument();
    expect(screen.getByText('Net $400.')).toBeInTheDocument();
  });

  it('shows the macro-reported error for AR aging', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'aging failed' } } });
    render(<AccountingActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/"invoices"/), { target: { value: '{"invoices":[]}' } });
    fireEvent.click(screen.getByText('AR aging'));
    expect(await screen.findByText('aging failed')).toBeInTheDocument();
  });

  it('runs variance and renders a variance result card', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { lines: [{ category: 'Travel', planned: 100, actual: 90, variance: 10, variancePercent: 10, status: 'under' }], totalPlanned: 100, totalActual: 90, totalVariance: 10, status: 'under budget' } } } });
    render(<AccountingActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/"lines"/), { target: { value: '{"lines":[]}' } });
    fireEvent.click(screen.getByText('Variance'));
    expect(await screen.findByText('Variance · under budget')).toBeInTheDocument();
  });

  it('errors when DM has no recipient', async () => {
    render(<AccountingActionPanel />);
    fireEvent.click(screen.getByText('DM'));
    expect(await screen.findByText('Recipient required.')).toBeInTheDocument();
  });

  it('sends a DM when a recipient is provided', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'm1' } } });
    render(<AccountingActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user-9' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social/dm', expect.objectContaining({ toUserId: 'user-9' })));
    expect(await screen.findByText(/Sent\. 60s to recall/)).toBeInTheDocument();
  });

  it('errors when publishing before a P&L was run', async () => {
    render(<AccountingActionPanel />);
    fireEvent.click(screen.getByText('Publish'));
    expect(await screen.findByText('Run P&L first.')).toBeInTheDocument();
  });

  it('runs the agent brief and renders the reply', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { reply: 'Cut cloud spend.' } } });
    render(<AccountingActionPanel />);
    fireEvent.click(screen.getByText('Brief'));
    expect(await screen.findByText('CFO brief')).toBeInTheDocument();
    expect(screen.getByText('Cut cloud spend.')).toBeInTheDocument();
  });

  it('shows an empty-agent error when the agent returns nothing', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<AccountingActionPanel />);
    fireEvent.click(screen.getByText('Brief'));
    expect(await screen.findByText('Agent returned empty.')).toBeInTheDocument();
  });

  it('mints a books DTU', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'dtu-abcdef12' } } } });
    render(<AccountingActionPanel />);
    fireEvent.click(screen.getByText('Mint'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ domain: 'dtu', name: 'create' })),
    );
    expect(await screen.findByText(/Books DTU/)).toBeInTheDocument();
  });
});
