import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    remove: vi.fn(),
  })),
  CandlestickSeries: 'CandlestickSeries',
  LineSeries: 'LineSeries',
  HistogramSeries: 'HistogramSeries',
}));

// components/crypto/CandleChart.tsx is a one-cycle re-export shim left behind
// after CandleChart was promoted to components/charts/ (the domain-agnostic
// home) — this proves the shim itself still resolves to a real, rendering
// component, not a dangling import.
import LegacyCandleChart from '@/components/crypto/CandleChart';

describe('components/crypto/CandleChart — re-export shim', () => {
  it('resolves to the real, promoted charts/CandleChart component', () => {
    const { container } = render(<LegacyCandleChart candles={[]} />);
    expect(container.textContent).toMatch(/No price data/i);
  });
});
