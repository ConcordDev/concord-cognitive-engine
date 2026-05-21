'use client';

/**
 * ForecastAccuracy — compares each past persisted forecast against the
 * forecast composed nearest its 24h target window. Both sides are real
 * persisted rows; nothing is synthesized. Needs >=2 persisted forecasts
 * spanning a window to score anything.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface Comparison {
  forecast_ts: number;
  target_ts: number;
  realized_ts: number;
  predicted_kind: string | null;
  realized_kind: string | null;
  kind_hit: boolean | null;
  predicted_temp_c: number | null;
  realized_temp_c: number | null;
  temp_abs_error_c: number | null;
}

interface AccuracyResult {
  ok: boolean;
  summary: {
    sample_count: number;
    kind_accuracy: number | null;
    mean_temp_error_c: number | null;
  };
  comparisons: Comparison[];
}

export function ForecastAccuracy({ worldId }: { worldId: string }) {
  const [result, setResult] = useState<AccuracyResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<AccuracyResult>('forecast', 'accuracy', { worldId, limit: 30 });
    if (r.data?.ok && r.data.result?.ok) {
      setResult(r.data.result);
    } else {
      setResult(null);
    }
    setLoading(false);
  }, [worldId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-xs text-zinc-500">Scoring past forecasts…</p>;

  if (!result || result.summary.sample_count === 0) {
    return (
      <p className="py-8 text-center text-xs italic text-zinc-500">
        No data yet — accuracy needs at least two persisted forecasts spanning a 24h window.
        Compose forecasts over time to build the comparison set.
      </p>
    );
  }

  const { summary, comparisons } = result;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Samples</div>
          <div className="mt-0.5 font-mono text-lg text-zinc-100">{summary.sample_count}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Kind hit-rate</div>
          <div className="mt-0.5 font-mono text-lg text-emerald-300">
            {summary.kind_accuracy !== null ? `${(summary.kind_accuracy * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Mean temp error</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">
            {summary.mean_temp_error_c !== null ? `${summary.mean_temp_error_c}°C` : '—'}
          </div>
        </div>
      </div>

      <ul className="space-y-1.5">
        {comparisons.slice().reverse().map((c, i) => (
          <li
            key={`${c.forecast_ts}-${i}`}
            className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-zinc-500">
                {new Date(c.forecast_ts * 1000).toLocaleString()}
              </span>
              {c.kind_hit !== null && (
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  c.kind_hit ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                }`}>
                  {c.kind_hit ? 'kind hit' : 'kind miss'}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
              <span className="text-zinc-400">
                kind: <span className="text-zinc-200">{c.predicted_kind ?? '—'}</span>
                {' → '}
                <span className="text-zinc-200">{c.realized_kind ?? '—'}</span>
              </span>
              {c.temp_abs_error_c !== null && (
                <span className="text-zinc-400">
                  temp err: <span className="font-mono text-amber-300">{c.temp_abs_error_c}°C</span>
                  <span className="text-zinc-600"> ({c.predicted_temp_c}° → {c.realized_temp_c}°)</span>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
