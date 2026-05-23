import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => React.createElement('div', { 'data-testid': 'save-dtu' }, 'save'),
}));

import { MarketsPulse } from '@/components/finance/MarketsPulse';

const GLOBAL = {
  data: {
    active_cryptocurrencies: 12000,
    markets: 800,
    total_market_cap: { usd: 2_500_000_000_000 },
    total_volume: { usd: 90_000_000_000 },
    market_cap_percentage: { btc: 52.3 },
    market_cap_change_percentage_24h_usd: 1.8,
    updated_at: 1700000000,
  },
};
const TOP = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 65000, market_cap: 1_200_000_000_000, market_cap_rank: 1, price_change_percentage_24h: 2.1 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', current_price: 3200, market_cap: 380_000_000_000, market_cap_rank: 2, price_change_percentage_24h: -1.4 },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('MarketsPulse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders global stats and the top-coins list', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/global')) return Promise.resolve({ ok: true, json: async () => GLOBAL });
      return Promise.resolve({ ok: true, json: async () => TOP });
    }));
    render(<MarketsPulse />, { wrapper });
    expect(await screen.findByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('$2.50T')).toBeInTheDocument();
    expect(screen.getByText('52.3%')).toBeInTheDocument();
    expect(screen.getByTestId('save-dtu')).toBeInTheDocument();
  });

  it('renders negative 24h-change branch', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/global')) return Promise.resolve({ ok: true, json: async () => ({ data: { ...GLOBAL.data, market_cap_change_percentage_24h_usd: -3.2 } }) });
      return Promise.resolve({ ok: true, json: async () => TOP });
    }));
    render(<MarketsPulse />, { wrapper });
    expect(await screen.findByText('-3.20%')).toBeInTheDocument();
  });

  it('shows an error banner when CoinGecko is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) })));
    render(<MarketsPulse />, { wrapper });
    expect(await screen.findByText(/CoinGecko unreachable/)).toBeInTheDocument();
  });

  it('shows dashes when global data is missing', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/global')) return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    render(<MarketsPulse />, { wrapper });
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
  });
});
