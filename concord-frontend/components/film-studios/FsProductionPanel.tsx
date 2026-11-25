'use client';

/**
 * FsProductionPanel — locations database, production tasks, the
 * production calendar and the Day Out of Days report.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, MapPin, CheckSquare, CalendarDays, Grid3x3, ChevronLeft, ChevronRight, Pencil, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface Location { id: string; name: string; address: string | null; contact: string | null }
interface Task { id: string; title: string; department: string; assignee: string | null; dueDate: string | null; status: string }
interface CalDay { type: string; label: string; status?: string }
interface DoodRow { castId: string; name: string; character: string | null; workDays: number; cells: { day: number; code: string }[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CODE_COLOR: Record<string, string> = {
  S: 'bg-emerald-700 text-white', W: 'bg-[#b72d23] text-white',
  H: 'bg-[var(--fo-rule,#3f3f46)] text-[var(--fo-ink-2,#d4d4d8)]', F: 'bg-amber-700 text-white', SWF: 'bg-sky-700 text-white',
};

export function FsProductionPanel({ projectId }: { projectId: string }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dood, setDood] = useState<{ days: number[]; rows: DoodRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locForm, setLocForm] = useState({ name: '', address: '', contact: '' });
  const [editingLoc, setEditingLoc] = useState<string | null>(null);
  const [editLocForm, setEditLocForm] = useState({ name: '', address: '', contact: '' });
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
    if (l.data?.ok === false || t.data?.ok === false || d.data?.ok === false) {
      setLoadError(l.data?.error || t.data?.error || d.data?.error || 'Could not load production data.');
      setLoading(false);
      return;
    }
    setLoadError(null);
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
  const startEditLoc = (l: Location) => {
    setEditingLoc(l.id);
    setEditLocForm({ name: l.name, address: l.address || '', contact: l.contact || '' });
  };
  const saveEditLoc = async (id: string) => {
    await lensRun('film-studios', 'location-update', { id, ...editLocForm });
    setEditingLoc(null);
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
    return <div className="flex items-center justify-center py-10 text-[var(--fo-muted,#a1a1aa)]"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Locations */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
          <MapPin className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Locations
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
              <li key={l.id} className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg px-3 py-1.5">
                {editingLoc === l.id ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 items-center">
                    <input placeholder="Name" value={editLocForm.name} onChange={(e) => setEditLocForm({ ...editLocForm, name: e.target.value })} className={inp} />
                    <input placeholder="Address" value={editLocForm.address} onChange={(e) => setEditLocForm({ ...editLocForm, address: e.target.value })} className={inp} />
                    <input placeholder="Contact" value={editLocForm.contact} onChange={(e) => setEditLocForm({ ...editLocForm, contact: e.target.value })} className={inp} />
                    <div className="flex items-center gap-1.5">
                      <button aria-label="Save" type="button" onClick={() => saveEditLoc(l.id)} className="text-[var(--fo-good,#34d399)] hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                      <button aria-label="Cancel" type="button" onClick={() => setEditingLoc(null)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-ink,#e4e4e7)]"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--fo-ink,#f4f4f5)] flex-1">{l.name}
                      {l.address && <span className="text-[var(--fo-muted,#a1a1aa)]"> · {l.address}</span>}</span>
                    {l.contact && <span className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">{l.contact}</span>}
                    <button aria-label="Edit" type="button" onClick={() => startEditLoc(l)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-tape,#e879f9)]"><Pencil className="w-3.5 h-3.5" /></button>
                    <button aria-label="Delete" type="button" onClick={() => lensRun('film-studios', 'location-delete', { id: l.id }).then(refresh)}
                      className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tasks */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
          <CheckSquare className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Production tasks
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
              <li key={t.id} className="flex items-center gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg px-3 py-1.5">
                <button type="button" onClick={() => cycleTask(t)}
                  className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded',
                    t.status === 'done' ? 'bg-emerald-900 text-emerald-300'
                      : t.status === 'in_progress' ? 'bg-amber-900 text-amber-300' : 'bg-[var(--fo-paper-2,#27272a)] text-[var(--fo-muted,#a1a1aa)]')}>
                  {t.status.replace(/_/g, ' ')}
                </button>
                <span className="text-xs text-[var(--fo-ink,#f4f4f5)] flex-1">{t.title}</span>
                <span className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">{t.department}{t.dueDate && ` · ${t.dueDate}`}</span>
                <button aria-label="Delete" type="button" onClick={() => lensRun('film-studios', 'task-delete', { id: t.id }).then(refresh)}
                  className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Calendar */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)]">
            <CalendarDays className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Production calendar
          </h3>
          <div className="flex items-center gap-2">
            <button aria-label="Previous" type="button" onClick={() => shiftMonth(-1)} className="text-[var(--fo-muted,#a1a1aa)] hover:text-[var(--fo-ink,#e4e4e7)]"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-[11px] text-[var(--fo-ink-2,#d4d4d8)]">{MONTHS[month - 1]} {year}</span>
            <button aria-label="Next" type="button" onClick={() => shiftMonth(1)} className="text-[var(--fo-muted,#a1a1aa)] hover:text-[var(--fo-ink,#e4e4e7)]"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = String(i + 1).padStart(2, '0');
            const items = cal[d] || [];
            return (
              <div key={d} className={cn('min-h-[44px] rounded border p-1',
                items.length ? 'border-[rgba(214,58,47,0.35)] bg-[rgba(214,58,47,0.06)]' : 'border-[var(--fo-rule,#27272a)] bg-[var(--fo-paper-2,rgba(24,24,27,0.7))]')}>
                <p className="text-[9px] text-[var(--fo-muted,#a1a1aa)]">{i + 1}</p>
                {items.slice(0, 2).map((it, j) => (
                  <p key={j} className={cn('text-[8px] truncate', it.type === 'shoot_day' ? 'text-[var(--fo-tape,#e879f9)]' : 'text-[var(--fo-muted,#a1a1aa)]')}>
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
          <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
            <Grid3x3 className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Day Out of Days
          </h3>
          <div className="overflow-x-auto">
            <table className="text-[10px]">
              <thead>
                <tr>
                  <th className="text-left text-[var(--fo-muted,#a1a1aa)] px-2 py-1">Cast</th>
                  {dood.days.map((d) => <th key={d} className="text-[var(--fo-muted,#a1a1aa)] px-1 py-1 w-7">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {dood.rows.map((r) => (
                  <tr key={r.castId}>
                    <td className="text-[var(--fo-ink,#e4e4e7)] px-2 py-1 whitespace-nowrap">{r.name}</td>
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
          <p className="text-[9px] text-[var(--fo-muted,#a1a1aa)] mt-1">S start · W work · H hold · F finish · SWF single day</p>
        </section>
      )}
    </div>
  );
}

const inp = 'bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]';
const btn = 'flex items-center justify-center gap-1 bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white text-xs font-medium rounded-lg';
function Empty({ text }: { text: string }) { return <p className="text-[11px] text-[var(--fo-muted,#a1a1aa)] italic">{text}</p>; }
