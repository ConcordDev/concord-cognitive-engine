'use client';

/**
 * PjSprintsPanel — sprints/cycles with a burndown chart.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Plus, Repeat, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SkeletonTableRows, ErrorState } from '@/components/ui';

interface Sprint {
  id: string; name: string; startDate: string; endDate: string; status: string;
  taskCount: number; donePoints: number; totalPoints: number;
}
interface BurndownPoint { day: number; date: string; ideal: number; remaining: number }
interface Burndown { sprint: string; totalPoints: number; donePoints: number; series: BurndownPoint[] }
interface SprintReceipt {
  sprintId: string; sprintName: string; issuesDone: number; issuesTotal: number;
  pointsDone: number; pointsTotal: number; settledInFull: boolean; carriedOver: number;
}

export function PjSprintsPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A14 remainder (R4 re-pass on #1720): the create form opens with
  // the default range VISIBLE (today -> +14d) instead of empty fields
  // whose emptiness the domain silently replaced. What the form shows
  // is what gets created; a field the user clears or leaves half-typed
  // in a split-field date control reads back empty and is called out
  // in words, never substituted behind their back.
  const defaultRange = () => {
    const start = new Date();
    const end = new Date(Date.now() + 14 * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { startDate: iso(start), endDate: iso(end) };
  };
  const [form, setForm] = useState(() => ({ name: '', ...defaultRange() }));
  const [burndown, setBurndown] = useState<Burndown | null>(null);
  const [receipt, setReceipt] = useState<SprintReceipt | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'sprint-list', { projectId });
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load sprints.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setSprints(r.data?.result?.sprints || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addSprint = async () => {
    if (!form.name.trim()) { setError('Sprint name is required.'); return; }
    // F7: a reversed range is rejected here, in words — the domain
    // rejects it too; entered dates are never silently replaced.
    if (!form.startDate || !form.endDate) {
      setError('Both sprint dates are needed — a date field is empty or half-typed. The range was pre-filled with the next two weeks; finish the dates or restore them. No sprint was created.');
      return;
    }
    if (form.endDate < form.startDate) {
      setError('Sprint end date is before its start date — fix the dates; no sprint was created.');
      return;
    }
    const r = await lensRun('projects', 'sprint-create', {
      projectId, name: form.name.trim(), startDate: form.startDate, endDate: form.endDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', ...defaultRange() });
    setError(null);
    await refresh();
  };

  const complete = async (id: string) => {
    // D1/D4: completing a sprint settles it — the domain returns the
    // receipt (the same numbers Reports reconciles from) and keeps a
    // copy on every settled issue's Activity. The card below is the
    // ceremony: it stamps in (≤300 ms, static under reduced motion).
    const r = await lensRun('projects', 'sprint-complete', { id });
    const rc = (r.data?.result as { receipt?: SprintReceipt } | null)?.receipt;
    if (rc && !(r.data as { unchanged?: boolean } | null)?.unchanged) setReceipt(rc);
    await refresh();
  };

  const showBurndown = async (id: string) => {
    if (burndown && sprints.find((s) => s.name === burndown.sprint)?.id === id) { setBurndown(null); return; }
    const r = await lensRun('projects', 'sprint-burndown', { id });
    setBurndown((r.data?.result as Burndown | null) || null);
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="rounded-xl border border-lattice-border bg-lattice-surface/70 overflow-hidden"><SkeletonTableRows rows={4} columns={4} /></div>
      </div>
    );
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-lattice-surface/70 border border-lattice-border rounded-xl p-3">
        <input placeholder="Sprint name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" />
        <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" />
        <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" />
        <button type="button" onClick={addSprint}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Sprint
        </button>
      </section>

      {receipt && (
        <section aria-label={`Receipt for ${receipt.sprintName}`} className="relative overflow-hidden bg-lattice-surface/70 border-2 border-dashed border-emerald-800/70 rounded-xl p-4">
          <style>{'@media (prefers-reduced-motion: no-preference) { @keyframes pj-stamp { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: scale(1); } } }'}</style>
          <div className="flex items-start gap-3" style={{ animation: 'pj-stamp 250ms ease-out' }}>
            <div className="flex-1">
              <p className="text-xs font-semibold text-white">{receipt.sprintName} — settled</p>
              <p className="text-[11px] text-gray-400 tabular-nums mt-0.5">
                {receipt.issuesDone}/{receipt.issuesTotal} issues · {receipt.pointsDone}/{receipt.pointsTotal} points
                {receipt.carriedOver > 0 && <> · {receipt.carriedOver} carried over</>}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">Kept on the Activity feed of every settled issue — and in this project's Activity tab.</p>
            </div>
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-emerald-300 border-2 border-emerald-500/70 rounded px-2 py-1 -rotate-[1.5deg]">
              {receipt.settledInFull ? 'Settled in full' : 'Settled'}
            </span>
            <button type="button" aria-label="Dismiss receipt" onClick={() => setReceipt(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
          </div>
        </section>
      )}

      {burndown && (
        <div className="bg-lattice-surface/70 border border-lattice-border rounded-xl p-3">
          <h3 className="text-xs font-semibold text-gray-300 mb-2">
            Burndown · {burndown.sprint} <span className="text-gray-400 font-normal tabular-nums">({burndown.donePoints}/{burndown.totalPoints} pts)</span>
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
        <p className="text-[11px] text-gray-400 italic py-6 text-center">No sprints yet.</p>
      ) : (
        <ul className="space-y-2">
          {sprints.map((sp) => (
            <li key={sp.id} className="bg-lattice-surface/70 border border-lattice-border rounded-xl p-3">
              <div className="flex items-center gap-2">
                <Repeat className="w-4 h-4 text-indigo-400 shrink-0" />
                <button type="button" onClick={() => showBurndown(sp.id)} className="flex-1 text-left">
                  <span className="text-sm font-semibold text-white">{sp.name}</span>
                  <span className="text-[10px] text-gray-400 ml-2 tabular-nums">{sp.startDate} → {sp.endDate}</span>
                </button>
                <span className="text-[11px] text-gray-400 tabular-nums">{sp.donePoints}/{sp.totalPoints} pts</span>
                {sp.status === 'active' ? (
                  <button type="button" onClick={() => complete(sp.id)}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-lattice-elevated hover:bg-lattice-border text-gray-200 rounded">
                    <CheckCircle2 className="w-3 h-3" /> Complete
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] text-emerald-400 uppercase">completed</span>
                    {sp.totalPoints > 0 && sp.donePoints === sp.totalPoints && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-300 border border-emerald-500/70 rounded px-1.5 py-0.5 -rotate-[1.5deg]">Settled in full.</span>
                    )}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
