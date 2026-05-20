'use client';

/**
 * PjSprintsPanel — sprints/cycles with a burndown chart.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Loader2, Plus, Repeat, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Sprint {
  id: string; name: string; startDate: string; endDate: string; status: string;
  taskCount: number; donePoints: number; totalPoints: number;
}
interface BurndownPoint { day: number; date: string; ideal: number; remaining: number }
interface Burndown { sprint: string; totalPoints: number; donePoints: number; series: BurndownPoint[] }

export function PjSprintsPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [burndown, setBurndown] = useState<Burndown | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'sprint-list', { projectId });
    setSprints(r.data?.result?.sprints || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addSprint = async () => {
    if (!form.name.trim()) { setError('Sprint name is required.'); return; }
    const r = await lensRun('projects', 'sprint-create', {
      projectId, name: form.name.trim(), startDate: form.startDate, endDate: form.endDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', startDate: '', endDate: '' });
    setError(null);
    await refresh();
  };

  const complete = async (id: string) => {
    await lensRun('projects', 'sprint-complete', { id });
    await refresh();
  };

  const showBurndown = async (id: string) => {
    if (burndown && sprints.find((s) => s.name === burndown.sprint)?.id === id) { setBurndown(null); return; }
    const r = await lensRun('projects', 'sprint-burndown', { id });
    setBurndown((r.data?.result as Burndown | null) || null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Sprint name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={addSprint}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Sprint
        </button>
      </section>

      {burndown && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">
            Burndown · {burndown.sprint} <span className="text-zinc-500 font-normal">({burndown.donePoints}/{burndown.totalPoints} pts)</span>
          </h3>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={burndown.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={28} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="ideal" stroke="#52525b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Ideal" />
              <Line type="monotone" dataKey="remaining" stroke="#818cf8" strokeWidth={2} dot={{ r: 2 }} name="Remaining" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {sprints.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No sprints yet.</p>
      ) : (
        <ul className="space-y-2">
          {sprints.map((sp) => (
            <li key={sp.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <Repeat className="w-4 h-4 text-indigo-400 shrink-0" />
                <button type="button" onClick={() => showBurndown(sp.id)} className="flex-1 text-left">
                  <span className="text-sm font-semibold text-zinc-100">{sp.name}</span>
                  <span className="text-[10px] text-zinc-500 ml-2">{sp.startDate} → {sp.endDate}</span>
                </button>
                <span className="text-[11px] text-zinc-400">{sp.donePoints}/{sp.totalPoints} pts</span>
                {sp.status === 'active' ? (
                  <button type="button" onClick={() => complete(sp.id)}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">
                    <CheckCircle2 className="w-3 h-3" /> Complete
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-400 uppercase">completed</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
