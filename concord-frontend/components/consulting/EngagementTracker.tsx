'use client';

/**
 * EngagementTracker — a consulting-engagement workbench: track client
 * engagements with rates and hour budgets, log billable time, and view
 * a utilization dashboard. Wires the consulting.engagement-* / time-log
 * / consulting-dashboard macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Briefcase, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface TimeEntry { id: string; hours: number; note: string; date: string }
interface Engagement { id: string; name: string; client: string; rate: number; budgetHours: number; status: string; timeEntries: TimeEntry[]; loggedHours: number; billed: number; utilizationPct: number }
interface Dash { engagements: number; active: number; loggedHours: number; billed: number }

export function EngagementTracker() {
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', client: '', rate: '', budgetHours: '' });
  const [timeForm, setTimeForm] = useState({ hours: '', note: '' });

  const refresh = useCallback(async () => {
    const [el, d] = await Promise.all([
      lensRun('consulting', 'engagement-list', {}),
      lensRun('consulting', 'consulting-dashboard', {}),
    ]);
    setEngs((el.data?.result?.engagements as Engagement[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addEng() {
    if (!form.name.trim()) return;
    await lensRun('consulting', 'engagement-create', {
      name: form.name.trim(), client: form.client.trim(),
      rate: form.rate ? Number(form.rate) : 0, budgetHours: form.budgetHours ? Number(form.budgetHours) : 0,
    });
    setForm({ name: '', client: '', rate: '', budgetHours: '' });
    await refresh();
  }
  async function delEng(id: string) {
    await lensRun('consulting', 'engagement-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  async function logTime(engagementId: string) {
    if (!timeForm.hours) return;
    await lensRun('consulting', 'time-log', { engagementId, hours: Number(timeForm.hours), note: timeForm.note.trim() });
    setTimeForm({ hours: '', note: '' });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Briefcase className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-bold text-zinc-100">Engagement Tracker</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Engagements', dash.engagements], ['Active', dash.active], ['Hours', dash.loggedHours], ['Billed', `$${dash.billed.toLocaleString()}`]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Engagement"
          className="flex-1 min-w-[110px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} placeholder="client"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder="$/hr"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.budgetHours} onChange={e => setForm({ ...form, budgetHours: e.target.value })} placeholder="budget h"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={addEng} disabled={!form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40">Add</button>
      </div>

      <ul className="space-y-1">
        {engs.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No engagements yet.</li>}
        {engs.map(e => (
          <li key={e.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <button onClick={() => setActive(active === e.id ? null : e.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{e.name}</p>
                <p className="text-[10px] text-zinc-400">{e.client} · {e.loggedHours}h logged · ${e.billed.toLocaleString()} billed · {e.utilizationPct}% of budget · {e.status}</p>
              </button>
              <button aria-label="Delete" onClick={() => delEng(e.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {active === e.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800">
                {e.timeEntries.map(t => (
                  <p key={t.id} className="text-[11px] text-zinc-400"><span className="text-indigo-400">{t.hours}h</span> · {t.date}{t.note ? ` — ${t.note}` : ''}</p>
                ))}
                <div className="flex gap-1 mt-1">
                  <input value={timeForm.hours} onChange={e2 => setTimeForm({ ...timeForm, hours: e2.target.value })} placeholder="hours"
                    className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <input value={timeForm.note} onChange={e2 => setTimeForm({ ...timeForm, note: e2.target.value })} placeholder="note"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <button onClick={() => logTime(e.id)} className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
                    <Plus className="w-3 h-3" />Log
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
