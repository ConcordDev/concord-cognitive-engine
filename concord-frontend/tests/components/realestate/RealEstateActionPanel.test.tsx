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
  motion: {
    div: React.forwardRef(({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...p, ref }, children)),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({
    run: async (op: () => Promise<unknown>) => op(),
    status: 'idle', label: 'x', token: null, remainingMs: 0, windowMs: 0, error: null,
    recall: vi.fn(), dismiss: vi.fn(),
  }),
  RecallSlot: () => React.createElement('div', { 'data-testid': 'recall-slot' }),
}));

import { RealEstateActionPanel } from '@/components/realestate/RealEstateActionPanel';

describe('RealEstateActionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDomain.mockResolvedValue({ data: { ok: true, result: {} } });
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'm1' } } });
    apiDelete.mockResolvedValue({ data: { ok: true } });
  });

  it('renders the workbench header and all eight action buttons', () => {
    render(<RealEstateActionPanel />);
    expect(screen.getByText('Property workbench')).toBeInTheDocument();
    ['Cap rate', 'Mortgage', 'Afford', 'Rent v buy', 'Mint', 'DM', 'Publish', 'Negotiate']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });

  it('computes a cap rate and renders the tile', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { capRatePct: 6.5, band: 'good', noi: 24000 } } });
    render(<RealEstateActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Price $'), { target: { value: '400000' } });
    fireEvent.change(screen.getByPlaceholderText('Annual rent $'), { target: { value: '36000' } });
    fireEvent.change(screen.getByPlaceholderText('Annual expenses $'), { target: { value: '12000' } });
    fireEvent.click(screen.getByText('Cap rate'));
    expect(await screen.findByText('Cap rate: 6.50%.')).toBeInTheDocument();
    expect(screen.getByText('6.50%')).toBeInTheDocument();
  });

  it('shows an error when the cap macro returns ok:false', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'bad inputs' } } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Cap rate'));
    expect(await screen.findByText('bad inputs')).toBeInTheDocument();
  });

  it('computes a mortgage payment', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { monthlyPayment: 2660, totalInterest: 557000, payoffYears: 30 } } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Mortgage'));
    expect(await screen.findByText('$2660/mo.')).toBeInTheDocument();
  });

  it('computes affordability', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { maxPrice: 540000, maxMonthlyPayment: 3100, dtiRatio: 0.34 } } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Afford'));
    expect(await screen.findByText('Max: $540,000.')).toBeInTheDocument();
  });

  it('computes rent vs buy', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { breakEvenYears: 6.2, recommendation: 'Buy', netDifference: 50000 } } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Rent v buy'));
    expect(await screen.findByText('Buy.')).toBeInTheDocument();
  });

  it('mints a property DTU when an id is returned', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'dtu-abcdef12' } } } });
    render(<RealEstateActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '1 Pine St' } });
    fireEvent.click(screen.getByText('Mint'));
    expect(await screen.findByText(/Property DTU dtu-abcd/)).toBeInTheDocument();
  });

  it('shows an error when minting returns no id', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Mint'));
    expect(await screen.findByText('No DTU id.')).toBeInTheDocument();
  });

  it('requires a recipient before sending a DM', async () => {
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('DM'));
    expect(await screen.findByText('Recipient required.')).toBeInTheDocument();
  });

  it('sends a DM when a recipient is given', async () => {
    render(<RealEstateActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Price $'), { target: { value: '400000' } });
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user-9' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/social/dm', expect.objectContaining({ toUserId: 'user-9' })),
    );
    expect(await screen.findByText('Sent. 60s to recall.')).toBeInTheDocument();
  });

  it('publishes an anonymized analysis', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'pub-12345678' } } } });
    apiPost.mockResolvedValue({ data: { ok: true } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Publish'));
    expect(await screen.findByText(/Analysis published pub-1234/)).toBeInTheDocument();
  });

  it('runs the negotiation agent and renders the reply', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { reply: 'Ask for a repair credit.' } } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Negotiate'));
    expect(await screen.findByText('Ask for a repair credit.')).toBeInTheDocument();
    expect(screen.getByText('Negotiation lever ready.')).toBeInTheDocument();
  });

  it('shows an error when the agent returns empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Negotiate'));
    expect(await screen.findByText('Agent returned empty.')).toBeInTheDocument();
  });

  it('surfaces a thrown error via pickMessage', async () => {
    runDomain.mockRejectedValue({ response: { data: { error: 'server boom' } } });
    render(<RealEstateActionPanel />);
    fireEvent.click(screen.getByText('Cap rate'));
    expect(await screen.findByText('server boom')).toBeInTheDocument();
  });
});
