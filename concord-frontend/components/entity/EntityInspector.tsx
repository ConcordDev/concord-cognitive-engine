'use client';

/**
 * EntityInspector — the permanent right-hand workbench for one world-model
 * entity. Every control maps to a real worldmodel macro: update_entity,
 * delete_entity, get_entity (with relations), create_relation, simulate,
 * counterfactual — plus the council-gated entity.terminal.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Copy, GitFork, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import {
  RELATION_TYPES, TYPE_DOT, pct, wm,
  type SimInsight, type WorldEntity, type WorldEntitySummary, type WorldRelation, type WorldSimulation,
} from '@/components/entity/entity-model';

type Tab = 'overview' | 'relations' | 'simulate' | 'terminal';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'relations', label: 'Relations' },
  { id: 'simulate', label: 'Simulate' },
  { id: 'terminal', label: 'Terminal' },
];

const toast = (type: 'success' | 'error', message: string) => useUIStore.getState().addToast({ type, message });
const fieldCls = 'rounded-lg border border-white/10 bg-transparent px-3 py-2 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-teal-400/60';
const primaryBtn = 'rounded-full bg-teal-400 px-4 py-1.5 text-[13px] font-medium text-black transition-colors hover:bg-teal-300 disabled:opacity-40';
const ghostBtn = 'inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-zinc-300 transition-colors hover:border-white/25 hover:text-zinc-50 disabled:opacity-40';

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[12px] text-zinc-400">
        {label}<span className="tabular-nums text-zinc-200">{pct(value)}%</span>
      </span>
      <input
        type="range" min={0} max={100} value={pct(value)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="mt-1 w-full accent-teal-400"
        aria-label={label}
      />
    </label>
  );
}

function coerce(raw: string): unknown {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  return raw;
}

function Insights({ items }: { items: SimInsight[] }) {
  if (!items.length) return <p className="text-[12px] text-zinc-500">The run finished with no change large enough to report.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((i, k) => (
        <li key={k} className="flex items-start gap-2 text-[13px] text-zinc-300">
          <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', (i.delta ?? 0) < 0 ? 'bg-rose-400' : 'bg-teal-400')} />
          {i.description}
        </li>
      ))}
    </ul>
  );
}

function OverviewTab({ entity, onFork, forking, onDeleted }: { entity: WorldEntity; onFork: () => void; forking: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description || '');
  const [confidence, setConfidence] = useState(entity.state.confidence);
  const [salience, setSalience] = useState(entity.state.salience);
  const [volatility, setVolatility] = useState(entity.state.volatility);
  const [props, setProps] = useState<[string, string][]>(
    Object.entries(entity.state.properties || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    name !== entity.name ||
    description !== (entity.description || '') ||
    confidence !== entity.state.confidence ||
    salience !== entity.state.salience ||
    volatility !== entity.state.volatility ||
    JSON.stringify(props.filter(([k]) => k.trim())) !==
      JSON.stringify(Object.entries(entity.state.properties || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));

  const save = useMutation({
    mutationFn: () => {
      const properties: Record<string, unknown> = {};
      for (const [k, v] of props) if (k.trim()) properties[k.trim()] = coerce(v);
      return wm('update_entity', { entityId: entity.id, name, description, confidence, salience, volatility, properties });
    },
    onSuccess: () => {
      toast('success', 'Entity saved.');
      qc.invalidateQueries({ queryKey: ['wm-entity', entity.id] });
      qc.invalidateQueries({ queryKey: ['wm-entities'] });
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const del = useMutation({
    mutationFn: () => wm('delete_entity', { entityId: entity.id }),
    onSuccess: () => {
      toast('success', `Deleted ${entity.name}.`);
      qc.invalidateQueries({ queryKey: ['wm-entities'] });
      qc.invalidateQueries({ queryKey: ['wm-status'] });
      onDeleted();
    },
    onError: (e: Error) => { setConfirmDelete(false); toast('error', e.message); },
  });

  return (
    <div className="space-y-4">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Entity name" className={cn(fieldCls, 'w-full text-[15px] font-medium')} />
      <textarea
        value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
        placeholder="What is this entity?" aria-label="Description" className={cn(fieldCls, 'w-full resize-y')}
      />
      <div className="space-y-3">
        <Slider label="Confidence" value={confidence} onChange={setConfidence} />
        <Slider label="Salience" value={salience} onChange={setSalience} />
        <Slider label="Volatility" value={volatility} onChange={setVolatility} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wide text-zinc-500">Properties</span>
          <button type="button" onClick={() => setProps((p) => [...p, ['', '']])} className="inline-flex items-center gap-1 text-[12px] text-teal-300 hover:text-teal-200">
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {props.length === 0 && <p className="text-[12px] text-zinc-600">No custom properties. Simulations can read any numeric property you add.</p>}
        <div className="space-y-1.5">
          {props.map(([k, v], i) => (
            <div key={i} className="flex gap-1.5">
              <input value={k} onChange={(e) => setProps((p) => p.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="key" aria-label="Property key" className={cn(fieldCls, 'w-2/5')} />
              <input value={v} onChange={(e) => setProps((p) => p.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} placeholder="value" aria-label="Property value" className={cn(fieldCls, 'min-w-0 flex-1')} />
            </div>
          ))}
        </div>
        {props.length > 0 && <p className="mt-1 text-[11px] text-zinc-600">Properties merge on save; the backend can add or change a key but not remove one.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={() => save.mutate()} disabled={!dirty || !name.trim() || save.isPending} className={primaryBtn}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" onClick={onFork} disabled={forking} className={ghostBtn}><GitFork className="h-3.5 w-3.5" />{forking ? 'Forking…' : 'Fork'}</button>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(entity.id).then(() => toast('success', 'Entity id copied.')).catch(() => toast('error', 'Could not copy.')); }} className={ghostBtn}>
          <Copy className="h-3.5 w-3.5" />Copy id
        </button>
        {confirmDelete ? (
          <span className="ml-auto inline-flex items-center gap-2 text-[12px]">
            <span className="text-rose-300">Delete and drop its relations?</span>
            <button type="button" onClick={() => del.mutate()} disabled={del.isPending} className="text-rose-300 hover:text-rose-200">{del.isPending ? 'Deleting…' : 'Yes'}</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="text-zinc-400 hover:text-zinc-200">No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className={cn(ghostBtn, 'ml-auto text-rose-300 hover:text-rose-200')}><Trash2 className="h-3.5 w-3.5" />Delete</button>
        )}
      </div>

      <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-zinc-600">
        <span className="font-mono">{entity.id}</span><br />
        Created {new Date(entity.createdAt).toLocaleString()} · updated {new Date(entity.updatedAt).toLocaleString()}
        {entity.source?.createdBy && <> · by {entity.source.createdBy}</>}
        {!!entity.source?.dtuIds?.length && <> · {entity.source.dtuIds.length} source DTU{entity.source.dtuIds.length !== 1 ? 's' : ''}</>}
      </p>
    </div>
  );
}

function RelationsTab({ entity, relations, others, onSelect }: { entity: WorldEntity; relations: WorldRelation[]; others: WorldEntitySummary[]; onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [type, setType] = useState<string>('correlates');
  const [target, setTarget] = useState('');
  const [strength, setStrength] = useState(0.5);

  const add = useMutation({
    mutationFn: () => wm('create_relation', dir === 'out'
      ? { from: entity.id, to: target, type, strength }
      : { from: target, to: entity.id, type, strength }),
    onSuccess: () => {
      toast('success', 'Relation created.');
      setTarget('');
      qc.invalidateQueries({ queryKey: ['wm-entity', entity.id] });
      qc.invalidateQueries({ queryKey: ['wm-entities'] });
      qc.invalidateQueries({ queryKey: ['wm-status'] });
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const candidates = others.filter((o) => o.id !== entity.id);

  return (
    <div className="space-y-4">
      {relations.length === 0 ? (
        <p className="text-[13px] text-zinc-500">No relations yet. Connect this entity below and it will show up in the Graph view and in simulations.</p>
      ) : (
        <ul className="space-y-1.5">
          {relations.map((r) => {
            const other = r.otherEntity;
            const otherId = r.direction === 'incoming' ? r.from : r.to;
            return (
              <li key={r.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-zinc-500">{r.direction === 'incoming' ? '←' : '→'}</span>
                  <span className="rounded-full bg-teal-400/10 px-2 py-0.5 text-[11px] text-teal-300">{r.type.replace('_', ' ')}</span>
                  <button type="button" onClick={() => onSelect(otherId)} className="min-w-0 truncate text-zinc-100 hover:text-teal-200" title="Open this entity">
                    {other?.name || otherId}
                  </button>
                </div>
                <div className="mt-1.5 flex gap-4 text-[11px] text-zinc-500">
                  <span>strength {pct(r.strength)}%</span><span>confidence {pct(r.confidence)}%</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); if (target) add.mutate(); }} className="space-y-2.5 rounded-xl border border-white/10 p-3">
        <p className="text-[12px] uppercase tracking-wide text-zinc-500">Connect</p>
        <div className="flex gap-1.5">
          {(['out', 'in'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDir(d)} className={cn('flex-1 rounded-lg border px-2 py-1.5 text-[12px] transition-colors', dir === d ? 'border-teal-400/60 text-teal-200' : 'border-white/10 text-zinc-400 hover:text-zinc-200')}>
              {d === 'out' ? 'This → other' : 'Other → this'}
            </button>
          ))}
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Relation type" className={cn(fieldCls, 'w-full bg-[#111]')}>
          {RELATION_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Other entity" className={cn(fieldCls, 'w-full bg-[#111]')}>
          <option value="">Pick an entity…</option>
          {candidates.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.type}</option>)}
        </select>
        <Slider label="Strength" value={strength} onChange={setStrength} />
        <button type="submit" disabled={!target || add.isPending} className={primaryBtn}>{add.isPending ? 'Connecting…' : 'Create relation'}</button>
        {candidates.length === 0 && <p className="text-[11px] text-zinc-600">Spawn a second entity first.</p>}
      </form>
    </div>
  );
}

function SimulateTab({ entity, relations }: { entity: WorldEntity; relations: WorldRelation[] }) {
  const qc = useQueryClient();
  const propKeys = Object.keys(entity.state.properties || {});
  const [mode, setMode] = useState<'whatif' | 'evolve'>('whatif');
  const [property, setProperty] = useState('salience');
  const [altValue, setAltValue] = useState('0.9');
  const [hypothesis, setHypothesis] = useState('');
  const [steps, setSteps] = useState(20);
  const [insights, setInsights] = useState<SimInsight[] | null>(null);
  const [summary, setSummary] = useState<WorldSimulation['causalSummary']>();
  const [label, setLabel] = useState('');

  const done = (sim: { insights: SimInsight[]; causalSummary?: WorldSimulation['causalSummary'] }, l: string) => {
    setInsights(sim.insights || []);
    setSummary(sim.causalSummary);
    setLabel(l);
    qc.invalidateQueries({ queryKey: ['wm-simulations'] });
    qc.invalidateQueries({ queryKey: ['wm-status'] });
  };

  const run = useMutation({
    mutationFn: async () => {
      if (mode === 'whatif') {
        const v = coerce(altValue);
        const r = await wm<{ counterfactual: { hypothesis: string; insights: SimInsight[]; warning: string; simulationId: string } }>('counterfactual', {
          entityId: entity.id, property, altValue: v, hypothesis: hypothesis.trim() || undefined,
        });
        const sim = await wm<{ simulation: WorldSimulation }>('get_simulation', { simId: r.counterfactual.simulationId }).catch(() => null);
        return { insights: r.counterfactual.insights, causalSummary: sim?.simulation.causalSummary, label: `${r.counterfactual.hypothesis} (hypothetical, not actual state)` };
      }
      const ids = [entity.id, ...relations.map((r) => (r.direction === 'incoming' ? r.from : r.to))];
      const r = await wm<{ simulation: WorldSimulation }>('simulate', {
        type: 'evolution', entityIds: [...new Set(ids)], steps, hypothesis: hypothesis.trim() || `Evolve ${entity.name} and its neighbours`,
      });
      return { insights: r.simulation.insights, causalSummary: r.simulation.causalSummary, label: `${r.simulation.config?.hypothesis || 'Evolution'} (${steps} steps)` };
    },
    onSuccess: (r) => done(r, r.label),
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {([['whatif', 'What if…'], ['evolve', 'Evolve']] as const).map(([id, l]) => (
          <button key={id} type="button" onClick={() => setMode(id)} className={cn('flex-1 rounded-lg border px-2 py-1.5 text-[12px] transition-colors', mode === id ? 'border-teal-400/60 text-teal-200' : 'border-white/10 text-zinc-400 hover:text-zinc-200')}>{l}</button>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-zinc-500">
        {mode === 'whatif'
          ? 'Change one property and see how it ripples through connected entities. Results are hypothetical and never written back.'
          : `Step the model forward over this entity and its ${relations.length} neighbour${relations.length !== 1 ? 's' : ''}.`}
      </p>
      {mode === 'whatif' && (
        <div className="flex gap-1.5">
          <select value={property} onChange={(e) => setProperty(e.target.value)} aria-label="Property to change" className={cn(fieldCls, 'min-w-0 flex-1 bg-[#111]')}>
            <option value="salience">salience</option>
            <option value="confidence">confidence</option>
            {propKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={altValue} onChange={(e) => setAltValue(e.target.value)} aria-label="Alternative value" className={cn(fieldCls, 'w-24')} />
        </div>
      )}
      {mode === 'evolve' && (
        <label className="block text-[12px] text-zinc-400">Steps · {steps}
          <input type="range" min={5} max={50} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="mt-1 w-full accent-teal-400" aria-label="Simulation steps" />
        </label>
      )}
      <input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="Hypothesis (optional)" aria-label="Hypothesis" className={cn(fieldCls, 'w-full')} />
      <button type="button" onClick={() => run.mutate()} disabled={run.isPending} className={cn(primaryBtn, 'inline-flex items-center gap-1.5')}>
        {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {run.isPending ? 'Running…' : mode === 'whatif' ? 'Run what-if' : 'Run simulation'}
      </button>
      {insights && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[12px] text-zinc-400">{label}</p>
          <Insights items={insights} />
          {summary && (
            <p className="border-t border-white/10 pt-2 text-[11px] text-zinc-500">
              {summary.totalEvents} causal event{summary.totalEvents !== 1 ? 's' : ''} · {summary.causalPathCount} path{summary.causalPathCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TerminalTab() {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [output]);

  const exec = useMutation({
    mutationFn: async (cmd: string) => {
      // entity.terminal is a register()-only macro scoped to the calling user,
      // so it goes through runDomain (POST /api/lens/run), not the per-artifact route.
      const res = await apiHelpers.lens.runDomain('entity', 'terminal', { command: cmd });
      return (res.data?.result ?? res.data) as Record<string, unknown>;
    },
    onSuccess: (data, cmd) => {
      const line = data.disabled
        ? `${data.error} (operator must set ENABLE_TERMINAL_EXEC=true)`
        : data.status === 'pending_council_approval'
        ? `${data.message} (proposal ${data.proposalId}, ${data.riskLevel} risk)`
        : data.ok === false
        ? `Error: ${data.error || 'command rejected'}`
        : 'exitCode' in data
        ? [
            data.stdout && String(data.stdout).trim(),
            data.stderr && String(data.stderr).trim() ? `stderr: ${String(data.stderr).trim()}` : null,
            `(exit ${data.exitCode})`,
          ].filter(Boolean).join('\n')
        : JSON.stringify(data);
      setOutput((p) => [...p, `$ ${cmd}`, line]);
      setCommand('');
    },
    onError: (err: Error, cmd) => setOutput((p) => [...p, `$ ${cmd}`, `Error: ${err.message || 'Command failed'}`]),
  });

  const submit = () => { const c = command.trim(); if (c && !exec.isPending) exec.mutate(c); };

  return (
    <div className="space-y-2">
      <div className="h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black p-3 font-mono text-[12px] text-teal-300">
        {output.length === 0 ? <p className="text-zinc-500">Ready. Risky commands are held for a council vote before they run.</p>
          : output.map((l, i) => <div key={i} className={l.startsWith('$') ? 'text-zinc-100' : ''}>{l}</div>)}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Enter a command" aria-label="Terminal command" className={cn(fieldCls, 'flex-1 font-mono')} />
        <button type="button" onClick={submit} disabled={!command.trim() || exec.isPending} aria-label="Run command" className={cn(ghostBtn, 'px-3')}><Play className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

export function EntityInspector({
  entityId, others, onSelect, onDeleted, onFork, forking,
}: {
  entityId: string;
  others: WorldEntitySummary[];
  onSelect: (id: string) => void;
  onDeleted: () => void;
  onFork: (e: WorldEntity) => void;
  forking: boolean;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const { data, isLoading, error } = useQuery({
    queryKey: ['wm-entity', entityId],
    queryFn: () => wm<{ entity: WorldEntity; relations: WorldRelation[] }>('get_entity', { entityId }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-4 text-[13px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (error || !data) return <p className="p-4 text-[13px] text-rose-300">{(error as Error)?.message || 'Could not load this entity.'}</p>;

  const { entity, relations } = data;
  return (
    <div>
      <div className="flex items-center gap-2 px-4 pt-4">
        <span className={cn('h-2.5 w-2.5 rounded-full', TYPE_DOT[entity.type] || 'bg-zinc-500')} />
        <span className="text-[12px] uppercase tracking-wide text-zinc-500">{entity.type}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-zinc-500">{relations.length} <ArrowRight className="h-3 w-3" /> relations</span>
      </div>
      <div className="mt-3 flex gap-1 border-b border-white/10 px-3">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-2.5 py-2 text-[13px] transition-colors', tab === t.id ? 'border-teal-400 text-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-200')}>
            {t.label}{t.id === 'relations' && relations.length > 0 && <span className="ml-1 text-[11px] text-zinc-500">{relations.length}</span>}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'overview' && <OverviewTab key={`${entity.id}:${entity.updatedAt}`} entity={entity} onFork={() => onFork(entity)} forking={forking} onDeleted={onDeleted} />}
        {tab === 'relations' && <RelationsTab key={entity.id} entity={entity} relations={relations} others={others} onSelect={onSelect} />}
        {tab === 'simulate' && <SimulateTab key={entity.id} entity={entity} relations={relations} />}
        {tab === 'terminal' && <TerminalTab />}
      </div>
    </div>
  );
}
