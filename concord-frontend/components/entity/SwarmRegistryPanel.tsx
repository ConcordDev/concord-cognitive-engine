'use client';

/**
 * SwarmRegistryPanel — the world-model workbench.
 * Left: searchable/filterable/sortable list of real world-model entities with
 * live stats. Right: a permanent inspector (edit, relate, simulate, terminal)
 * or, with nothing selected, whole-world controls. Council approvals for
 * gated terminal commands sit underneath.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import EntityLifecycleViz from '@/components/visualizations/EntityLifecycleViz';
import { EntityInspector } from '@/components/entity/EntityInspector';
import { WorldOverview } from '@/components/entity/WorldOverview';
import {
  COUNCIL_ROLES, ENTITY_TYPES, TYPE_BLURB, TYPE_DOT, pct, riskColors, wm,
  type TerminalProposalSummary, type WorldEntity, type WorldEntitySummary, type WorldEntityType,
} from '@/components/entity/entity-model';

type Sort = 'salience' | 'confidence' | 'relations' | 'newest';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'salience', label: 'Salience' },
  { id: 'confidence', label: 'Confidence' },
  { id: 'relations', label: 'Most connected' },
  { id: 'newest', label: 'Newest' },
];

interface Status {
  entities: number; relations: number; simulations: number; snapshots: number;
}

const toast = (type: 'success' | 'error', message: string) => useUIStore.getState().addToast({ type, message });
const textBtn = 'text-[13px] text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-40';

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#111] px-4 py-3">
      <div className="text-[1.5rem] font-medium leading-none tabular-nums text-zinc-50">{value}</div>
      <div className="mt-1.5 text-[12px] text-zinc-500">{label}</div>
    </div>
  );
}

function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-white/10">
      <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct(value)}%` }} />
    </span>
  );
}

export function SwarmRegistryPanel({ createOpen = false, onCreateClose }: { createOpen?: boolean; onCreateClose?: () => void } = {}) {
  const { user: currentUser, isAuthenticated } = useAuth();
  const isCouncilEligible = isAuthenticated && !!currentUser?.role && COUNCIL_ROLES.has(currentUser.role);
  const qc = useQueryClient();

  const [pickedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<WorldEntityType | 'all'>('all');
  const [sort, setSort] = useState<Sort>('salience');
  const [name, setName] = useState('');
  const [type, setType] = useState<WorldEntityType>('concept');
  const [description, setDescription] = useState('');

  const status = useQuery({ queryKey: ['wm-status'], queryFn: () => wm<Status>('status'), refetchInterval: 15000 });
  const list = useQuery({
    queryKey: ['wm-entities'],
    queryFn: () => wm<{ entities: WorldEntitySummary[]; total: number }>('list_entities', { limit: 500 }),
    refetchInterval: 15000,
  });
  const entities = useMemo(() => list.data?.entities ?? [], [list.data]);
  // A selection whose entity was deleted elsewhere falls back to the overview.
  const selectedId = pickedId && entities.some((e) => e.id === pickedId) ? pickedId : null;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entities) c[e.type] = (c[e.type] || 0) + 1;
    return c;
  }, [entities]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = entities.filter((e) => (typeFilter === 'all' || e.type === typeFilter) && (!q || e.name.toLowerCase().includes(q)));
    const by: Record<Sort, (a: WorldEntitySummary, b: WorldEntitySummary) => number> = {
      salience: (a, b) => b.salience - a.salience,
      confidence: (a, b) => b.confidence - a.confidence,
      relations: (a, b) => b.relationCount - a.relationCount,
      newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    };
    return [...rows].sort(by[sort]);
  }, [entities, search, typeFilter, sort]);

  const refreshAll = () => Promise.all(['wm-entities', 'wm-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  const create = useMutation({
    mutationFn: () => wm<{ entity: WorldEntity }>('create_entity', { name: name.trim(), type, description: description.trim() || undefined }),
    onSuccess: async (r) => {
      toast('success', `Spawned ${r.entity.name}.`);
      setName(''); setDescription(''); onCreateClose?.();
      await refreshAll();
      setSelectedId(r.entity.id);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const fork = useMutation({
    mutationFn: (e: WorldEntity) => wm<{ entity: WorldEntity }>('create_entity', {
      name: `${e.name} (fork)`,
      type: ENTITY_TYPES.includes(e.type as WorldEntityType) ? e.type : 'concept',
      description: e.description || undefined,
      confidence: e.state.confidence,
      salience: e.state.salience,
      volatility: e.state.volatility,
      properties: { ...(e.state.properties || {}), forkedFrom: e.id },
    }),
    onSuccess: async (r) => { toast('success', `Forked into ${r.entity.name}.`); await refreshAll(); setSelectedId(r.entity.id); },
    onError: (e: Error) => toast('error', e.message),
  });

  const { data: pendingApprovals, isLoading: pendingLoading, isError: pendingErrored } = useQuery({
    queryKey: ['entity-terminal-pending'],
    queryFn: () => apiHelpers.lens.runDomain('entity', 'terminal_pending', {}).then((r) => r.data?.result ?? r.data),
    enabled: isCouncilEligible,
    refetchInterval: isCouncilEligible ? 15000 : false,
  });

  const vote = useMutation({
    mutationFn: async (d: { proposalId: string; vote: 'approve' | 'deny' | 'abstain' }) => {
      const res = await apiHelpers.lens.runDomain('entity', 'terminal_approve', d);
      return res.data?.result ?? res.data;
    },
    onSuccess: (data) => {
      if (!data || data.ok === false) { toast('error', data?.error || 'Vote was rejected.'); return; }
      qc.invalidateQueries({ queryKey: ['entity-terminal-pending'] });
      toast('success', data.status === 'pending'
        ? `Vote recorded (${data.votes?.approve ?? 0} approve / ${data.votes?.deny ?? 0} deny / ${data.votes?.abstain ?? 0} abstain).`
        : `Proposal ${data.status}${data.executionResult ? ` — exit ${data.executionResult.exitCode}` : ''}.`);
    },
    onError: (err: Error) => toast('error', err?.message || 'Vote failed to submit.'),
  });

  if (list.isError) {
    return <div className="flex items-center justify-center p-8"><ErrorState error={(list.error as Error)?.message} onRetry={() => list.refetch()} /></div>;
  }

  const pending: TerminalProposalSummary[] = isCouncilEligible && Array.isArray(pendingApprovals?.pending) ? pendingApprovals.pending : [];
  const s = status.data;
  const fieldCls = 'rounded-lg border border-white/10 bg-transparent px-3 py-2 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-teal-400/60';

  return (
    <div className="pb-28">
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Entities" value={s?.entities ?? entities.length} />
        <Stat label="Relations" value={s?.relations ?? '—'} />
        <Stat label="Simulations" value={s?.simulations ?? '—'} />
        <Stat label="Snapshots" value={s?.snapshots ?? '—'} />
      </div>

      {createOpen && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          className="mb-5 rounded-2xl border border-white/10 bg-[#111] p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[14px] font-medium text-zinc-100">Spawn an entity</span>
            <button type="button" onClick={onCreateClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {ENTITY_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} title={TYPE_BLURB[t]}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors', type === t ? 'border-teal-400/60 text-teal-200' : 'border-white/10 text-zinc-400 hover:text-zinc-200')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', TYPE_DOT[t])} />{t}
              </button>
            ))}
          </div>
          <p className="mb-3 text-[12px] text-zinc-500">{TYPE_BLURB[type]}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Supply chain resilience" aria-label="Entity name" className={fieldCls} />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" aria-label="Entity description" className={fieldCls} />
          </div>
          <button type="submit" disabled={!name.trim() || create.isPending} className="mt-3 rounded-full bg-teal-400 px-4 py-1.5 text-[13px] font-medium text-black transition-colors hover:bg-teal-300 disabled:opacity-40">
            {create.isPending ? 'Spawning…' : 'Spawn'}
          </button>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <section aria-label="Entities">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entities" aria-label="Search entities" className={cn(fieldCls, 'w-full pl-9')} />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort entities" className={cn(fieldCls, 'bg-[#111]')}>
              {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(['all', ...ENTITY_TYPES] as const).map((t) => {
              const n = t === 'all' ? entities.length : counts[t] || 0;
              if (t !== 'all' && n === 0 && typeFilter !== t) return null;
              return (
                <button key={t} type="button" onClick={() => setTypeFilter(t)} aria-pressed={typeFilter === t}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors', typeFilter === t ? 'border-teal-400/60 bg-teal-400/10 text-teal-200' : 'border-white/10 text-zinc-400 hover:text-zinc-200')}>
                  {t !== 'all' && <span className={cn('h-1.5 w-1.5 rounded-full', TYPE_DOT[t])} />}{t}<span className="text-zinc-500">{n}</span>
                </button>
              );
            })}
          </div>

          {list.isLoading ? (
            <div className="flex items-center gap-2 text-[14px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading entities…</div>
          ) : entities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
              <p className="text-[15px] text-zinc-300">The world model is empty.</p>
              <p className="mt-1 text-[13px] text-zinc-500">Spawn an entity with the button below, or extract entities from a DTU on the right.</p>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-[14px] text-zinc-500">No entities match that filter.</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((e) => {
                const on = selectedId === e.id;
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => setSelectedId(on ? null : e.id)} aria-current={on ? 'true' : undefined}
                      className={cn('w-full rounded-2xl border bg-[#111] px-4 py-3 text-left transition-colors', on ? 'border-teal-400/50' : 'border-white/10 hover:border-white/25')}>
                      <div className="flex items-center gap-3">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', TYPE_DOT[e.type] || 'bg-zinc-500')} />
                        <span className="min-w-0 flex-1 truncate text-[15px] text-zinc-100">{e.name}</span>
                        <span className="shrink-0 text-[12px] text-zinc-500">{e.type}</span>
                        <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] tabular-nums text-zinc-400" title="Relations">{e.relationCount} rel</span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 gap-4">
                        <div title={`Salience ${pct(e.salience)}%`}><div className="mb-1 text-[11px] text-zinc-500">Salience</div><Bar value={e.salience} tone="bg-teal-400" /></div>
                        <div title={`Confidence ${pct(e.confidence)}%`}><div className="mb-1 text-[11px] text-zinc-500">Confidence</div><Bar value={e.confidence} tone="bg-sky-400" /></div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside aria-label="Inspector" className="self-start overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e0e] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {selectedId ? (
            <EntityInspector
              key={selectedId}
              entityId={selectedId}
              others={entities}
              onSelect={setSelectedId}
              onDeleted={() => setSelectedId(null)}
              onFork={(e) => fork.mutate(e)}
              forking={fork.isPending}
            />
          ) : (
            <WorldOverview entityCount={entities.length} />
          )}
        </aside>
      </div>

      {isCouncilEligible && (
        <section className="mt-8 max-w-3xl">
          <h2 className="mb-3 text-[14px] text-zinc-400">
            Council approvals{pending.length > 0 && <span className="ml-2 text-amber-300">{pending.length} pending</span>}
          </h2>
          {pendingLoading ? (
            <p className="flex items-center gap-2 text-[13px] text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading proposals…</p>
          ) : pendingErrored || pendingApprovals?.ok === false ? (
            <p className="text-[13px] text-red-300">Couldn’t load the approval queue{pendingApprovals?.error ? `: ${pendingApprovals.error}` : '.'}</p>
          ) : pending.length === 0 ? (
            <p className="text-[13px] text-zinc-500">Nothing waiting on a vote.</p>
          ) : (
            <ul className="space-y-3">
              {pending.map((p) => (
                <li key={p.id} className={cn('rounded-2xl border p-3.5', riskColors[p.riskLevel] || 'border-white/10')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] text-zinc-400">{new Date(p.createdAt).toLocaleString()}</p>
                      <code className="break-all font-mono text-[13px] text-zinc-100">{p.command}</code>
                    </div>
                    <span className="shrink-0 text-[12px] uppercase">{p.riskLevel} risk</span>
                  </div>
                  <p className="mt-2 text-[12px] text-zinc-400">
                    {p.votes.approve} approve · {p.votes.deny} deny · {p.votes.abstain} abstain (needs {Math.round(p.threshold * 100)}% of decisive votes, min 3)
                    {p.myVote && <span className="ml-2 text-teal-300">your vote: {p.myVote}</span>}
                  </p>
                  <div className="mt-2 flex gap-5">
                    {(['approve', 'deny', 'abstain'] as const).map((v) => (
                      <button key={v} type="button" disabled={vote.isPending} onClick={() => vote.mutate({ proposalId: p.id, vote: v })} className={textBtn}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {Array.isArray(pendingApprovals?.recentHistory) && pendingApprovals.recentHistory.length > 0 && (
            <details className="mt-3 text-[12px] text-zinc-500">
              <summary className="cursor-pointer hover:text-zinc-300">Recently resolved ({pendingApprovals.recentHistory.length})</summary>
              <div className="mt-2 space-y-1">
                {pendingApprovals.recentHistory.map((p: TerminalProposalSummary) => (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <code className="truncate font-mono">{p.command}</code>
                    <span className={p.status === 'approved' ? 'text-teal-300' : 'text-rose-300'}>{p.status}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {entities.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-[13px] text-zinc-500 hover:text-zinc-300">Lifecycle</summary>
          <div className="mt-3"><EntityLifecycleViz /></div>
        </details>
      )}
    </div>
  );
}
