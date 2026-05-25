'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Loader2, BarChart3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Trend {
  category: string;
  current: number;
  prior: number;
  delta: number;
  deltaPct: number;
  anomaly: boolean;
}

interface Insights {
  latestMonth: string;
  priorMonth: string;
  trends: Trend[];
  anomalies: Trend[];
  topGrowth: Trend[];
  topShrink: Trend[];
}

export function SpendingInsights() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'finance', action: 'spending-insights',
        input: {},
      });
      setInsights(res.data?.result || null);
    } catch (e) { console.error('[Spending] insights failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Spending insights</span>
        <span className="ml-auto text-[10px] text-gray-400">your real transactions</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Crunching…</div>
      ) : !insights || insights.trends.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400"><BarChart3 className="w-6 h-6 mx-auto mb-2 opacity-30" />No spending data yet.</div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-white/10 text-[11px] text-gray-400 flex items-center gap-3">
            <span>Comparing <span className="text-cyan-300 font-mono">{insights.latestMonth}</span> vs <span className="text-gray-300 font-mono">{insights.priorMonth}</span></span>
            {insights.anomalies.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">
                <AlertTriangle className="w-3 h-3" /> {insights.anomalies.length} anomal{insights.anomalies.length === 1 ? 'y' : 'ies'}
              </span>
            )}
          </div>
          <ul className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {insights.trends.map(t => {
              const max = Math.max(t.current, t.prior, 1);
              return (
                <li key={t.category} className={cn('px-3 py-2 hover:bg-white/[0.03]', t.anomaly && 'bg-amber-500/[0.04]')}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-white font-medium flex-1">{t.category}</span>
                    {t.anomaly && <AlertTriangle className="w-3 h-3 text-amber-300" />}
                    <span className={cn('text-xs font-mono inline-flex items-center gap-1', t.delta >= 0 ? 'text-rose-300' : 'text-emerald-300')}>
                      {t.delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {t.delta >= 0 ? '+' : ''}${Math.abs(t.delta).toFixed(0)} ({t.deltaPct >= 0 ? '+' : ''}{t.deltaPct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <div className="text-gray-400">Prior · ${t.prior.toFixed(0)}</div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gray-500" style={{ width: `${(t.prior / max) * 100}%` }} /></div>
                    </div>
                    <div>
                      <div className="text-cyan-300">Current · ${t.current.toFixed(0)}</div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className={cn('h-full', t.delta >= 0 ? 'bg-rose-400' : 'bg-emerald-400')} style={{ width: `${(t.current / max) * 100}%` }} /></div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default SpendingInsights;
