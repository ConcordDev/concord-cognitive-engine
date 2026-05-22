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
    status: 'idle',
    label: 'x',
    token: null,
    remainingMs: 0,
    windowMs: 0,
    error: null,
    recall: vi.fn(),
    dismiss: vi.fn(),
  }),
  RecallSlot: () => React.createElement('div', { 'data-testid': 'recall-slot' }),
}));

import { MarketplaceActionPanel } from '@/components/marketplace/MarketplaceActionPanel';

function fillTitle(value = 'My Listing') {
  fireEvent.change(screen.getByPlaceholderText('Listing title'), { target: { value } });
}

describe('MarketplaceActionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDomain.mockResolvedValue({ data: { ok: true, result: {} } });
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'm1' } } });
    apiDelete.mockResolvedValue({ data: { ok: true } });
  });

  it('renders the workbench header and all action buttons', () => {
    render(<MarketplaceActionPanel />);
    expect(screen.getByText('Listing workbench')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Mint')).toBeInTheDocument();
    expect(screen.getByText('Copy AI')).toBeInTheDocument();
  });

  it('shows an error when score is run without a title', async () => {
    render(<MarketplaceActionPanel />);
    fireEvent.click(screen.getByText('Score'));
    expect(await screen.findByText('Listing title required.')).toBeInTheDocument();
  });

  it('runs listingScore and renders the score result card', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { score: 82, band: 'strong', tips: ['Add tags', 'More photos'] } },
    });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('Score'));
    expect(await screen.findByText(/Score 82/)).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('Add tags')).toBeInTheDocument();
  });

  it('shows error feedback when score macro returns ok:false', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'score broke' } });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('Score'));
    expect(await screen.findByText('score broke')).toBeInTheDocument();
  });

  it('runs priceOptimize and renders the price card', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: { suggestedPrice: 24, competitorAvg: 20, demandIndex: 0.7, rationale: 'High demand' },
      },
    });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.change(screen.getByPlaceholderText('Price $'), { target: { value: '19' } });
    fireEvent.click(screen.getByText('Price'));
    expect(await screen.findByText('$24')).toBeInTheDocument();
    expect(screen.getByText('High demand')).toBeInTheDocument();
  });

  it('runs sellerMetrics with no title required', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: { listings: 5, views: 300, sales: 12, conversionPct: 4, revenue: 1500 },
      },
    });
    render(<MarketplaceActionPanel />);
    fireEvent.click(screen.getByText('Metrics'));
    expect(await screen.findByText('Seller metrics')).toBeInTheDocument();
    expect(screen.getByText(/5 listings · 12 sales/)).toBeInTheDocument();
  });

  it('mints a private listing DTU', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'dtu-abcdef12' } } } });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('Mint'));
    expect(await screen.findByText(/Listing DTU dtu-abcd/)).toBeInTheDocument();
  });

  it('shows error when mint returns no DTU id', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('Mint'));
    expect(await screen.findByText('No DTU id returned.')).toBeInTheDocument();
  });

  it('requires a recipient before sending a DM', async () => {
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('DM'));
    expect(await screen.findByText('Enter a recipient.')).toBeInTheDocument();
  });

  it('sends a DM when a recipient is present', async () => {
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social/dm', expect.anything()));
  });

  it('publishes a public listing DTU', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'pub-abcdef99' } } } });
    apiPost.mockResolvedValue({ data: { ok: true } });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('Go live'));
    expect(await screen.findByText(/Listing live pub-/)).toBeInTheDocument();
  });

  it('runs the agent copy rewrite and renders the reply', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { reply: 'New punchy title' } } });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.change(screen.getByPlaceholderText(/What is it/), { target: { value: 'A widget' } });
    fireEvent.click(screen.getByText('Copy AI'));
    expect(await screen.findByText('Copy rewrite')).toBeInTheDocument();
    expect(screen.getByText('New punchy title')).toBeInTheDocument();
  });

  it('shows error when agent returns empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('Copy AI'));
    expect(await screen.findByText('Agent returned empty.')).toBeInTheDocument();
  });

  it('strips non-numeric characters from the price field', () => {
    render(<MarketplaceActionPanel />);
    const priceInput = screen.getByPlaceholderText('Price $') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: 'a12.5b' } });
    expect(priceInput.value).toBe('12.5');
  });

  it('handles a thrown error from a macro call', async () => {
    runDomain.mockRejectedValue({ message: 'network exploded' });
    render(<MarketplaceActionPanel />);
    fillTitle();
    fireEvent.click(screen.getByText('Score'));
    expect(await screen.findByText('network exploded')).toBeInTheDocument();
  });
});
