'use client';

/**
 * HourlyBreakdown — hour-by-hour view within the forecast window. Temperature
 * follows the standard diurnal cosine curve anchored on the measured embodied
 * baseline (coldest ~05:00, warmest ~15:00); humidity is the inverse.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface HourEntry {
  hour_offset: number;
  clock_hour: number;
  temperature_c: number | null;
  humidity_pct: number | null;
  confidence: number;
}

interface HourlyResult {
  ok: boolean;
  hours: number;
  breakdown: HourEntry[];
}

export function HourlyBreakdown({ worldId }: { worldId: string }) {
  const [hours, setHours] = useState(24);
  const [breakdown, setBreakdown] = useState<HourEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<HourlyResult>('forecast', 'hourly', { worldId, hours });
    if (r.data?.ok && r.data.result?.ok) {
      setBreakdown(r.data.result.breakdown || []);
    } else {
      setBreakdown([]);
    }
    setLoading(false);
  }, [worldId, hours]);

  useEffect(() => { void load(); }, [load]);

  const chartData = (breakdown || []).map((h) => ({
    label: `${String(h.clock_hour).padStart(2, '0')}:00`,
    temperature: h.temperature_c,
    humidity: h.humidity_pct,
  }));
  const hasTemp = chartData.some((d) => d.temperature !== null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="forecast-hours" className="text-xs text-zinc-400">Window</label>
        <select
          id="forecast-hours"
          value={hours}
          onChange={(e) => setHours(parseInt(e.target.value, 10))}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
        >
          {[12, 24, 36, 48].map((n) => <option key={n} value={n}>{n} hours</option>)}
        </select>
      </div>

      {loading && <p className="text-xs text-zinc-400">Composing hourly curve…</p>}

      {!loading && (!breakdown || breakdown.length === 0) && (
        <p className="py-8 text-center text-xs italic text-zinc-400">No data yet.</p>
      )}

      {!loading && breakdown && breakdown.length > 0 && (
        <>
          {hasTemp ? (
            <ChartKit
              kind="line"
              data={chartData}
              xKey="label"
              series={[
                { key: 'temperature', label: 'Temp °C', color: '#f59e0b' },
                { key: 'humidity', label: 'Humidity %', color: '#06b6d4' },
              ]}
              height={220}
            />
          ) : (
            <p className="py-6 text-center text-xs italic text-zinc-400">
              No embodied temperature baseline for this world yet.
            </p>
          )}
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {breakdown.map((h) => (
              <li
                key={h.hour_offset}
                className="rounded-lg border border-amber-700/25 bg-amber-500/5 px-2.5 py-1.5"
              >
                <div className="font-mono text-[11px] text-zinc-300">
                  {String(h.clock_hour).padStart(2, '0')}:00
                </div>
                <div className="mt-0.5 font-mono text-sm text-amber-300">
                  {h.temperature_c !== null ? `${h.temperature_c}°C` : '—'}
                </div>
                <div className="font-mono text-[10px] text-zinc-400">
                  {h.humidity_pct !== null ? `${h.humidity_pct}% rh · ` : ''}
                  {(h.confidence * 100).toFixed(0)}% conf
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
