import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const postMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => postMock(...args) },
}));

import PredictionDepthPanel from '@/components/markets/PredictionDepthPanel';

beforeEach(() => { vi.clearAllMocks(); });

const MARKETS = [
  { id: 'm1', question: 'Will the dome hold through the season?' },
  { id: 'm2', question: 'Will the tunya harvest exceed 500?' },
];
const BOOK_M1 = {
  currentYesProbability: 0.62,
  yesBids: [{ price: 0.55, size: 10 }],
  noBids: [{ price: 0.5, size: 8 }],
};

function mockApi() {
  postMock.mockImplementation((_url: string, body: { domain: string; action: string; input?: { marketId?: string } }) => {
    if (body.action === 'market-list') {
      return Promise.resolve({ data: { result: { markets: MARKETS } } });
    }
    if (body.action === 'order-book') {
      return Promise.resolve({ data: { result: body.input?.marketId === 'm1' ? BOOK_M1 : { currentYesProbability: 0.4, yesBids: [], noBids: [] } } });
    }
    return Promise.resolve({ data: { result: {} } });
  });
}

describe('PredictionDepthPanel — self-contained markets.order-book depth viewer', () => {
  it('shows the honest empty state when no open markets exist', async () => {
    postMock.mockResolvedValue({ data: { result: { markets: [] } } });
    render(<PredictionDepthPanel />);
    await waitFor(() => expect(screen.getByText(/No open prediction markets yet/i)).toBeInTheDocument());
  });

  it('auto-selects the first open market and renders its real resting-order depth', async () => {
    mockApi();
    render(<PredictionDepthPanel />);
    await waitFor(() => expect(screen.getByRole('img', { name: /Order book depth/i })).toBeInTheDocument());
    // the real book totals from BOOK_M1, not fabricated
    expect(screen.getByText(/YES 10/)).toBeInTheDocument();
    expect(screen.getByText(/NO 8/)).toBeInTheDocument();
    expect(screen.getByText('mid 0.62')).toBeInTheDocument();
  });

  it('switching markets fetches and renders that market\'s real order book', async () => {
    mockApi();
    render(<PredictionDepthPanel />);
    await waitFor(() => expect(screen.getByText(/YES 10/)).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    await waitFor(() => expect(screen.getByText(/No resting orders in the book/i)).toBeInTheDocument());
  });
});
