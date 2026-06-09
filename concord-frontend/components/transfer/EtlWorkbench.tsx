'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * EtlWorkbench — the real Fivetran/Airbyte-style ETL surface for the
 * transfer lens. Every panel here is wired to a `transfer` domain macro:
 * connectors (connector-upsert/list/read/delete), pipelines + drag-connect
 * mapping editor (pipeline-upsert/list/delete, mapping-suggest), the
 * transformation engine, dry-run preview, scheduled/incremental sync
 * (run-sync, schedule-due), the transfer run log (run-log) and schema
 * drift detection (schema-drift). No hardcoded demo data.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import {
  Database, Plug, GitBranch, Play, FlaskConical, History, AlertTriangle,
  Plus, Trash2, RefreshCw, ArrowRight, Clock, ShieldCheck, X, Wand2,
} from 'lucide-react';

const DOMAIN = 'transfer';

interface SchemaField { name: string; type?: string }
interface Connector {
  id: string; name: string; role: 'source' | 'destination';
  kind: 'csv' | 'json' | 'inline'; payload?: string; rowCount?: number;
  schema?: SchemaField[]; updatedAt?: string;
}
interface Mapping { source: string; target: string; transforms?: any[] }
interface Schedule { mode: 'manual' | 'interval' | 'incremental'; intervalMinutes?: number; cdcKey?: string | null }
interface Pipeline {
  id: string; name: string; sourceConnectorId: string; destConnectorId?: string | null;
  mappings?: Mapping[]; derivedColumns?: any[]; validationRules?: any[];
  schedule?: Schedule; runCount?: number;
  lastRun?: { status: string; rowsWritten: number; rowsQuarantined: number } | null;
}
interface SyncRun {
  id: string; pipelineId: string; pipelineName: string; startedAt: string;
  finishedAt: string; mode: string; status: string;
  rowsRead: number; rowsProcessed: number; rowsWritten: number; rowsQuarantined: number;
  errors?: any[];
}

async function run<T = any>(name: string, params: Record<string, unknown>): Promise<T | null> {
  const r = await lensRun<T>(DOMAIN, name, params);
  return r.data?.ok ? (r.data.result as T) : null;
}

const STATUS_TONE: Record<string, string> = {
  success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  partial: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  failed: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
};

