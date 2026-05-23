import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  api: {
    post: (...a: unknown[]) => apiPost(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  },
}));

const pipePublish = vi.fn();
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: pipePublish }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => React.createElement('div', { 'data-testid': 'recall-slot' }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t2, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t2;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { GovernmentActionPanel } from '@/components/government/GovernmentActionPanel';

describe('GovernmentActionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDomain.mockResolvedValue({ data: { ok: true, result: {} } });
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    apiPost.mockResolvedValue({ data: { ok: true } });
  });

  it('renders the civic workbench with all eight action tiles', () => {
    render(<GovernmentActionPanel />);
    expect(screen.getByText('Civic workbench')).toBeInTheDocument();
    expect(screen.getByText('Reps')).toBeInTheDocument();
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Permit')).toBeInTheDocument();
    expect(screen.getByText('Violation')).toBeInTheDocument();
    expect(screen.getByText('Mint')).toBeInTheDocument();
    expect(screen.getByText('Letter')).toBeInTheDocument();
  });

  it('errors when ZIP is not 5 digits for Reps', async () => {
    render(<GovernmentActionPanel />);
    fireEvent.click(screen.getByText('Reps'));
    expect(await screen.findByText('5-digit ZIP required.')).toBeInTheDocument();
  });

  it('finds representatives with a valid ZIP', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { representatives: [{ name: 'Rep A', office: 'Senate', party: 'D' }] } } });
    render(<GovernmentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('ZIP'), { target: { value: '90210' } });
    fireEvent.click(screen.getByText('Reps'));
    expect(await screen.findByText('1 reps.')).toBeInTheDocument();
    expect(screen.getByText('Rep A')).toBeInTheDocument();
    await waitFor(() =>
      expect(runDomain).toHaveBeenCalledWith('government', 'representatives-find', { input: { zip: '90210' } }),
    );
  });

  it('strips non-digits from the ZIP input', () => {
    render(<GovernmentActionPanel />);
    const zip = screen.getByPlaceholderText('ZIP') as HTMLInputElement;
    fireEvent.change(zip, { target: { value: 'ab12c3' } });
    expect(zip.value).toBe('123');
  });

  it('errors when bill query is empty', async () => {
    render(<GovernmentActionPanel />);
    fireEvent.click(screen.getByText('Bills'));
    expect(await screen.findByText('Query required.')).toBeInTheDocument();
  });

  it('lists bills for a query', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { bills: [{ id: 'HR1', title: 'Climate Act', status: 'introduced' }] } } });
    render(<GovernmentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Bill query'), { target: { value: 'climate' } });
    fireEvent.click(screen.getByText('Bills'));
    expect(await screen.findByText('1 bills.')).toBeInTheDocument();
    expect(screen.getByText('HR1')).toBeInTheDocument();
  });

  it('runs the permit timeline action', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { estimatedWeeks: 12, phases: [{ name: 'review', weeks: 4, status: 'pending' }] } } });
    render(<GovernmentActionPanel />);
    fireEvent.click(screen.getByText('Permit'));
    expect(await screen.findByText('~12 weeks.')).toBeInTheDocument();
    expect(screen.getByText('12w')).toBeInTheDocument();
  });

  it('runs the violation escalation action', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { tier: '2', escalated: true, nextStep: 'Notify board' } } });
    render(<GovernmentActionPanel />);
    fireEvent.click(screen.getByText('Violation'));
    expect(await screen.findByText('Tier: 2.')).toBeInTheDocument();
    expect(screen.getByText('Notify board')).toBeInTheDocument();
  });

  it('mints a civic DTU', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'dtu-abcd1234' } } } });
    render(<GovernmentActionPanel />);
    fireEvent.click(screen.getByText('Mint'));
    expect(await screen.findByText(/Civic DTU dtu-abcd/)).toBeInTheDocument();
  });

  it('errors when DM recipient is missing', async () => {
    render(<GovernmentActionPanel />);
    fireEvent.click(screen.getByText('DM'));
    expect(await screen.findByText('Recipient required.')).toBeInTheDocument();
  });

  it('sends a DM brief to a recipient', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'msg1' } } });
    render(<GovernmentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user-9' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social/dm', expect.objectContaining({ toUserId: 'user-9' })));
  });

  it('drafts a constituent letter via the agent', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { reply: 'Dear Rep,\nPlease act.\nThanks.' } } });
    render(<GovernmentActionPanel />);
    fireEvent.click(screen.getByText('Letter'));
    expect(await screen.findByText('Letter draft ready.')).toBeInTheDocument();
    expect(screen.getByText(/Dear Rep/)).toBeInTheDocument();
  });

  it('shows an error feedback when a macro returns ok:false', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'no civic data' } });
    render(<GovernmentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('ZIP'), { target: { value: '12345' } });
    fireEvent.click(screen.getByText('Reps'));
    expect(await screen.findByText('no civic data')).toBeInTheDocument();
  });
});
