'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart, Loader2, Plus, Trash2, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface FootprintEntry {
  id: string;
  totalKgCO2e: number;
  netKgCO2e: number;
  categoryBreakdown: { category: string; emissionsKgCO2e: number }[];
  label: string;
  at: string;
}

interface HistoryResult {
  entries: FootprintEntry[];
  count: number;
  trend: 'improving' | 'worsening' | 'stable' | 'none';
  changePct: number;
  deltaKg: number;
  averageNetKgCO2e: number;
  bestEntry: FootprintEntry | null;
  sinceDays: number;
}

const TREND_TONE: Record<string, string> = {
  improving: 'text-green-400',
  worsening: 'text-red-400',
  stable: 'text-cyan-400',
  none: 'text-gray-400',
};

export function FootprintTrend() {
  const [data, setData] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState('');
  const [net, setNet] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<HistoryResult>('eco', 'footprint-history', { sinceDays: 365 });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
    } else {
      setError(r.data?.error || 'Could not load footprint history.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const record = useCallback(async () => {
    const totalN = Number(total);
    if (!isFinite(totalN) || totalN < 0) {
      setError('Enter a valid total (kg CO₂e ≥ 0).');
      return;
    }
    setSaving(true);
    setError(null);
    const netN = Number(net);
    const r = await lensRun('eco', 'footprint-record', {
      totalKgCO2e: totalN,
      netKgCO2e: isFinite(netN) ? netN : totalN,
      label: label.trim(),
    });
    if (r.data?.ok) {
      setTotal('');
      setNet('');
      setLabel('');
      await load();
    } else {
      setError(r.data?.error || 'Could not record snapshot.');
    }
    setSaving(false);
  }, [total, net, label, load]);

  const remove = useCallback(
    async (id: string) => {
      const r = await lensRun('eco', 'footprint-delete', { id });
      if (r.data?.ok) await load();
    },
    [load],
  );

  const chartData = useMemo(
    () =>
      (data?.entries || []).map((e) => ({
        date: new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        net: e.netKgCO2e,
        total: e.totalKgCO2e,
      })),
    [data],
  );

  const TrendIcon =
    data?.trend === 'improving' ? TrendingDown : data?.trend === 'worsening' ? TrendingUp : Minus;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <LineChart className="w-4 h-4 text-green-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Carbon-footprint trend
        </span>
        {data && data.count > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">{data.count} snapshots</span>
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 uppercase">Total kg CO₂e</span>
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 1200"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 uppercase">Net (after offsets)</span>
            <input
              value={net}
              onChange={(e) => setNet(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <label className="flex flex-col gap-0.5 md:col-span-2">
            <span className="text-[10px] text-gray-400 uppercase">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. May estimate"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
        </div>

        <button
          onClick={record}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Record snapshot
        </button>

        {error && <div className="text-xs text-red-400">{error}</div>}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
          </div>
        )}

        {!loading && data && data.count === 0 && (
          <p className="py-8 text-center text-xs text-gray-400">
            No data yet. Record a footprint snapshot to start tracking your trend over time.
          </p>
        )}

        {!loading && data && data.count > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className={`text-sm font-bold flex items-center justify-center gap-1 ${TREND_TONE[data.trend]}`}>
                  <TrendIcon className="w-3.5 h-3.5" />
                  {data.trend}
                </p>
                <p className="text-[10px] text-gray-400">
                  {data.changePct > 0 ? '+' : ''}
                  {data.changePct}% over period
                </p>
              </div>
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className="text-sm font-bold text-cyan-400">{data.averageNetKgCO2e}</p>
                <p className="text-[10px] text-gray-400">avg net kg CO₂e</p>
              </div>
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className="text-sm font-bold text-green-400">
                  {data.bestEntry ? data.bestEntry.netKgCO2e : '—'}
                </p>
                <p className="text-[10px] text-gray-400">best (lowest) net</p>
              </div>
            </div>

            <ChartKit
              kind="area"
              data={chartData}
              xKey="date"
              series={[
                { key: 'total', label: 'Total kg CO₂e', color: '#f59e0b' },
                { key: 'net', label: 'Net kg CO₂e', color: '#22c55e' },
              ]}
              height={220}
            />

            <div className="max-h-56 overflow-y-auto rounded border border-white/5 divide-y divide-white/5">
              {data.entries
                .slice()
                .reverse()
                .map((e) => (
                  <div key={e.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">
                        {e.label || 'Snapshot'}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(e.at).toLocaleDateString()} · net {e.netKgCO2e} kg · total{' '}
                        {e.totalKgCO2e} kg
                      </div>
                    </div>
                    <button
                      onClick={() => remove(e.id)}
                      className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400"
                      aria-label="Delete snapshot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default FootprintTrend;