export function EtlWorkbench() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [runSummary, setRunSummary] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // selection
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<any>(null);
  const [drift, setDrift] = useState<Record<string, any>>({});
  const [due, setDue] = useState<any[]>([]);

  // connector draft
  const [cName, setCName] = useState('');
  const [cRole, setCRole] = useState<'source' | 'destination'>('source');
  const [cKind, setCKind] = useState<'csv' | 'json'>('csv');
  const [cPayload, setCPayload] = useState('');

  // pipeline draft
  const [pName, setPName] = useState('');
  const [pSource, setPSource] = useState('');
  const [pDest, setPDest] = useState('');

  const flash = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadConnectors = useCallback(async () => {
    const r = await run<{ connectors: Connector[] }>('connector-list', {});
    if (r) setConnectors(r.connectors || []);
  }, []);

  const loadPipelines = useCallback(async () => {
    const r = await run<{ pipelines: Pipeline[] }>('pipeline-list', {});
    if (r) setPipelines(r.pipelines || []);
  }, []);

  const loadRuns = useCallback(async () => {
    const r = await run<{ runs: SyncRun[]; summary: Record<string, number> }>('run-log', {});
    if (r) { setRuns(r.runs || []); setRunSummary(r.summary || {}); }
  }, []);

  const loadDue = useCallback(async () => {
    const r = await run<{ due: any[] }>('schedule-due', {});
    if (r) setDue(r.due || []);
  }, []);

  useEffect(() => {
    loadConnectors();
    loadPipelines();
    loadRuns();
    loadDue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── connector ops ─────────────────────────────────────────────────────
  const addConnector = useCallback(async () => {
    if (!cName.trim()) return;
    setBusy('connector');
    const r = await run<{ connector: Connector }>('connector-upsert', {
      name: cName.trim(), role: cRole, kind: cKind,
      payload: cPayload || (cKind === 'json' ? '[]' : ''),
    });
    setBusy(null);
    if (r) {
      flash(`Connector "${r.connector.name}" registered — ${r.connector.rowCount ?? 0} rows`);
      setCName(''); setCPayload('');
      loadConnectors();
    } else { flash('Connector creation failed'); }
  }, [cName, cRole, cKind, cPayload, flash, loadConnectors]);

  const removeConnector = useCallback(async (id: string) => {
    await run('connector-delete', { id });
    loadConnectors();
  }, [loadConnectors]);

  const checkDrift = useCallback(async (id: string) => {
    setBusy('drift:' + id);
    const r = await run<{ drift: any }>('schema-drift', { connectorId: id });
    setBusy(null);
    if (r) setDrift((d) => ({ ...d, [id]: r.drift }));
  }, []);

  // ── pipeline ops ──────────────────────────────────────────────────────
  const addPipeline = useCallback(async () => {
    if (!pName.trim() || !pSource) return;
    setBusy('pipeline');
    const r = await run<{ pipeline: Pipeline }>('pipeline-upsert', {
      name: pName.trim(), sourceConnectorId: pSource,
      destConnectorId: pDest || undefined,
    });
    setBusy(null);
    if (r) {
      flash(`Pipeline "${r.pipeline.name}" created`);
      setPName(''); setPSource(''); setPDest('');
      loadPipelines();
      setSelectedPipeline(r.pipeline.id);
    } else { flash('Pipeline creation failed'); }
  }, [pName, pSource, pDest, flash, loadPipelines]);

  const removePipeline = useCallback(async (id: string) => {
    await run('pipeline-delete', { id });
    if (selectedPipeline === id) setSelectedPipeline(null);
    loadPipelines();
  }, [selectedPipeline, loadPipelines]);

  const runSync = useCallback(async (id: string, mode?: string) => {
    setBusy('sync:' + id);
    const r = await run<{ run: SyncRun }>('run-sync', { pipelineId: id, ...(mode ? { mode } : {}) });
    setBusy(null);
    if (r) {
      flash(`Sync ${r.run.status}: ${r.run.rowsWritten} written, ${r.run.rowsQuarantined} quarantined`);
      loadRuns(); loadPipelines(); loadConnectors(); loadDue();
    } else { flash('Sync failed'); }
  }, [flash, loadRuns, loadPipelines, loadConnectors, loadDue]);

  const doDryRun = useCallback(async (id: string) => {
    setBusy('dry:' + id);
    const r = await run('dry-run', { pipelineId: id, sampleSize: 10 });
    setBusy(null);
    setDryRun(r);
  }, []);

  const selected = useMemo(
    () => pipelines.find((p) => p.id === selectedPipeline) || null,
    [pipelines, selectedPipeline],
  );

  // run-log chart data — rows written vs quarantined per run (chronological)
  const runChart = useMemo(
    () => runs.slice().reverse().map((r, i) => ({
      label: `#${i + 1}`,
      written: r.rowsWritten,
      quarantined: r.rowsQuarantined,
    })),
    [runs],
  );

  const runTimeline: TimelineEvent[] = useMemo(
    () => runs.map((r) => ({
      id: r.id,
      label: `${r.pipelineName} · ${r.rowsWritten}→`,
      time: r.finishedAt,
      tone: r.status === 'success' ? 'good' : r.status === 'failed' ? 'bad' : 'warn',
      detail: `${r.mode} sync — ${r.rowsProcessed} processed, ${r.rowsQuarantined} quarantined`,
    })),
    [runs],
  );

  const sources = connectors.filter((c) => c.role === 'source');
  const destinations = connectors.filter((c) => c.role === 'destination');

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200 flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5" /> {notice}
        </div>
      )}

      {/* live KPI strip — every number is macro-derived */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={Plug} label="Connectors" value={connectors.length} sub={`${sources.length} src / ${destinations.length} dst`} />
        <Kpi icon={GitBranch} label="Pipelines" value={pipelines.length} sub={`${due.length} due now`} />
        <Kpi icon={History} label="Sync runs" value={runSummary.totalRuns ?? 0} sub={`${runSummary.successRuns ?? 0} ok / ${runSummary.failedRuns ?? 0} fail`} />
        <Kpi icon={ArrowRight} label="Rows moved" value={runSummary.totalRowsTransferred ?? 0} sub="across all runs" />
        <Kpi icon={AlertTriangle} label="Quarantined" value={runSummary.totalRowsQuarantined ?? 0} sub="rejected rows" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Connectors ── */}
        <section className="panel p-4 space-y-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <Database className="w-4 h-4 text-neon-cyan" /> Connectors
            <span className="text-[10px] text-gray-400">read/write CSV · JSON sources</span>
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Connector name…" className="input-lattice text-xs col-span-2" />
            <select value={cRole} onChange={(e) => setCRole(e.target.value as any)} className="input-lattice text-xs">
              <option value="source">source</option>
              <option value="destination">destination</option>
            </select>
            <select value={cKind} onChange={(e) => setCKind(e.target.value as any)} className="input-lattice text-xs">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <textarea
            value={cPayload}
            onChange={(e) => setCPayload(e.target.value)}
            placeholder={cKind === 'csv' ? 'id,name,email\n1,Alice,a@x.com' : '[{"id":1,"name":"Alice"}]'}
            className="input-lattice w-full h-20 resize-none text-xs font-mono"
          />
          <button onClick={addConnector} disabled={!cName.trim() || busy === 'connector'} className="btn-neon w-full text-xs flex items-center justify-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> {busy === 'connector' ? 'Probing…' : 'Register connector'}
          </button>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {connectors.length === 0 && <p className="text-center py-3 text-gray-400 text-xs">No connectors yet.</p>}
            {connectors.map((c) => {
              const d = drift[c.id];
              return (
                <div key={c.id} className="lens-card text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium flex items-center gap-1.5">
                      <span className={`px-1 rounded text-[9px] uppercase ${c.role === 'source' ? 'bg-neon-cyan/15 text-neon-cyan' : 'bg-neon-purple/15 text-neon-purple'}`}>{c.role}</span>
                      {c.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => checkDrift(c.id)} disabled={busy === 'drift:' + c.id} title="Schema drift" className="p-1 rounded hover:bg-white/10 text-gray-400">
                        <RefreshCw className={`w-3 h-3 ${busy === 'drift:' + c.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button aria-label="Delete" onClick={() => removeConnector(c.id)} className="p-1 rounded hover:bg-rose-500/20 text-rose-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <p className="text-gray-400">
                    {c.kind.toUpperCase()} · {c.rowCount ?? 0} rows · {(c.schema || []).length} fields
                  </p>
                  {(c.schema || []).length > 0 && (
                    <p className="text-[10px] text-gray-400 truncate">
                      {(c.schema || []).map((f) => `${f.name}:${f.type || '?'}`).join('  ')}
                    </p>
                  )}
                  {d && (
                    <p className={`text-[10px] ${d.hasDrift ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {d.firstSnapshot ? 'Drift baseline captured' : d.hasDrift
                        ? `Drift: +${d.added.length} −${d.removed.length} ~${d.typeChanged.length}`
                        : 'No schema drift'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Pipelines ── */}
        <section className="panel p-4 space-y-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <GitBranch className="w-4 h-4 text-neon-purple" /> Pipelines
            {due.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {due.length} due
              </span>
            )}
          </h3>
          <div className="space-y-2">
            <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Pipeline name…" className="input-lattice text-xs w-full" />
            <div className="grid grid-cols-2 gap-2">
              <select value={pSource} onChange={(e) => setPSource(e.target.value)} className="input-lattice text-xs">
                <option value="">source…</option>
                {sources.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={pDest} onChange={(e) => setPDest(e.target.value)} className="input-lattice text-xs">
                <option value="">destination (opt)…</option>
                {destinations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button onClick={addPipeline} disabled={!pName.trim() || !pSource || busy === 'pipeline'} className="btn-neon purple w-full text-xs flex items-center justify-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> {busy === 'pipeline' ? 'Creating…' : 'Create pipeline'}
            </button>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {pipelines.length === 0 && <p className="text-center py-3 text-gray-400 text-xs">No pipelines yet.</p>}
            {pipelines.map((p) => (
              <div
                key={p.id}
                className={`lens-card text-xs space-y-1.5 cursor-pointer ${selectedPipeline === p.id ? 'ring-1 ring-neon-purple/60' : ''}`}
                onClick={() => setSelectedPipeline(p.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] px-1 rounded bg-white/5 text-gray-400">{p.schedule?.mode || 'manual'}</span>
                    <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); removePipeline(p.id); }} className="p-1 rounded hover:bg-rose-500/20 text-rose-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <p className="text-gray-400">
                  {(p.mappings || []).length} mappings · {p.runCount ?? 0} runs
                  {p.lastRun && <span className={`ml-1 ${STATUS_TONE[p.lastRun.status]?.split(' ')[0] || ''}`}> · last {p.lastRun.status}</span>}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={(e) => { e.stopPropagation(); doDryRun(p.id); }} disabled={busy === 'dry:' + p.id} className="px-2 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 flex items-center gap-1">
                    <FlaskConical className="w-3 h-3" /> Dry-run
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); runSync(p.id); }} disabled={busy === 'sync:' + p.id} className="px-2 py-0.5 rounded bg-neon-green/10 text-neon-green border border-neon-green/30 flex items-center gap-1">
                    <Play className="w-3 h-3" /> {busy === 'sync:' + p.id ? 'Syncing…' : 'Run sync'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); runSync(p.id, 'incremental'); }} disabled={busy === 'sync:' + p.id} className="px-2 py-0.5 rounded bg-neon-purple/10 text-neon-purple border border-neon-purple/30 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Incremental
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Mapping editor for the selected pipeline ── */}
      {selected && (
        <MappingEditor
          pipeline={selected}
          connectors={connectors}
          onSaved={() => { loadPipelines(); flash('Mapping saved'); }}
        />
      )}

      {/* ── Dry-run preview ── */}
      {dryRun && (
        <section className="panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2 text-sm">
              <FlaskConical className="w-4 h-4 text-neon-cyan" /> Dry-run preview
            </h3>
            <button onClick={() => setDryRun(null)} className="p-1 rounded hover:bg-white/10 text-gray-400"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-gray-400">
            {dryRun.sampled}/{dryRun.totalSourceRows} rows sampled —
            <span className="text-emerald-400"> {dryRun.wouldPass} would commit</span>,
            <span className="text-amber-400"> {dryRun.wouldQuarantine} would quarantine</span>.
            Output columns: {(dryRun.outputColumns || []).join(', ') || '—'}
          </p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {(dryRun.preview || []).map((row: any, i: number) => (
              <div key={i} className={`rounded p-2 text-[11px] font-mono ${row.passed ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-rose-500/5 border border-rose-500/20'}`}>
                <div className="text-gray-300">{JSON.stringify(row.outputRow)}</div>
                {!row.passed && (
                  <div className="text-rose-400 mt-0.5">
                    ✗ {(row.failures || []).map((f: any) => f.message).join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Run log + chart ── */}
      <section className="panel p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <History className="w-4 h-4 text-neon-blue" /> Transfer run log
        </h3>
        {runs.length === 0 ? (
          <p className="text-center py-4 text-gray-400 text-xs">No sync runs yet — create a pipeline and run a sync.</p>
        ) : (
          <>
            <ChartKit
              kind="bar"
              data={runChart}
              xKey="label"
              series={[
                { key: 'written', label: 'Rows written', color: '#22c55e' },
                { key: 'quarantined', label: 'Quarantined', color: '#f59e0b' },
              ]}
              height={180}
              stacked
            />
            <TimelineView events={runTimeline} />
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {runs.map((r) => (
                <div key={r.id} className="lens-card text-xs flex items-center justify-between">
                  <div>
                    <p className="font-medium">{r.pipelineName}</p>
                    <p className="text-gray-400">
                      {new Date(r.finishedAt).toLocaleString()} · {r.mode} · {r.rowsProcessed} processed
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${STATUS_TONE[r.status] || 'text-gray-400 border-gray-600'}`}>{r.status}</span>
                    <p className="text-gray-400 mt-0.5">{r.rowsWritten} ✓ / {r.rowsQuarantined} ⚠</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: number; sub: string }) {
  return (
    <div className="lens-card">
      <Icon className="w-4 h-4 text-neon-cyan mb-1.5" />
      <p className="text-xl font-bold">{value.toLocaleString()}</p>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}

// ── Drag-connect mapping editor + transformation pipeline + validation ──
const TRANSFORM_TYPES = ['cast', 'uppercase', 'lowercase', 'trim', 'default', 'multiply', 'replace'];
const RULE_TYPES = ['required', 'type', 'range', 'pattern', 'enum'];

function MappingEditor({
  pipeline, connectors, onSaved,
}: {
  pipeline: Pipeline;
  connectors: Connector[];
  onSaved: () => void;
}) {
  const src = connectors.find((c) => c.id === pipeline.sourceConnectorId);
  const dst = connectors.find((c) => c.id === pipeline.destConnectorId);
  const [mappings, setMappings] = useState<Mapping[]>(pipeline.mappings || []);
  const [derived, setDerived] = useState<any[]>(pipeline.derivedColumns || []);
  const [rules, setRules] = useState<any[]>(pipeline.validationRules || []);
  const [schedule, setSchedule] = useState<Schedule>(pipeline.schedule || { mode: 'manual' });
  const [dragField, setDragField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMappings(pipeline.mappings || []);
    setDerived(pipeline.derivedColumns || []);
    setRules(pipeline.validationRules || []);
    setSchedule(pipeline.schedule || { mode: 'manual' });
  }, [pipeline]);

  const srcFields = src?.schema || [];
  const tgtFields = dst?.schema || srcFields;

  const autoSuggest = useCallback(async () => {
    const r = await run<{ mappings: Mapping[] }>('mapping-suggest', { pipelineId: pipeline.id });
    if (r) setMappings(r.mappings || []);
  }, [pipeline.id]);

  const dropOnTarget = useCallback((target: string) => {
    if (!dragField) return;
    setMappings((m) => [...m.filter((x) => x.target !== target && x.source !== dragField), { source: dragField, target, transforms: [] }]);
    setDragField(null);
  }, [dragField]);

  const save = useCallback(async () => {
    setSaving(true);
    await run('pipeline-upsert', {
      id: pipeline.id, name: pipeline.name, sourceConnectorId: pipeline.sourceConnectorId,
      destConnectorId: pipeline.destConnectorId || undefined,
      mappings, derivedColumns: derived, validationRules: rules, schedule,
    });
    setSaving(false);
    onSaved();
  }, [pipeline, mappings, derived, rules, schedule, onSaved]);

  return (
    <section className="panel p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Wand2 className="w-4 h-4 text-neon-purple" /> Mapping editor — {pipeline.name}
        </h3>
        <div className="flex gap-2">
          <button onClick={autoSuggest} className="px-2 py-1 rounded text-xs bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30">Auto-suggest</button>
          <button onClick={save} disabled={saving} className="btn-neon purple text-xs px-3">{saving ? 'Saving…' : 'Save pipeline'}</button>
        </div>
      </div>

      {/* drag-connect field grid */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
        <div className="space-y-1">
          <p className="text-[10px] uppercase text-gray-400">Source fields ({src?.name || '—'})</p>
          {srcFields.length === 0 && <p className="text-xs text-gray-400">Source has no fields.</p>}
          {srcFields.map((f) => (
            <div
              key={f.name}
              draggable
              onDragStart={() => setDragField(f.name)}
              className={`rounded px-2 py-1 text-xs cursor-grab border ${mappings.some((m) => m.source === f.name) ? 'border-neon-green/40 bg-neon-green/5' : 'border-white/10 bg-white/5'}`}
            >
              {f.name} <span className="text-gray-600">:{f.type || '?'}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center pt-6 text-gray-600"><ArrowRight className="w-5 h-5" /></div>
        <div className="space-y-1">
          <p className="text-[10px] uppercase text-gray-400">Target fields ({dst?.name || 'mirror source'})</p>
          {tgtFields.map((f) => {
            const m = mappings.find((x) => x.target === f.name);
            return (
              <div
                key={f.name}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOnTarget(f.name)}
                className={`rounded px-2 py-1 text-xs border ${m ? 'border-neon-purple/40 bg-neon-purple/10' : 'border-dashed border-white/15 bg-white/[0.02]'}`}
              >
                {f.name} <span className="text-gray-600">:{f.type || '?'}</span>
                {m && <span className="text-neon-green ml-1">← {m.source}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* mappings + transforms */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase text-gray-400">Field mappings &amp; transforms</p>
        {mappings.length === 0 && <p className="text-xs text-gray-400">Drag a source field onto a target, or auto-suggest.</p>}
        {mappings.map((m, i) => (
          <div key={i} className="lens-card text-xs flex flex-wrap items-center gap-2">
            <span className="text-neon-green">{m.source}</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="text-neon-purple">{m.target}</span>
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const t = e.target.value === 'cast' ? { type: 'cast', to: 'string' } : { type: e.target.value };
                setMappings((mm) => mm.map((x, j) => j === i ? { ...x, transforms: [...(x.transforms || []), t] } : x));
              }}
              className="input-lattice text-[10px] py-0.5"
            >
              <option value="">+ transform</option>
              {TRANSFORM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {(m.transforms || []).map((t: any, ti: number) => (
              <span key={ti} className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] flex items-center gap-1">
                {t.type}{t.to ? `→${t.to}` : ''}
                <button onClick={() => setMappings((mm) => mm.map((x, j) => j === i ? { ...x, transforms: (x.transforms || []).filter((_: any, k: number) => k !== ti) } : x))} className="text-rose-400"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
            <button aria-label="Delete" onClick={() => setMappings((mm) => mm.filter((_, j) => j !== i))} className="ml-auto text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      {/* derived columns */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase text-gray-400">Derived columns</p>
          <button onClick={() => setDerived((d) => [...d, { name: `derived_${d.length + 1}`, from: srcFields[0]?.name || '', transforms: [] }])} className="text-[10px] text-neon-cyan">+ add</button>
        </div>
        {derived.map((d, i) => (
          <div key={i} className="lens-card text-xs flex items-center gap-2">
            <input value={d.name} onChange={(e) => setDerived((dd) => dd.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="input-lattice text-[10px] py-0.5 w-28" />
            <span className="text-gray-400">from</span>
            <select value={d.from} onChange={(e) => setDerived((dd) => dd.map((x, j) => j === i ? { ...x, from: e.target.value } : x))} className="input-lattice text-[10px] py-0.5">
              {srcFields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
            <button aria-label="Delete" onClick={() => setDerived((dd) => dd.filter((_, j) => j !== i))} className="ml-auto text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      {/* validation rules */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase text-gray-400">Validation rules (failures route to quarantine)</p>
          <button onClick={() => setRules((r) => [...r, { type: 'required', field: tgtFields[0]?.name || '' }])} className="text-[10px] text-neon-cyan">+ add</button>
        </div>
        {rules.map((r, i) => (
          <div key={i} className="lens-card text-xs flex flex-wrap items-center gap-2">
            <select value={r.type} onChange={(e) => setRules((rr) => rr.map((x, j) => j === i ? { type: e.target.value, field: x.field } : x))} className="input-lattice text-[10px] py-0.5">
              {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="text-gray-400">on</span>
            <input value={r.field} onChange={(e) => setRules((rr) => rr.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} placeholder="field" className="input-lattice text-[10px] py-0.5 w-28" />
            {r.type === 'type' && (
              <input value={r.dataType || ''} onChange={(e) => setRules((rr) => rr.map((x, j) => j === i ? { ...x, dataType: e.target.value } : x))} placeholder="number|date|boolean" className="input-lattice text-[10px] py-0.5 w-32" />
            )}
            {r.type === 'range' && (
              <>
                <input type="number" value={r.min ?? ''} onChange={(e) => setRules((rr) => rr.map((x, j) => j === i ? { ...x, min: e.target.value === '' ? undefined : Number(e.target.value) } : x))} placeholder="min" className="input-lattice text-[10px] py-0.5 w-16" />
                <input type="number" value={r.max ?? ''} onChange={(e) => setRules((rr) => rr.map((x, j) => j === i ? { ...x, max: e.target.value === '' ? undefined : Number(e.target.value) } : x))} placeholder="max" className="input-lattice text-[10px] py-0.5 w-16" />
              </>
            )}
            {r.type === 'pattern' && (
              <input value={r.pattern || ''} onChange={(e) => setRules((rr) => rr.map((x, j) => j === i ? { ...x, pattern: e.target.value } : x))} placeholder="regex" className="input-lattice text-[10px] py-0.5 w-32" />
            )}
            {r.type === 'enum' && (
              <input value={(r.values || []).join(',')} onChange={(e) => setRules((rr) => rr.map((x, j) => j === i ? { ...x, values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x))} placeholder="a,b,c" className="input-lattice text-[10px] py-0.5 w-32" />
            )}
            <button aria-label="Delete" onClick={() => setRules((rr) => rr.filter((_, j) => j !== i))} className="ml-auto text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      {/* schedule */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase text-gray-400">Sync schedule</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={schedule.mode} onChange={(e) => setSchedule((s) => ({ ...s, mode: e.target.value as any }))} className="input-lattice text-[11px] py-0.5">
            <option value="manual">manual</option>
            <option value="interval">interval</option>
            <option value="incremental">incremental (CDC)</option>
          </select>
          {schedule.mode !== 'manual' && (
            <>
              <span className="text-gray-400">every</span>
              <input type="number" value={schedule.intervalMinutes ?? 60} onChange={(e) => setSchedule((s) => ({ ...s, intervalMinutes: Number(e.target.value) }))} className="input-lattice text-[11px] py-0.5 w-20" />
              <span className="text-gray-400">min</span>
            </>
          )}
          {schedule.mode === 'incremental' && (
            <>
              <span className="text-gray-400">CDC cursor field</span>
              <select value={schedule.cdcKey || ''} onChange={(e) => setSchedule((s) => ({ ...s, cdcKey: e.target.value || null }))} className="input-lattice text-[11px] py-0.5">
                <option value="">—</option>
                {srcFields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
