import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const addToast = vi.fn();
const create = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
    dtus: { create: (...args: unknown[]) => create(...args) },
  },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

// lightweight-charts is loaded via dynamic import and is irrelevant for these
// contract tests — stub the module entirely.
vi.mock('lightweight-charts', () => {
  const mkSeries = () => ({ setData: vi.fn(), applyOptions: vi.fn() });
  const mkChart = () => ({
    addSeries: vi.fn(() => mkSeries()),
    removeSeries: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    remove: vi.fn(),
  });
  return {
    createChart: vi.fn(mkChart),
    LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries',
  };
});

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { MarketsQuoteDetail } from '@/components/markets/MarketsQuoteDetail';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('MarketsQuoteDetail', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
  });

  it('renders empty state until a symbol is searched', () => {
    renderWithQuery(<MarketsQuoteDetail />);
    expect(screen.getByPlaceholderText(/AAPL, SPY, MSFT/i)).toBeInTheDocument();
    expect(screen.getByText(/Pull a real-time quote/i)).toBeInTheDocument();
  });

  it('fetches quote (market.quotes-batch) and history (markets.quote-history) on submit', async () => {
    runDomain.mockImplementation(async (domain, action) => {
      if (domain === 'market' && action === 'quotes-batch') {
        return { data: { ok: true, result: { ok: true, result: {
          quotes: [{ symbol: 'AAPL', name: 'Apple Inc.', price: 178.2,
            pctChange1d: 1.5, pctChange1y: 28.4,
            volume: 50_000_000, marketCap: 2_780_000_000_000, pe: 28.5, eps: 6.25 }],
        } } } };
      }
      if (domain === 'markets' && action === 'quote-history') {
        return { data: { ok: true, result: { ok: true, result: {
          symbol: 'AAPL', range: '1mo', interval: '1d',
          bars: [
            { time: 1700000000, open: 175, high: 178, low: 174, close: 176, volume: 50e6 },
            { time: 1700086400, open: 176, high: 179, low: 176, close: 178.2, volume: 48e6 },
          ],
          count: 2, currency: 'USD', exchangeName: 'NMS',
          previousClose: 175.5, regularMarketPrice: 178.2, source: 'yahoo-finance-chart',
        } } } };
      }
      return { data: { ok: false } };
    });

    renderWithQuery(<MarketsQuoteDetail />);
    fireEvent.change(screen.getByPlaceholderText(/AAPL, SPY/i), { target: { value: 'aapl' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lookup$/i }));

    await waitFor(() => expect(screen.getByText('AAPL')).toBeInTheDocument());
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
    // Price formatted with thousands separator (en-US default)
    expect(screen.getByText(/178\.2/)).toBeInTheDocument();
    // Fundamentals strip
    expect(screen.getByText('Market Cap')).toBeInTheDocument();
    expect(screen.getByText(/2\.78T/)).toBeInTheDocument();
    expect(screen.getByText('P/E (TTM)')).toBeInTheDocument();

    // Macro shape: input nested under {input}
    const quoteCall = runDomain.mock.calls.find((c) => c[0] === 'market' && c[1] === 'quotes-batch');
    expect(quoteCall?.[2]).toMatchObject({ input: { symbols: ['AAPL'] } });
    const histCall = runDomain.mock.calls.find((c) => c[0] === 'markets' && c[1] === 'quote-history');
    expect(histCall?.[2]).toMatchObject({ input: { symbol: 'AAPL', range: '1mo', interval: '1d' } });
  });

  it('refetches history when timeframe pill is changed', async () => {
    runDomain.mockImplementation(async (domain, action) => {
      if (domain === 'market' && action === 'quotes-batch') {
        return { data: { ok: true, result: { ok: true, result: { quotes: [{ symbol: 'SPY', price: 500 }] } } } };
      }
      if (domain === 'markets' && action === 'quote-history') {
        return { data: { ok: true, result: { ok: true, result: {
          symbol: 'SPY', range: 'placeholder', interval: 'placeholder',
          bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
          count: 1, source: 'yahoo-finance-chart',
        } } } };
      }
      return { data: { ok: false } };
    });
    renderWithQuery(<MarketsQuoteDetail />);
    fireEvent.change(screen.getByPlaceholderText(/AAPL, SPY/i), { target: { value: 'spy' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lookup$/i }));
    await waitFor(() => expect(screen.getByText('SPY')).toBeInTheDocument());

    runDomain.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^1Y$/ }));
    await waitFor(() => {
      const c = runDomain.mock.calls.find((x) => x[0] === 'markets' && x[1] === 'quote-history');
      expect(c?.[2]).toMatchObject({ input: { symbol: 'SPY', range: '1y', interval: '1d' } });
    });
  });

  it('adds a comparison ticker and posts its history', async () => {
    runDomain.mockImplementation(async (domain, action, args) => {
      if (domain === 'market' && action === 'quotes-batch') {
        return { data: { ok: true, result: { ok: true, result: { quotes: [{ symbol: 'AAPL', price: 178 }] } } } };
      }
      if (domain === 'markets' && action === 'quote-history') {
        const sym = (args?.input as { symbol?: string } | undefined)?.symbol || '';
        return { data: { ok: true, result: { ok: true, result: {
          symbol: sym, range: '1mo', interval: '1d',
          bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
          count: 1, source: 'yahoo-finance-chart',
        } } } };
      }
      return { data: { ok: false } };
    });

    renderWithQuery(<MarketsQuoteDetail />);
    fireEvent.change(screen.getByPlaceholderText(/AAPL, SPY/i), { target: { value: 'aapl' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lookup$/i }));
    await waitFor(() => expect(screen.getByText('AAPL')).toBeInTheDocument());

    const compareInput = screen.getByPlaceholderText(/compare with…|add ticker/i);
    fireEvent.change(compareInput, { target: { value: 'msft' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

    await waitFor(() => expect(screen.getByText('Comparing:')).toBeInTheDocument());
    // Now both symbols should appear in the comparison chip row
    const msftCall = runDomain.mock.calls.find((c) => c[1] === 'quote-history' && (c[2] as { input?: { symbol?: string } })?.input?.symbol === 'MSFT');
    expect(msftCall).toBeTruthy();
  });

  it('surfaces error when quotes-batch returns ok=false', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'yahoo finance unreachable: 503' } } });
    renderWithQuery(<MarketsQuoteDetail />);
    fireEvent.change(screen.getByPlaceholderText(/AAPL, SPY/i), { target: { value: 'aapl' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lookup$/i }));
    await waitFor(() => expect(screen.getByText(/yahoo finance unreachable/i)).toBeInTheDocument());
  });

  it('uppercases the input symbol', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { quotes: [{ symbol: 'TSLA' }] } } } });
    renderWithQuery(<MarketsQuoteDetail />);
    const input = screen.getByPlaceholderText(/AAPL, SPY/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'tsla' } });
    expect(input.value).toBe('TSLA');
  });
});
