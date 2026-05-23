import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: (p: Record<string, unknown>) => React.createElement('div', { 'data-testid': 'chart', 'data-kind': p.kind }),
}));

import { PriceHistoryPanel } from '@/components/realestate/PriceHistoryPanel';

const RESULT_UP = {
  listingId: 'L1', address: '1 Pine St',
  history: [
    { id: 'h1', date: '2026-01-01', price: 400000, kind: 'listed' },
    { id: 'h2', date: '2026-03-01', price: 440000, kind: 'price_change' },
  ],
  firstPrice: 400000, lastPrice: 440000, lowestPrice: 400000, highestPrice: 440000,
  totalChangePct: 10, pricePerSqft: 244,
};
const RESULT_DOWN = { ...RESULT_UP, totalChangePct: -8, pricePerSqft: null };

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('PriceHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
  });

  it('shows the select-a-listing placeholder without a listingId', () => {
    render(<PriceHistoryPanel />);
    expect(screen.getByText(/Select a listing to view its price history/)).toBeInTheDocument();
  });

  it('shows the no-history empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...RESULT_UP, history: [] } } });
    render(<PriceHistoryPanel listingId="L1" />);
    expect(await screen.findByText('No price history yet. Add a price event.')).toBeInTheDocument();
  });

  it('renders an upward price history with chart and stats', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: RESULT_UP } });
    render(<PriceHistoryPanel listingId="L1" />);
    expect((await screen.findAllByText('$440,000')).length).toBeGreaterThan(0);
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('$244')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toHaveAttribute('data-kind', 'area');
  });

  it('renders a downward change and a missing $/sqft', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: RESULT_DOWN } });
    render(<PriceHistoryPanel listingId="L1" />);
    expect(await screen.findByText('-8%')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('adds a price entry through the form', async () => {
    route((action) => {
      if (action === 'price-history') return { data: { ok: true, result: { ...RESULT_UP, history: [] } } };
      return { data: { ok: true } };
    });
    render(<PriceHistoryPanel listingId="L1" />);
    await screen.findByText('No price history yet. Add a price event.');
    fireEvent.click(screen.getByTitle('Add price event'));
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '455000' } });
    fireEvent.change(screen.getByDisplayValue('price change'), { target: { value: 'sold' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'price-history-add', input: expect.objectContaining({ listingId: 'L1', price: 455000, kind: 'sold' }) }),
      ),
    );
  });

  it('surfaces an error when add fails', async () => {
    route((action) => {
      if (action === 'price-history') return { data: { ok: true, result: RESULT_UP } };
      return { data: { ok: false, error: 'bad entry' } };
    });
    render(<PriceHistoryPanel listingId="L1" />);
    await screen.findAllByText('$440,000');
    fireEvent.click(screen.getByTitle('Add price event'));
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '999' } });
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText('bad entry')).toBeInTheDocument();
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<PriceHistoryPanel listingId="L1" />);
    expect(await screen.findByText('No price history yet. Add a price event.')).toBeInTheDocument();
  });
});
