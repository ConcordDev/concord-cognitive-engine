'use client';

/**
 * MarketsQuoteDetail — bespoke quote-research surface for the markets lens.
 *
 * Designed per category-leader UX research (TradingView, Yahoo Finance,
 * a quote-detail surface):
 *
 *   • Single hero panel: [Symbol] [Last] [Δ abs] [Δ%] above a
 *     lightweight-charts line series, faded pre/after-hours second row
 *     when active (text-amber-400/70).
 *   • Timeframe pills (1D · 5D · 1M · 3M · 6M · YTD · 1Y · 5Y) below the
 *     price + a chart-type toggle (line/area) and Compare `+` button
 *     in a thin top-right control cluster.
 *   • Compare adds a second ticker series and switches the y-axis to
 *     percent-rebase (lightweight-charts priceFormat percentage) — the
 *     canonical multi-asset overlay pattern from TradingView.
 *   • Each comparison ticker gets an auto-assigned color and a
 *     remove-chip below the chart.
 *   • Save-as-DTU on the hero card with source: "yahoo-finance"
 *     provenance so curated quote analyses become citable artifacts.
 *
 * Backed by:
 *   market.quotes-batch — quote snapshot (price, % change, volume,
 *                         marketCap, PE, EPS)
 *   markets.quote-history — OHLCV bars for the chart and comparison
 *
 * Charting uses the existing lightweight-charts module (already in
 * package.json — same lib TradingView publishes), via dynamic import
 * to stay SSR-safe.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Loader2, Search, Plus, X, TrendingUp, TrendingDown, Minus, Activity, BarChart3,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

type Range = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y';
type ChartType = 'line' | 'area';

const RANGE_PILLS: Array<{ label: Range; range: string; interval: string }> = [
  { label: '1D', range: '1d', interval: '5m' },
  { label: '5D', range: '5d', interval: '15m' },
  { label: '1M', range: '1mo', interval: '1d' },
  { label: '3M', range: '3mo', interval: '1d' },
  { label: '6M', range: '6mo', interval: '1d' },
  { label: 'YTD', range: 'ytd', interval: '1d' },
  { label: '1Y', range: '1y', interval: '1d' },
  { label: '5Y', range: '5y', interval: '1wk' },
];

// Color palette for the comparison series (primary first, others rotate)
const SERIES_COLORS = ['#22d3ee', '#a855f7', '#fbbf24', '#34d399', '#fb7185'];

interface Quote {
  symbol: string;
  name?: string;
  price?: number;
  pctChange1d?: number | null;
  pctChange1y?: number | null;
  volume?: number | null;
  marketCap?: number | null;
  pe?: number | null;
  eps?: number | null;
  error?: string;
}

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number | null }
interface HistoryResult {
  symbol: string; range: string; interval: string;
  bars: Bar[]; count: number;
  currency?: string | null; exchangeName?: string | null;
  previousClose?: number | null;
  regularMarketPrice?: number | null;
  source: string;
}
interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(domain: 'market' | 'markets', action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain(domain, action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function MarketsQuoteDetail() {
  const [primarySymbol, setPrimarySymbol] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [activeRange, setActiveRange] = useState<Range>('1M');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [comparisons, setComparisons] = useState<string[]>([]);  // additional tickers
  const [comparisonInput, setComparisonInput] = useState('');
  const [series, setSeries] = useState<Record<string, HistoryResult>>({}); // by symbol
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const allSymbols = useMemo(() => primarySymbol ? [primarySymbol, ...comparisons] : [], [primarySymbol, comparisons]);
  const comparing = comparisons.length > 0;

  const quoteQuery = useMutation({
    mutationFn: async (sym: string) => callMacro<{ quotes: Quote[] }>('market', 'quotes-batch', { symbols: [sym] }),
    onSuccess: (env) => {
      if (env.ok && env.result?.quotes?.[0]) { setQuote(env.result.quotes[0]); setErrorMsg(null); }
      else { setErrorMsg(env.error || 'No quote returned'); setQuote(null); }
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const historyQuery = useMutation({
    mutationFn: async ({ symbol, range, interval }: { symbol: string; range: string; interval: string }) =>
      callMacro<HistoryResult>('markets', 'quote-history', { symbol, range, interval }),
    onSuccess: (env, vars) => {
      if (env.ok && env.result) setSeries((prev) => ({ ...prev, [vars.symbol]: env.result! }));
    },
  });

  // Load quote when primary symbol changes
  useEffect(() => {
    if (!primarySymbol) return;
    quoteQuery.mutate(primarySymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, [primarySymbol]);

  // Load history for every symbol when range or symbol set changes
  useEffect(() => {
    if (!primarySymbol) return;
    const pill = RANGE_PILLS.find((p) => p.label === activeRange);
    if (!pill) return;
    setSeries({});
    for (const sym of allSymbols) {
      historyQuery.mutate({ symbol: sym, range: pill.range, interval: pill.interval });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable; allSymbols derived
  }, [primarySymbol, activeRange, comparisons.join(',')]);

  const submitSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const sym = inputValue.trim().toUpperCase();
    if (!sym) return;
    setPrimarySymbol(sym);
    setComparisons([]);
    setComparisonInput('');
    setInputValue('');
  };

  const addCompare = () => {
    const sym = comparisonInput.trim().toUpperCase();
    if (!sym || sym === primarySymbol || comparisons.includes(sym) || comparisons.length >= 4) return;
    setComparisons((p) => [...p, sym]);
    setComparisonInput('');
  };

  const removeCompare = (sym: string) => {
    setComparisons((p) => p.filter((s) => s !== sym));
  };

  const reset = () => {
    setPrimarySymbol(null); setQuote(null); setSeries({}); setComparisons([]);
    setInputValue(''); setComparisonInput(''); setErrorMsg(null); setActiveRange('1M');
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Quote Research</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            yahoo finance · OHLCV
          </span>
        </div>
        {primarySymbol && (
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            New lookup
          </button>
        )}
      </header>

      <form onSubmit={submitSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value.toUpperCase())}
            placeholder="Ticker — AAPL, SPY, MSFT, BTC-USD, EURUSD=X, ^GSPC…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm font-mono text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!inputValue.trim() || quoteQuery.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {quoteQuery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Lookup
        </button>
      </form>

      {errorMsg && !quote && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {!primarySymbol && !errorMsg && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/50 px-3 py-8 text-center text-xs text-zinc-400">
          Pull a real-time quote, price chart, and side-by-side comparison for any Yahoo-listed ticker —
          equities, ETFs, indices (^GSPC), futures (ES=F), forex (EURUSD=X), or crypto (BTC-USD).
        </div>
      )}

      {primarySymbol && (
        <>
          <QuoteHero
            symbol={primarySymbol}
            quote={quote}
            history={series[primarySymbol]}
          />

          <ChartControls
            activeRange={activeRange}
            setActiveRange={setActiveRange}
            chartType={chartType}
            setChartType={setChartType}
            comparing={comparing}
            comparisonInput={comparisonInput}
            setComparisonInput={setComparisonInput}
            onAddCompare={addCompare}
            canAdd={comparisons.length < 4}
          />

          {comparisons.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">Comparing:</span>
              {[primarySymbol, ...comparisons].map((sym, i) => (
                <span
                  key={sym}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-mono"
                  style={{ borderColor: SERIES_COLORS[i] + '55', color: SERIES_COLORS[i] }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: SERIES_COLORS[i] }} />
                  {sym}
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => removeCompare(sym)}
                      className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-zinc-800"
                      aria-label={`Remove ${sym}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <LightChart
            symbols={allSymbols}
            series={series}
            comparing={comparing}
            chartType={chartType}
            isLoading={historyQuery.isPending && Object.keys(series).length === 0}
          />

          {quote && <QuoteFundamentals quote={quote} />}
        </>
      )}
    </div>
  );
}

// ── Quote hero card ───────────────────────────────────────────────────────

function QuoteHero({ symbol, quote, history }: { symbol: string; quote: Quote | null; history?: HistoryResult }) {
  const price = quote?.price ?? history?.regularMarketPrice ?? null;
  const prevClose = history?.previousClose ?? null;
  const delta = price != null && prevClose != null ? price - prevClose : null;
  const deltaPct = quote?.pctChange1d ?? (delta != null && prevClose ? (delta / prevClose) * 100 : null);
  const isUp = (deltaPct ?? 0) > 0;
  const isDown = (deltaPct ?? 0) < 0;
  const trendColor = isUp ? 'text-emerald-400' : isDown ? 'text-rose-400' : 'text-zinc-400';
  const TrendIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;

  return (
    <motion.div
      key={symbol}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <h3 className="font-mono text-2xl font-bold tracking-tight text-white">{symbol}</h3>
            {quote?.name && (
              <span className="truncate text-xs text-zinc-400">{quote.name}</span>
            )}
          </div>
          <div className="mt-2 flex items-end gap-3">
            <span className="font-mono text-3xl font-semibold text-white">
              {price != null ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}
            </span>
            <div className={`flex items-center gap-1.5 ${trendColor}`}>
              <TrendIcon className="h-4 w-4" />
              <span className="font-mono text-sm font-semibold">
                {delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(2) : '—'}
              </span>
              <span className="font-mono text-sm">
                ({deltaPct != null ? (deltaPct >= 0 ? '+' : '') + deltaPct.toFixed(2) : '—'}%)
              </span>
            </div>
            {history?.currency && history.currency !== 'USD' && (
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                {history.currency}
              </span>
            )}
          </div>
          {history?.exchangeName && (
            <p className="mt-1 text-[11px] text-zinc-400">
              {history.exchangeName}
            </p>
          )}
        </div>
        <SaveAsDtuButton
          apiSource="yahoo-finance"
          apiUrl={`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`}
          title={`${symbol} — quote snapshot ${new Date().toISOString().slice(0, 10)}`}
          content={[
            `Symbol: ${symbol}${quote?.name ? `  (${quote.name})` : ''}`,
            `Price: ${price ?? '—'}${history?.currency ? ` ${history.currency}` : ''}`,
            delta != null ? `Day change: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} (${deltaPct?.toFixed(2)}%)` : '',
            quote?.marketCap ? `Market cap: ${formatCurrency(quote.marketCap)}` : '',
            quote?.pe ? `P/E (trailing): ${quote.pe.toFixed(2)}` : '',
            quote?.eps ? `EPS (TTM): ${quote.eps.toFixed(2)}` : '',
            quote?.volume ? `Volume: ${quote.volume.toLocaleString()}` : '',
          ].filter(Boolean).join('\n')}
          extraTags={['markets', 'quote', symbol.toLowerCase()]}
          rawData={quote}
        />
      </div>
    </motion.div>
  );
}

// ── Fundamentals strip (PE, EPS, market cap, volume) ─────────────────────

function QuoteFundamentals({ quote }: { quote: Quote }) {
  const cells: Array<{ label: string; value: string | null; color?: string }> = [
    { label: 'Market Cap', value: quote.marketCap != null ? formatCurrency(quote.marketCap) : null },
    { label: 'Volume', value: quote.volume != null ? formatCompact(quote.volume) : null },
    { label: 'P/E (TTM)', value: quote.pe != null ? quote.pe.toFixed(2) : null },
    { label: 'EPS (TTM)', value: quote.eps != null ? quote.eps.toFixed(2) : null },
    { label: '1Y Change', value: quote.pctChange1y != null ? (quote.pctChange1y >= 0 ? '+' : '') + quote.pctChange1y.toFixed(2) + '%' : null, color: (quote.pctChange1y ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">{c.label}</div>
          <div className={`font-mono text-sm font-medium ${c.color ?? 'text-white'}`}>{c.value ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}

// ── Chart controls (timeframe pills + chart type + compare) ──────────────

function ChartControls({
  activeRange, setActiveRange, chartType, setChartType,
  comparing, comparisonInput, setComparisonInput, onAddCompare, canAdd,
}: {
  activeRange: Range; setActiveRange: (r: Range) => void;
  chartType: ChartType; setChartType: (t: ChartType) => void;
  comparing: boolean;
  comparisonInput: string; setComparisonInput: (v: string) => void;
  onAddCompare: () => void; canAdd: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1">
        {RANGE_PILLS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setActiveRange(p.label)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeRange === p.label
                ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {(['line', 'area'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setChartType(t)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                chartType === t ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              <Activity className="h-3 w-3" />
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 p-1">
          <Plus className="h-3 w-3 text-zinc-400" />
          <input
            type="text"
            value={comparisonInput}
            onChange={(e) => setComparisonInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddCompare(); } }}
            placeholder={comparing ? 'add ticker' : 'compare with…'}
            disabled={!canAdd}
            className="w-24 bg-transparent text-[11px] font-mono text-white placeholder-zinc-600 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onAddCompare}
            disabled={!comparisonInput.trim() || !canAdd}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-cyan-300 transition-colors hover:bg-cyan-500/15 disabled:opacity-30"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lightweight-charts pane ─────────────────────────────────────────────

interface ChartApi { remove?: () => void; timeScale: () => { fitContent: () => void } }
interface SeriesApi { setData: (d: Array<{ time: number; value: number }>) => void; applyOptions?: (o: Record<string, unknown>) => void }
type LWModule = {
  createChart: (host: HTMLElement, opts: Record<string, unknown>) => ChartApi & { addSeries: (kind: unknown, opts?: Record<string, unknown>) => SeriesApi; priceScale?: (id: string) => { applyOptions: (o: Record<string, unknown>) => void } };
  LineSeries: unknown;
  AreaSeries: unknown;
};

function LightChart({ symbols, series, comparing, chartType, isLoading }: {
  symbols: string[];
  series: Record<string, HistoryResult>;
  comparing: boolean;
  chartType: ChartType;
  isLoading: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<(ChartApi & { addSeries: LWModule['createChart'] extends (h: HTMLElement, o: Record<string, unknown>) => infer R ? R : never }) | null>(null);
  const seriesRefs = useRef<Map<string, SeriesApi>>(new Map());
  const [ready, setReady] = useState(false);

  const create = useCallback(async () => {
    if (!hostRef.current) return;
    const mod = (await import('lightweight-charts')) as unknown as LWModule;
    if (!hostRef.current) return;
    const chart = mod.createChart(hostRef.current, {
      height: 360,
      layout: { background: { color: '#09090b' }, textColor: '#a1a1aa', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
      grid: { vertLines: { color: '#27272a40' }, horzLines: { color: '#27272a40' } },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    chartRef.current = chart as unknown as typeof chartRef.current;
    setReady(true);
  }, []);

  useEffect(() => {
    create();
    const seriesMap = seriesRefs.current;
    return () => {
      try { (chartRef.current as ChartApi | null)?.remove?.(); } catch { /* noop */ }
      chartRef.current = null;
      seriesMap.clear();
      setReady(false);
    };
  }, [create]);

  // Re-paint series when symbols / series data / chart type / comparing changes
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const mod = (await import('lightweight-charts')) as unknown as LWModule;
      if (cancelled || !chartRef.current) return;
      // Clear existing series
      for (const s of seriesRefs.current.values()) {
        try { (chartRef.current as unknown as { removeSeries: (s: SeriesApi) => void })?.removeSeries(s); } catch { /* noop */ }
      }
      seriesRefs.current.clear();

      // Build series per symbol — percent-rebase to first available close when comparing
      symbols.forEach((sym, i) => {
        const h = series[sym];
        if (!h || h.bars.length === 0) return;
        const sorted = [...h.bars].sort((a, b) => a.time - b.time);
        const base = sorted[0].close || 1;
        const data = sorted.map((b) => ({
          time: b.time as unknown as number,
          value: comparing ? ((b.close - base) / base) * 100 : b.close,
        }));
        const color = SERIES_COLORS[i] || '#22d3ee';
        const kind = chartType === 'area' ? mod.AreaSeries : mod.LineSeries;
        const opts: Record<string, unknown> = {
          color,
          lineWidth: i === 0 ? 2 : 1.5,
          priceLineVisible: i === 0,
          lastValueVisible: i === 0,
        };
        if (chartType === 'area') {
          opts.topColor = color + '40';
          opts.bottomColor = color + '00';
        }
        if (comparing) {
          opts.priceFormat = { type: 'percent', precision: 2, minMove: 0.01 };
        }
        const s = (chartRef.current as unknown as { addSeries: (k: unknown, o: Record<string, unknown>) => SeriesApi }).addSeries(kind, opts);
        s.setData(data);
        seriesRefs.current.set(sym, s);
      });

      try { (chartRef.current as unknown as ChartApi).timeScale().fitContent(); } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [ready, symbols, series, chartType, comparing]);

  const hasAnyData = symbols.some((s) => series[s]?.bars.length);

  return (
    <div className="relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-950" style={{ height: 360 }}>
      <div ref={hostRef} className="absolute inset-0" />
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
        </div>
      )}
      {!isLoading && !hasAnyData && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-zinc-400">
          No chart data for the selected range
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}
