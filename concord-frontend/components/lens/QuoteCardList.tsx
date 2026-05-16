'use client';

// QuoteCardList — CNBC Markets / Yahoo Mobile ticker list. Vertical
// scrolling list of tall quote cards (one per symbol) — symbol big,
// price big, change pill, mini in-card sparkline if a session buffer
// exists in localStorage (populated by QuoteChart in the trades lens).
// Mounted in the markets lens.

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Wifi, WifiOff } from 'lucide-react';

export interface QuoteCardItem {
  symbol: string;
  price?: number;
  change?: number;
  changePercent?: number | string;
  currency?: string;
  exchange?: string;
  marketStatus?: string;
}

interface QuoteCardListProps {
  quotes: QuoteCardItem[] | null | undefined;
  isLive?: boolean;
  lastUpdated?: string | null;
  className?: string;
}

const SYMBOL_LABELS: Record<string, string> = {
  GSPC: 'S&P 500',
  DJI: 'Dow Jones Industrial',
  IXIC: 'NASDAQ Composite',
  RUT: 'Russell 2000',
  VIX: 'CBOE Volatility',
};

function loadSparkBuffer(symbol: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`concord_quote_buf_${symbol}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p: { price?: number }) => Number(p?.price)).filter(n => Number.isFinite(n));
  } catch { return []; }
}

function MiniSparkline({ prices, up }: { prices: number[]; up: boolean }) {
  if (prices.length < 2) return null;
  const W = 80, H = 24;
  const minV = Math.min(...prices);
  const maxV = Math.max(...prices);
  const span = Math.max(0.0001, maxV - minV);
  const pts = prices.map((p, i) => ({
    x: (i / (prices.length - 1)) * W,
    y: H - ((p - minV) / span) * H,
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0">
      <path d={d} fill="none" stroke={up ? '#34d399' : '#f87171'} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export default function QuoteCardList({ quotes, isLive, lastUpdated, className = '' }: QuoteCardListProps) {
  const list = quotes || [];
  // Sparkline buffers re-read whenever lastUpdated changes (i.e. the
  // chart in trades lens just pushed a new tick to localStorage).
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  useEffect(() => {
    const next: Record<string, number[]> = {};
    for (const q of list) {
      next[q.symbol] = loadSparkBuffer(q.symbol);
    }
    setSparks(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUpdated, list.length]);

  return (
    <section className={`rounded-xl border border-white/10 bg-zinc-900/40 backdrop-blur-sm overflow-hidden ${className}`}>
      <header className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-zinc-900/60 to-zinc-900/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Markets</span>
          {isLive ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
              <Wifi className="w-3 h-3 animate-pulse" /><span>live</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
              <WifiOff className="w-3 h-3" /><span>offline</span>
            </span>
          )}
        </div>
        {lastUpdated && (
          <span className="text-[10px] text-zinc-500">{new Date(lastUpdated).toLocaleTimeString()}</span>
        )}
      </header>

      {list.length === 0 ? (
        <div className="p-6 text-center text-xs text-zinc-500">Yahoo Finance feed connecting…</div>
      ) : (
        <ul className="divide-y divide-white/5">
          {list.map(q => {
            const sym = (q.symbol || '').replace('^', '');
            const label = SYMBOL_LABELS[sym] || sym;
            const pct = q.changePercent != null && q.changePercent !== '' ? Number(q.changePercent) : null;
            const up = pct != null && pct >= 0;
            const TrendIcon = pct == null ? Minus : (up ? TrendingUp : TrendingDown);
            const trendColor = pct == null ? 'text-zinc-500' : (up ? 'text-emerald-400' : 'text-rose-400');
            const pillBg = pct == null ? 'bg-zinc-700/40' : (up ? 'bg-emerald-500/15' : 'bg-rose-500/15');
            const spark = sparks[q.symbol] || [];
            return (
              <li key={q.symbol} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-mono font-bold text-zinc-100">{sym}</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">{q.exchange || 'INDX'}</span>
                  </div>
                  <div className="text-xs text-zinc-400 truncate">{label}</div>
                </div>
                <MiniSparkline prices={spark} up={up} />
                <div className="text-right shrink-0">
                  <div className="text-base font-light text-zinc-100">
                    {q.price != null ? Number(q.price).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                  </div>
                  {pct != null && (
                    <div className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${pillBg} ${trendColor}`}>
                      <TrendIcon className="w-3 h-3" />
                      {up ? '+' : ''}{Number(q.change ?? 0).toFixed(2)} ({up ? '+' : ''}{pct.toFixed(2)}%)
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
