'use client';

/**
 * FsProductionPanel — locations database, production tasks, the
 * production calendar and the Day Out of Days report.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, MapPin, CheckSquare, CalendarDays, Grid3x3, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Location { id: string; name: string; address: string | null; contact: string | null }
interface Task { id: string; title: string; department: string; assignee: string | null; dueDate: string | null; status: string }
interface CalDay { type: string; label: string; status?: string }
interface DoodRow { castId: string; name: string; character: string | null; workDays: number; cells: { day: number; code: string }[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CODE_COLOR: Record<string, string> = {
  S: 'bg-emerald-700 text-white', W: 'bg-fuchsia-800 text-white',
  H: 'bg-zinc-700 text-zinc-300', F: 'bg-amber-700 text-white', SWF: 'bg-sky-700 text-white',
};

export function FsProductionPanel({ projectId }: { projectId: string }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dood, setDood] = useState<{ days: number[]; rows: DoodRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [locForm, setLocForm] = useState({ name: '', address: '', contact: '' });
  const [taskForm, setTaskForm] = useState({ title: '', department: '', dueDate: '' });
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [cal, setCal] = useState<Record<string, CalDay[]>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [l, t, d] = await Promise.all([
      lensRun('film-studios', 'location-list', { projectId }),
      lensRun('film-studios', 'task-list', { projectId }),
      lensRun('film-studios', 'dood-report', { projectId }),
    ]);
    setLocations(l.data?.result?.locations || []);
    setTasks(t.data?.result?.tasks || []);
    setDood((d.data?.result as { days: number[]; rows: DoodRow[] } | null) || null);
    setLoading(false);
  }, [projectId]);

  const loadCal = useCallback(async () => {
    const r = await lensRun('film-studios', 'production-calendar', { projectId, year, month });
    setCal(r.data?.result?.days || {});
  }, [projectId, year, month]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void loadCal(); }, [loadCal]);

  const addLocation = async () => {
    if (!locForm.name.trim()) return;
    await lensRun('film-studios', 'location-create', { projectId, ...locForm, name: locForm.name.trim() });
    setLocForm({ name: '', address: '', contact: '' });
    await refresh();
  };
  const addTask = async () => {
    if (!taskForm.title.trim()) return;
    await lensRun('film-studios', 'task-create', { projectId, ...taskForm, title: taskForm.title.trim() });
    setTaskForm({ title: '', department: '', dueDate: '' });
    await refresh();
    await loadCal();
  };
  const cycleTask = async (t: Task) => {
    const next = t.status === 'todo' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'todo';
    await lensRun('film-studios', 'task-update', { id: t.id, status: next });
    await refresh();
  };
  const shiftMonth = (delta: number) => {
    let m = month + delta; let y = year;
    if (m < 1) { m = 12; y -= 1; } if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };
  const daysInMonth = new Date(year, month, 0).getUTCDate();

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Locations */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <MapPin className="w-3.5 h-3.5 text-fuchsia-400" /> Locations
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Name" value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} className={inp} />
          <input placeholder="Address" value={locForm.address} onChange={(e) => setLocForm({ ...locForm, address: e.target.value })} className={inp} />
          <input placeholder="Contact" value={locForm.contact} onChange={(e) => setLocForm({ ...locForm, contact: e.target.value })} className={inp} />
          <button type="button" onClick={addLocation} className={btn}><Plus className="w-3.5 h-3.5" /> Location</button>
        </div>
        {locations.length === 0 ? <Empty text="No locations." /> : (
          <ul className="space-y-1">
            {locations.map((l) => (
              <li key={l.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-100 flex-1">{l.name}
                  {l.address && <span className="text-zinc-400"> · {l.address}</span>}</span>
                {l.contact && <span className="text-[10px] text-zinc-400">{l.contact}</span>}
                <button aria-label="Delete" type="button" onClick={() => lensRun('film-studios', 'location-delete', { id: l.id }).then(refresh)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tasks */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CheckSquare className="w-3.5 h-3.5 text-fuchsia-400" /> Production tasks
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Task" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} className={inp} />
          <input placeholder="Department" value={taskForm.department} onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value })} className={inp} />
          <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className={inp} />
          <button type="button" onClick={addTask} className={btn}><Plus className="w-3.5 h-3.5" /> Task</button>
        </div>
        {tasks.length === 0 ? <Empty text="No tasks." /> : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <button type="button" onClick={() => cycleTask(t)}
                  className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded',
                    t.status === 'done' ? 'bg-emerald-900 text-emerald-300'
                      : t.status === 'in_progress' ? 'bg-amber-900 text-amber-300' : 'bg-zinc-800 text-zinc-400')}>
                  {t.status.replace(/_/g, ' ')}
                </button>
                <span className="text-xs text-zinc-100 flex-1">{t.title}</span>
                <span className="text-[10px] text-zinc-400">{t.department}{t.dueDate && ` · ${t.dueDate}`}</span>
                <button aria-label="Delete" type="button" onClick={() => lensRun('film-studios', 'task-delete', { id: t.id }).then(refresh)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Calendar */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <CalendarDays className="w-3.5 h-3.5 text-fuchsia-400" /> Production calendar
          </h3>
          <div className="flex items-center gap-2">
            <button aria-label="Previous" type="button" onClick={() => shiftMonth(-1)} className="text-zinc-400 hover:text-zinc-200"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-[11px] text-zinc-300">{MONTHS[month - 1]} {year}</span>
            <button aria-label="Next" type="button" onClick={() => shiftMonth(1)} className="text-zinc-400 hover:text-zinc-200"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = String(i + 1).padStart(2, '0');
            const items = cal[d] || [];
            return (
              <div key={d} className={cn('min-h-[44px] rounded border p-1',
                items.length ? 'border-fuchsia-900/50 bg-fuchsia-950/20' : 'border-zinc-800 bg-zinc-900/40')}>
                <p className="text-[9px] text-zinc-400">{i + 1}</p>
                {items.slice(0, 2).map((it, j) => (
                  <p key={j} className={cn('text-[8px] truncate', it.type === 'shoot_day' ? 'text-fuchsia-300' : 'text-zinc-400')}>
                    {it.label}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {/* DOOD */}
      {dood && dood.rows.length > 0 && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Grid3x3 className="w-3.5 h-3.5 text-fuchsia-400" /> Day Out of Days
          </h3>
          <div className="overflow-x-auto">
            <table className="text-[10px]">
              <thead>
                <tr>
                  <th className="text-left text-zinc-400 px-2 py-1">Cast</th>
                  {dood.days.map((d) => <th key={d} className="text-zinc-400 px-1 py-1 w-7">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {dood.rows.map((r) => (
                  <tr key={r.castId}>
                    <td className="text-zinc-200 px-2 py-1 whitespace-nowrap">{r.name}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="px-0.5 py-0.5">
                        {c.code && <span className={cn('block text-center rounded font-bold', CODE_COLOR[c.code])}>{c.code}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-zinc-400 mt-1">S start · W work · H hold · F finish · SWF single day</p>
        </section>
      )}
    </div>
  );
}

const inp = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';
const btn = 'flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg';
function Empty({ text }: { text: string }) { return <p className="text-[11px] text-zinc-400 italic">{text}</p>; }
