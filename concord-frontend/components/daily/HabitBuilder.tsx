'use client';

/**
 * HabitBuilder — Reflectly-style habit creation + scheduled check-ins.
 * Create habits with a cue, cadence and reminder time; toggle today's
 * check-in; track streaks and weekly progress. Wires the daily.habit-*
 * macros (habit-create, habit-list, habit-checkin, habit-update, habit-delete).
 */

import { useCallback, useEffect, useState } from 'react';
import { Repeat, Plus, Check, Trash2, Bell, Loader2, Archive } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Habit {
  id: string; name: string; cue: string | null; frequency: string;
  reminderTime: string | null; color: string; targetPerWeek: number;
  currentStreak: number; totalCheckins: number; doneToday: boolean;
  dueToday: boolean; thisWeek: number; weekProgress: number; status: string;
}
interface HabitListResult { habits: Habit[]; count: number; dueToday: number; doneToday: number }

const FREQS = [
  { v: 'daily', label: 'Every day' },
  { v: 'weekdays', label: 'Weekdays' },
  { v: 'weekends', label: 'Weekends' },
  { v: 'weekly', label: 'Weekly' },
];

const STATUS_COLOR: Record<string, string> = {
  'locked-in': 'bg-emerald-500/20 text-emerald-300',
  strong: 'bg-rose-500/20 text-rose-300',
  building: 'bg-amber-500/20 text-amber-300',
  starting: 'bg-sky-500/20 text-sky-300',
  new: 'bg-zinc-700/50 text-zinc-400',
};

export function HabitBuilder({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<HabitListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', cue: '', frequency: 'daily', reminderTime: '', targetPerWeek: 7 });

  const load = useCallback(async () => {
    const r = await lensRun<HabitListResult>('daily', 'habit-list', {});
    if (r.data?.ok && r.data.result) setData(r.data.result);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!form.name.trim()) return;
    setBusy('create');
    const r = await lensRun('daily', 'habit-create', {
      name: form.name.trim(),
      cue: form.cue.trim() || undefined,
      frequency: form.frequency,
      reminderTime: form.reminderTime || undefined,
      targetPerWeek: form.targetPerWeek,
    });
    setBusy(null);
    if (r.data?.ok) {
      setForm({ name: '', cue: '', frequency: 'daily', reminderTime: '', targetPerWeek: 7 });
      setShowForm(false);
      await load();
      onChange?.();
    }
  }, [form, load, onChange]);

  const checkin = useCallback(async (habitId: string) => {
    setBusy(habitId);
    await lensRun('daily', 'habit-checkin', { habitId });
    setBusy(null);
    await load();
    onChange?.();
  }, [load, onChange]);

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    await lensRun('daily', 'habit-delete', { id });
    setBusy(null);
    await load();
    onChange?.();
  }, [load, onChange]);

  const archive = useCallback(async (id: string) => {
    setBusy(id);
    await lensRun('daily', 'habit-update', { id, archived: true });
    setBusy(null);
    await load();
    onChange?.();
  }, [load, onChange]);

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const habits = data?.habits || [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Repeat className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">Habits</h3>
        {data && data.count > 0 && (
          <span className="text-[11px] text-zinc-500">{data.doneToday}/{data.dueToday} done today</span>
        )}
        <button onClick={() => setShowForm((v) => !v)}
          className="ml-auto px-2 py-1 text-[11px] rounded bg-rose-600 hover:bg-rose-500 text-white inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New habit
        </button>
      </div>

      {showForm && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 mb-3 space-y-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Habit name (e.g. Morning walk)" maxLength={80}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500" />
          <input value={form.cue} onChange={(e) => setForm({ ...form, cue: e.target.value })}
            placeholder="Cue / trigger (optional, e.g. After coffee)" maxLength={160}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <div className="flex gap-2">
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
              {FREQS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              <Bell className="w-3 h-3" />
              <input type="time" value={form.reminderTime} onChange={(e) => setForm({ ...form, reminderTime: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            Target / week
            <input type="number" min={1} max={7} value={form.targetPerWeek}
              onChange={(e) => setForm({ ...form, targetPerWeek: Math.max(1, Math.min(7, Number(e.target.value) || 1)) })}
              className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
          </label>
          <button onClick={create} disabled={!form.name.trim() || busy === 'create'}
            className="w-full px-3 py-1.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 inline-flex items-center justify-center gap-1">
            {busy === 'create' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Create habit
          </button>
        </div>
      )}

      {habits.length === 0 ? (
        <p className="text-xs text-zinc-500 italic text-center py-6">No habits yet — create one to start a streak.</p>
      ) : (
        <div className="space-y-2">
          {habits.map((h) => (
            <div key={h.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <button onClick={() => checkin(h.id)} disabled={busy === h.id}
                  aria-label={h.doneToday ? 'Undo check-in' : 'Check in'}
                  className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-colors',
                    h.doneToday ? 'bg-rose-600 border-rose-500 text-white' : 'border-zinc-700 text-zinc-600 hover:border-rose-500')}>
                  {busy === h.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">{h.name}</p>
                  <p className="text-[10px] text-zinc-500">
                    {FREQS.find((f) => f.v === h.frequency)?.label || h.frequency}
                    {h.cue ? ` · ${h.cue}` : ''}
                    {h.reminderTime ? ` · ⏰ ${h.reminderTime}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-orange-400">{h.currentStreak}d</p>
                  <span className={cn('text-[9px] px-1 rounded', STATUS_COLOR[h.status] || STATUS_COLOR.new)}>{h.status}</span>
                </div>
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100">
                  <button onClick={() => archive(h.id)} aria-label="Archive habit" className="text-zinc-500 hover:text-zinc-300"><Archive className="w-3 h-3" /></button>
                  <button onClick={() => remove(h.id)} aria-label="Delete habit" className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-rose-500" style={{ width: `${h.weekProgress}%` }} />
                </div>
                <span className="text-[10px] text-zinc-500">{h.thisWeek}/{h.targetPerWeek} this week</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
