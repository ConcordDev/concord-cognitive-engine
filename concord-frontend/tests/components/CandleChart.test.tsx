import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

// lightweight-charts is loaded via dynamic import; stub it (same convention
// as tests/components/MarketsQuoteDetail.test.tsx).
const setDataMock = vi.fn();
const fitContentMock = vi.fn();
vi.mock('lightweight-charts', () => {
  const mkSeries = () => ({ setData: setDataMock });
  const mkChart = () => ({
    addSeries: vi.fn(() => mkSeries()),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({ fitContent: fitContentMock }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    remove: vi.fn(),
  });
  return {
    createChart: vi.fn(mkChart),
    CandlestickSeries: 'CandlestickSeries',
    LineSeries: 'LineSeries',
    HistogramSeries: 'HistogramSeries',
  };
});

import CandleChart, { type Candle } from '@/components/charts/CandleChart';

const CANDLES: Candle[] = [
  { time: 1, open: 100, high: 110, low: 95, close: 105, volume: 10 },
  { time: 2, open: 105, high: 115, low: 100, close: 112, volume: 12 },
  { time: 3, open: 112, high: 120, low: 108, close: 118, volume: 8 },
];

beforeEach(() => { vi.clearAllMocks(); });

describe('CandleChart — TradingView-grade OHLC chart (lightweight-charts)', () => {
  it('shows the honest "no data" panel when candles is empty', () => {
    render(<CandleChart candles={[]} />);
    expect(screen.getByText(/No price data/i)).toBeInTheDocument();
  });

  it('shows a loading overlay when loading is true, even with candles present', () => {
    const { container } = render(<CandleChart candles={CANDLES} loading />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders the symbol label and mounts the real chart + feeds it real candle data', async () => {
    render(<CandleChart candles={CANDLES} symbol="BTCUSD" />);
    expect(screen.getByText('BTCUSD')).toBeInTheDocument();
    await waitFor(() => expect(setDataMock).toHaveBeenCalled());
    // The candle series gets the real, chronologically-sorted input — not fabricated.
    const candleCall = setDataMock.mock.calls.find((c) => c[0]?.[0]?.open === 100);
    expect(candleCall).toBeTruthy();
    expect(candleCall![0]).toHaveLength(3);
  });

  it('computes a real EMA series (not a stub) from close prices', async () => {
    render(<CandleChart candles={CANDLES} emaPeriod={2} />);
    await waitFor(() => expect(setDataMock).toHaveBeenCalled());
    // EMA(period=2): k=2/3; ema0=close0=105; ema1=112*2/3+105*1/3=109.666...
    const emaCall = setDataMock.mock.calls.find((c) => c[0]?.[0]?.value === 105);
    expect(emaCall).toBeTruthy();
    expect(emaCall![0][1].value).toBeCloseTo(109.6667, 3);
  });

  it('re-fits the timeframe after new data loads', async () => {
    render(<CandleChart candles={CANDLES} />);
    await waitFor(() => expect(fitContentMock).toHaveBeenCalled());
  });
});
