'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Worldmodel Lens — digital-twin / counterfactual-simulation surface:
 * an entity-graph world model with counterfactual simulation over a
 * modeled system.
 *
 * Every panel here is wired to a real `worldmodel.*` domain macro. There
 * is no mock / seed / demo data: each rendered value comes from a macro
 * call or a real client-side computation over macro output.
 *
 * Tabs:
 *   - Graph     — interactive force-directed entity/relation graph (wm graph)
 *   - Entities  — typed CRUD: create / attrs editing / typed schemas / delete
 *   - Relations — create / edit weight+type / delete
 *   - Simulate  — forward simulation with charted trajectories
 *   - Compare   — side-by-side scenario vs counterfactual with delta charts
 *   - Snapshots — capture / list / diff / restore world-state snapshots
 *   - Library   — save / re-run / delete named scenarios
 *   - Ingest    — live data ingestion into entity attributes + event log
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WorldModelArxiv } from '@/components/worldmodel/WorldModelArxiv';
import { GraphCanvas, type GraphNode, type GraphEdge } from '@/components/worldmodel/GraphCanvas';
import { ChartKit } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe2, Loader2, Plus, Play, Camera, Network, Boxes, GitFork,
  Trash2, Save, Upload, GitCompareArrows, Pencil, RefreshCcw, Library,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'graph' | 'entities' | 'relations' | 'simulate' | 'compare' | 'snapshots' | 'library' | 'ingest';

interface WmEntity { id: string; name: string; type: string; attributes?: Record<string, any>; updatedAt?: string }
interface WmRelation { id: string; from: string; to: string; type: string; weight?: number }
interface WmTypeField { key: string; kind: 'number' | 'string' | 'boolean'; label?: string }
interface WmType { name: string; fields: WmTypeField[] }
interface WmTrajRow { step: number; [k: string]: number }
interface WmSim {
  id: string; name: string; mode?: string; total?: number; createdAt?: string;
  trajectory?: WmTrajRow[]; finalState?: Record<string, number>; entityNames?: Record<string, string>;
}
interface WmSnapshot { id: string; label: string; entityCount: number; relationCount: number; capturedAt: string }
interface WmScenario {
  id: string; name: string; steps: number; growth: number;
  shocks: { entityId: string; step: number; delta: number }[]; note?: string; savedAt?: string;
}
interface WmIngestEvent {
  id: string; entityId: string; entityName: string; attribute: string;
  mode: string; from: number; to: number; source: string; at: string;
}

async function run<T = any>(action: string, input: Record<string, unknown> = {}) {
  const r = await lensRun<T>('worldmodel', action, input);
  if (!r.data.ok) throw new Error(r.data.error || `${action} failed`);
  return r.data.result as T;
}

