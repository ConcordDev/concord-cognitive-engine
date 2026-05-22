'use client';

/**
 * StreaksPanel — consecutive-day logging streaks across all self
 * subsystems. Calls self.streaks: shows the overall active streak,
 * the best per-metric streak, and a per-metric breakdown with
 * current / longest. No seed data.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Flame, CalendarCheck } from 'lucide-react';

interface MetricStreak {
  metric: string;
  label: string;
  current: number;
  longest: number;
  lastLogged: string | null;
  loggedToday: boolean;
}
interface StreaksResult {
  overall: number;
  loggedToday: boolean;
  perMetric: MetricStreak[];
  bestStreak: MetricStreak | null;
  activeDays: number;
}

export function StreaksPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<StreaksResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await lensRun<StreaksResult>('self', 'streaks', {});
      if (r.data?.ok && r.data.result) setData(r.data.result);
      else setData(null);
    } catch { setData(null); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (busy) return <Loader2 className="h-4 w-4 animate-spin text-rose-500" />;
  if (!data || data.perMetric.length === 0) {
    return (
      <p className="rounded border border-rose-900/30 bg-rose-950/10 px-4 py-8 text-center text-xs text-rose-600">
        No streaks yet. Log a reading on consecutive days to start one.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-rose-700">
            <Flame className="h-3.5 w-3.5 text-orange-400" aria-hidden /> Overall streak
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-orange-300">
            {data.overall}<span className="ml-1 text-xs text-rose-700">days</span>
          </div>
        </div>
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-rose-700">
            <CalendarCheck className="h-3.5 w-3.5 text-rose-500" aria-hidden /> Active days
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-rose-200">{data.activeDays}</div>
        </div>
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-rose-700">Best metric streak</div>
          <div className="mt-1 text-sm font-semibold text-rose-200">
            {data.bestStreak ? `${data.bestStreak.label} · ${data.bestStreak.current}d` : '—'}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-rose-900/40 bg-rose-950/10">
        <div className="border-b border-rose-900/30 px-3 py-2 text-[10px] uppercase tracking-wider text-rose-700">
          Per-metric
        </div>
        <ul className="divide-y divide-rose-900/20">
          {data.perMetric.map((m) => (
            <li key={m.metric} className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 text-rose-300">
                {m.loggedToday && <Flame className="h-3 w-3 text-orange-400" aria-label="Logged today" />}
                {m.label}
              </span>
              <span className="flex items-center gap-3 font-mono">
                <span className="text-rose-100">{m.current}d</span>
                <span className="text-rose-700">best {m.longest}d</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
