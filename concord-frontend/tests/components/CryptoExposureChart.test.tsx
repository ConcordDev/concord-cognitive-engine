import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// CandleChart is loaded via next/dynamic — stub it to a simple marker so this
// test stays scoped to CryptoExposureChart's own data-resolution logic.
vi.mock('@/components/charts/CandleChart', () => ({
  default: ({ symbol, candles }: { symbol?: string; candles: unknown[] }) => (
    <div data-testid="candle-chart">{symbol}:{candles.length}</div>
  ),
}));

import CryptoExposureChart from '@/components/finance/CryptoExposureChart';

beforeEach(() => { vi.clearAllMocks(); });

function mockResponses({ holdings = [], candles = [] }: { holdings?: Array<{ symbol: string; assetClass: string }>; candles?: unknown[] }) {
  lensRunMock.mockImplementation((spec: { domain: string; action: string }) => {
    if (spec.domain === 'finance' && spec.action === 'holdings-list') {
      return Promise.resolve({ data: { result: { holdings } } });
    }
    if (spec.domain === 'crypto' && spec.action === 'token-candles') {
      return Promise.resolve({ data: { result: { candles } } });
    }
    return Promise.resolve({ data: { result: {} } });
  });
}

describe('CryptoExposureChart — real crypto.token-candles market context for Positions', () => {
  it('defaults to bitcoin and shows the "no crypto holdings" note when the user holds none', async () => {
    mockResponses({ holdings: [], candles: [] });
    render(<CryptoExposureChart />);
    await waitFor(() => expect(screen.getByTestId('candle-chart')).toHaveTextContent('BITCOIN:0'));
    expect(screen.getByText(/No crypto holdings yet/i)).toBeInTheDocument();
  });

  it('resolves a real crypto holding to its known market id and charts it', async () => {
    mockResponses({
      holdings: [{ symbol: 'eth', assetClass: 'crypto' }],
      candles: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }],
    });
    render(<CryptoExposureChart />);
    await waitFor(() => expect(screen.getByTestId('candle-chart')).toHaveTextContent('ETHEREUM:1'));
    expect(screen.queryByText(/No crypto holdings yet/i)).toBeNull();
    expect(screen.queryByText(/Chart not available/i)).toBeNull();
  });

  it('flags an honest fallback note for a crypto holding with no known market id', async () => {
    mockResponses({ holdings: [{ symbol: 'SHIBAINU', assetClass: 'crypto' }], candles: [] });
    render(<CryptoExposureChart />);
    await waitFor(() => expect(screen.getByText(/Chart not available for: SHIBAINU/i)).toBeInTheDocument());
    expect(screen.getByText(/showing BITCOIN instead/i)).toBeInTheDocument();
  });

  it('switching the timeframe re-requests real candles for the new window', async () => {
    mockResponses({ holdings: [], candles: [] });
    render(<CryptoExposureChart />);
    await waitFor(() => expect(screen.getByTestId('candle-chart')).toBeInTheDocument());
    lensRunMock.mockClear();
    mockResponses({ holdings: [], candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }] });

    fireEvent.click(screen.getByText('7d'));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'crypto', action: 'token-candles', input: expect.objectContaining({ days: 7 }) }),
    ));
  });
});
