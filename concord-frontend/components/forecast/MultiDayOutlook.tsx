'use client';

/**
 * MultiDayOutlook — 2-14 day world outlook. Confidence honestly decays the
 * further out the model looks; temperature drifts deterministically off the
 * measured embodied baseline. No invented data — every day inherits the
 * measured baseline kind.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface OutlookDay {
  day_index: number;
  date_ts: number;
  weather: {
    kind: string;
    confidence: number;
    temperature_c: number | null;
    humidity_pct: number | null;
  };
}

interface MultiDayResult {
  ok: boolean;
  days: number;
  outlook: OutlookDay[];
}

export function MultiDayOutlook({ worldId }: { worldId: string }) {
  const [days, setDays] = useState(7);
  const [outlook, setOutlook] = useState<OutlookDay[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<MultiDayResult>('forecast', 'multiDay', { worldId, days });
    if (r.data?.ok && r.data.result?.ok) {
      setOutlook(r.data.result.outlook || []);
    } else {
      setOutlook([]);
    }
    setLoading(false);
  }, [worldId, days]);

  useEffect(() => { void load(); }, [load]);

  const chartData = (outlook || []).map((d) => ({
    label: new Date(d.date_ts * 1000).toLocaleDateString(undefined, { weekday: 'short' }),
    temperature: d.weather.temperature_c,
    confidence: Number((d.weather.confidence * 100).toFixed(0)),
  }));
  const hasTemp = chartData.some((d) => d.temperature !== null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="forecast-days" className="text-xs text-zinc-400">Range</label>
        <select
          id="forecast-days"
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
        >
          {[3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} days</option>)}
        </select>
      </div>

      {loading && <p className="text-xs text-zinc-400">Composing outlook…</p>}

      {!loading && (!outlook || outlook.length === 0) && (
        <p className="py-8 text-center text-xs italic text-zinc-400">No data yet.</p>
      )}

      {!loading && outlook && outlook.length > 0 && (
        <>
          {hasTemp && (
            <ChartKit
              kind="area"
              data={chartData}
              xKey="label"
              series={[
                { key: 'temperature', label: 'Temp °C', color: '#06b6d4' },
                { key: 'confidence', label: 'Confidence %', color: '#a855f7' },
              ]}
              height={200}
            />
          )}
          <ul className="space-y-1.5">
            {outlook.map((d) => (
              <li
                key={d.day_index}
                className="flex items-center justify-between gap-3 rounded-lg border border-cyan-700/25 bg-cyan-500/5 px-3 py-2"
              >
                <span className="w-28 shrink-0 font-mono text-[11px] text-zinc-300">
                  {new Date(d.date_ts * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <span className="text-xs text-zinc-100">{d.weather.kind}</span>
                <span className="font-mono text-xs text-cyan-300">
                  {d.weather.temperature_c !== null ? `${d.weather.temperature_c}°C` : '—'}
                  {d.weather.humidity_pct !== null ? ` · ${d.weather.humidity_pct}%` : ''}
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-[10px] text-zinc-400">
                  {(d.weather.confidence * 100).toFixed(0)}% conf
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
