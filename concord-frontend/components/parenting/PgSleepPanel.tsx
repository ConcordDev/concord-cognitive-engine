'use client';

/**
 * PgSleepPanel — SweetSpot nap prediction and recent sleep history.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Moon, Sparkles, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SweetSpot {
  ageMonths: number;
  napsLikelyDropped?: boolean;
  wakeWindow: { min: number; typical: number; max: number };
  predictedNap: { earliest: string; ideal: string; latest: string } | null;
  lastWakeAt?: string;
  note?: string;
}
interface SleepEntry { id: string; type: string; durationMin: number; startAt: string; endAt: string }

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function PgSleepPanel({ childId }: { childId: string }) {
  const [spot, setSpot] = useState<SweetSpot | null>(null);
  const [history, setHistory] = useState<SleepEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ type: 'nap', durationMin: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, h] = await Promise.all([
      lensRun('parenting', 'sweet-spot', { childId }),
      lensRun('parenting', 'sleep-history', { childId, days: 7 }),
    ]);
    setSpot((s.data?.result as SweetSpot | null) || null);
    setHistory(h.data?.result?.entries || []);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logSleep = async () => {
    const m = Number(form.durationMin);
    if (!(m > 0)) return;
    await lensRun('parenting', 'sleep-log', { childId, type: form.type, durationMin: m });
    setForm({ type: 'nap', durationMin: '' });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* SweetSpot */}
      {spot && (
        <div className="bg-gradient-to-br from-indigo-900/50 to-zinc-900/70 border border-indigo-900/50 rounded-xl p-4">
          <h3 className="flex items-center gap-1 text-[11px] font-semibold text-indigo-300 uppercase tracking-wide mb-2">
            <Sparkles className="w-3.5 h-3.5" /> SweetSpot nap prediction
          </h3>
          {spot.predictedNap ? (
            <>
              <p className="text-2xl font-bold text-zinc-100">{timeOf(spot.predictedNap.ideal)}</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Ideal nap window {timeOf(spot.predictedNap.earliest)} – {timeOf(spot.predictedNap.latest)}
              </p>
              <p className="text-[10px] text-zinc-400 mt-1.5">
                Age-based wake window ≈ {spot.wakeWindow.typical} min · based on last wake at {spot.lastWakeAt ? timeOf(spot.lastWakeAt) : '—'}
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-400">{spot.note}</p>
          )}
        </div>
      )}

      {/* Log sleep */}
      <div className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="nap">Nap</option>
          <option value="night">Night sleep</option>
        </select>
        <input placeholder="Duration (min)" inputMode="numeric" value={form.durationMin}
          onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={logSleep}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Log
        </button>
      </div>

      {/* History */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Moon className="w-3.5 h-3.5 text-indigo-400" /> Sleep history (7d)
        </h3>
        {history.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">No sleep logged yet.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((e) => (
              <li key={e.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <span className="text-xs text-zinc-200 capitalize">{e.type}</span>
                <span className="text-[11px] text-zinc-400">
                  {Math.floor(e.durationMin / 60)}h {e.durationMin % 60}m · {timeOf(e.startAt)}–{timeOf(e.endAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
