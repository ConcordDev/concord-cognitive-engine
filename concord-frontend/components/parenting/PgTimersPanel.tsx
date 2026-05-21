'use client';

/**
 * PgTimersPanel — one-tap start/stop nursing and sleep timers. A running
 * timer is in-flight state; stopping it commits a real log entry with the
 * elapsed duration.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Timer, Milk, Moon, Square, Play, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface RunningTimer {
  id: string;
  childId: string;
  kind: 'nursing' | 'sleep';
  side: string | null;
  sleepType: string | null;
  startedAt: string;
  elapsedSec: number;
}

function fmtElapsed(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function PgTimersPanel({ childId }: { childId: string }) {
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const baseRef = useRef<{ at: number; timers: RunningTimer[] }>({ at: Date.now(), timers: [] });

  const refresh = useCallback(async () => {
    const r = await lensRun('parenting', 'timer-list', { childId });
    const list: RunningTimer[] = r.data?.result?.timers || [];
    baseRef.current = { at: Date.now(), timers: list };
    setTimers(list);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Local ticking clock so the elapsed display updates without polling.
  useEffect(() => {
    if (timers.length === 0) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [timers.length]);

  const start = async (kind: 'nursing' | 'sleep', extra: Record<string, unknown>) => {
    const r = await lensRun('parenting', 'timer-start', { childId, kind, ...extra });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to start timer'); return; }
    setError(null);
    await refresh();
  };
  const stop = async (id: string) => {
    const r = await lensRun('parenting', 'timer-stop', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to stop timer'); return; }
    setError(null);
    await refresh();
  };
  const cancel = async (id: string) => {
    await lensRun('parenting', 'timer-cancel', { id });
    await refresh();
  };

  const liveElapsed = (t: RunningTimer) => {
    const drift = Math.round((Date.now() - baseRef.current.at) / 1000);
    return t.elapsedSec + drift;
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4" data-live-tick={tick}>
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Running timers */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Timer className="w-3.5 h-3.5 text-rose-400" /> Live timers
        </h3>
        {timers.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic py-4 text-center">No timer running. Start one below.</p>
        ) : (
          <ul className="space-y-2">
            {timers.map((t) => (
              <li key={t.id} className={cn('rounded-xl border p-3',
                t.kind === 'nursing' ? 'border-sky-900/50 bg-sky-950/30' : 'border-indigo-900/50 bg-indigo-950/30')}>
                <div className="flex items-center gap-2">
                  {t.kind === 'nursing'
                    ? <Milk className="w-4 h-4 text-sky-300" />
                    : <Moon className="w-4 h-4 text-indigo-300" />}
                  <span className="text-xs font-semibold text-zinc-100 capitalize">
                    {t.kind === 'nursing' ? `Nursing${t.side ? ` · ${t.side}` : ''}` : `Sleep${t.sleepType ? ` · ${t.sleepType}` : ''}`}
                  </span>
                  <span className="ml-auto font-mono text-lg font-bold text-zinc-100 tabular-nums">{fmtElapsed(liveElapsed(t))}</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => stop(t.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">
                    <Square className="w-3 h-3" /> Stop &amp; log
                  </button>
                  <button type="button" onClick={() => cancel(t.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
                    <X className="w-3 h-3" /> Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quick-start widgets */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
        <h3 className="text-xs font-semibold text-zinc-300">One-tap start</h3>
        <div className="space-y-1.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Nursing</p>
          <div className="flex flex-wrap gap-2">
            {(['left', 'right', 'both'] as const).map((side) => (
              <button key={side} type="button" onClick={() => start('nursing', { side })}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg capitalize">
                <Play className="w-3 h-3" /> {side}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Sleep</p>
          <div className="flex flex-wrap gap-2">
            {(['nap', 'night'] as const).map((st) => (
              <button key={st} type="button" onClick={() => start('sleep', { sleepType: st })}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg capitalize">
                <Play className="w-3 h-3" /> {st}
              </button>
            ))}
          </div>
        </div>
      </section>
      <p className="text-[10px] text-zinc-500">Stopping a timer commits a real feed/sleep entry with the elapsed duration.</p>
    </div>
  );
}
