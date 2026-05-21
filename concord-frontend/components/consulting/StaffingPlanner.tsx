'use client';

/**
 * StaffingPlanner — manage consultants and allocate their hours across
 * engagements per week, flagging overbooking. Wires
 * consulting.consultant-create / consultant-delete / allocation-create /
 * allocation-delete / staffing-plan.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, Loader2, Trash2, Plus, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface WeekRow { week: string; hours: number; capacity: number; utilizationPct: number; overbooked: boolean }
interface PlanRow { consultantId: string; name: string; role: string; weeklyCapacity: number; byWeek: WeekRow[] }
interface Allocation { id: string; consultantId: string; engagementId: string; week: string; hours: number; consultantName: string; engagementName: string }
interface EngagementOption { id: string; name: string }

export function StaffingPlanner({ engagements }: { engagements: EngagementOption[] }) {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [cForm, setCForm] = useState({ name: '', role: '', weeklyCapacity: '', costRate: '' });
  const [aForm, setAForm] = useState({ consultantId: '', engagementId: '', week: '', hours: '' });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('consulting', 'staffing-plan', {});
    const res = r.data?.result as { rows?: PlanRow[]; allocations?: Allocation[] } | null;
    setRows(res?.rows || []);
    setAllocations(res?.allocations || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addConsultant() {
    if (!cForm.name.trim()) return;
    await lensRun('consulting', 'consultant-create', {
      name: cForm.name.trim(), role: cForm.role.trim(),
      weeklyCapacity: cForm.weeklyCapacity ? Number(cForm.weeklyCapacity) : 40,
      costRate: cForm.costRate ? Number(cForm.costRate) : 0,
    });
    setCForm({ name: '', role: '', weeklyCapacity: '', costRate: '' });
    await refresh();
  }
  async function delConsultant(id: string) {
    await lensRun('consulting', 'consultant-delete', { id });
    await refresh();
  }
  async function addAllocation() {
    setError('');
    if (!aForm.consultantId || !aForm.engagementId || !aForm.week.trim() || !aForm.hours) {
      setError('All allocation fields are required'); return;
    }
    const r = await lensRun('consulting', 'allocation-create', {
      consultantId: aForm.consultantId, engagementId: aForm.engagementId,
      week: aForm.week.trim(), hours: Number(aForm.hours),
    });
    if (!r.data?.ok) { setError(r.data?.error || 'Allocation failed'); return; }
    setAForm({ consultantId: '', engagementId: '', week: '', hours: '' });
    await refresh();
  }
  async function delAllocation(id: string) {
    await lensRun('consulting', 'allocation-delete', { id });
    await refresh();
  }

  if (loading) return <div className="flex justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  // Build a per-week chart: one row per week, one series column per consultant.
  const weekSet = new Set<string>();
  rows.forEach(r => r.byWeek.forEach(w => weekSet.add(w.week)));
  const weeks = Array.from(weekSet).sort();
  const chartData = weeks.map(week => {
    const rec: Record<string, unknown> = { week };
    rows.forEach(r => {
      const w = r.byWeek.find(x => x.week === week);
      rec[r.consultantId] = w ? w.utilizationPct : 0;
    });
    return rec;
  });
  const chartSeries = rows.map(r => ({ key: r.consultantId, label: r.name }));

  return (
    <div className="space-y-3">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex flex-wrap gap-1.5">
        <input value={cForm.name} onChange={e => setCForm({ ...cForm, name: e.target.value })} placeholder="Consultant name"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={cForm.role} onChange={e => setCForm({ ...cForm, role: e.target.value })} placeholder="role"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={cForm.weeklyCapacity} onChange={e => setCForm({ ...cForm, weeklyCapacity: e.target.value })} placeholder="cap h/wk"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={cForm.costRate} onChange={e => setCForm({ ...cForm, costRate: e.target.value })} placeholder="$cost/h"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={addConsultant} disabled={!cForm.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40">Add Consultant</button>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex flex-wrap gap-1.5">
        <select value={aForm.consultantId} onChange={e => setAForm({ ...aForm, consultantId: e.target.value })}
          className="flex-1 min-w-[110px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
          <option value="">Consultant…</option>
          {rows.map(r => <option key={r.consultantId} value={r.consultantId}>{r.name}</option>)}
        </select>
        <select value={aForm.engagementId} onChange={e => setAForm({ ...aForm, engagementId: e.target.value })}
          className="flex-1 min-w-[110px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
          <option value="">Engagement…</option>
          {engagements.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input value={aForm.week} onChange={e => setAForm({ ...aForm, week: e.target.value })} placeholder="2026-W21"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={aForm.hours} onChange={e => setAForm({ ...aForm, hours: e.target.value })} placeholder="hours"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={addAllocation}
          className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Allocate
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      {chartData.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
          <p className="text-[10px] text-zinc-500 uppercase mb-2">Weekly Utilization %</p>
          <ChartKit kind="bar" data={chartData} xKey="week" series={chartSeries} height={160} />
        </div>
      )}

      <div className="space-y-1.5">
        {rows.length === 0 && <p className="text-xs text-zinc-500 italic py-3 text-center">No consultants yet.</p>}
        {rows.map(row => (
          <div key={row.consultantId} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{row.name} · <span className="text-zinc-500">{row.role}</span></p>
                <p className="text-[10px] text-zinc-500">{row.weeklyCapacity}h/wk capacity · {row.byWeek.length} weeks planned</p>
              </div>
              <button onClick={() => delConsultant(row.consultantId)} aria-label="Delete consultant"
                className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {row.byWeek.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {row.byWeek.map(w => (
                  <span key={w.week}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${w.overbooked ? 'bg-rose-500/15 text-rose-400' : 'bg-zinc-800 text-zinc-300'}`}>
                    {w.overbooked && <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />}
                    {w.week}: {w.hours}/{w.capacity}h ({w.utilizationPct}%)
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {allocations.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <p className="text-[10px] text-zinc-500 uppercase mb-1.5">Allocations</p>
          <ul className="space-y-1">
            {allocations.map(a => (
              <li key={a.id} className="group flex items-center gap-2 text-[11px] text-zinc-300">
                <span className="flex-1 truncate">{a.consultantName} → {a.engagementName} · {a.week} · {a.hours}h</span>
                <button onClick={() => delAllocation(a.id)} aria-label="Remove allocation"
                  className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
