'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  CalendarClock, Plus, Trash2, Loader2, CheckCircle2,
  AlertTriangle, Snowflake, Sun, Leaf, Flower2,
} from 'lucide-react';

interface Reminder {
  id: string;
  task: string;
  season: 'spring' | 'summer' | 'fall' | 'winter' | 'any';
  intervalDays: number;
  dueDate: string;
  lastDone: string;
  done: boolean;
  daysUntil: number | null;
  overdue: boolean;
  createdAt: string;
}
interface MaintList {
  reminders: Reminder[];
  count: number;
  overdueCount: number;
  upcomingCount: number;
}
interface SeasonalResult {
  season: string;
  suggestedTasks: string[];
  allSeasons: string[];
}

const DOMAIN = 'home-improvement';
const SEASON_ICON: Record<string, typeof Sun> = {
  spring: Flower2, summer: Sun, fall: Leaf, winter: Snowflake, any: CalendarClock,
};
const SEASON_CLR: Record<string, string> = {
  spring: 'text-pink-400', summer: 'text-amber-400', fall: 'text-orange-400', winter: 'text-cyan-300', any: 'text-gray-400',
};

export function MaintenanceReminders() {
  const [list, setList] = useState<MaintList | null>(null);
  const [seasonal, setSeasonal] = useState<SeasonalResult | null>(null);
  const [seasonView, setSeasonView] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ task: '', season: 'any', intervalDays: '365', dueDate: '' });

  const loadList = useCallback(async () => {
    const { data } = await lensRun<MaintList>(DOMAIN, 'maintenance-list', {});
    if (data.ok && data.result) setList(data.result);
    else setError(data.error || 'Failed to load reminders');
  }, []);

  const loadSeasonal = useCallback(async (season?: string) => {
    const { data } = await lensRun<SeasonalResult>(DOMAIN, 'maintenance-seasonal', season ? { season } : {});
    if (data.ok && data.result) { setSeasonal(data.result); setSeasonView(data.result.season); }
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await Promise.all([loadList(), loadSeasonal()]); setLoading(false); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async (task?: string, season?: string) => {
    const taskName = task ?? form.task;
    if (!taskName.trim()) return;
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'maintenance-add', {
      task: taskName,
      season: season ?? form.season,
      intervalDays: Number(form.intervalDays) || 365,
      dueDate: task ? '' : form.dueDate,
    });
    if (data.ok) { if (!task) setForm({ task: '', season: 'any', intervalDays: '365', dueDate: '' }); await loadList(); }
    else setError(data.error || 'Failed to add reminder');
    setBusy(false);
  };

  const complete = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'maintenance-complete', { id });
    if (data.ok) await loadList();
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'maintenance-delete', { id });
    if (data.ok) await loadList();
    setBusy(false);
  };

  const reminders = list?.reminders || [];

  return (
    <div className="space-y-3">
      <h3 className="font-semibold flex items-center gap-2 text-sm">
        <CalendarClock className="w-4 h-4 text-amber-400" /> Maintenance Reminders
        <span className="text-xs text-gray-400">({list?.count || 0})</span>
      </h3>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {list && (
        <div className="grid grid-cols-3 gap-2">
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-red-400">{list.overdueCount}</p>
            <p className="text-xs text-gray-400">Overdue</p>
          </div>
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-yellow-400">{list.upcomingCount}</p>
            <p className="text-xs text-gray-400">Due within 30d</p>
          </div>
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-neon-cyan">{list.count}</p>
            <p className="text-xs text-gray-400">Total tracked</p>
          </div>
        </div>
      )}

      {/* Seasonal suggestions */}
      {seasonal && (
        <div className="panel p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-300 flex items-center gap-1">Seasonal upkeep checklist</p>
            <div className="flex gap-1">
              {seasonal.allSeasons.map((s) => {
                const SIcon = SEASON_ICON[s];
                return (
                  <button
                    key={s}
                    onClick={() => loadSeasonal(s)}
                    className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${seasonView === s ? 'bg-amber-400/20 text-amber-400' : 'bg-lattice-surface text-gray-400'}`}
                  >
                    <SIcon className={`w-3 h-3 ${SEASON_CLR[s]}`} />{s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            {seasonal.suggestedTasks.map((t) => (
              <div key={t} className="flex items-center justify-between text-xs bg-lattice-deep rounded px-2 py-1.5">
                <span className="text-gray-200">{t}</span>
                <button onClick={() => add(t, seasonal.season)} disabled={busy} className="text-amber-400 hover:text-amber-300 flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> track
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom reminder form */}
      <div className="panel p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-300">Custom reminder</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input value={form.task} onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))} placeholder="Task" className="input-lattice text-xs md:col-span-2" />
          <select value={form.season} onChange={(e) => setForm((f) => ({ ...f, season: e.target.value }))} className="input-lattice text-xs">
            {['any', 'spring', 'summer', 'fall', 'winter'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={form.intervalDays} onChange={(e) => setForm((f) => ({ ...f, intervalDays: e.target.value }))} type="number" placeholder="Interval days" className="input-lattice text-xs" />
          <label className="text-xs text-gray-400 md:col-span-2">Next due
            <input value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} type="date" className="input-lattice w-full" />
          </label>
        </div>
        <button onClick={() => add()} disabled={busy || !form.task.trim()} className="btn-neon green w-full text-xs disabled:opacity-50">
          {busy ? 'Saving...' : 'Add Reminder'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading reminders...</div>
      ) : reminders.length === 0 ? (
        <p className="text-xs text-gray-400">No reminders tracked yet. Add seasonal upkeep tasks above.</p>
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => {
            const SIcon = SEASON_ICON[r.season];
            return (
              <div key={r.id} className={`panel p-3 flex items-center gap-3 ${r.overdue ? 'border-red-400/40' : ''}`}>
                <SIcon className={`w-4 h-4 ${SEASON_CLR[r.season]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{r.task}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>Due {r.dueDate}</span>
                    <span>every {r.intervalDays}d</span>
                    {r.overdue ? (
                      <span className="flex items-center gap-0.5 text-red-400"><AlertTriangle className="w-3 h-3" />overdue {Math.abs(r.daysUntil ?? 0)}d</span>
                    ) : r.daysUntil != null ? (
                      <span className="text-neon-cyan">in {r.daysUntil}d</span>
                    ) : null}
                    {r.lastDone && <span className="text-gray-600">last: {r.lastDone}</span>}
                  </div>
                </div>
                <button onClick={() => complete(r.id)} disabled={busy} className="text-neon-green hover:text-green-300 p-1" title="Mark done & reschedule">
                  <CheckCircle2 className="w-4 h-4" />
                </button>
                <button aria-label="Delete" onClick={() => remove(r.id)} disabled={busy} className="text-gray-400 hover:text-red-400 p-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
