'use client';

/**
 * NewsDigestSchedule — pick a personalized digest delivery cadence and hour.
 * Persists via `news.digest-schedule-set` and shows the computed next
 * delivery time from `news.digest-schedule-get`.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarClock, Check } from 'lucide-react';

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Cadence = 'daily' | 'weekdays' | 'weekly' | 'off';

interface Schedule {
  cadence: Cadence;
  hour: number;
  topicsOnly: boolean;
  updatedAt: string;
}

const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays only',
  weekly: 'Weekly (Monday)',
  off: 'Off',
};

export function NewsDigestSchedule() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [nextDelivery, setNextDelivery] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable draft
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [hour, setHour] = useState(8);
  const [topicsOnly, setTopicsOnly] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('news', 'digest-schedule-get', {});
    if (r.data?.ok) {
      const s = (r.data.result?.schedule as Schedule | null) || null;
      setSchedule(s);
      setNextDelivery((r.data.result?.nextDelivery as string | null) || null);
      if (s) {
        setCadence(s.cadence);
        setHour(s.hour);
        setTopicsOnly(s.topicsOnly);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    const r = await lensRun('news', 'digest-schedule-set', { cadence, hour, topicsOnly });
    if (r.data?.ok) {
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  }, [cadence, hour, topicsOnly, refresh]);

  const fmtHour = (h: number) => {
    const period = h < 12 ? 'AM' : 'PM';
    const display = h % 12 === 0 ? 12 : h % 12;
    return `${display}:00 ${period}`;
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-fuchsia-600/15 to-transparent">
        <CalendarClock className="w-5 h-5 text-fuchsia-400" />
        <h2 className="text-sm font-bold text-zinc-100">Digest Schedule</h2>
        <span className="text-[11px] text-zinc-400">Choose your delivery time</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Current status */}
          <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-2">
            {schedule && schedule.cadence !== 'off' ? (
              <>
                <p className="text-xs text-zinc-300">
                  Digest set for <span className="font-semibold text-fuchsia-300">{CADENCE_LABEL[schedule.cadence]}</span>{' '}
                  at <span className="font-semibold text-fuchsia-300">{fmtHour(schedule.hour)}</span>
                </p>
                {nextDelivery && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    Next delivery: {new Date(nextDelivery).toLocaleString()}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-zinc-400 italic">No digest scheduled.</p>
            )}
          </div>

          {/* Cadence picker */}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">Cadence</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCadence(c)}
                  className={cn(
                    'px-2.5 py-1.5 text-[11px] rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-500',
                    cadence === c
                      ? 'bg-fuchsia-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {CADENCE_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          {/* Hour picker */}
          {cadence !== 'off' && (
            <div>
              <label className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5 block">
                Delivery hour — {fmtHour(hour)}
              </label>
              <input
                type="range"
                min={0}
                max={23}
                step={1}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="w-full accent-fuchsia-500"
              />
              <div className="flex justify-between text-[9px] text-zinc-400">
                <span>12 AM</span>
                <span>12 PM</span>
                <span>11 PM</span>
              </div>
            </div>
          )}

          {/* Topics-only toggle */}
          {cadence !== 'off' && (
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={topicsOnly}
                onChange={(e) => setTopicsOnly(e.target.checked)}
                className="accent-fuchsia-500"
              />
              Only include topics I follow
            </label>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : saved ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <CalendarClock className="w-3.5 h-3.5" />
            )}
            {saved ? 'Schedule saved' : 'Save schedule'}
          </button>
        </div>
      )}
    </div>
  );
}
