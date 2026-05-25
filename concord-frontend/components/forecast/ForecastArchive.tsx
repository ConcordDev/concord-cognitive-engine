'use client';

/**
 * ForecastArchive — historical archive of persisted forecasts plus a trend
 * chart of temperature / ecosystem score over time. Every point is a real
 * persisted world_forecasts row.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface ArchiveEntry {
  composed_at: number;
  weather_kind: string | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  ecosystem_score: number | null;
  drift_kind: string | null;
  event_count: number;
}

interface ArchiveResult {
  ok: boolean;
  count: number;
  entries: ArchiveEntry[];
  trend: ArchiveEntry[];
}

export function ForecastArchive({ worldId }: { worldId: string }) {
  const [result, setResult] = useState<ArchiveResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<ArchiveResult>('forecast', 'archive', { worldId, limit: 60 });
    if (r.data?.ok && r.data.result?.ok) {
      setResult(r.data.result);
    } else {
      setResult(null);
    }
    setLoading(false);
  }, [worldId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-xs text-zinc-400">Loading archive…</p>;

  if (!result || result.count === 0) {
    return (
      <p className="py-8 text-center text-xs italic text-zinc-400">
        No data yet — compose and persist forecasts to build the archive.
      </p>
    );
  }

  const trendData = result.trend.map((e) => ({
    label: new Date(e.composed_at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    temperature: e.temperature_c,
    ecosystem: e.ecosystem_score,
  }));
  const hasTemp = trendData.some((d) => d.temperature !== null);
  const hasEco = trendData.some((d) => d.ecosystem !== null);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">{result.count} persisted forecasts.</p>

      {(hasTemp || hasEco) && (
        <ChartKit
          kind="line"
          data={trendData}
          xKey="label"
          series={[
            ...(hasTemp ? [{ key: 'temperature', label: 'Temp °C', color: '#06b6d4' }] : []),
            ...(hasEco ? [{ key: 'ecosystem', label: 'Ecosystem score', color: '#22c55e' }] : []),
          ]}
          height={200}
        />
      )}

      <ul className="space-y-1.5">
        {result.entries.map((e, i) => (
          <li
            key={`${e.composed_at}-${i}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
          >
            <span className="w-36 shrink-0 font-mono text-[10px] text-zinc-400">
              {new Date(e.composed_at * 1000).toLocaleString()}
            </span>
            <span className="text-xs text-zinc-200">{e.weather_kind ?? '—'}</span>
            <span className="font-mono text-xs text-cyan-300">
              {e.temperature_c !== null ? `${e.temperature_c}°C` : '—'}
            </span>
            <span className="font-mono text-[10px] text-zinc-400">
              {e.drift_kind ? `drift: ${e.drift_kind} · ` : ''}
              {e.event_count} events
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
