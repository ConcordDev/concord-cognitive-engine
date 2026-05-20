'use client';

/**
 * FsBudgetTeamPanel — production budget by department plus cast and crew.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Wallet, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface BudgetLine { id: string; department: string; description: string; estimated: number; actual: number }
interface Budget {
  lines: BudgetLine[];
  byDept: Record<string, { estimated: number; actual: number }>;
  totalEstimated: number; totalActual: number; variance: number;
}
interface CastMember { id: string; name: string; characterName: string | null; role: string; dailyRate: number }
interface CrewMember { id: string; name: string; department: string; position: string | null }

const DEPTS = ['above_the_line', 'production', 'post_production', 'marketing', 'other'];
const CAST_ROLES = ['lead', 'supporting', 'day_player', 'background'];

export function FsBudgetTeamPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [bForm, setBForm] = useState({ department: 'production', description: '', estimated: '', actual: '' });
  const [castForm, setCastForm] = useState({ name: '', characterName: '', role: 'supporting', dailyRate: '' });
  const [crewForm, setCrewForm] = useState({ name: '', department: '', position: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, c, cr] = await Promise.all([
      lensRun('film-studios', 'budget-list', { projectId }),
      lensRun('film-studios', 'cast-list', { projectId }),
      lensRun('film-studios', 'crew-list', { projectId }),
    ]);
    setBudget((b.data?.result as Budget | null) || null);
    setCast(c.data?.result?.members || []);
    setCrew(cr.data?.result?.members || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addLine = async () => {
    if (!bForm.description.trim()) return;
    await lensRun('film-studios', 'budget-line-add', {
      projectId, department: bForm.department, description: bForm.description.trim(),
      estimated: Number(bForm.estimated) || 0, actual: Number(bForm.actual) || 0,
    });
    setBForm({ department: 'production', description: '', estimated: '', actual: '' });
    await refresh();
  };
  const delLine = async (id: string) => { await lensRun('film-studios', 'budget-line-delete', { id }); await refresh(); };

  const addCast = async () => {
    if (!castForm.name.trim()) return;
    await lensRun('film-studios', 'cast-add', {
      projectId, name: castForm.name.trim(), characterName: castForm.characterName.trim(),
      role: castForm.role, dailyRate: Number(castForm.dailyRate) || 0,
    });
    setCastForm({ name: '', characterName: '', role: 'supporting', dailyRate: '' });
    await refresh();
  };
  const delCast = async (id: string) => { await lensRun('film-studios', 'cast-delete', { id }); await refresh(); };

  const addCrew = async () => {
    if (!crewForm.name.trim()) return;
    await lensRun('film-studios', 'crew-add', {
      projectId, name: crewForm.name.trim(), department: crewForm.department.trim(), position: crewForm.position.trim(),
    });
    setCrewForm({ name: '', department: '', position: '' });
    await refresh();
  };
  const delCrew = async (id: string) => { await lensRun('film-studios', 'crew-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Budget */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Wallet className="w-3.5 h-3.5 text-fuchsia-400" /> Budget
          {budget && (
            <span className="text-zinc-500 font-normal">
              · est ${budget.totalEstimated.toLocaleString()} · act ${budget.totalActual.toLocaleString()}
              {budget.variance !== 0 && (
                <span className={budget.variance > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  {' '}({budget.variance > 0 ? '+' : ''}{budget.variance.toLocaleString()})
                </span>
              )}
            </span>
          )}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
          <select value={bForm.department} onChange={(e) => setBForm({ ...bForm, department: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {DEPTS.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Line item" value={bForm.description} onChange={(e) => setBForm({ ...bForm, description: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Estimated" inputMode="numeric" value={bForm.estimated}
            onChange={(e) => setBForm({ ...bForm, estimated: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Actual" inputMode="numeric" value={bForm.actual}
            onChange={(e) => setBForm({ ...bForm, actual: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addLine}
            className="flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Line
          </button>
        </div>
        {budget && budget.lines.length > 0 && (
          <ul className="space-y-1">
            {budget.lines.map((l) => (
              <li key={l.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-[9px] uppercase text-zinc-500 w-20 shrink-0">{l.department.replace(/_/g, ' ')}</span>
                <span className="text-xs text-zinc-200 flex-1 truncate">{l.description}</span>
                <span className="text-[11px] text-zinc-400 font-mono">${l.estimated.toLocaleString()} / ${l.actual.toLocaleString()}</span>
                <button type="button" onClick={() => delLine(l.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cast */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-fuchsia-400" /> Cast
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
          <input placeholder="Actor name" value={castForm.name} onChange={(e) => setCastForm({ ...castForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Character" value={castForm.characterName} onChange={(e) => setCastForm({ ...castForm, characterName: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={castForm.role} onChange={(e) => setCastForm({ ...castForm, role: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {CAST_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Daily rate" inputMode="numeric" value={castForm.dailyRate}
            onChange={(e) => setCastForm({ ...castForm, dailyRate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addCast}
            className="flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Cast
          </button>
        </div>
        {cast.length > 0 && (
          <ul className="space-y-1">
            {cast.map((c) => (
              <li key={c.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-100 flex-1">
                  {c.name}{c.characterName && <span className="text-zinc-400"> as {c.characterName}</span>}
                </span>
                <span className="text-[9px] uppercase text-fuchsia-400">{c.role.replace(/_/g, ' ')}</span>
                {c.dailyRate > 0 && <span className="text-[10px] text-zinc-500">${c.dailyRate}/day</span>}
                <button type="button" onClick={() => delCast(c.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Crew */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-fuchsia-400" /> Crew
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Name" value={crewForm.name} onChange={(e) => setCrewForm({ ...crewForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Department" value={crewForm.department} onChange={(e) => setCrewForm({ ...crewForm, department: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Position" value={crewForm.position} onChange={(e) => setCrewForm({ ...crewForm, position: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addCrew}
            className="flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Crew
          </button>
        </div>
        {crew.length > 0 && (
          <ul className="space-y-1">
            {crew.map((c) => (
              <li key={c.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-100 flex-1">{c.name}</span>
                <span className="text-[10px] text-zinc-400">{c.position || c.department}</span>
                <button type="button" onClick={() => delCrew(c.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
