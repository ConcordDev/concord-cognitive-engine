'use client';

/**
 * EnergyDisaggregationPanel — Sense-style "per-device" view. Attributes
 * whole-home consumption across the user's tracked devices: directly
 * metered readings plus a nameplate-wattage-weighted split of the
 * remaining whole-home load. Every value is computed by the
 * `energy.disaggregate` macro from real user-entered devices + readings.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, PieChart, Plug } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface DisaggRow {
  deviceId: string;
  name: string;
  category: string;
  directKwh: number;
  estimatedKwh: number;
  attributedKwh: number;
  pct: number;
  method: string;
}
interface DisaggResult {
  devices: DisaggRow[];
  totalKwh: number;
  attributedKwh: number;
  unattributedKwh: number;
  wholeHomeKwh: number;
  days: number;
}

const WINDOWS = [7, 30, 90];
const METHOD_LABEL: Record<string, string> = {
  metered: 'metered',
  estimated: 'estimated',
  'metered+estimated': 'metered + estimated',
};

export function EnergyDisaggregationPanel({ onChange }: { onChange: () => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DisaggResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('energy', 'disaggregate', { days });
    if (r.data?.ok) setData(r.data.result as DisaggResult);
    setLoading(false);
    onChange();
  }, [days, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const rows = data?.devices || [];
  const total = data?.totalKwh || 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <PieChart className="w-3.5 h-3.5 text-lime-400" /> Per-device load attribution
        </h3>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => setDays(w)}
              className={`px-2 py-1 text-[10px] rounded-md ${days === w ? 'bg-lime-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
              {w}d
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-8 text-center">
          No data yet. Add devices and log readings to attribute your consumption.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total kWh" value={total} />
            <Stat label="Attributed" value={data?.attributedKwh ?? 0} accent="text-lime-400" />
            <Stat label="Unattributed" value={data?.unattributedKwh ?? 0} accent="text-zinc-400" />
          </div>
          <ul className="space-y-1.5">
            {rows.map((d) => (
              <li key={d.deviceId} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-zinc-200">
                    <Plug className="w-3 h-3 text-lime-400" />
                    {d.name}
                    <span className="text-[9px] text-zinc-500 capitalize">{d.category.replace(/_/g, ' ')}</span>
                  </span>
                  <span className="text-zinc-400">{d.attributedKwh} kWh · {d.pct}%</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden flex">
                  <div className="h-full bg-lime-500" style={{ width: `${total > 0 ? (d.directKwh / total) * 100 : 0}%` }} title="metered" />
                  <div className="h-full bg-lime-500/40" style={{ width: `${total > 0 ? (d.estimatedKwh / total) * 100 : 0}%` }} title="estimated" />
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  {d.directKwh} kWh metered · {d.estimatedKwh} kWh estimated · {METHOD_LABEL[d.method] || d.method}
                </p>
              </li>
            ))}
          </ul>
          {(data?.unattributedKwh ?? 0) > 0 && (
            <p className="text-[10px] text-zinc-500 px-1">
              {data?.unattributedKwh} kWh unattributed — log device-tagged readings to shrink this.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent = 'text-zinc-100' }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
      <p className={`text-lg font-bold ${accent}`}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
