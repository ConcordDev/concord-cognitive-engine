'use client';

/**
 * PgTodayPanel — one-touch logging for feeds, diapers and medicine plus
 * the merged day timeline.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Milk, Baby, Pill, Activity, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Dash {
  feedsToday: number; sleepMinToday: number; diapersToday: number;
  lastFeed: { kind: string; at: string } | null;
}
interface TimelineEvent { type: string; at: string; label: string }

const TYPE_ICON: Record<string, typeof Milk> = {
  feed: Milk, sleep: Clock, diaper: Baby, medicine: Pill, activity: Activity,
};
const TYPE_COLOR: Record<string, string> = {
  feed: 'text-sky-400', sleep: 'text-indigo-400', diaper: 'text-amber-400',
  medicine: 'text-emerald-400', activity: 'text-rose-400',
};

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function PgTodayPanel({ childId }: { childId: string }) {
  const [dash, setDash] = useState<Dash | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [bottleMl, setBottleMl] = useState('');
  const [nurseMin, setNurseMin] = useState('');
  const [medName, setMedName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, t] = await Promise.all([
      lensRun('parenting', 'parenting-dashboard', { childId }),
      lensRun('parenting', 'day-timeline', { childId }),
    ]);
    setDash((d.data?.result as Dash | null) || null);
    setEvents(t.data?.result?.events || []);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logFeed = async (kind: string, extra: Record<string, unknown>) => {
    await lensRun('parenting', 'feed-log', { childId, kind, ...extra });
    setBottleMl(''); setNurseMin('');
    await refresh();
  };
  const logDiaper = async (kind: string) => {
    await lensRun('parenting', 'diaper-log', { childId, kind });
    await refresh();
  };
  const logMed = async () => {
    if (!medName.trim()) return;
    await lensRun('parenting', 'medicine-log', { childId, name: medName.trim() });
    setMedName('');
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {dash && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Feeds today" value={dash.feedsToday} />
          <Stat label="Sleep today" value={`${Math.floor(dash.sleepMinToday / 60)}h ${dash.sleepMinToday % 60}m`} />
          <Stat label="Diapers today" value={dash.diapersToday} />
        </div>
      )}

      {/* Quick log */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
        <h3 className="text-xs font-semibold text-zinc-300">Quick log</h3>
        <div className="flex items-center gap-2">
          <input placeholder="Bottle ml" inputMode="numeric" value={bottleMl} onChange={(e) => setBottleMl(e.target.value)}
            className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={() => logFeed('bottle', { amountMl: Number(bottleMl) || 0 })}
            className="px-2.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Bottle</button>
          <input placeholder="Nurse min" inputMode="numeric" value={nurseMin} onChange={(e) => setNurseMin(e.target.value)}
            className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={() => logFeed('nursing', { side: 'both', durationMin: Number(nurseMin) || 0 })}
            className="px-2.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Nurse</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => logDiaper('wet')}
            className="px-2.5 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg">Wet diaper</button>
          <button type="button" onClick={() => logDiaper('dirty')}
            className="px-2.5 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded-lg">Dirty diaper</button>
          <button type="button" onClick={() => logDiaper('mixed')}
            className="px-2.5 py-1.5 text-xs bg-amber-800 hover:bg-amber-700 text-white rounded-lg">Mixed</button>
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Medicine name" value={medName} onChange={(e) => setMedName(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={logMed}
            className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">Log medicine</button>
        </div>
      </section>

      {/* Timeline */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Clock className="w-3.5 h-3.5 text-rose-400" /> Today's timeline
        </h3>
        {events.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic py-6 text-center">Nothing logged yet today.</p>
        ) : (
          <ul className="space-y-1">
            {events.map((e, i) => {
              const Icon = TYPE_ICON[e.type] || Clock;
              return (
                <li key={i} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <Icon className={`w-3.5 h-3.5 ${TYPE_COLOR[e.type] || 'text-zinc-400'}`} />
                  <span className="text-xs text-zinc-200 capitalize flex-1">{e.type} · {e.label}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">{timeOf(e.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
