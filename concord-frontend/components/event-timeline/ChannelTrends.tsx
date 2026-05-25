'use client';

/**
 * ChannelTrends — per-channel trend sparklines. Backed by the
 * event_timeline.timeseries macro, which returns one bucketed counts[]
 * array per channel over a rolling window. Clicking a channel toggles it
 * into the parent's channel filter.
 */

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { Sparkline } from './Sparkline';

interface Series {
  channel: string;
  counts: number[];
  total: number;
}

interface TimeseriesResult {
  ok: boolean;
  fromTs?: number;
  toTs?: number;
  bucketSec?: number;
  buckets?: number;
  series?: Series[];
}

const WINDOWS: { label: string; sec: number }[] = [
  { label: '6h', sec: 6 * 3600 },
  { label: '24h', sec: 24 * 3600 },
  { label: '7d', sec: 7 * 24 * 3600 },
];

export function ChannelTrends({
  worldId,
  selectedChannels,
  onToggleChannel,
}: {
  worldId: string;
  selectedChannels: string[];
  onToggleChannel: (channel: string) => void;
}) {
  const [series, setSeries] = useState<Series[]>([]);
  const [windowSec, setWindowSec] = useState(24 * 3600);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await lensRun<TimeseriesResult>('event_timeline', 'timeseries', {
      windowSec,
      buckets: 32,
      worldId: worldId || null,
    });
    if (r.data?.result?.ok && Array.isArray(r.data.result.series)) {
      setSeries(r.data.result.series);
    } else {
      setSeries([]);
    }
    setLoading(false);
  }, [windowSec, worldId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
          <TrendingUp className="h-4 w-4 text-indigo-400" /> Channel trends
        </h3>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWindowSec(w.sec)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                windowSec === w.sec
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Computing trends…
        </div>
      )}

      {!loading && series.length === 0 && (
        <p className="py-4 text-center text-xs text-zinc-400">
          No events in this window yet.
        </p>
      )}

      {!loading && series.length > 0 && (
        <ul className="space-y-1">
          {series.slice(0, 14).map((s) => {
            const active = selectedChannels.includes(s.channel);
            return (
              <li key={s.channel}>
                <button
                  onClick={() => onToggleChannel(s.channel)}
                  className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${
                    active ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'hover:bg-zinc-800/60'
                  }`}
                  title={`Filter to ${s.channel}`}
                >
                  <span className="w-44 shrink-0 truncate font-mono text-[11px] text-zinc-300">
                    {s.channel}
                  </span>
                  <Sparkline counts={s.counts} color={active ? '#a5b4fc' : '#818cf8'} />
                  <span className="ml-auto shrink-0 font-mono text-xs text-zinc-400">
                    {s.total.toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
