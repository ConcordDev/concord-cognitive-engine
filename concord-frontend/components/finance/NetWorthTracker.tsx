'use client';

import { useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Snapshot {
  date: string;
  cash: number;
  investments: number;
  realEstate: number;
  crypto: number;
  liabilities: number;
  total: number;
}

interface NetWorthTrackerProps {
  range?: '1M' | '6M' | '1Y' | '5Y' | 'all';
}

export function NetWorthTracker({ range: initialRange = '1Y' }: NetWorthTrackerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<unknown>(null);
  const seriesRef = useRef<{ total?: unknown; assets?: unknown; liabilities?: unknown }>({});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'1M' | '6M' | '1Y' | '5Y' | 'all'>(initialRange);
  const [ready, setReady] = useState(false);

  useEffect(() => { refresh(); }, [range]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'finance', action: 'net-worth-history', input: { range },
      });
      setSnapshots((res.data?.result?.snapshots || []) as Snapshot[]);
    } catch (e) { console.error('[NetWorth] history failed', e); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('lightweight-charts');
      if (cancelled || !hostRef.current) return;
      const chart = mod.createChart(hostRef.current, {
        height: 280,
        layout: { background: { color: '#0a0e17' }, textColor: '#94a3b8', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
        grid: { vertLines: { color: '#1e293b40' }, horzLines: { color: '#1e293b40' } },
        rightPriceScale: { borderColor: '#1e293b' },
        timeScale: { borderColor: '#1e293b' },
        crosshair: { mode: 1 },
        autoSize: true,
      });
      const totalSeries = chart.addSeries(mod.AreaSeries, {
        lineColor: '#34d399', topColor: '#34d39950', bottomColor: '#34d39905', lineWidth: 2,
      });
      const liabSeries = chart.addSeries(mod.LineSeries, { color: '#f87171', lineWidth: 1, lineStyle: 1 });
      chartRef.current = chart;
      seriesRef.current = { total: totalSeries, liabilities: liabSeries };
      setReady(true);
    })();
    return () => {
      cancelled = true;
      try { (chartRef.current as { remove?: () => void } | null)?.remove?.(); } catch { /* noop */ }
    };
  }, []);

  useEffect(() => {
    if (!ready || snapshots.length === 0) return;
    const total = seriesRef.current.total as { setData: (d: Array<{ time: string; value: number }>) => void } | undefined;
    const liab = seriesRef.current.liabilities as { setData: (d: Array<{ time: string; value: number }>) => void } | undefined;
    total?.setData(snapshots.map(s => ({ time: s.date, value: s.total })));
    liab?.setData(snapshots.map(s => ({ time: s.date, value: s.liabilities })));
    try { (chartRef.current as { timeScale: () => { fitContent: () => void } } | null)?.timeScale().fitContent(); } catch { /* noop */ }
  }, [snapshots, ready]);

  const latest = snapshots[snapshots.length - 1];
  const earliest = snapshots[0];
  const change = latest && earliest ? latest.total - earliest.total : 0;
  const changePct = latest && earliest && earliest.total > 0 ? (change / earliest.total) * 100 : 0;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Net worth</span>
        <span className="ml-auto flex items-center gap-1">
          {(['1M', '6M', '1Y', '5Y', 'all'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn('px-2 py-0.5 text-[10px] rounded',
                range === r ? 'bg-cyan-500 text-black font-bold' : 'border border-white/10 text-gray-400 hover:text-white'
              )}
            >{r}</button>
          ))}
        </span>
      </header>
      <div className="px-4 py-3 border-b border-white/5">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : !latest ? (
          <div className="text-xs text-gray-500">No snapshots yet. Income/expense entries on the Budget tab generate weekly snapshots.</div>
        ) : (
          <div className="flex items-end gap-4">
            <div>
              <div className="text-3xl font-bold text-white tabular-nums">${latest.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div className={cn('text-xs inline-flex items-center gap-1',
                change >= 0 ? 'text-green-400' : 'text-red-400'
              )}>
                {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {change >= 0 ? '+' : ''}${change.toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
                ({changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%) {range}
              </div>
            </div>
            <div className="ml-auto grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              <span className="text-gray-500">Cash:</span>
              <span className="text-white text-right tabular-nums">${latest.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-gray-500">Investments:</span>
              <span className="text-white text-right tabular-nums">${latest.investments.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-gray-500">Real estate:</span>
              <span className="text-white text-right tabular-nums">${latest.realEstate.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-gray-500">Crypto:</span>
              <span className="text-white text-right tabular-nums">${latest.crypto.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-red-400">Liabilities:</span>
              <span className="text-red-300 text-right tabular-nums">−${latest.liabilities.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        )}
      </div>
      <div ref={hostRef} style={{ height: 280 }} />
    </div>
  );
}

export default NetWorthTracker;