export default function WorldmodelLensPage() {
  useLensNav('worldmodel');
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('graph');

  useLensCommand(
    [
      { id: 'tab-graph', keys: 'g', description: 'Graph', category: 'navigation', action: () => setActiveTab('graph') },
      { id: 'tab-entities', keys: 'e', description: 'Entities', category: 'navigation', action: () => setActiveTab('entities') },
      { id: 'tab-relations', keys: 'r', description: 'Relations', category: 'navigation', action: () => setActiveTab('relations') },
      { id: 'tab-simulate', keys: 'i', description: 'Simulate', category: 'navigation', action: () => setActiveTab('simulate') },
      { id: 'tab-compare', keys: 'c', description: 'Compare', category: 'navigation', action: () => setActiveTab('compare') },
      { id: 'tab-snapshots', keys: 'n', description: 'Snapshots', category: 'navigation', action: () => setActiveTab('snapshots') },
      { id: 'tab-library', keys: 'l', description: 'Library', category: 'navigation', action: () => setActiveTab('library') },
      { id: 'tab-ingest', keys: 'd', description: 'Ingest', category: 'navigation', action: () => setActiveTab('ingest') },
    ],
    { lensId: 'worldmodel' },
  );

  // ── Shared queries ────────────────────────────────────────────────────
  const status = useQuery({
    queryKey: ['wm-status'],
    queryFn: () => run<Record<string, number>>('wm_status'),
    refetchInterval: 30_000,
  });
  const entities = useQuery({
    queryKey: ['wm-entities'],
    queryFn: () => run<{ entities: WmEntity[] }>('wm_list_entities'),
  });
  const relations = useQuery({
    queryKey: ['wm-relations'],
    queryFn: () => run<{ relations: WmRelation[] }>('wm_list_relations'),
  });
  const types = useQuery({
    queryKey: ['wm-types'],
    queryFn: () => run<{ types: WmType[] }>('list_entity_types'),
  });
  const graph = useQuery({
    queryKey: ['wm-graph'],
    queryFn: () => run<{ nodes: GraphNode[]; edges: GraphEdge[] }>('graph'),
  });

  const entityList = entities.data?.entities ?? [];
  const relationList = relations.data?.relations ?? [];
  const typeList = types.data?.types ?? [];
  const entityName = (id: string) => entityList.find((e) => e.id === id)?.name ?? id;

  function refreshAll() {
    ['wm-status', 'wm-entities', 'wm-relations', 'wm-types', 'wm-graph'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'graph', label: 'Graph', icon: Network },
    { key: 'entities', label: 'Entities', icon: Boxes, count: entityList.length },
    { key: 'relations', label: 'Relations', icon: GitFork, count: relationList.length },
    { key: 'simulate', label: 'Simulate', icon: Play },
    { key: 'compare', label: 'Compare', icon: GitCompareArrows },
    { key: 'snapshots', label: 'Snapshots', icon: Camera },
    { key: 'library', label: 'Library', icon: Library },
    { key: 'ingest', label: 'Ingest', icon: Upload },
  ];

  return (
    <LensShell lensId="worldmodel" asMain={false}>
      <ManifestActionBar />
      <DepthBadge lensId="worldmodel" size="sm" className="ml-2" />
      <div className="min-h-screen bg-black pb-12 text-emerald-50">
        <header className="sticky top-0 z-10 border-b border-emerald-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Globe2 className="h-6 w-6 text-emerald-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">Worldmodel</h1>
              <p className="text-xs text-emerald-700">Digital twin · entity graph · counterfactual simulation</p>
            </div>
            <div className="ml-auto flex items-center gap-3 text-xs text-emerald-600">
              {status.data && (
                <>
                  <span>{status.data.entities ?? 0} entities</span>
                  <span>{status.data.relations ?? 0} relations</span>
                  <span>{status.data.simulations ?? 0} sims</span>
                  <span>{status.data.snapshots ?? 0} snapshots</span>
                </>
              )}
            </div>
          </div>
        </header>

        <nav className="border-b border-emerald-900/30 px-4 md:px-8" aria-label="Worldmodel sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {tabs.map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                  activeTab === key ? 'border-emerald-400 text-emerald-200' : 'border-transparent text-emerald-700 hover:text-emerald-400'
                }`}
                aria-pressed={activeTab === key}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                {count != null && <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">{count}</span>}
              </button>
            ))}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            {activeTab === 'graph' && (
              <Pane key="graph">
                <GraphTab graph={graph.data} loading={graph.isLoading} />
              </Pane>
            )}
            {activeTab === 'entities' && (
              <Pane key="entities">
                <EntitiesTab
                  entities={entityList} types={typeList} loading={entities.isLoading}
                  onChanged={refreshAll}
                />
              </Pane>
            )}
            {activeTab === 'relations' && (
              <Pane key="relations">
                <RelationsTab
                  relations={relationList} entities={entityList} entityName={entityName}
                  loading={relations.isLoading} onChanged={refreshAll}
                />
              </Pane>
            )}
            {activeTab === 'simulate' && (
              <Pane key="simulate"><SimulateTab entities={entityList} /></Pane>
            )}
            {activeTab === 'compare' && (
              <Pane key="compare"><CompareTab entities={entityList} /></Pane>
            )}
            {activeTab === 'snapshots' && (
              <Pane key="snapshots"><SnapshotsTab onRestored={refreshAll} /></Pane>
            )}
            {activeTab === 'library' && (
              <Pane key="library"><LibraryTab entities={entityList} /></Pane>
            )}
            {activeTab === 'ingest' && (
              <Pane key="ingest"><IngestTab entities={entityList} onIngested={refreshAll} /></Pane>
            )}
          </AnimatePresence>
        </main>

        <section className="mx-4 mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 md:mx-8">
          <WorldModelArxiv />
        </section>
      </div>
    </LensShell>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }}
    >
      {children}
    </motion.section>
  );
}

const card = 'rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-4';
const input = 'rounded border border-emerald-900/40 bg-black/40 px-2 py-1.5 font-mono text-sm text-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
const btn = 'inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-400';
const btnGhost = 'inline-flex items-center gap-1 rounded border border-emerald-900/40 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-900/30';

// ─── Graph tab ──────────────────────────────────────────────────────────
function GraphTab({ graph, loading }: { graph?: { nodes: GraphNode[]; edges: GraphEdge[] }; loading: boolean }) {
  const [selNode, setSelNode] = useState<GraphNode | null>(null);
  const [selEdge, setSelEdge] = useState<GraphEdge | null>(null);
  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-emerald-300">Entity-relation graph</h3>
        <GraphCanvas
          nodes={nodes} edges={edges}
          selectedNodeId={selNode?.id}
          onSelectNode={(n) => { setSelNode(n); setSelEdge(null); }}
          onSelectEdge={(e) => { setSelEdge(e); setSelNode(null); }}
        />
        <p className="mt-2 text-[11px] text-emerald-700">
          {nodes.length} nodes · {edges.length} edges · drag nodes to reposition · node size = degree
        </p>
      </div>
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Inspector</h3>
        {!selNode && !selEdge && <p className="text-xs text-emerald-700">Click a node or edge to inspect it.</p>}
        {selNode && (
          <dl className="space-y-1.5 text-xs">
            <Row k="id" v={selNode.id} />
            <Row k="name" v={selNode.name ?? '—'} />
            <Row k="type" v={selNode.type ?? '—'} />
            <Row k="degree" v={String(selNode.degree ?? 0)} />
            {selNode.attributes && Object.entries(selNode.attributes).map(([k, v]) => (
              <Row key={k} k={`attr.${k}`} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
          </dl>
        )}
        {selEdge && (
          <dl className="space-y-1.5 text-xs">
            <Row k="id" v={selEdge.id} />
            <Row k="type" v={selEdge.type ?? '—'} />
            <Row k="from" v={selEdge.from} />
            <Row k="to" v={selEdge.to} />
            <Row k="weight" v={String(selEdge.weight ?? '—')} />
          </dl>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-emerald-700">{k}</dt>
      <dd className="truncate font-mono text-emerald-200">{v}</dd>
    </div>
  );
}

// ─── Entities tab ───────────────────────────────────────────────────────
function EntitiesTab({
  entities, types, loading, onChanged,
}: {
  entities: WmEntity[]; types: WmType[]; loading: boolean; onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState('concept');
  const [value, setValue] = useState('100');
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // typed schema builder
  const [typeName, setTypeName] = useState('');
  const [typeFields, setTypeFields] = useState<WmTypeField[]>([{ key: 'value', kind: 'number', label: 'Value' }]);

  const create = useMutation({
    mutationFn: () => run('wm_create_entity', {
      name, type, attributes: { value: Number(value) || 0 },
    }),
    onSuccess: () => { setName(''); setValue('100'); setErr(null); onChanged(); },
    onError: (e) => setErr((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => run('wm_delete_entity', { id }),
    onSuccess: onChanged,
  });
  const defineType = useMutation({
    mutationFn: () => run('define_entity_type', { name: typeName, fields: typeFields }),
    onSuccess: () => { setTypeName(''); onChanged(); },
  });
  const delType = useMutation({
    mutationFn: (n: string) => run('delete_entity_type', { name: n }),
    onSuccess: onChanged,
  });

  const editEntity = entities.find((e) => e.id === editId) ?? null;

  return (
    <div className="space-y-5">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Create entity</h3>
        <div className="flex flex-wrap gap-2">
          <input className={`${input} flex-1 min-w-32`} placeholder="Entity name" aria-label="Entity name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <select className={input} aria-label="Entity type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="concept">concept</option>
            {types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <input className={`${input} w-28`} type="number" placeholder="value" aria-label="Initial value"
            value={value} onChange={(e) => setValue(e.target.value)} />
          <button className={btn} disabled={!name || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-emerald-700">Entities carry a numeric <code>value</code> attribute that simulations propagate.</p>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Typed entity schemas</h3>
        <div className="flex flex-wrap items-end gap-2">
          <input className={`${input} w-40`} placeholder="Type name" aria-label="New type name"
            value={typeName} onChange={(e) => setTypeName(e.target.value)} />
          <button className={btn} disabled={!typeName || defineType.isPending} onClick={() => defineType.mutate()}>
            <Save className="h-3 w-3" /> Define type
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {typeFields.map((f, i) => (
            <div key={i} className="flex flex-wrap gap-1.5">
              <input className={`${input} w-32`} placeholder="field key" aria-label="Field key"
                value={f.key} onChange={(e) => setTypeFields((fs) => fs.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
              <select className={input} aria-label="Field kind" value={f.kind}
                onChange={(e) => setTypeFields((fs) => fs.map((x, j) => j === i ? { ...x, kind: e.target.value as WmTypeField['kind'] } : x))}>
                <option value="number">number</option>
                <option value="string">string</option>
                <option value="boolean">boolean</option>
              </select>
              <button aria-label="Delete" className={btnGhost} onClick={() => setTypeFields((fs) => fs.filter((_, j) => j !== i))}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button className={btnGhost} onClick={() => setTypeFields((fs) => [...fs, { key: '', kind: 'string' }])}>
            <Plus className="h-3 w-3" /> Add field
          </button>
        </div>
        {types.length > 0 && (
          <ul className="mt-3 space-y-1">
            {types.map((t) => (
              <li key={t.name} className="flex items-center gap-2 rounded border border-emerald-900/30 bg-black/30 px-2 py-1.5 text-xs">
                <span className="font-mono text-emerald-300">{t.name}</span>
                <span className="text-emerald-700">{t.fields.map((f) => `${f.key}:${f.kind}`).join(', ') || 'no fields'}</span>
                <button aria-label="Delete" className={`${btnGhost} ml-auto`} onClick={() => delType.mutate(t.name)}><Trash2 className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
      {!loading && entities.length === 0 && <p className="text-xs text-emerald-700">No entities yet — create one above.</p>}
      <ul className="space-y-1">
        {entities.map((e) => (
          <li key={e.id} className="rounded border border-emerald-900/30 bg-emerald-950/10">
            <div className="flex items-center gap-3 px-3 py-2 text-xs">
              <Boxes className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              <span className="text-emerald-100">{e.name}</span>
              <span className="rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px] text-emerald-300">{e.type}</span>
              <span className="font-mono text-emerald-600">value={Number(e.attributes?.value ?? 0)}</span>
              <button className={`${btnGhost} ml-auto`} onClick={() => setEditId(editId === e.id ? null : e.id)}>
                <Pencil className="h-3 w-3" /> attrs
              </button>
              <button aria-label="Delete" className={btnGhost} onClick={() => del.mutate(e.id)}><Trash2 className="h-3 w-3" /></button>
            </div>
            {editId === e.id && editEntity && (
              <AttrEditor entity={editEntity} types={types} onSaved={() => { setEditId(null); onChanged(); }} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttrEditor({ entity, types, onSaved }: { entity: WmEntity; types: WmType[]; onSaved: () => void }) {
  const schema = types.find((t) => t.name === entity.type);
  const initial: Record<string, string> = {};
  const fieldKeys = schema
    ? schema.fields.map((f) => f.key)
    : Object.keys(entity.attributes ?? { value: 0 });
  for (const k of fieldKeys) initial[k] = String((entity.attributes ?? {})[k] ?? '');
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [nm, setNm] = useState(entity.name);

  const save = useMutation({
    mutationFn: () => {
      const attributes: Record<string, unknown> = {};
      for (const k of fieldKeys) {
        const f = schema?.fields.find((x) => x.key === k);
        const raw = vals[k] ?? '';
        if (f?.kind === 'number') attributes[k] = Number(raw) || 0;
        else if (f?.kind === 'boolean') attributes[k] = raw === 'true';
        else attributes[k] = raw;
      }
      if (!schema) attributes.value = Number(vals.value) || 0;
      return run('update_entity_attrs', { id: entity.id, name: nm, attributes });
    },
    onSuccess: onSaved,
  });

  return (
    <div className="border-t border-emerald-900/30 bg-black/30 p-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${input} w-44`} aria-label="Entity name" value={nm} onChange={(e) => setNm(e.target.value)} />
        {fieldKeys.map((k) => {
          const f = schema?.fields.find((x) => x.key === k);
          return (
            <label key={k} className="flex items-center gap-1 text-[11px] text-emerald-600">
              {k}
              {f?.kind === 'boolean' ? (
                <select className={input} aria-label={k} value={vals[k] ?? 'false'}
                  onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input className={`${input} w-24`} type={f?.kind === 'number' ? 'number' : 'text'} aria-label={k}
                  value={vals[k] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
              )}
            </label>
          );
        })}
        <button className={btn} disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
      </div>
      {schema && <p className="mt-1.5 text-[10px] text-emerald-700">Coerced against typed schema &quot;{schema.name}&quot;.</p>}
    </div>
  );
}

