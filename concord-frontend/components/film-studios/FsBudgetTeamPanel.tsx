'use client';

/**
 * FsBudgetTeamPanel — production budget by department plus cast and crew.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Wallet, Users, BarChart3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface BudgetLine { id: string; department: string; description: string; estimated: number; actual: number }
interface Budget {
  lines: BudgetLine[];
  byDept: Record<string, { estimated: number; actual: number }>;
  totalEstimated: number; totalActual: number; variance: number;
}
interface CostLine {
  id: string; description: string; department: string; estimated: number;
  actual: number; variance: number; variancePct: number; status: string;
}
interface CostReport {
  totalEstimated: number; totalActual: number; variance: number; committed: number;
  spentPct: number; overBudget: boolean;
  byDept: Record<string, { estimated: number; actual: number; variance: number; lineCount: number; overItems: number }>;
  lines: CostLine[]; overrunLines: number; topOverrun: string | null;
}
const STATUS_COLOR: Record<string, string> = {
  over: 'text-[var(--fo-bad,#fb7185)]', under: 'text-[var(--fo-good,#34d399)]',
  on_budget: 'text-[var(--fo-muted,#a1a1aa)]', pending: 'text-amber-400',
};
interface CastMember { id: string; name: string; characterName: string | null; role: string; dailyRate: number }
interface CrewMember { id: string; name: string; department: string; position: string | null }

const DEPTS = ['above_the_line', 'production', 'post_production', 'marketing', 'other'];
const CAST_ROLES = ['lead', 'supporting', 'day_player', 'background'];

export function FsBudgetTeamPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [cost, setCost] = useState<CostReport | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCost, setShowCost] = useState(false);
  const [bForm, setBForm] = useState({ department: 'production', description: '', estimated: '', actual: '' });
  const [castForm, setCastForm] = useState({ name: '', characterName: '', role: 'supporting', dailyRate: '' });
  const [crewForm, setCrewForm] = useState({ name: '', department: '', position: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, ct, c, cr] = await Promise.all([
      lensRun('film-studios', 'budget-list', { projectId }),
      lensRun('film-studios', 'cost-report', { projectId }),
      lensRun('film-studios', 'cast-list', { projectId }),
      lensRun('film-studios', 'crew-list', { projectId }),
    ]);
    const failed = [b, ct, c, cr].find((x) => x.data?.ok === false);
    if (failed) {
      setLoadError(failed.data?.error || 'Could not load budget & team data.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setBudget((b.data?.result as Budget | null) || null);
    setCost((ct.data?.result as CostReport | null) || null);
    setCast(c.data?.result?.members || []);
    setCrew(cr.data?.result?.members || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  // Inline actuals tracking — commit the actual spend on a line.
  const updateActual = async (id: string, actual: number) => {
    await lensRun('film-studios', 'budget-line-update', { id, actual: Math.max(0, actual) });
    await refresh();
  };

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
    return <div className="flex items-center justify-center py-10 text-[var(--fo-muted,#a1a1aa)]"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Budget */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
          <Wallet className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Budget
          {budget && (
            <span className="text-[var(--fo-muted,#a1a1aa)] font-normal">
              · est ${budget.totalEstimated.toLocaleString()} · act ${budget.totalActual.toLocaleString()}
              {budget.variance !== 0 && (
                <span className={budget.variance > 0 ? 'text-[var(--fo-bad,#fb7185)]' : 'text-[var(--fo-good,#34d399)]'}>
                  {' '}({budget.variance > 0 ? '+' : ''}{budget.variance.toLocaleString()})
                </span>
              )}
            </span>
          )}
          <button type="button" onClick={() => setShowCost((v) => !v)}
            className="ml-auto flex items-center gap-1 text-[10px] bg-[var(--fo-paper-2,#27272a)] hover:bg-[var(--fo-rule,#3f3f46)] text-[var(--fo-ink,#e4e4e7)] px-2 py-0.5 rounded">
            <BarChart3 className="w-3 h-3" /> {showCost ? 'Hide' : 'Cost report'}
          </button>
        </h3>

        {/* Cost report — actuals vs estimate, overruns */}
        {showCost && cost && (
          <div className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-xl p-3 mb-2 space-y-2">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <CostStat label="Estimated" value={`$${cost.totalEstimated.toLocaleString()}`} />
              <CostStat label="Actual" value={`$${cost.totalActual.toLocaleString()}`} />
              <CostStat label="Variance" value={`${cost.variance >= 0 ? '+' : ''}$${cost.variance.toLocaleString()}`}
                accent={cost.overBudget ? 'text-[var(--fo-bad,#fb7185)]' : 'text-[var(--fo-good,#34d399)]'} />
              <CostStat label="Spent" value={`${cost.spentPct}%`} />
              <CostStat label="Overruns" value={cost.overrunLines} accent={cost.overrunLines > 0 ? 'text-[var(--fo-bad,#fb7185)]' : 'text-[var(--fo-ink,#f4f4f5)]'} />
            </div>
            {cost.topOverrun && (
              <p className="text-[10px] text-[var(--fo-bad,#fb7185)]">Biggest overrun: {cost.topOverrun}</p>
            )}
            {cost.lines.length > 0 && (
              <ul className="space-y-0.5">
                {cost.lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-[11px]">
                    <span className="text-[var(--fo-ink,#e4e4e7)] flex-1 truncate">{l.description}</span>
                    <span className="font-mono text-[var(--fo-muted,#a1a1aa)]">${l.estimated.toLocaleString()} → ${l.actual.toLocaleString()}</span>
                    <span className={cn('font-mono w-24 text-right', STATUS_COLOR[l.status] || 'text-[var(--fo-muted,#a1a1aa)]')}>
                      {l.variance >= 0 ? '+' : ''}${l.variance.toLocaleString()}
                      {l.variancePct !== 0 && <span className="text-[var(--fo-faint,#52525b)]"> ({l.variancePct}%)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
          <select value={bForm.department} onChange={(e) => setBForm({ ...bForm, department: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]">
            {DEPTS.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Line item" value={bForm.description} onChange={(e) => setBForm({ ...bForm, description: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Estimated" inputMode="numeric" value={bForm.estimated}
            onChange={(e) => setBForm({ ...bForm, estimated: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Actual" inputMode="numeric" value={bForm.actual}
            onChange={(e) => setBForm({ ...bForm, actual: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <button type="button" onClick={addLine}
            className="flex items-center justify-center gap-1 bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Line
          </button>
        </div>
        {budget && budget.lines.length > 0 && (
          <ul className="space-y-1">
            {budget.lines.map((l) => (
              <li key={l.id} className="flex items-center gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg px-3 py-1.5">
                <span className="text-[9px] uppercase text-[var(--fo-muted,#a1a1aa)] w-20 shrink-0">{l.department.replace(/_/g, ' ')}</span>
                <span className="text-xs text-[var(--fo-ink,#e4e4e7)] flex-1 truncate">{l.description}</span>
                <span className="text-[11px] text-[var(--fo-muted,#a1a1aa)] font-mono">est ${l.estimated.toLocaleString()}</span>
                <label className="flex items-center gap-1">
                  <span className="text-[9px] text-[var(--fo-muted,#a1a1aa)] uppercase">act</span>
                  <input inputMode="numeric" defaultValue={String(l.actual)}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== l.actual) updateActual(l.id, v); }}
                    className={cn('w-20 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1.5 py-0.5 text-[11px] font-mono',
                      l.actual > l.estimated ? 'text-rose-300' : l.actual > 0 ? 'text-emerald-300' : 'text-[var(--fo-ink-2,#d4d4d8)]')} />
                </label>
                <button aria-label="Delete" type="button" onClick={() => delLine(l.id)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cast */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
          <Users className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Cast
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
          <input placeholder="Actor name" value={castForm.name} onChange={(e) => setCastForm({ ...castForm, name: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Character" value={castForm.characterName} onChange={(e) => setCastForm({ ...castForm, characterName: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <select value={castForm.role} onChange={(e) => setCastForm({ ...castForm, role: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]">
            {CAST_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Daily rate" inputMode="numeric" value={castForm.dailyRate}
            onChange={(e) => setCastForm({ ...castForm, dailyRate: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <button type="button" onClick={addCast}
            className="flex items-center justify-center gap-1 bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Cast
          </button>
        </div>
        {cast.length > 0 && (
          <ul className="space-y-1">
            {cast.map((c) => (
              <li key={c.id} className="flex items-center gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg px-3 py-1.5">
                <span className="text-xs text-[var(--fo-ink,#f4f4f5)] flex-1">
                  {c.name}{c.characterName && <span className="text-[var(--fo-muted,#a1a1aa)]"> as {c.characterName}</span>}
                </span>
                <span className="text-[9px] uppercase text-[var(--fo-tape,#e879f9)]">{c.role.replace(/_/g, ' ')}</span>
                {c.dailyRate > 0 && <span className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">${c.dailyRate}/day</span>}
                <button aria-label="Delete" type="button" onClick={() => delCast(c.id)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Crew */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
          <Users className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Crew
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Name" value={crewForm.name} onChange={(e) => setCrewForm({ ...crewForm, name: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Department" value={crewForm.department} onChange={(e) => setCrewForm({ ...crewForm, department: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Position" value={crewForm.position} onChange={(e) => setCrewForm({ ...crewForm, position: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <button type="button" onClick={addCrew}
            className="flex items-center justify-center gap-1 bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Crew
          </button>
        </div>
        {crew.length > 0 && (
          <ul className="space-y-1">
            {crew.map((c) => (
              <li key={c.id} className="flex items-center gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg px-3 py-1.5">
                <span className="text-xs text-[var(--fo-ink,#f4f4f5)] flex-1">{c.name}</span>
                <span className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">{c.position || c.department}</span>
                <button aria-label="Delete" type="button" onClick={() => delCrew(c.id)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]">
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

function CostStat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-[var(--fo-paper-2,rgba(9,9,11,0.6))] border border-[var(--fo-rule,#27272a)] rounded-lg p-1.5 text-center">
      <p className={cn('text-sm font-bold', accent || 'text-[var(--fo-ink,#f4f4f5)]')}>{value}</p>
      <p className="text-[9px] text-[var(--fo-muted,#a1a1aa)] uppercase tracking-wide">{label}</p>
    </div>
  );
}
