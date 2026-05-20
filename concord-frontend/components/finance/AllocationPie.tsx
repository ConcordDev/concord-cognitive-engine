'use client';

import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Loader2, PieChart as PieIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Holding {
  id: string; symbol: string; name: string; shares: number; price: number; value: number;
  assetClass: string; sector: string;
}

const CLASS_COLOURS: Record<string, string> = {
  equity_us: '#06b6d4', equity_intl: '#0891b2', bonds: '#fbbf24',
  reits: '#f97316', cash: '#94a3b8', crypto: '#a78bfa',
};
const SECTOR_PALETTE = ['#06b6d4', '#10b981', '#fbbf24', '#f97316', '#a78bfa', '#ec4899', '#22d3ee', '#65a30d', '#6366f1', '#f43f5e'];

export function AllocationPie() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'class' | 'sector' | 'position'>('class');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'holdings-list', input: {} });
      setHoldings((res.data?.result?.holdings || []) as Holding[]);
    } catch (e) { console.error('[AllocationPie] failed', e); }
    finally { setLoading(false); }
  }

  const total = useMemo(() => holdings.reduce((s, h) => s + h.value, 0), [holdings]);

  const data = useMemo(() => {
    if (holdings.length === 0) return [];
    if (mode === 'position') {
      return [...holdings]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((h, i) => ({ name: h.symbol, value: h.value, fill: SECTOR_PALETTE[i % SECTOR_PALETTE.length] }));
    }
    const key = mode === 'class' ? 'assetClass' : 'sector';
    const buckets = new Map<string, number>();
    for (const h of holdings) {
      const k = (h as any)[key] || 'other';
      buckets.set(k, (buckets.get(k) || 0) + h.value);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value,
        fill: mode === 'class' ? CLASS_COLOURS[name] || '#94a3b8' : SECTOR_PALETTE[i % SECTOR_PALETTE.length],
      }));
  }, [holdings, mode]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <PieIcon className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Allocation</span>
        <span className="ml-auto text-[10px] font-mono text-gray-500">${total.toFixed(0)}</span>
        <select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="class">By asset class</option>
          <option value="sector">By sector</option>
          <option value="position">By position</option>
        </select>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : data.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-500"><PieIcon className="w-6 h-6 mx-auto mb-2 opacity-30" />Add holdings to see your allocation.</div>
      ) : (
        <div className="h-60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={42}
                outerRadius={75}
                paddingAngle={1}
                stroke="#0d1117"
                strokeWidth={1.5}
              >
                {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }}
                formatter={(v, n) => {
                  const num = Number(v) || 0;
                  return [`$${num.toFixed(0)} (${total > 0 ? ((num / total) * 100).toFixed(1) : 0}%)`, String(n)];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                formatter={(value: string) => <span style={{ color: '#cbd5e1' }}>{String(value).replace(/_/g, ' ')}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default AllocationPie;