// ─── Relations tab ──────────────────────────────────────────────────────
function RelationsTab({
  relations, entities, entityName, loading, onChanged,
}: {
  relations: WmRelation[]; entities: WmEntity[]; entityName: (id: string) => string;
  loading: boolean; onChanged: () => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('relates_to');
  const [weight, setWeight] = useState(0.5);
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => run('create_relation_typed', { from, to, type, weight }),
    onSuccess: () => { setErr(null); onChanged(); },
    onError: (e) => setErr((e as Error).message),
  });
  const update = useMutation({
    mutationFn: (p: { id: string; type: string; weight: number }) => run('update_relation', p),
    onSuccess: onChanged,
  });
  const del = useMutation({
    mutationFn: (id: string) => run('delete_relation', { id }),
    onSuccess: onChanged,
  });

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Create relation</h3>
        {entities.length < 2 ? (
          <p className="text-xs text-emerald-700">Create at least two entities first.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select className={input} aria-label="From entity" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">from…</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input className={`${input} w-32`} placeholder="type" aria-label="Relation type"
              value={type} onChange={(e) => setType(e.target.value)} />
            <select className={input} aria-label="To entity" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">to…</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-emerald-600">
              weight {weight.toFixed(2)}
              <input type="range" min={0} max={1} step={0.05} value={weight}
                onChange={(e) => setWeight(Number(e.target.value))} aria-label="Relation weight" />
            </label>
            <button className={btn} disabled={!from || !to || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
            </button>
          </div>
        )}
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
      </div>

      {loading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
      {!loading && relations.length === 0 && <p className="text-xs text-emerald-700">No relations yet.</p>}
      <ul className="space-y-1">
        {relations.map((r) => (
          <RelationRow key={r.id} relation={r} entityName={entityName}
            onUpdate={(p) => update.mutate(p)} onDelete={() => del.mutate(r.id)} />
        ))}
      </ul>
    </div>
  );
}

