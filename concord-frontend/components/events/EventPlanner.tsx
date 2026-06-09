'use client';

/**
 * EventPlanner — an event-management workbench: plan events with a
 * budget, planning-task checklist and vendor roster. Wires the
 * events.event-*, events.task-* and events.vendor-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarHeart, Plus, Trash2, Check, Loader2, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Task { id: string; title: string; dueDate: string | null; done: boolean }
interface Vendor { id: string; name: string; role: string; cost: number; booked: boolean }
interface EventMeta { id: string; name: string; type: string; date: string | null; venue: string | null; budget: number; status: string; taskCount: number; doneTaskCount: number; vendorCost: number }
interface EventFull { id: string; name: string; type: string; date: string | null; venue: string | null; budget: number; guestCount: number; status: string; tasks: Task[]; vendors: Vendor[] }
interface Dash { totalEvents: number; upcoming: number; totalBudget: number; openTasks: number }

const TYPES = ['conference', 'wedding', 'concert', 'festival', 'corporate', 'social'];
const STATUSES = ['planning', 'confirmed', 'complete', 'cancelled'];

export function EventPlanner() {
  const [events, setEvents] = useState<EventMeta[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<EventFull | null>(null);
  const [budgetRemaining, setBudgetRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', type: 'social', date: '', budget: '' });
  const [taskTitle, setTaskTitle] = useState('');
  const [vendor, setVendor] = useState({ name: '', role: '', cost: '' });

  const refresh = useCallback(async () => {
    const [el, d] = await Promise.all([
      lensRun('events', 'event-list', {}),
      lensRun('events', 'events-dashboard', {}),
    ]);
    setEvents((el.data?.result?.events as EventMeta[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('events', 'event-detail', { id });
    if (r.data?.ok) { setActive(r.data.result?.event as EventFull); setBudgetRemaining(r.data.result?.budgetRemaining ?? 0); }
  }, []);
  async function reload() { if (active) await open(active.id); }

  async function create() {
    if (!form.name.trim()) return;
    const r = await lensRun('events', 'event-create', {
      name: form.name.trim(), type: form.type, date: form.date, budget: form.budget ? Number(form.budget) : 0,
    });
    setForm({ name: '', type: 'social', date: '', budget: '' });
    await refresh();
    if (r.data?.ok) await open(r.data.result?.event.id);
  }
  async function del(id: string) {
    if (!confirm('Delete this event?')) return;
    await lensRun('events', 'event-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function setStatus(status: string) {
    if (!active) return;
    await lensRun('events', 'event-update', { id: active.id, status });
    await reload(); await refresh();
  }
  async function addTask() {
    if (!active || !taskTitle.trim()) return;
    await lensRun('events', 'task-add', { eventId: active.id, title: taskTitle.trim() });
    setTaskTitle('');
    await reload(); await refresh();
  }
  async function toggleTask(taskId: string) {
    if (!active) return;
    await lensRun('events', 'task-toggle', { eventId: active.id, taskId });
    await reload(); await refresh();
  }
  async function delTask(taskId: string) {
    if (!active) return;
    await lensRun('events', 'task-delete', { eventId: active.id, taskId });
    await reload(); await refresh();
  }
  async function addVendor() {
    if (!active || !vendor.name.trim()) return;
    await lensRun('events', 'vendor-add', { eventId: active.id, name: vendor.name.trim(), role: vendor.role.trim(), cost: vendor.cost ? Number(vendor.cost) : 0 });
    setVendor({ name: '', role: '', cost: '' });
    await reload();
  }
  async function delVendor(vendorId: string) {
    if (!active) return;
    await lensRun('events', 'vendor-remove', { eventId: active.id, vendorId });
    await reload();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarHeart className="w-4 h-4 text-pink-400" />
        <h3 className="text-sm font-bold text-zinc-100">Event Planner</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Events', dash.totalEvents], ['Upcoming', dash.upcoming], ['Budget', `$${dash.totalBudget.toLocaleString()}`], ['Open tasks', dash.openTasks]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Event name"
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 capitalize">
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} placeholder="budget"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={create} disabled={!form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-pink-600 hover:bg-pink-500 text-white font-semibold disabled:opacity-40">Add event</button>
      </div>

      <div className="grid sm:grid-cols-[200px_1fr] gap-3">
        <ul className="space-y-1">
          {events.map(e => (
            <li key={e.id} className="group flex items-center gap-1">
              <button onClick={() => open(e.id)}
                className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active?.id === e.id ? 'bg-pink-600/15 border-pink-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                <p className="text-xs font-semibold text-zinc-100 truncate">{e.name}</p>
                <p className="text-[10px] text-zinc-400 capitalize">{e.type}{e.date ? ` · ${e.date}` : ''} · {e.doneTaskCount}/{e.taskCount} tasks</p>
              </button>
              <button aria-label="Delete" onClick={() => del(e.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>

        {active ? (
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-zinc-100 truncate">{active.name}</h4>
                <p className="text-[11px] text-zinc-400">
                  {active.venue || 'No venue'} · ${active.budget.toLocaleString()} budget · ${budgetRemaining.toLocaleString()} left
                </p>
              </div>
              <select value={active.status} onChange={e => setStatus(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200">
                {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>

            {/* Tasks */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Planning checklist</p>
              {active.tasks.map(t => (
                <div key={t.id} className="group flex items-center gap-2 text-xs py-0.5">
                  <button onClick={() => toggleTask(t.id)}
                    className={cn('w-4 h-4 rounded flex items-center justify-center shrink-0', t.done ? 'bg-emerald-600 text-white' : 'border border-zinc-600')}>
                    {t.done && <Check className="w-3 h-3" />}
                  </button>
                  <span className={cn('flex-1', t.done ? 'text-zinc-400 line-through' : 'text-zinc-200')}>{t.title}</span>
                  <button aria-label="Delete" onClick={() => delTask(t.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              <div className="flex gap-1 mt-1">
                <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addTask(); }}
                  placeholder="+ task" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                <button aria-label="Add" onClick={addTask} className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><Plus className="w-3 h-3" /></button>
              </div>
            </div>

            {/* Vendors */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1 inline-flex items-center gap-1"><Users className="w-3 h-3" />Vendors</p>
              {active.vendors.map(v => (
                <div key={v.id} className="group flex items-center gap-2 text-xs py-0.5">
                  <span className="text-zinc-200">{v.name}</span>
                  <span className="text-[10px] text-zinc-400">{v.role}</span>
                  <span className="ml-auto text-zinc-400">${v.cost.toLocaleString()}</span>
                  <button aria-label="Delete" onClick={() => delVendor(v.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              <div className="flex gap-1 mt-1">
                <input value={vendor.name} onChange={e => setVendor({ ...vendor, name: e.target.value })} placeholder="vendor"
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                <input value={vendor.role} onChange={e => setVendor({ ...vendor, role: e.target.value })} placeholder="role"
                  className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                <input value={vendor.cost} onChange={e => setVendor({ ...vendor, cost: e.target.value })} placeholder="$"
                  className="w-14 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                <button aria-label="Add" onClick={addVendor} className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><Plus className="w-3 h-3" /></button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[140px]">
            Select or create an event.
          </div>
        )}
      </div>
    </div>
  );
}
