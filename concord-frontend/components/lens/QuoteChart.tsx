'use client';

// QuoteChart — TradingView-style session price chart for a single
// symbol. Mounted in the trades lens. The realtime feed gives us
// periodic snapshots (every ~75s) rather than tick-by-tick data, so
// we build a rolling buffer of price points across the user's
// session and chart them as a line. Below a threshold of points
// shows the current price + "collecting data" indicator instead of
// a sad-looking empty chart.
//
// State persistence: the buffer lives in localStorage keyed by symbol
// so a page refresh doesn't reset the session view.
//
// Data shape (realtimeData.quotes for finance):
//   { symbol, price, previousClose, change, changePercent, currency,
//     exchange, marketStatus }

import { useEffect, useMemo, useRef, useState } from 'react';
import { Wifi, WifiOff, Maximize2 } from 'lucide-react';

export interface QuoteSnapshot {
  symbol: string;
  price: number;
  previousClose?: number;
  change?: number;
  changePercent?: number | string;
  currency?: string;
  exchange?: string;
  marketStatus?: string;
}

interface QuoteChartProps {
  symbol: string;
  quotes: QuoteSnapshot[] | null | undefined; // full realtimeData.quotes array
  isLive?: boolean;
  lastUpdated?: string | null;
  className?: string;
  onChangeSymbol?: (symbol: string) => void;
}

const BUFFER_MAX = 200; // 200 points × 75s ≈ 4.2h of session

type Point = { ts: number; price: number };