function RelationRow({
  relation, entityName, onUpdate, onDelete,
}: {
  relation: WmRelation; entityName: (id: string) => string;
  onUpdate: (p: { id: string; type: string; weight: number }) => void; onDelete: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [type, setType] = useState(relation.type);
  const [weight, setWeight] = useState(relation.weight ?? 0.5);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-emerald-900/30 bg-emerald-950/10 px-3 py-2 text-xs">
      <GitFork className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
      <span className="font-mono text-emerald-300">{entityName(relation.from)}</span>
      {edit ? (
        <input className={`${input} w-28`} aria-label="Relation type" value={type} onChange={(e) => setType(e.target.value)} />
      ) : (
        <span className="rounded bg-emerald-700/30 px-1.5 py-0.5 text-[10px]">{relation.type}</span>
      )}
      <span className="font-mono text-emerald-300">{entityName(relation.to)}</span>
      {edit ? (
        <label className="flex items-center gap-1 text-[10px] text-emerald-600">
          {weight.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={weight}
            onChange={(e) => setWeight(Number(e.target.value))} aria-label="Relation weight" />
        </label>
      ) : (
        <span className="text-emerald-600">w={relation.weight ?? 0.5}</span>
      )}
      {edit ? (
        <>
          <button className={`${btnGhost} ml-auto`} onClick={() => { onUpdate({ id: relation.id, type, weight }); setEdit(false); }}>
            <Save className="h-3 w-3" /> save
          </button>
          <button className={btnGhost} onClick={() => setEdit(false)}>cancel</button>
        </>
      ) : (
        <>
          <button aria-label="Edit" className={`${btnGhost} ml-auto`} onClick={() => setEdit(true)}><Pencil className="h-3 w-3" /></button>
          <button aria-label="Delete" className={btnGhost} onClick={onDelete}><Trash2 className="h-3 w-3" /></button>
        </>
      )}
    </li>
  );
}

// ─── Simulate tab ───────────────────────────────────────────────────────
function SimulateTab({ entities }: { entities: WmEntity[] }) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState(10);
  const [growth, setGrowth] = useState(0.05);
  const [name, setName] = useState('forward run');
  const [shocks, setShocks] = useState<{ entityId: string; step: number; delta: number }[]>([]);

  const sims = useQuery({
    queryKey: ['wm-sims'],
    queryFn: () => run<{ simulations: WmSim[] }>('list_sims'),
  });
  const [viewSim, setViewSim] = useState<WmSim | null>(null);

  const exec = useMutation({
    mutationFn: () => run<WmSim>('run_scenario', { name, steps, growth, shocks }),
    onSuccess: (sim) => { setViewSim(sim); qc.invalidateQueries({ queryKey: ['wm-sims'] }); },
  });
  const loadSim = useMutation({
    mutationFn: (id: string) => run<WmSim>('get_sim', { id }),
    onSuccess: (sim) => setViewSim(sim),
  });

  const chart = useTrajectoryChart(viewSim);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-emerald-300">Run a forward simulation</h3>
        {entities.length === 0 ? (
          <p className="text-xs text-emerald-700">Create entities (with a numeric value) before simulating.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <input className={`${input} w-44`} aria-label="Simulation name" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="text-[11px] text-emerald-600">steps {steps}
                <input type="range" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                  aria-label="Steps" className="block" />
              </label>
              <label className="text-[11px] text-emerald-600">growth {growth.toFixed(2)}
                <input type="range" min={-0.5} max={0.5} step={0.01} value={growth}
                  onChange={(e) => setGrowth(Number(e.target.value))} aria-label="Growth rate" className="block" />
              </label>
              <button className={btn} disabled={exec.isPending} onClick={() => exec.mutate()}>
                {exec.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
              </button>
            </div>
            <ShockEditor entities={entities} steps={steps} shocks={shocks} onChange={setShocks} />
          </>
        )}
        {exec.isError && <p className="mt-2 text-xs text-rose-400">{(exec.error as Error).message}</p>}
      </div>

      {viewSim?.trajectory && (
        <div className={card}>
          <h3 className="mb-3 text-sm font-semibold text-emerald-300">
            Trajectory · {viewSim.name} <span className="text-emerald-700">(total {viewSim.total})</span>
          </h3>
          <ChartKit kind="line" data={chart.data} xKey="step" series={chart.series} height={280} />
        </div>
      )}

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Recent simulations</h3>
        {(sims.data?.simulations ?? []).length === 0 ? (
          <p className="text-xs text-emerald-700">No simulations yet.</p>
        ) : (
          <ul className="space-y-1">
            {(sims.data?.simulations ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Play className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{s.name}</span>
                <span className="rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px]">{s.mode}</span>
                <span className="font-mono text-emerald-600">total {s.total}</span>
                {s.createdAt && <span className="text-[10px] text-emerald-800">{new Date(s.createdAt).toLocaleString()}</span>}
                <button className={`${btnGhost} ml-auto`} onClick={() => loadSim.mutate(s.id)}>view chart</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ShockEditor({
  entities, steps, shocks, onChange,
}: {
  entities: WmEntity[]; steps: number;
  shocks: { entityId: string; step: number; delta: number }[];
  onChange: (s: { entityId: string; step: number; delta: number }[]) => void;
}) {
  return (
    <div className="mt-3 border-t border-emerald-900/30 pt-3">
      <p className="mb-1.5 text-[11px] uppercase tracking-wider text-emerald-700">Shocks (one-off deltas at a step)</p>
      {shocks.map((sh, i) => (
        <div key={i} className="mb-1.5 flex flex-wrap gap-1.5">
          <select className={input} aria-label="Shock entity" value={sh.entityId}
            onChange={(e) => onChange(shocks.map((x, j) => j === i ? { ...x, entityId: e.target.value } : x))}>
            <option value="">entity…</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input className={`${input} w-20`} type="number" min={1} max={steps} aria-label="Shock step"
            value={sh.step} onChange={(e) => onChange(shocks.map((x, j) => j === i ? { ...x, step: Number(e.target.value) } : x))} />
          <input className={`${input} w-24`} type="number" aria-label="Shock delta" placeholder="delta"
            value={sh.delta} onChange={(e) => onChange(shocks.map((x, j) => j === i ? { ...x, delta: Number(e.target.value) } : x))} />
          <button aria-label="Delete" className={btnGhost} onClick={() => onChange(shocks.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></button>
        </div>
      ))}
      <button className={btnGhost} disabled={entities.length === 0}
        onClick={() => onChange([...shocks, { entityId: entities[0]?.id ?? '', step: 1, delta: 0 }])}>
        <Plus className="h-3 w-3" /> Add shock
      </button>
    </div>
  );
}

function useTrajectoryChart(sim: WmSim | null) {
  return useMemo(() => {
    if (!sim?.trajectory) return { data: [] as Record<string, unknown>[], series: [] as { key: string; label: string }[] };
    const names = sim.entityNames ?? {};
    const ids = Object.keys(sim.trajectory[0] ?? {}).filter((k) => k !== 'step');
    return {
      data: sim.trajectory as unknown as Record<string, unknown>[],
      series: ids.map((id) => ({ key: id, label: names[id] ?? id })),
    };
  }, [sim]);
}

// ─── Compare tab ────────────────────────────────────────────────────────
interface CompareResult {
  steps: number;
  entityNames: Record<string, string>;
  baseline: { trajectory: WmTrajRow[]; total: number };
  counterfactual: { trajectory: WmTrajRow[]; total: number };
  delta: WmTrajRow[];
  totalSwing: number;
  verdict: string;
}
function CompareTab({ entities }: { entities: WmEntity[] }) {
  const [steps, setSteps] = useState(10);
  const [baseGrowth, setBaseGrowth] = useState(0.05);
  const [cfGrowth, setCfGrowth] = useState(0.12);
  const [result, setResult] = useState<CompareResult | null>(null);

  const exec = useMutation({
    mutationFn: () => run<CompareResult>('compare_scenarios', {
      steps,
      baseline: { growth: baseGrowth, shocks: [] },
      counterfactual: { growth: cfGrowth, shocks: [] },
    }),
    onSuccess: (r) => setResult(r),
  });

  const series = useMemo(() => {
    if (!result) return [];
    return Object.keys(result.entityNames).map((id) => ({ key: id, label: result.entityNames[id] }));
  }, [result]);
  const totalSeries = useMemo(() => {
    if (!result) return [];
    return result.baseline.trajectory.map((row, i) => {
      const cf = result.counterfactual.trajectory[i] ?? {};
      const sumRow = (r: WmTrajRow) => Object.entries(r).reduce((a, [k, v]) => k === 'step' ? a : a + (v as number), 0);
      return { step: row.step, baseline: Number(sumRow(row).toFixed(2)), counterfactual: Number(sumRow(cf as WmTrajRow).toFixed(2)) };
    });
  }, [result]);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-emerald-300">Scenario vs counterfactual</h3>
        {entities.length === 0 ? (
          <p className="text-xs text-emerald-700">Create entities before comparing scenarios.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-[11px] text-emerald-600">steps {steps}
              <input type="range" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                aria-label="Steps" className="block" />
            </label>
            <label className="text-[11px] text-indigo-400">baseline growth {baseGrowth.toFixed(2)}
              <input type="range" min={-0.5} max={0.5} step={0.01} value={baseGrowth}
                onChange={(e) => setBaseGrowth(Number(e.target.value))} aria-label="Baseline growth" className="block" />
            </label>
            <label className="text-[11px] text-amber-400">counterfactual growth {cfGrowth.toFixed(2)}
              <input type="range" min={-0.5} max={0.5} step={0.01} value={cfGrowth}
                onChange={(e) => setCfGrowth(Number(e.target.value))} aria-label="Counterfactual growth" className="block" />
            </label>
            <button className={btn} disabled={exec.isPending} onClick={() => exec.mutate()}>
              {exec.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />} Compare
            </button>
          </div>
        )}
        {exec.isError && <p className="mt-2 text-xs text-rose-400">{(exec.error as Error).message}</p>}
      </div>

      {result && (
        <>
          <div className={`${card} flex flex-wrap items-center gap-4`}>
            <Stat label="Baseline total" value={result.baseline.total} />
            <Stat label="Counterfactual total" value={result.counterfactual.total} />
            <Stat label="Net swing" value={result.totalSwing} tone={result.totalSwing >= 0 ? 'good' : 'bad'} />
            <span className={`text-xs ${result.totalSwing >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{result.verdict}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <h4 className="mb-2 text-xs font-semibold text-indigo-300">Baseline trajectory</h4>
              <ChartKit kind="line" data={result.baseline.trajectory as unknown as Record<string, unknown>[]} xKey="step" series={series} height={220} />
            </div>
            <div className={card}>
              <h4 className="mb-2 text-xs font-semibold text-amber-300">Counterfactual trajectory</h4>
              <ChartKit kind="line" data={result.counterfactual.trajectory as unknown as Record<string, unknown>[]} xKey="step" series={series} height={220} />
            </div>
          </div>
          <div className={card}>
            <h4 className="mb-2 text-xs font-semibold text-emerald-300">Total system value — baseline vs counterfactual</h4>
            <ChartKit kind="area" data={totalSeries as unknown as Record<string, unknown>[]} xKey="step"
              series={[{ key: 'baseline', label: 'Baseline', color: '#6366f1' }, { key: 'counterfactual', label: 'Counterfactual', color: '#f59e0b' }]}
              height={240} />
          </div>
          <div className={card}>
            <h4 className="mb-2 text-xs font-semibold text-emerald-300">Per-entity delta (counterfactual − baseline)</h4>
            <ChartKit kind="bar" data={result.delta as unknown as Record<string, unknown>[]} xKey="step" series={series} height={240} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Snapshots tab ──────────────────────────────────────────────────────
interface SnapshotDiff {
  from: { id: string; label: string };
  to: { id: string; label: string };
  addedEntities: { id: string; name: string }[];
  removedEntities: { id: string; name: string }[];
  changedEntities: { id: string; name: string; changes: { field: string; from: unknown; to: unknown }[] }[];
  addedRelations: { id: string; type: string }[];
  removedRelations: { id: string; type: string }[];
  summary: Record<string, number>;
}
function SnapshotsTab({ onRestored }: { onRestored: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);

  const snaps = useQuery({
    queryKey: ['wm-snapshots'],
    queryFn: () => run<{ snapshots: WmSnapshot[] }>('list_snapshots_full'),
  });
  const capture = useMutation({
    mutationFn: () => run('capture_snapshot', { label: label || `snapshot-${new Date().toISOString()}` }),
    onSuccess: () => { setLabel(''); qc.invalidateQueries({ queryKey: ['wm-snapshots'] }); },
  });
  const doDiff = useMutation({
    mutationFn: () => run<SnapshotDiff>('diff_snapshots', { fromId, toId }),
    onSuccess: (d) => setDiff(d),
  });
  const restore = useMutation({
    mutationFn: (id: string) => run('restore_snapshot', { id }),
    onSuccess: onRestored,
  });

  const list = snaps.data?.snapshots ?? [];

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-end gap-2`}>
        <input className={`${input} flex-1 min-w-40`} placeholder="Snapshot label" aria-label="Snapshot label"
          value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className={btn} disabled={capture.isPending} onClick={() => capture.mutate()}>
          {capture.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />} Capture snapshot
        </button>
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">World-state snapshots</h3>
        {list.length === 0 ? (
          <p className="text-xs text-emerald-700">No snapshots yet — capture one above.</p>
        ) : (
          <ul className="space-y-1">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Camera className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{s.label}</span>
                <span className="text-emerald-600">{s.entityCount}E · {s.relationCount}R</span>
                <span className="text-[10px] text-emerald-800">{new Date(s.capturedAt).toLocaleString()}</span>
                <button className={`${btnGhost} ml-auto`} onClick={() => restore.mutate(s.id)}>
                  <RefreshCcw className="h-3 w-3" /> restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {list.length >= 2 && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold text-emerald-300">Compare snapshots</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select className={input} aria-label="From snapshot" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">from…</option>
              {list.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span className="text-emerald-700">→</span>
            <select className={input} aria-label="To snapshot" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">to…</option>
              {list.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className={btn} disabled={!fromId || !toId || doDiff.isPending} onClick={() => doDiff.mutate()}>
              <GitCompareArrows className="h-3 w-3" /> Diff
            </button>
          </div>
          {diff && (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex flex-wrap gap-3">
                {Object.entries(diff.summary).map(([k, v]) => (
                  <span key={k} className="rounded bg-emerald-900/30 px-2 py-0.5 text-emerald-300">{k}: {v}</span>
                ))}
              </div>
              {diff.addedEntities.length > 0 && (
                <DiffBlock title="Added entities" tone="text-emerald-400"
                  items={diff.addedEntities.map((e) => e.name)} />
              )}
              {diff.removedEntities.length > 0 && (
                <DiffBlock title="Removed entities" tone="text-rose-400"
                  items={diff.removedEntities.map((e) => e.name)} />
              )}
              {diff.changedEntities.length > 0 && (
                <div>
                  <p className="text-amber-400">Changed entities</p>
                  <ul className="ml-3 space-y-0.5">
                    {diff.changedEntities.map((c) => (
                      <li key={c.id} className="text-emerald-500">
                        {c.name}: {c.changes.map((ch) => `${ch.field} ${JSON.stringify(ch.from)}→${JSON.stringify(ch.to)}`).join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(diff.addedRelations.length > 0 || diff.removedRelations.length > 0) && (
                <DiffBlock title="Relations" tone="text-indigo-400"
                  items={[
                    ...diff.addedRelations.map((r) => `+ ${r.type}`),
                    ...diff.removedRelations.map((r) => `− ${r.type}`),
                  ]} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <p className={tone}>{title}</p>
      <ul className="ml-3 text-emerald-500">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

// ─── Library tab ────────────────────────────────────────────────────────
function LibraryTab({ entities }: { entities: WmEntity[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState(10);
  const [growth, setGrowth] = useState(0.05);
  const [note, setNote] = useState('');
  const [lastRun, setLastRun] = useState<WmSim | null>(null);

  const scenarios = useQuery({
    queryKey: ['wm-scenarios'],
    queryFn: () => run<{ scenarios: WmScenario[] }>('list_scenarios'),
  });
  const save = useMutation({
    mutationFn: () => run('save_scenario', { name, steps, growth, note, shocks: [] }),
    onSuccess: () => { setName(''); setNote(''); qc.invalidateQueries({ queryKey: ['wm-scenarios'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => run('delete_scenario', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wm-scenarios'] }),
  });
  const rerun = useMutation({
    mutationFn: (s: WmScenario) => run<WmSim>('run_scenario', {
      name: s.name, steps: s.steps, growth: s.growth, shocks: s.shocks,
    }),
    onSuccess: (sim) => { setLastRun(sim); qc.invalidateQueries({ queryKey: ['wm-sims'] }); },
  });
  const chart = useTrajectoryChart(lastRun);
  const list = scenarios.data?.scenarios ?? [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Save a named scenario</h3>
        <div className="flex flex-wrap items-end gap-3">
          <input className={`${input} w-44`} placeholder="Scenario name" aria-label="Scenario name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <label className="text-[11px] text-emerald-600">steps {steps}
            <input type="range" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
              aria-label="Steps" className="block" />
          </label>
          <label className="text-[11px] text-emerald-600">growth {growth.toFixed(2)}
            <input type="range" min={-0.5} max={0.5} step={0.01} value={growth}
              onChange={(e) => setGrowth(Number(e.target.value))} aria-label="Growth" className="block" />
          </label>
          <input className={`${input} flex-1 min-w-32`} placeholder="note (optional)" aria-label="Scenario note"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <button className={btn} disabled={!name || save.isPending} onClick={() => save.mutate()}>
            <Save className="h-3 w-3" /> Save
          </button>
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Scenario library</h3>
        {list.length === 0 ? (
          <p className="text-xs text-emerald-700">No saved scenarios.</p>
        ) : (
          <ul className="space-y-1">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Library className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{s.name}</span>
                <span className="font-mono text-emerald-600">steps {s.steps} · growth {s.growth}</span>
                {s.note && <span className="text-emerald-700">{s.note}</span>}
                <button className={`${btnGhost} ml-auto`} disabled={entities.length === 0 || rerun.isPending}
                  onClick={() => rerun.mutate(s)}>
                  <Play className="h-3 w-3" /> re-run
                </button>
                <button aria-label="Delete" className={btnGhost} onClick={() => del.mutate(s.id)}><Trash2 className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lastRun?.trajectory && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold text-emerald-300">
            Re-run result · {lastRun.name} <span className="text-emerald-700">(total {lastRun.total})</span>
          </h3>
          <ChartKit kind="line" data={chart.data} xKey="step" series={chart.series} height={260} />
        </div>
      )}
    </div>
  );
}

// ─── Ingest tab ─────────────────────────────────────────────────────────
function IngestTab({ entities, onIngested }: { entities: WmEntity[]; onIngested: () => void }) {
  const qc = useQueryClient();
  const [entityId, setEntityId] = useState('');
  const [attribute, setAttribute] = useState('value');
  const [mode, setMode] = useState<'set' | 'increment'>('set');
  const [value, setValue] = useState('0');
  const [source, setSource] = useState('manual');

  const log = useQuery({
    queryKey: ['wm-ingest-log'],
    queryFn: () => run<{ events: WmIngestEvent[] }>('ingest_log', { limit: 50 }),
  });
  const ingest = useMutation({
    mutationFn: () => run('ingest', { entityId, attribute, mode, value: Number(value) || 0, source }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wm-ingest-log'] }); onIngested(); },
  });

  const events = log.data?.events ?? [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Ingest an observation</h3>
        {entities.length === 0 ? (
          <p className="text-xs text-emerald-700">Create entities before ingesting data.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select className={input} aria-label="Target entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">entity…</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input className={`${input} w-28`} placeholder="attribute" aria-label="Attribute"
              value={attribute} onChange={(e) => setAttribute(e.target.value)} />
            <select className={input} aria-label="Ingest mode" value={mode} onChange={(e) => setMode(e.target.value as 'set' | 'increment')}>
              <option value="set">set</option>
              <option value="increment">increment</option>
            </select>
            <input className={`${input} w-24`} type="number" placeholder="value" aria-label="Value"
              value={value} onChange={(e) => setValue(e.target.value)} />
            <input className={`${input} w-28`} placeholder="source" aria-label="Source"
              value={source} onChange={(e) => setSource(e.target.value)} />
            <button className={btn} disabled={!entityId || ingest.isPending} onClick={() => ingest.mutate()}>
              {ingest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Ingest
            </button>
          </div>
        )}
        {ingest.isError && <p className="mt-2 text-xs text-rose-400">{(ingest.error as Error).message}</p>}
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Ingestion log</h3>
        {events.length === 0 ? (
          <p className="text-xs text-emerald-700">No ingestion events yet.</p>
        ) : (
          <ul className="space-y-1">
            {events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Upload className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{ev.entityName}</span>
                <span className="font-mono text-emerald-600">{ev.attribute}</span>
                <span className="rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px]">{ev.mode}</span>
                <span className="font-mono text-emerald-400">{ev.from} → {ev.to}</span>
                <span className="text-emerald-700">via {ev.source}</span>
                <span className="ml-auto text-[10px] text-emerald-800">{new Date(ev.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────
function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-emerald-200';
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-emerald-700">{label}</div>
      <div className={`font-mono text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
