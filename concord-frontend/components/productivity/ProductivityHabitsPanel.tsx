'use client';

/**
 * ProductivityHabitsPanel — habit tracker with daily check-ins and
 * streak counts.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Flame, Check, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Habit { id: string; name: string; cadence: string; streak: number; doneToday: boolean; totalCheckins: number }

export function ProductivityHabitsPanel({ onChange }: { onChange: () => void }) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('productivity', 'habit-list', {});
    setHabits(r.data?.result?.habits || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) { setError('Habit name is required.'); return; }
    const r = await lensRun('productivity', 'habit-create', { name: name.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setName(''); setError(null);
    await refresh();
  };
  const checkin = async (id: string) => { await lensRun('productivity', 'habit-checkin', { id }); await refresh(); };
  const del = async (id: string) => { await lensRun('productivity', 'habit-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New habit — e.g. Read 20 minutes"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={create}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {habits.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No habits yet. Build a daily routine.
        </div>
      ) : (
        <ul className="space-y-2">
          {habits.map((h) => (
            <li key={h.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button aria-label="Confirm" type="button" onClick={() => checkin(h.id)}
                className={cn('w-9 h-9 rounded-full border flex items-center justify-center shrink-0',
                  h.doneToday ? 'bg-red-600 border-red-600' : 'border-zinc-600 hover:border-red-500')}>
                <Check className={cn('w-4 h-4', h.doneToday ? 'text-white' : 'text-zinc-600')} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-100">{h.name}</p>
                <p className="text-[11px] text-zinc-400">{h.totalCheckins} check-ins · {h.cadence}</p>
              </div>
              <span className="flex items-center gap-1 text-xs font-bold text-amber-400 shrink-0">
                <Flame className="w-3.5 h-3.5" />{h.streak}
              </span>
              <button aria-label="Delete" type="button" onClick={() => del(h.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
