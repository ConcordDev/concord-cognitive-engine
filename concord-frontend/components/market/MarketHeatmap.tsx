'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface SectorPerf {
  sector: string;
  pct: number;
  marketCap: number;
  topMovers: Array<{ symbol: string; pct: number }>;
}

export function MarketHeatmap() {
  const [sectors, setSectors] = useState<SectorPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'1D' | '1W' | '1M' | 'YTD'>('1D');

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', { domain: 'market', action: 'sector-performance', input: { range } });
        setSectors((res.data?.result?.sectors || []) as SectorPerf[]);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [range]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Market heatmap · S&amp;P 500 sectors</span>
        <span className="ml-auto flex items-center gap-1">
          {(['1D', '1W', '1M', 'YTD'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)} className={cn('px-2 py-0.5 text-[10px] rounded',
              range === r ? 'bg-cyan-500 text-black font-bold' : 'border border-white/10 text-gray-400 hover:text-white'
            )}>{r}</button>
          ))}
        </span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-1 p-3">
          {sectors.map(s => {
            const pct = s.pct;
            const intensity = Math.min(1, Math.abs(pct) / 5);
            const bg = pct >= 0
              ? `rgba(34, 197, 94, ${0.15 + intensity * 0.5})`
              : `rgba(239, 68, 68, ${0.15 + intensity * 0.5})`;
            return (
              <div key={s.sector} className="rounded p-3 hover:scale-[1.02] transition-transform cursor-pointer" style={{ backgroundColor: bg }}>
                <div className="text-xs font-bold text-white truncate">{s.sector}</div>
                <div className={cn('text-2xl font-bold tabular-nums', pct >= 0 ? 'text-green-200' : 'text-red-200')}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</div>
                <div className="text-[10px] text-gray-300 mt-1">${(s.marketCap / 1e9).toFixed(0)}B mkt cap</div>
                {s.topMovers.length > 0 && (
                  <div className="text-[10px] text-gray-300 mt-1 truncate">
                    {s.topMovers.slice(0, 2).map(m => <span key={m.symbol} className="mr-2">{m.symbol} {m.pct >= 0 ? '+' : ''}{m.pct.toFixed(1)}%</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
export default MarketHeatmap;