function loadBuffer(symbol: string): Point[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`concord_quote_buf_${symbol}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(p => Number.isFinite(p?.ts) && Number.isFinite(p?.price)).slice(-BUFFER_MAX);
  } catch { return []; }
}

function saveBuffer(symbol: string, buf: Point[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(`concord_quote_buf_${symbol}`, JSON.stringify(buf.slice(-BUFFER_MAX))); }
  catch { /* private mode */ }
}

export default function QuoteChart({ symbol, quotes, isLive, lastUpdated, className = '', onChangeSymbol }: QuoteChartProps) {
  const [buffer, setBuffer] = useState<Point[]>(() => loadBuffer(symbol));
  const lastTsRef = useRef<number>(0);

  // Append new price point when the relevant quote in the payload changes
  useEffect(() => {
    if (!quotes || quotes.length === 0) return;
    const q = quotes.find(qq => qq.symbol === symbol || qq.symbol?.replace('^', '') === symbol.replace('^', ''));
    if (!q || !Number.isFinite(Number(q.price))) return;
    const ts = lastUpdated ? new Date(lastUpdated).getTime() : Date.now();
    if (!Number.isFinite(ts) || ts <= lastTsRef.current) return;
    lastTsRef.current = ts;
    setBuffer(prev => {
      const next = [...prev, { ts, price: Number(q.price) }].slice(-BUFFER_MAX);
      saveBuffer(symbol, next);
      return next;
    });
  }, [quotes, lastUpdated, symbol]);

  // Reload buffer when symbol changes
  useEffect(() => {
    setBuffer(loadBuffer(symbol));
    lastTsRef.current = 0;
  }, [symbol]);

  const q = useMemo(() => (quotes || []).find(qq => qq.symbol === symbol || qq.symbol?.replace('^', '') === symbol.replace('^', '')), [quotes, symbol]);
  const pct = q?.changePercent != null ? Number(q.changePercent) : null;
  const up = pct != null && pct >= 0;

  // SVG line chart geometry
  const W = 800, H = 240, PAD_L = 50, PAD_R = 12, PAD_T = 12, PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const { path, fillPath, minY, maxY } = useMemo(() => {
    if (buffer.length < 2) return { path: '', fillPath: '', minY: 0, maxY: 1 };
    const prices = buffer.map(p => p.price);
    const minV = Math.min(...prices);
    const maxV = Math.max(...prices);
    const span = Math.max(0.0001, maxV - minV);
    const tsMin = buffer[0].ts;
    const tsMax = buffer[buffer.length - 1].ts;
    const xSpan = Math.max(1, tsMax - tsMin);
    const pts = buffer.map(p => ({
      x: PAD_L + ((p.ts - tsMin) / xSpan) * innerW,
      y: PAD_T + innerH - ((p.price - minV) / span) * innerH,
    }));
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const fill = `${d} L ${pts[pts.length - 1].x.toFixed(2)} ${(PAD_T + innerH).toFixed(2)} L ${pts[0].x.toFixed(2)} ${(PAD_T + innerH).toFixed(2)} Z`;
    return { path: d, fillPath: fill, minY: minV, maxY: maxV };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- innerH/innerW are render-constant geometry; buffer is the only real input
  }, [buffer]);

  const accentLine = up ? '#34d399' : '#f87171';
  const accentFill = up ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';

  return (
    <section className={`rounded-xl border border-white/10 bg-zinc-900/40 backdrop-blur-sm overflow-hidden ${className}`}>
      {/* Header — symbol + big price + change + status */}
      <header className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-zinc-900/60 to-zinc-900/20 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-xl font-bold text-zinc-100 font-mono">{symbol.replace('^', '')}</span>
          {q?.exchange && <span className="text-[10px] text-zinc-400 uppercase">{q.exchange}</span>}
          {q && (
            <>
              <span className="text-2xl font-light text-zinc-100">
                {Number(q.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              {pct != null && (
                <span className={`text-sm font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {up ? '+' : ''}{Number(q.change ?? 0).toFixed(2)} ({up ? '+' : ''}{pct.toFixed(2)}%)
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {q?.marketStatus && (
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${q.marketStatus === 'open' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-700/50 text-zinc-400'}`}>
              {q.marketStatus}
            </span>
          )}
          {isLive ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
              <Wifi className="w-3 h-3 animate-pulse" /><span>live</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
              <WifiOff className="w-3 h-3" /><span>offline</span>
            </span>
          )}
        </div>
      </header>

      {/* Chart */}
      <div className="p-3">
        {buffer.length < 2 ? (
          <div className="h-60 flex flex-col items-center justify-center text-zinc-400 text-xs gap-2">
            <Maximize2 className="w-6 h-6 opacity-40" />
            <span>Collecting session ticks… ({buffer.length} so far)</span>
            <span className="text-[10px] text-zinc-400">Feed updates every ~75s. Chart appears after the second tick.</span>
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-60" role="img" aria-label={`${symbol} session chart`}>
            {/* Y-axis grid */}
            {[0, 0.5, 1].map((frac, i) => {
              const y = PAD_T + innerH * (1 - frac);
              const v = minY + (maxY - minY) * frac;
              return (
                <g key={i}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#3f3f46" strokeDasharray="2 4" strokeWidth="0.5" />
                  <text x={PAD_L - 4} y={y + 3} fontSize="9" fill="#71717a" textAnchor="end">{v.toFixed(2)}</text>
                </g>
              );
            })}
            <path d={fillPath} fill={accentFill} />
            <path d={path} fill="none" stroke={accentLine} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Symbol switcher — sibling symbols in the feed */}
      {(quotes && quotes.length > 1 && onChangeSymbol) && (
        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
          {quotes.map(qq => {
            const isActive = qq.symbol === symbol || qq.symbol?.replace('^', '') === symbol.replace('^', '');
            const qpct = qq.changePercent != null ? Number(qq.changePercent) : null;
            return (
              <button
                key={qq.symbol}
                onClick={() => onChangeSymbol(qq.symbol)}
                className={`text-[10px] px-2 py-1 rounded border font-mono transition-colors ${
                  isActive
                    ? 'bg-white/[0.06] border-white/20 text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:bg-white/[0.02] hover:text-zinc-200'
                }`}
              >
                {qq.symbol.replace('^', '')}
                {qpct != null && (
                  <span className={`ml-1 ${qpct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {qpct >= 0 ? '+' : ''}{qpct.toFixed(2)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
