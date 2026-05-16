'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Candle {
  time: number | string; // unix seconds OR yyyy-mm-dd
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CandleChartProps {
  candles: Candle[];
  height?: number;
  loading?: boolean;
  symbol?: string;
  emaPeriod?: number;
  showVolume?: boolean;
  className?: string;
  onCrosshairMove?: (data: { time?: number | string; price?: number } | null) => void;
}

/**
 * TradingView-grade candle chart powered by `lightweight-charts` (the
 * open-source library the TradingView team publishes). One canvas, ~60kb
 * gzipped, GPU-accelerated, handles 10k+ bars without breaking a sweat.
 *
 * Renders OHLC candles + optional EMA overlay + optional volume histogram
 * + crosshair pulse. Falls back to a styled "no data" panel when the
 * series is empty.
 */
export default function CandleChart({
  candles,
  height = 320,
  loading,
  symbol,
  emaPeriod = 20,
  showVolume = true,
  className,
  onCrosshairMove,
}: CandleChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<unknown>(null);
  const seriesRef = useRef<{ candle?: unknown; ema?: unknown; volume?: unknown }>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('lightweight-charts');
      if (cancelled || !hostRef.current) return;
      const chart = mod.createChart(hostRef.current, {
        height,
        layout: {
          background: { color: '#0a0e17' },
          textColor: '#94a3b8',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: '#1e293b40' },
          horzLines: { color: '#1e293b40' },
        },
        rightPriceScale: { borderColor: '#1e293b' },
        timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 },
        autoSize: true,
      });

      const candleSeries = chart.addSeries(mod.CandlestickSeries, {
        upColor: '#34d399',
        downColor: '#f87171',
        borderUpColor: '#34d399',
        borderDownColor: '#f87171',
        wickUpColor: '#34d39990',
        wickDownColor: '#f8717190',
      });

      const emaSeries = chart.addSeries(mod.LineSeries, {
        color: '#00e5ff',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      let volumeSeries: unknown = null;
      if (showVolume) {
        volumeSeries = chart.addSeries(mod.HistogramSeries, {
          color: '#3b82f6',
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
          borderColor: '#1e293b',
        });
      }

      chartRef.current = chart;
      seriesRef.current = { candle: candleSeries, ema: emaSeries, volume: volumeSeries };

      if (onCrosshairMove) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chart.subscribeCrosshairMove((param: any) => {
          if (!param?.time || !param?.seriesData) {
            onCrosshairMove(null);
            return;
          }
          const candleData = param.seriesData.get(candleSeries) as { close?: number } | undefined;
          const time = typeof param.time === 'object' ? `${param.time.year}-${param.time.month}-${param.time.day}` : param.time;
          onCrosshairMove({ time, price: candleData?.close });
        });
      }

      setReady(true);
    })();
    return () => {
      cancelled = true;
      try {
        (chartRef.current as { remove?: () => void } | null)?.remove?.();
      } catch {
        // chart may be already disposed
      }
      chartRef.current = null;
      seriesRef.current = {};
      setReady(false);
    };
  }, [height, showVolume, onCrosshairMove]);

  useEffect(() => {
    if (!ready) return;
    const candle = seriesRef.current.candle as { setData: (d: Candle[]) => void } | undefined;
    const ema = seriesRef.current.ema as { setData: (d: Array<{ time: number | string; value: number }>) => void } | undefined;
    const volume = seriesRef.current.volume as { setData: (d: Array<{ time: number | string; value: number; color: string }>) => void } | undefined;
    if (!candle || candles.length === 0) return;
    const sorted = [...candles].sort((a, b) => Number(a.time) - Number(b.time));
    candle.setData(sorted);
    if (ema) {
      ema.setData(computeEMA(sorted, emaPeriod));
    }
    if (volume) {
      volume.setData(sorted.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? '#34d39960' : '#f8717160',
      })));
    }
    try {
      (chartRef.current as { timeScale: () => { fitContent: () => void } } | null)?.timeScale().fitContent();
    } catch { /* noop */ }
  }, [candles, ready, emaPeriod]);

  return (
    <div className={cn('relative bg-[#0a0e17] border border-lattice-border rounded overflow-hidden', className)} style={{ height }}>
      {symbol && (
        <div className="absolute top-2 left-3 z-10 text-xs font-mono text-cyan-300 font-bold">
          {symbol}
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
        </div>
      )}
      {!loading && candles.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-500">
          <span className="text-sm">No price data</span>
          <span className="text-xs">Pick a different timeframe or token</span>
        </div>
      )}
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}

function computeEMA(candles: Candle[], period: number): Array<{ time: number | string; value: number }> {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const out: Array<{ time: number | string; value: number }> = [];
  let prev = candles[0].close;
  for (const c of candles) {
    const ema = c.close * k + prev * (1 - k);
    out.push({ time: c.time, value: ema });
    prev = ema;
  }
  return out;
}
