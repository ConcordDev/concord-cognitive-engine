'use client';

import { useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Columns, Plus, Trash2, Play, Loader2, Table2, Workflow } from 'lucide-react';

type AnalysisTab = 'schema' | 'quality' | 'migration';

interface FieldRow { id: string; name: string; type: string }
interface EntityRow { id: string; name: string; size: number; priority: number; dependencies: string }

const FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'array', 'object'];
const uid = () => Math.random().toString(36).slice(2, 9);

function StatChip({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  const cls = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-neon-green' : 'text-white';
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-sm font-semibold font-mono ${cls}`}>{value}</p>
    </div>
  );
}

function FieldListEditor({
  title, fields, onAdd, onRemove, draft, setDraft,
}: {
  title: string;
  fields: FieldRow[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  draft: { name: string; type: string };
  setDraft: (d: { name: string; type: string }) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
      <h3 className="text-xs font-semibold text-gray-300">{title}</h3>
      <div className="flex gap-2">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          placeholder="field name" className="input-lattice flex-1 text-xs" />
        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className="input-lattice text-xs">
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={onAdd} disabled={!draft.name.trim()} className="btn-secondary text-xs px-2 disabled:opacity-40"><Plus className="w-3 h-3" /></button>
      </div>
      <div className="flex flex-wrap gap-1">
        {fields.map((f) => (
          <span key={f.id} className="flex items-center gap-1 rounded bg-black/40 px-2 py-1 text-[11px] text-gray-300">
            {f.name}<span className="text-gray-500">:{f.type}</span>
            <button onClick={() => onRemove(f.id)} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </span>
        ))}
        {fields.length === 0 && <span className="text-[11px] text-gray-600">No fields yet</span>}
      </div>
    </div>
  );
}

export function TransferAnalysisPanel() {
  const [tab, setTab] = useState<AnalysisTab>('schema');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Schema Mapping ────────────────────────────────────────────────────
  const [sourceFields, setSourceFields] = useState<FieldRow[]>([]);
  const [targetFields, setTargetFields] = useState<FieldRow[]>([]);
  const [sourceDraft, setSourceDraft] = useState({ name: '', type: 'string' });
  const [targetDraft, setTargetDraft] = useState({ name: '', type: 'string' });
  const [mappingResult, setMappingResult] = useState<Record<string, unknown> | null>(null);

  const runSchemaMapping = async () => {
    if (sourceFields.length === 0 || targetFields.length === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await lensRun('transfer', 'schemaMapping', {
        sourceSchema: sourceFields.map((f) => ({ name: f.name, type: f.type })),
        targetSchema: targetFields.map((f) => ({ name: f.name, type: f.type })),
      });
      if (res.data.ok === false) setError(res.data.error || 'Schema mapping failed');
      else setMappingResult(res.data.result as Record<string, unknown>);
    } catch (e) { setError(e instanceof Error ? e.message : 'Schema mapping failed'); }
    finally { setBusy(false); }
  };

  // ── Data Quality (CSV sample → records) ──────────────────────────────
  const [csvText, setCsvText] = useState('id,email,signup_date\n1,a@x.com,2026-01-05\n2,,2026-02-11\n3,c@x.com,not-a-date');
  const [qualityResult, setQualityResult] = useState<Record<string, unknown> | null>(null);
  const parsedRecords = useMemo(() => {
    const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return { header: [] as string[], records: [] as Record<string, string>[] };
    const header = lines[0].split(',').map((h) => h.trim());
    const records = lines.slice(1).map((line) => {
      const cells = line.split(',');
      const rec: Record<string, string> = {};
      header.forEach((h, i) => { rec[h] = (cells[i] ?? '').trim(); });
      return rec;
    });
    return { header, records };
  }, [csvText]);

  const runDataQuality = async () => {
    if (parsedRecords.records.length === 0) return;
    setBusy(true); setError(null);
    try {
      const schema = parsedRecords.header.map((name) => ({
        name,
        type: name.toLowerCase().includes('date') ? 'date' : name.toLowerCase().includes('id') ? 'number' : 'string',
        required: name.toLowerCase() === 'id',
      }));
      const res = await lensRun('transfer', 'dataQuality', { records: parsedRecords.records, schema });
      if (res.data.ok === false) setError(res.data.error || 'Data quality assessment failed');
      else setQualityResult(res.data.result as Record<string, unknown>);
    } catch (e) { setError(e instanceof Error ? e.message : 'Data quality assessment failed'); }
    finally { setBusy(false); }
  };

  // ── Migration Plan ────────────────────────────────────────────────────
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [entityDraft, setEntityDraft] = useState<Omit<EntityRow, 'id'>>({ name: '', size: 1000, priority: 5, dependencies: '' });
  const [batchSizeLimit, setBatchSizeLimit] = useState(5000);
  const [migrationResult, setMigrationResult] = useState<Record<string, unknown> | null>(null);
  const entityIds = useMemo(() => entities.map((e) => e.name), [entities]);

  const addEntity = () => {
    if (!entityDraft.name.trim()) return;
    setEntities((prev) => [...prev, { id: uid(), ...entityDraft, name: entityDraft.name.trim() }]);
    setEntityDraft({ name: '', size: 1000, priority: 5, dependencies: '' });
  };
  const removeEntity = (id: string) => setEntities((prev) => prev.filter((e) => e.id !== id));

  const runMigrationPlan = async () => {
    if (entities.length === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await lensRun('transfer', 'migrationPlan', {
        entities: entities.map((e) => ({
          id: e.name, name: e.name, size: e.size, priority: e.priority,
          dependencies: e.dependencies.split(',').map((d) => d.trim()).filter(Boolean),
        })),
        batchSizeLimit,
      });
      if (res.data.ok === false) setError(res.data.error || 'Migration plan failed');
      else setMigrationResult(res.data.result as Record<string, unknown>);
    } catch (e) { setError(e instanceof Error ? e.message : 'Migration plan failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Workflow className="w-4 h-4 text-neon-purple" /> Migration Analysis
        </h2>
        <div className="flex gap-1 rounded-lg bg-lattice-deep p-1 text-xs">
          {([
            { key: 'schema', label: 'Schema Mapping', icon: Columns },
            { key: 'quality', label: 'Data Quality', icon: Table2 },
            { key: 'migration', label: 'Migration Plan', icon: Workflow },
          ] as const).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${tab === t.key ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white'}`}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">{error}</p>}

      {tab === 'schema' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Define a source and target field list — the real Levenshtein + type-compatibility +
            hierarchical-path matcher below computes an actual best-match mapping, not a guess.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldListEditor title="Source schema" fields={sourceFields}
              onAdd={() => { if (!sourceDraft.name.trim()) return; setSourceFields((p) => [...p, { id: uid(), ...sourceDraft }]); setSourceDraft({ name: '', type: 'string' }); }}
              onRemove={(id) => setSourceFields((p) => p.filter((f) => f.id !== id))}
              draft={sourceDraft} setDraft={setSourceDraft} />
            <FieldListEditor title="Target schema" fields={targetFields}
              onAdd={() => { if (!targetDraft.name.trim()) return; setTargetFields((p) => [...p, { id: uid(), ...targetDraft }]); setTargetDraft({ name: '', type: 'string' }); }}
              onRemove={(id) => setTargetFields((p) => p.filter((f) => f.id !== id))}
              draft={targetDraft} setDraft={setTargetDraft} />
          </div>
          <button onClick={runSchemaMapping} disabled={busy || sourceFields.length === 0 || targetFields.length === 0}
            className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Map Schemas
          </button>
          {mappingResult && !('message' in mappingResult) && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatChip label="Mappings" value={String(mappingResult.mappingCount ?? 0)} />
                <StatChip label="Avg confidence" value={String(mappingResult.averageConfidence ?? 0)} />
                <StatChip label="Transforms needed" value={String(mappingResult.transformsRequired ?? 0)} />
                <StatChip
                  label="Required mapped"
                  value={(mappingResult.coverage as Record<string, unknown>)?.allRequiredMapped ? 'yes' : 'no'}
                  tone={(mappingResult.coverage as Record<string, unknown>)?.allRequiredMapped ? 'good' : 'bad'}
                />
              </div>
              <div className="space-y-1">
                {(mappingResult.mappings as Array<Record<string, unknown>> | undefined)?.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 rounded bg-black/30 px-2 py-1 text-[11px]">
                    <span className="text-gray-300">{String(m.source)}</span>
                    <span className="text-gray-600">→</span>
                    <span className="text-gray-300">{String(m.target)}</span>
                    <span className={`ml-auto ${m.confidence === 'high' ? 'text-neon-green' : m.confidence === 'medium' ? 'text-amber-400' : 'text-gray-500'}`}>{String(m.confidence)} · {String(m.combinedScore)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'quality' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Paste a CSV sample (header row + data rows) — completeness, accuracy, consistency and
            timeliness are scored per field for real from the parsed records below.
          </p>
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={5}
            className="input-lattice w-full font-mono text-xs" placeholder="header1,header2\nvalue1,value2" />
          <p className="text-[11px] text-gray-500">Parsed {parsedRecords.records.length} record(s) across {parsedRecords.header.length} field(s).</p>
          <button onClick={runDataQuality} disabled={busy || parsedRecords.records.length === 0}
            className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Assess Quality
          </button>
          {qualityResult && typeof qualityResult.overallQuality === 'object' && (
            <div className="space-y-2">
              {(() => {
                const q = qualityResult.overallQuality as Record<string, unknown>;
                const grade = String(q.grade ?? '-');
                return (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <StatChip label="Grade" value={grade} tone={grade === 'A' || grade === 'B' ? 'good' : grade === 'C' ? 'warn' : 'bad'} />
                    <StatChip label="Completeness" value={String(q.completeness)} />
                    <StatChip label="Accuracy" value={String(q.accuracy)} />
                    <StatChip label="Consistency" value={String(q.consistency)} />
                    <StatChip label="Readiness" value={String(qualityResult.transferReadiness)} tone={qualityResult.transferReadiness === 'ready' ? 'good' : 'warn'} />
                  </div>
                );
              })()}
              {Array.isArray(qualityResult.criticalIssues) && qualityResult.criticalIssues.length > 0 && (
                <ul className="space-y-0.5 text-xs text-rose-300">
                  {(qualityResult.criticalIssues as Array<{ field: string; issue: string }>).map((c, i) => (
                    <li key={i}>• {c.field}: {c.issue.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'migration' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            List entities to migrate (with dependencies) — a real topological sort orders them,
            batches by size limit, and inserts rollback checkpoints.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <input value={entityDraft.name} onChange={(e) => setEntityDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="entity name" className="input-lattice text-xs" />
            <input type="number" min={1} value={entityDraft.size} onChange={(e) => setEntityDraft((d) => ({ ...d, size: Number(e.target.value) || 1 }))}
              placeholder="row count" className="input-lattice text-xs" />
            <input type="number" min={1} max={10} value={entityDraft.priority} onChange={(e) => setEntityDraft((d) => ({ ...d, priority: Number(e.target.value) || 5 }))}
              placeholder="priority" className="input-lattice text-xs" />
            <select multiple value={entityDraft.dependencies ? entityDraft.dependencies.split(',') : []}
              onChange={(e) => setEntityDraft((d) => ({ ...d, dependencies: Array.from(e.target.selectedOptions).map((o) => o.value).join(',') }))}
              className="input-lattice text-xs h-16" disabled={entityIds.length === 0}>
              {entityIds.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={addEntity} disabled={!entityDraft.name.trim()} className="btn-secondary text-xs flex items-center justify-center gap-1 disabled:opacity-40">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {entities.length > 0 && (
            <div className="space-y-1">
              {entities.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded bg-black/30 px-2 py-1 text-xs">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-gray-500">{e.size} rows · pri {e.priority}</span>
                  <span className="flex-1 text-gray-500">{e.dependencies ? `depends on ${e.dependencies}` : 'no dependencies'}</span>
                  <button onClick={() => removeEntity(e.id)} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Batch size limit</label>
            <input type="number" min={1} value={batchSizeLimit} onChange={(e) => setBatchSizeLimit(Number(e.target.value) || 1000)}
              className="input-lattice w-24 text-xs" />
            <button onClick={runMigrationPlan} disabled={busy || entities.length === 0} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Build Plan
            </button>
          </div>
          {migrationResult && typeof migrationResult.summary === 'object' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatChip label="Batches" value={String((migrationResult.summary as Record<string, unknown>)?.totalBatches ?? 0)} />
                <StatChip label="Checkpoints" value={String((migrationResult.summary as Record<string, unknown>)?.totalCheckpoints ?? 0)} />
                <StatChip label="Steps" value={String(migrationResult.estimatedSteps ?? 0)} />
                {(() => {
                  const circ = migrationResult.circularDependencies as { detected?: boolean; entities?: string[] } | undefined;
                  return (
                    <StatChip
                      label="Circular deps"
                      value={circ?.detected ? `${circ.entities?.length ?? 0} entities` : 'none'}
                      tone={circ?.detected ? 'bad' : 'good'}
                    />
                  );
                })()}
              </div>
              {Array.isArray(migrationResult.criticalPath) && migrationResult.criticalPath.length > 0 && (
                <p className="text-xs text-gray-400">Critical path: {(migrationResult.criticalPath as string[]).map((c, i) => <span key={i} className="ml-1 text-neon-cyan">{c}</span>)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
