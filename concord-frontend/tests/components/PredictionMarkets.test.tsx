import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/components/viz', () => ({ ChartKit: () => <div data-testid="chart-kit" /> }));

const MARKET = {
  id: 'm1',
  question: 'Will the dome hold through the season?',
  description: 'desc', category: 'substrate', resolutionCriteria: 'crit', creatorId: 'u1',
  poolYes: 300, poolNo: 100, totalPool: 400, yesProbability: 0.75, noProbability: 0.25,
  yesPercent: 75, noPercent: 25, status: 'open', outcome: null,
  openedAt: 1735000000, closesAt: null, resolvedAt: null, tradeCount: 12, resolution: null,
};

const BOOK = {
  marketId: 'm1',
  currentYesProbability: 0.75,
  yesBids: [{ price: 0.7, size: 12 }],
  noBids: [{ price: 0.3, size: 9 }],
  restingCount: 2,
  myOrders: [],
};

function mockMarketsApi() {
  lensRunMock.mockImplementation((_domain: string, action: string) => {
    switch (action) {
      case 'market-list':
        return Promise.resolve({ data: { ok: true, result: { markets: [MARKET], facets: {}, categories: ['substrate'] } } });
      case 'my-positions':
        return Promise.resolve({ data: { ok: true, result: { positions: [] } } });
      case 'leaderboard':
        return Promise.resolve({ data: { ok: true, result: { leaderboard: [] } } });
      case 'market-get':
        return Promise.resolve({ data: { ok: true, result: { market: MARKET } } });
      case 'market-history':
        return Promise.resolve({ data: { ok: true, result: { points: [] } } });
      case 'order-book':
        return Promise.resolve({ data: { ok: true, result: BOOK } });
      case 'market-resolution':
        return Promise.resolve({ data: { ok: true, result: null } });
      case 'market-odds':
        return Promise.resolve({ data: { ok: true, result: { yesPercent: 75, noPercent: 25, yesMultiple: 1.3, noMultiple: 4, yesStakePayoutIfWin: 13, noStakePayoutIfWin: 40 } } });
      default:
        return Promise.resolve({ data: { ok: true, result: {} } });
    }
  });
}

import PredictionMarkets from '@/components/markets/PredictionMarkets';

beforeEach(() => { vi.clearAllMocks(); mockMarketsApi(); });

describe('PredictionMarkets — market detail renders real order-book depth (not a plain bid/ask list)', () => {
  it('opening a market detail view renders the real DepthChart fed by markets.order-book', async () => {
    render(<PredictionMarkets />);
    await waitFor(() => expect(screen.getByText('Will the dome hold through the season?')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Will the dome hold through the season?'));

    await waitFor(() => expect(screen.getByText(/Order book depth · 2 resting/i)).toBeInTheDocument());
    // Confirms the real DepthChart mounted (SVG, real cumulative totals from BOOK) —
    // not the retired plain-list OrderColumn rendering.
    const svg = screen.getByRole('img', { name: /Order book depth/i });
    expect(svg).toBeInTheDocument();
    expect(screen.getByText(/YES 12/)).toBeInTheDocument();
    expect(screen.getByText(/NO 9/)).toBeInTheDocument();
  });

  it('an empty order book shows the honest "no resting orders" state inside the detail view', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'order-book') {
        return Promise.resolve({ data: { ok: true, result: { ...BOOK, yesBids: [], noBids: [], restingCount: 0 } } });
      }
      return action === 'market-list'
        ? Promise.resolve({ data: { ok: true, result: { markets: [MARKET], facets: {}, categories: [] } } })
        : action === 'market-get'
          ? Promise.resolve({ data: { ok: true, result: { market: MARKET } } })
          : Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<PredictionMarkets />);
    await waitFor(() => expect(screen.getByText('Will the dome hold through the season?')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Will the dome hold through the season?'));
    await waitFor(() => expect(screen.getByText(/No resting orders in the book/i)).toBeInTheDocument());
  });
});
