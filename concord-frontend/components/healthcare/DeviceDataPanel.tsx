'use client';

/**
 * DeviceDataPanel — home/wearable device readings (HR, glucose, BP,
 * SpO2, steps, weight, body temp). Backend: healthcare.device-ingest /
 * device-readings. Per-metric trend summary + ChartKit time series.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Watch, Loader2, Plus, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { cn } from '@/lib/utils';

interface Reading {
  id: string; patientId: string; metric: string; value: number;
  unit: string; flag: 'normal' | 'low' | 'high' | 'unflagged';
  device: string; recordedAt: string; ingestedAt: string;
}
interface MetricSummary {
  metric: string; count: number; latest: number; unit: string;
  latestFlag: Reading['flag']; trend: 'up' | 'down' | 'stable';
}

const METRICS = ['heart_rate', 'glucose', 'systolic', 'diastolic', 'spo2', 'steps', 'weight', 'body_temp'];
const FLAG_STYLE: Record<Reading['flag'], string> = {
  normal: 'text-emerald-300',
  low: 'text-amber-300',
  high: 'text-rose-300',
  unflagged: 'text-gray-400',
};

export function DeviceDataPanel({ patientId }: { patientId: string }) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [summary, setSummary] = useState<MetricSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricFilter, setMetricFilter] = useState('');
  const [draft, setDraft] = useState({ metric: 'heart_rate', value: '', device: '', recordedAt: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('healthcare', 'device-readings', {
        patientId, ...(metricFilter ? { metric: metricFilter } : {}),
      });
      if (r.data?.ok) {
        setReadings((r.data.result.readings || []) as Reading[]);
        setSummary((r.data.result.summary || []) as MetricSummary[]);
      }
    } catch (e) { console.error('[DeviceData] refresh', e); }
    finally { setLoading(false); }
  }, [patientId, metricFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  async function ingest() {
    const value = Number(draft.value);
    if (!Number.isFinite(value)) return;
    try {
      const r = await lensRun('healthcare', 'device-ingest', {
        patientId, metric: draft.metric, value,
        device: draft.device.trim() || undefined,
        recordedAt: draft.recordedAt ? new Date(draft.recordedAt).toISOString() : undefined,
      });
      if (r.data?.ok) {
        setDraft({ metric: draft.metric, value: '', device: '', recordedAt: '' });
        await refresh();
      }
    } catch (e) { console.error('[DeviceData] ingest', e); }
  }

  // Chart data for the active (or first) metric — chronological.
  const chartMetric = metricFilter || summary[0]?.metric || '';
  const chartData = useMemo(() => {
    return readings
      .filter(r => r.metric === chartMetric)
      .slice()
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .map(r => ({ t: r.recordedAt.slice(5, 16).replace('T', ' '), value: r.value }));
  }, [readings, chartMetric]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Watch className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Wearable / home device data</span>
        <span className="text-[10px] text-gray-500">{readings.length}</span>
        <select value={metricFilter} onChange={e => setMetricFilter(e.target.value)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">All metrics</option>
          {METRICS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
        </select>
      </header>

      {/* Ingest form */}
      <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
        <select value={draft.metric} onChange={e => setDraft({ ...draft, metric: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {METRICS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
        </select>
        <input type="number" value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} placeholder="Value *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={draft.device} onChange={e => setDraft({ ...draft, device: e.target.value })} placeholder="Device" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="datetime-local" value={draft.recordedAt} onChange={e => setDraft({ ...draft, recordedAt: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={ingest} className="col-span-2 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Log</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : readings.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-500"><Watch className="w-6 h-6 mx-auto mb-2 opacity-30" />No device readings yet.</div>
      ) : (
        <>
          {/* Per-metric summary tiles */}
          <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-white/10">
            {summary.map(s => (
              <div key={s.metric} className="bg-lattice-deep/50 border border-white/5 rounded p-2">
                <div className="text-[9px] uppercase text-gray-500 tracking-wider">{s.metric.replace('_', ' ')}</div>
                <div className="flex items-center gap-1">
                  <span className={cn('text-base font-bold', FLAG_STYLE[s.latestFlag])}>{s.latest}</span>
                  <span className="text-[10px] text-gray-500">{s.unit}</span>
                  {s.trend === 'up' && <ArrowUp className="w-3 h-3 text-rose-400" />}
                  {s.trend === 'down' && <ArrowDown className="w-3 h-3 text-cyan-400" />}
                  {s.trend === 'stable' && <Minus className="w-3 h-3 text-gray-500" />}
                </div>
                <div className="text-[9px] text-gray-600">{s.count} reading{s.count === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>

          {/* Trend chart for the active metric */}
          {chartData.length > 1 && (
            <div className="p-3 border-b border-white/10">
              <div className="text-[10px] uppercase text-gray-500 tracking-wider mb-1">{chartMetric.replace('_', ' ')} trend</div>
              <ChartKit kind="line" data={chartData} xKey="t" series={[{ key: 'value', label: chartMetric.replace('_', ' ') }]} height={180} showLegend={false} />
            </div>
          )}

          {/* Reading list */}
          <ul className="max-h-72 overflow-y-auto divide-y divide-white/5">
            {readings.map(r => (
              <li key={r.id} className="px-4 py-2 hover:bg-white/[0.02] flex items-center gap-3">
                <span className="text-[9px] uppercase text-gray-500 font-mono w-20">{r.metric.replace('_', ' ')}</span>
                <span className={cn('text-sm font-semibold', FLAG_STYLE[r.flag])}>{r.value} <span className="text-[10px] text-gray-500">{r.unit}</span></span>
                <span className="text-[10px] text-gray-500 ml-auto truncate">{r.device} · {r.recordedAt.slice(0, 16).replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default DeviceDataPanel;
