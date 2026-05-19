'use client';

import { useEffect, useState } from 'react';
import { Coins, Calendar, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Summary {
  perHolding: Array<{ symbol: string; value: number; yieldPct: number; annualDividend: number; monthlyDividend: number }>;
  totalAnnual: number;
  monthlyAverage: number;
  portfolioYieldPct: number;
}
interface CalEvent { date: string; symbol: string; amount: number; kind: string }
interface EarningsEvent { date: string; symbol: string; name: string; when: string; estimateEps: number }

export function DividendTracker() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [calendar, setCalendar] = useState<CalEvent[]>([]);
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'summary' | 'div-cal' | 'earnings'>('summary');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        api.post('/api/lens/run', { domain: 'finance', action: 'dividends-summary', input: {} }),
        api.post('/api/lens/run', { domain: 'finance', action: 'dividends-calendar', input: { days: 180 } }),
        api.post('/api/lens/run', { domain: 'finance', action: 'earnings-calendar', input: { days: 90 } }),
      ]);
      setSummary(a.data?.result || null);
      setCalendar((b.data?.result?.events || []) as CalEvent[]);
      setEarnings((c.data?.result?.events || []) as EarningsEvent[]);
    } catch (e) { console.error('[Dividend] refresh failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Coins className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Dividends & earnings</span>
        {summary && (
          <span className="ml-auto text-[10px] font-mono text-gray-500">
            ${summary.totalAnnual.toFixed(0)}/yr · {summary.portfolioYieldPct.toFixed(2)}% yield
          </span>
        )}
      </header>

      <div className="flex border-b border-white/10 text-[11px]">
        {(['summary', 'div-cal', 'earnings'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1.5 transition', tab === t ? 'text-cyan-300 border-b-2 border-cyan-400' : 'text-gray-500 hover:text-gray-300')}>
            {t === 'summary' ? 'Summary' : t === 'div-cal' ? 'Dividend calendar' : 'Earnings'}
          </button>
        ))}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : tab === 'summary' ? (
          summary && summary.perHolding.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-gray-500 border-b border-white/5"><tr><th className="text-left px-3 py-1.5">Symbol</th><th className="text-right">Yield</th><th className="text-right">Annual</th><th className="text-right pr-3">Monthly</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {summary.perHolding.map(p => (
                  <tr key={p.symbol} className="hover:bg-white/[0.03]">
                    <td className="px-3 py-2 font-mono font-semibold text-white">{p.symbol}</td>
                    <td className="text-right font-mono tabular-nums text-cyan-300">{p.yieldPct.toFixed(2)}%</td>
                    <td className="text-right font-mono tabular-nums text-white">${p.annualDividend.toFixed(2)}</td>
                    <td className="text-right font-mono tabular-nums text-gray-300 pr-3">${p.monthlyDividend.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-3 py-10 text-center text-xs text-gray-500"><Coins className="w-6 h-6 mx-auto mb-2 opacity-30" />No dividend-paying holdings yet.</div>
          )
        ) : tab === 'div-cal' ? (
          calendar.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-500"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />No upcoming dividend events.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {calendar.slice(0, 50).map((e, i) => (
                <li key={i} className="px-3 py-2 flex items-center gap-3 hover:bg-white/[0.03]">
                  <div className="w-12 text-[10px] text-cyan-300 font-mono">{e.date.slice(5)}</div>
                  <div className="flex-1 text-sm font-mono font-semibold text-white">{e.symbol}</div>
                  <div className="text-sm font-mono tabular-nums text-emerald-300">+${e.amount.toFixed(2)}</div>
                </li>
              ))}
            </ul>
          )
        ) : (
          earnings.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-500"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />No upcoming earnings.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {earnings.map(e => (
                <li key={e.symbol + e.date} className="px-3 py-2 flex items-center gap-3 hover:bg-white/[0.03]">
                  <div className="w-12 text-[10px] text-amber-300 font-mono">{e.date.slice(5)}</div>
                  <div className="flex-1">
                    <div className="text-sm font-mono font-semibold text-white">{e.symbol}</div>
                    <div className="text-[10px] text-gray-500">{e.name} · {e.when.replace('_', ' ')}</div>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-gray-300">est EPS ${e.estimateEps.toFixed(2)}</div>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}

export default DividendTracker;
