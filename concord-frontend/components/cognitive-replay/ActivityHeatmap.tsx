'use client';

/**
 * ActivityHeatmap — calendar + hour-of-week heatmap of cognitive
 * activity intensity. Data from the `cognitive-replay.heatmap` macro.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Grid3x3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface HeatmapDay { day: string; weekday: number; turns: number; tokens: number }
interface HeatmapResult {
  sinceDays: number;
  days: HeatmapDay[];
  maxDayTurns: number;
  hourGrid: number[][];
  maxCell: number;
  totalActiveDays: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function intensity(v: number, max: number): string {
  if (v === 0 || max === 0) return 'bg-zinc-900';
  const r = v / max;
  if (r > 0.75) return 'bg-cyan-400';
  if (r > 0.5) return 'bg-cyan-500/80';
  if (r > 0.25) return 'bg-cyan-600/60';
  return 'bg-cyan-700/40';
}

export function ActivityHeatmap({ sinceDays }: { sinceDays: number }) {
  const [data, setData] = useState<HeatmapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<HeatmapResult>('cognitive-replay', 'heatmap', { sinceDays: Math.max(7, sinceDays) });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'heatmap failed');
    setLoading(false);
  }, [sinceDays]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div role="status" aria-live="polite" className="flex items-center gap-2 p-4 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Building heatmap…</div>;
  }
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
        <span>{error}</span>
        <button onClick={load} className="rounded border border-rose-500/40 px-2 py-0.5 font-medium text-rose-100 hover:bg-rose-500/20">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Grid3x3 className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-zinc-100">Activity heatmap</h2>
        <span className="text-[11px] text-zinc-400">{data.totalActiveDays} active days · last {data.sinceDays}d</span>
      </div>

      {/* Calendar strip */}
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Daily intensity</div>
        <div className="flex flex-wrap gap-1">
          {data.days.map((d) => (
            <div
              key={d.day}
              title={`${d.day} · ${d.turns} turns · ${d.tokens.toLocaleString()} tokens`}
              className={`h-4 w-4 rounded-sm ${intensity(d.turns, data.maxDayTurns)}`}
            />
          ))}
        </div>
      </div>

      {/* Hour-of-week grid */}
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Hour-of-week pattern</div>
        <div className="overflow-x-auto">
          <table className="border-separate" style={{ borderSpacing: '2px' }}>
            <tbody>
              {data.hourGrid.map((row, wd) => (
                <tr key={wd}>
                  <td className="pr-1.5 text-right font-mono text-[9px] text-zinc-400">{WEEKDAYS[wd]}</td>
                  {row.map((v, hr) => (
                    <td key={hr}>
                      <div
                        title={`${WEEKDAYS[wd]} ${String(hr).padStart(2, '0')}:00 · ${v} turns`}
                        className={`h-3.5 w-3.5 rounded-sm ${intensity(v, data.maxCell)}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td />
                {Array.from({ length: 24 }, (_, h) => (
                  <td key={h} className="text-center font-mono text-[7px] text-zinc-600">{h % 6 === 0 ? h : ''}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
