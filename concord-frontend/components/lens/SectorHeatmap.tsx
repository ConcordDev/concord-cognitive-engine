'use client';

// SectorHeatmap — Yahoo Finance "Markets" treemap-style colored tile
// grid. Mounted in the market lens. Each tile = one symbol, sized
// uniformly (we don't have market cap from the Yahoo v8 feed), colored
// by changePercent on a red→neutral→green spectrum, with the symbol
// and percentage rendered in-tile.
//
// Click → fire onClick(symbol) so the parent lens can drill into the
// detail view.

import { Wifi, WifiOff } from 'lucide-react';

export interface SectorHeatmapQuote {
  symbol: string;
  price?: number;
  changePercent?: number | string;
  exchange?: string;
}

interface SectorHeatmapProps {
  quotes: SectorHeatmapQuote[] | null | undefined;
  isLive?: boolean;
  lastUpdated?: string | null;
  className?: string;
  onSelect?: (symbol: string) => void;
}

function tileColor(pct: number | null): { bg: string; ring: string; text: string } {
  if (pct == null || !Number.isFinite(pct)) return { bg: 'bg-zinc-800/60', ring: 'ring-zinc-700/30', text: 'text-zinc-300' };
  const abs = Math.min(5, Math.abs(pct));
  const intensity = abs / 5; // 0..1
  // Map intensity 0..1 → opacity 30..90
  const opacity = Math.round(30 + intensity * 60);
  if (pct > 0.05)  return { bg: `bg-emerald-500/${opacity}`, ring: 'ring-emerald-400/30', text: 'text-emerald-100' };
  if (pct < -0.05) return { bg: `bg-rose-500/${opacity}`,    ring: 'ring-rose-400/30',    text: 'text-rose-100' };
  return { bg: 'bg-zinc-700/40', ring: 'ring-zinc-600/30', text: 'text-zinc-300' };
}

// Symbol → human label map for the 5 indices we fetch
const SYMBOL_LABELS: Record<string, string> = {
  GSPC: 'S&P 500',
  DJI: 'Dow Jones',
  IXIC: 'NASDAQ',
  RUT: 'Russell 2000',
  VIX: 'CBOE VIX',
};

export default function SectorHeatmap({ quotes, isLive, lastUpdated, className = '', onSelect }: SectorHeatmapProps) {
  const list = quotes || [];

  return (
    <section className={`rounded-xl border border-white/10 bg-zinc-900/40 backdrop-blur-sm overflow-hidden ${className}`}>
      <header className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-zinc-900/60 to-zinc-900/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Market Heatmap</span>
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
        {lastUpdated && (
          <span className="text-[10px] text-zinc-400">
            {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </header>

      {list.length === 0 ? (
        <div className="p-6 text-center text-xs text-zinc-400">Yahoo Finance feed connecting…</div>
      ) : (
        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {list.map((q) => {
            const sym = (q.symbol || '').replace('^', '');
            const label = SYMBOL_LABELS[sym] || sym;
            const pct = q.changePercent != null && q.changePercent !== '' ? Number(q.changePercent) : null;
            const c = tileColor(pct);
            const Btn = onSelect ? 'button' : 'div';
            return (
              <Btn
                key={q.symbol}
                onClick={onSelect ? () => onSelect(q.symbol) : undefined}
                className={`relative rounded-lg ${c.bg} ring-1 ${c.ring} p-3 transition-colors ${onSelect ? 'hover:brightness-125 cursor-pointer' : ''}`}
              >
                <div className={`text-[10px] uppercase tracking-wider opacity-70 ${c.text}`}>{label}</div>
                <div className={`mt-1 text-xl font-light ${c.text} font-mono`}>{sym}</div>
                {pct != null && (
                  <div className={`mt-2 text-lg font-medium ${c.text}`}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </div>
                )}
                {q.price != null && (
                  <div className={`text-[11px] opacity-80 ${c.text} mt-0.5`}>
                    {Number(q.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                )}
              </Btn>
            );
          })}
        </div>
      )}
    </section>
  );
}
