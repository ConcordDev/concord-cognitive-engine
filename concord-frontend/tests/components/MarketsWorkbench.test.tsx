import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const postMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => postMock(...args) },
}));

// PredictionDepthPanel has its own dedicated test file
// (tests/components/PredictionDepthPanel.test.tsx) — stub it here so this
// test stays scoped to MarketsWorkbench's own tab-switching + depth-of-book
// wiring, per this repo's existing MarketsQuoteDetail.test.tsx convention.
vi.mock('@/components/markets/PredictionDepthPanel', () => ({
  default: () => <div data-testid="prediction-depth-panel" />,
}));

import { MarketsWorkbench } from '@/components/markets/MarketsWorkbench';

function mockWorkbenchApi() {
  postMock.mockImplementation((_url: string, body: { action: string }) => {
    switch (body.action) {
      case 'depth-of-book':
        return Promise.resolve({ data: { result: { bids: [{ price: 449.9, size: 100 }], asks: [{ price: 450.1, size: 80 }], spread: 0.2 } } });
      case 'options-chain':
        return Promise.resolve({ data: { result: { chain: [{ strike: 450, call: { mark: 5.2, delta: 0.5, theta: -0.1, rho: 0.02 }, put: { mark: 4.8, delta: -0.5, theta: -0.1, rho: -0.02 }, gamma: 0.01, vega: 0.2 }] } } });
      case 'futures-board':
        return Promise.resolve({ data: { result: { contracts: [{ symbol: 'ES', frontContract: 'ESZ26', name: 'E-mini S&P', last: 5800, change: 12.5, changePercent: 0.22, tickSize: 0.25, tickValue: 12.5, multiplier: 50, initialMargin: 13000 }] } } });
      case 'forex-quotes':
        return Promise.resolve({ data: { result: { quotes: [{ pair: 'EUR/USD', name: 'Euro/Dollar', bid: 1.085, ask: 1.0852, spread: 0.0002, spreadPips: 2, pipValue: 10 }] } } });
      case 'alerts-list':
        return Promise.resolve({ data: { result: { alerts: [{ id: 'a1', symbol: 'SPY', condition: 'price_above', threshold: 460, status: 'active', createdAt: '2026-01-01T00:00:00Z' }] } } });
      case 'alert-create':
      case 'alert-cancel':
        return Promise.resolve({ data: { result: {} } });
      default:
        return Promise.resolve({ data: { result: {} } });
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkbenchApi();
});

describe('MarketsWorkbench — Depth tab (real Yahoo inside-quote + prediction-market depth)', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MarketsWorkbench open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts the real prediction-market depth panel alongside the equities depth-of-book', async () => {
    render(<MarketsWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Depth'));

    await waitFor(() => expect(screen.getByText(/Bids/i)).toBeInTheDocument());
    expect(screen.getByText('449.9')).toBeInTheDocument();
    expect(screen.getByText(/Spread:/i)).toBeInTheDocument();

    // the new line this commit added: PredictionDepthPanel is always mounted
    // in the Depth tab, not gated behind the equities book loading.
    expect(screen.getByTestId('prediction-depth-panel')).toBeInTheDocument();
    expect(screen.getByText(/Prediction-market depth \(real resting orders\)/i)).toBeInTheDocument();
  });

  it('re-loading with a new symbol re-requests the real depth-of-book macro', async () => {
    render(<MarketsWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Depth'));
    await waitFor(() => expect(postMock).toHaveBeenCalled());

    postMock.mockClear();
    fireEvent.change(screen.getByDisplayValue('SPY'), { target: { value: 'qqq' } });
    fireEvent.click(screen.getByText('Load'));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/api/lens/run', expect.objectContaining({
      domain: 'markets', action: 'depth-of-book', input: expect.objectContaining({ symbol: 'QQQ' }),
    })));
  });

  it('Options tab computes a real BSM options chain from the options-chain macro', async () => {
    render(<MarketsWorkbench open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Compute chain \(BSM\)/i)).toBeInTheDocument());
    expect(screen.getByText('5.2')).toBeInTheDocument(); // real call mark, not fabricated
    expect(screen.getByText('450')).toBeInTheDocument(); // strike
  });

  it('Futures tab renders real CME continuous-front-month rows from futures-board', async () => {
    render(<MarketsWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Futures'));
    await waitFor(() => expect(screen.getByText('ES')).toBeInTheDocument());
    expect(screen.getByText('ESZ26')).toBeInTheDocument();
    expect(screen.getByText(/\+12\.5 \(0\.22%\)/)).toBeInTheDocument();
  });

  it('FX tab renders real forex quotes from forex-quotes', async () => {
    render(<MarketsWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByText('FX'));
    await waitFor(() => expect(screen.getByText('EUR/USD')).toBeInTheDocument());
    expect(screen.getByText('1.085')).toBeInTheDocument();
    expect(screen.getByText('1.0852')).toBeInTheDocument();
  });

  it('Alerts tab lists real active alerts and creates a new one via alert-create', async () => {
    render(<MarketsWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Alerts'));
    await waitFor(() => expect(screen.getByText(/price above/)).toBeInTheDocument());
    expect(screen.getByText('460')).toBeInTheDocument();

    fireEvent.click(screen.getByText('New alert'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/api/lens/run', expect.objectContaining({
      domain: 'markets', action: 'alert-create',
    })));
  });

  it('closing via the header button calls onClose', async () => {
    const onClose = vi.fn();
    render(<MarketsWorkbench open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/Compute chain \(BSM\)/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
