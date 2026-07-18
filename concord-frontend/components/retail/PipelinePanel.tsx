'use client';

/**
 * PipelinePanel — the real CRM / sales-pipeline kanban that replaced the
 * removed fake "Pipeline" tab (docs/lens-specs/retail-capability-map.md
 * "Genuinely missing, deferred" #1). Backs onto the persisted
 * retail.deals-* macro family (deals-list / deals-upsert /
 * deals-stage-move / deals-delete) — every number here is server-computed,
 * never client-invented.
 */

import { useEffect, useState } from 'react';
import { Briefcase, Plus, Trash2, RotateCcw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';

type Stage = 'lead' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

interface Deal {
  id: string; name: string; company: string; contactName: string; assignee: string;
  notes: string; value: number; probability: number; stage: Stage;
  expectedCloseDate: string | null;
  stageHistory: Array<{ from: Stage | null; to: Stage; at: string; note?: string; reopened?: boolean }>;
  closedAt: string | null;
}

interface Rollup {
  totalDeals: number; openCount: number;
  totalPipelineValue: number; weightedPipelineValue: number;
  wonCount: number; wonValue: number; lostCount: number; lostValue: number;
  byStage: Record<Stage, { count: number; value: number; weighted: number }>;
}

const OPEN_STAGES: { id: Stage; label: string }[] = [
  { id: 'lead', label: 'Lead' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'negotiation', label: 'Negotiation' },
];
const ALL_STAGES = [...OPEN_STAGES.map((s) => s.id), 'won', 'lost'] as Stage[];

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function PipelinePanel() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', company: '', contactName: '', assignee: '', value: '', probability: '', expectedCloseDate: '' });

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun({ domain: 'retail', action: 'deals-list', input: {} });
    if (r.data?.ok) {
      setDeals((r.data.result?.deals || []) as Deal[]);
      setRollup((r.data.result?.rollup || null) as Rollup | null);
    } else {
      setError(r.data?.error || 'Could not load the pipeline.');
    }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    if (!form.name.trim()) return;
    const input: Record<string, unknown> = {
      name: form.name.trim(),
      company: form.company.trim(),
      contactName: form.contactName.trim(),
      assignee: form.assignee.trim(),
      expectedCloseDate: form.expectedCloseDate || undefined,
    };
    if (form.value.trim() !== '') input.value = Number(form.value);
    if (form.probability.trim() !== '') input.probability = Number(form.probability);
    const r = await lensRun({ domain: 'retail', action: 'deals-upsert', input });
    if (r.data?.ok) {
      setForm({ name: '', company: '', contactName: '', assignee: '', value: '', probability: '', expectedCloseDate: '' });
      setCreating(false);
      await refresh();
    } else {
      setError(r.data?.error || 'Could not create the deal.');
    }
  };

  const moveStage = async (dealId: string, stage: Stage, reopen = false) => {
    setBusyId(dealId);
    const r = await lensRun({ domain: 'retail', action: 'deals-stage-move', input: { id: dealId, stage, reopen: reopen || undefined } });
    setBusyId(null);
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Could not move that deal.');
  };

  const remove = async (dealId: string) => {
    setBusyId(dealId);
    await lensRun({ domain: 'retail', action: 'deals-delete', input: { id: dealId } });
    setBusyId(null);
    await refresh();
  };

  const dealsByStage = (stage: Stage) => deals.filter((d) => d.stage === stage);

  return (
    <div className="bg-lattice-deep border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Briefcase className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Pipeline</span>
        <span className="ml-auto text-[10px] text-gray-400">{deals.length} deal{deals.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-label="New deal"
          className="p-1 text-gray-400 hover:text-white"
        >
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {rollup && (
        <div className="px-3 py-2 border-b border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Open pipeline</div>
            <div className="text-sm font-mono tabular-nums text-white">{money(rollup.totalPipelineValue)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Weighted</div>
            <div className="text-sm font-mono tabular-nums text-emerald-300">{money(rollup.weightedPipelineValue)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Won</div>
            <div className="text-sm font-mono tabular-nums text-emerald-400">{money(rollup.wonValue)} <span className="text-gray-500">({rollup.wonCount})</span></div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Lost</div>
            <div className="text-sm font-mono tabular-nums text-gray-500">{money(rollup.lostValue)} <span className="text-gray-500">({rollup.lostCount})</span></div>
          </div>
        </div>
      )}

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Deal name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Contact" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} placeholder="Assignee" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Value ($)" type="number" min="0" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} placeholder="Probability (%)" type="number" min="0" max="100" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} type="date" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" aria-label="Expected close date" />
          <button type="button" onClick={create} disabled={!form.name.trim()} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40">Add deal</button>
        </div>
      )}

      {error && (
        <div role="alert" className="px-3 py-2 border-b border-rose-900/40 bg-rose-950/30 text-[11px] text-rose-300">{error}</div>
      )}

      {loading ? (
        <div className="flex gap-2 overflow-x-auto p-3" aria-label="Loading pipeline">
          {OPEN_STAGES.map((s) => (
            <div key={s.id} className="flex-shrink-0 w-56 space-y-1.5">
              <Skeleton variant="line" width="60%" />
              <Skeleton variant="block" height="4rem" />
              <Skeleton variant="block" height="4rem" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto p-3">
            {OPEN_STAGES.map((s) => {
              const stageDeals = dealsByStage(s.id);
              const stageRollup = rollup?.byStage[s.id];
              return (
                <div key={s.id} className="flex-shrink-0 w-56 bg-lattice-surface/40 border border-white/5 rounded-md" data-testid={`pipeline-column-${s.id}`}>
                  <div className="px-2 py-1.5 border-b border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-gray-300 font-semibold">{s.label}</div>
                    <div className="text-[10px] text-gray-500">
                      {stageDeals.length} · {money(stageRollup?.value || 0)}
                    </div>
                  </div>
                  <div className="p-1.5 space-y-1.5 min-h-[3rem]">
                    {stageDeals.length === 0 && (
                      <p className="text-[10px] text-gray-600 italic px-1 py-2 text-center">empty</p>
                    )}
                    {stageDeals.map((d) => (
                      <div key={d.id} className="bg-lattice-elevated border border-white/10 rounded p-2 group">
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-xs text-white font-medium truncate">{d.name}</p>
                          <button
                            type="button"
                            onClick={() => remove(d.id)}
                            aria-label={`Delete ${d.name}`}
                            disabled={busyId === d.id}
                            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-rose-400 shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        {d.company && <p className="text-[10px] text-gray-400 truncate">{d.company}</p>}
                        <div className="flex items-center justify-between mt-1 text-[10px]">
                          <span className="font-mono tabular-nums text-gray-300">{money(d.value)}</span>
                          <span className="text-gray-500">{d.probability}%</span>
                        </div>
                        <select
                          value={d.stage}
                          onChange={(e) => moveStage(d.id, e.target.value as Stage)}
                          disabled={busyId === d.id}
                          aria-label={`Move ${d.name} to stage`}
                          className="mt-1.5 w-full text-[10px] bg-lattice-deep border border-lattice-border rounded px-1 py-0.5 text-gray-300"
                        >
                          {ALL_STAGES.map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              className="text-[11px] text-gray-400 hover:text-emerald-300"
            >
              {showClosed ? 'Hide' : 'Show'} won/lost archive ({(rollup?.wonCount || 0) + (rollup?.lostCount || 0)})
            </button>
          </div>

          {showClosed && (
            <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['won', 'lost'] as Stage[]).map((s) => (
                <div key={s} data-testid={`pipeline-archive-${s}`}>
                  <div className={cn('text-[10px] uppercase tracking-wider mb-1', s === 'won' ? 'text-emerald-400' : 'text-gray-500')}>
                    {s} ({dealsByStage(s).length})
                  </div>
                  <div className="space-y-1">
                    {dealsByStage(s).map((d) => (
                      <div key={d.id} className="bg-lattice-elevated border border-white/10 rounded px-2 py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-white truncate">{d.name}</p>
                          <p className="text-[10px] text-gray-500">{money(d.value)}{d.closedAt ? ` · ${new Date(d.closedAt).toLocaleDateString()}` : ''}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => moveStage(d.id, 'lead', true)}
                          disabled={busyId === d.id}
                          aria-label={`Reopen ${d.name}`}
                          className="shrink-0 p-1 text-gray-400 hover:text-emerald-300"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {dealsByStage(s).length === 0 && <p className="text-[10px] text-gray-600 italic">none</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PipelinePanel;
