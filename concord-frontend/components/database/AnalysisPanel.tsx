'use client';

// Analysis (S8): the workspace dashboard + the analysis quartet
// (schemaAnalysis / queryOptimize / migrationPlan / indexRecommendation)
// wired to REAL inputs — the workspace datasets, the server-side query
// history, and the user's own described changes. Results are held in a
// module cache so they survive tab switches (panels unmount).
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useWorkspaceTables } from './use-workspace-tables';
import { useWorkspaceIndexes } from './use-workspace-indexes';

interface HistoryEntry { sql: string; at: string; success: boolean; durationMs: number; connectionName: string | null }
interface SchemaAnalysisResult {
  message?: string; healthScore?: number; totalTables?: number; totalColumns?: number; totalIssues?: number;
  normalizationTip?: string;
  tables?: { table: string; columns: number; hasPrimaryKey: boolean; hasForeignKeys: boolean; indexedColumns: number; issues: string[] }[];
}
interface OptimizeResult { message?: string; grade?: string; issueCount?: number; issues?: { issue: string; fix: string; severity: string }[] }
interface MigrationResult { message?: string; recommendation?: string; estimatedDowntime?: string; highRiskChanges?: number; steps?: { step: number; operation: string; table: string; column?: string; description: string; risk: string; reversible: boolean; rollback: string }[] }
interface IndexRecResult { recommendations?: { column: string; reason: string; type: string }[]; queriesAnalyzed?: number; suggestedIndexes?: number; estimatedSpeedup?: string }

const cache: {
  schema?: SchemaAnalysisResult | null;
  optimize?: OptimizeResult | null;
  migration?: MigrationResult | null;
  indexRec?: IndexRecResult | null;
  queryText?: string;
} = {};

export function AnalysisPanel() {
  const { tables, connectionCount } = useWorkspaceTables();
  const ws = useWorkspaceIndexes();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [designer, setDesigner] = useState<{ schemas: number; totalTables: number; totalRelations: number } | null>(null);
  const [schemaRes, setSchemaRes] = useState<SchemaAnalysisResult | null | undefined>(cache.schema);
  const [optRes, setOptRes] = useState<OptimizeResult | null | undefined>(cache.optimize);
  const [migRes, setMigRes] = useState<MigrationResult | null | undefined>(cache.migration);
  const [recRes, setRecRes] = useState<IndexRecResult | null | undefined>(cache.indexRec);
  const [queryText, setQueryText] = useState(cache.queryText || '');
  const [changes, setChanges] = useState<{ type: string; table: string; column: string; description: string }[]>([
    { type: 'add', table: '', column: '', description: '' },
  ]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    (async () => {
      const h = await lensRun<{ entries: HistoryEntry[] }>('database', 'query-history', { limit: 50 });
      if (live && h.data.ok && h.data.result) {
        setHistory(h.data.result.entries);
        if (!cache.queryText && h.data.result.entries.length > 0) {
          setQueryText(h.data.result.entries[0].sql);
        }
      }
      const d = await lensRun<{ schemas: number; totalTables: number; totalRelations: number }>('database', 'schema-dashboard', {});
      if (live && d.data.ok && d.data.result) setDesigner(d.data.result);
    })();
    return () => { live = false; };
  }, []);

  const tablesPayload = useCallback(() => tables.map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => ({
      name: c.name, type: c.type,
      primaryKey: !!c.isPrimary,
      foreignKey: !!c.isForeign,
      indexed: ws.indexes.some((ix) => ix.dataset === t.name && ix.columns.includes(c.name)),
      nullable: true,
    })),
  })), [tables, ws.indexes]);

  const runSchema = useCallback(async () => {
    setBusyKey('schema');
    const r = await lensRun<SchemaAnalysisResult>('database', 'schemaAnalysis', { input: { tables: tablesPayload() } });
    setBusyKey(null);
    cache.schema = r.data.result ?? null;
    setSchemaRes(cache.schema);
  }, [tablesPayload]);

  const runOptimize = useCallback(async () => {
    setBusyKey('optimize');
    cache.queryText = queryText;
    const r = await lensRun<OptimizeResult>('database', 'queryOptimize', { input: { query: queryText } });
    setBusyKey(null);
    cache.optimize = r.data.result ?? null;
    setOptRes(cache.optimize);
  }, [queryText]);

  const runMigration = useCallback(async () => {
    setBusyKey('migration');
    const filled = changes.filter((c) => c.table.trim());
    const r = await lensRun<MigrationResult>('database', 'migrationPlan', { input: { changes: filled } });
    setBusyKey(null);
    cache.migration = r.data.result ?? null;
    setMigRes(cache.migration);
  }, [changes]);

  const runRecs = useCallback(async () => {
    setBusyKey('recs');
    const r = await lensRun<IndexRecResult>('database', 'indexRecommendation', {
      input: { tables: tablesPayload(), queries: history.map((h) => h.sql) },
    });
    setBusyKey(null);
    cache.indexRec = r.data.result ?? null;
    setRecRes(cache.indexRec);
  }, [tablesPayload, history]);

  const applyRec = useCallback(async (column: string) => {
    const target = tables.find((t) => t.columns.some((c) => c.name === column));
    if (!target) return;
    await ws.createIndex(target.connectionId, target.name, column);
    setApplied((s) => new Set(s).add(column));
  }, [tables, ws]);

  const totalRows = tables.reduce((n, t) => n + t.rowCount, 0);
  const relationCount = tables.reduce((n, t) => n + t.columns.filter((c) => c.isForeign).length, 0);

  return (
    <div className="space-y-4">
      {/* Workspace dashboard — counts measured from the workspace store. */}
      <div className="panel p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-neon-cyan" /> Workspace Dashboard
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 text-center">
          {[
            ['Connections', connectionCount],
            ['Tables', tables.length],
            ['Rows', totalRows],
            ['Relations', relationCount],
            ['Indexes', ws.indexes.length],
            ['Queries run', history.length],
          ].map(([label, v]) => (
            <div key={label as string} className="bg-lattice-surface rounded-lg p-3">
              <p className="text-xl font-bold">{v as number}</p>
              <p className="text-[10px] text-gray-400">{label as string}</p>
            </div>
          ))}
        </div>
        {designer && (
          <p className="text-[11px] text-gray-400 mt-3">
            Schema Designer store: {designer.schemas} schema(s), {designer.totalTables} table(s), {designer.totalRelations} relation(s) — designed schemas live separately from the workspace tables above until you build them out as datasets.
          </p>
        )}
        {history.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] font-semibold text-gray-400">Recent activity</p>
            {history.slice(0, 5).map((h, i) => (
              <p key={i} className="text-[11px] text-gray-300 truncate">
                <span className={h.success ? 'text-emerald-400' : 'text-rose-400'}>{h.success ? '✓' : '✗'}</span>{' '}
                <span className="font-mono">{h.sql}</span>{' '}
                <span className="text-gray-500">· {h.durationMs}ms{h.connectionName ? ` · ${h.connectionName}` : ''}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Schema analysis */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Schema Analysis</h3>
            <button onClick={runSchema} disabled={busyKey === 'schema' || tables.length === 0} className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40">
              <Play className="w-3.5 h-3.5" /> Analyze {tables.length} table(s)
            </button>
          </div>
          {schemaRes === undefined && <p className="text-xs text-gray-500">Runs over your actual workspace tables.</p>}
          {schemaRes?.message && <p className="text-xs text-gray-400">{schemaRes.message}</p>}
          {schemaRes?.tables && (
            <div className="space-y-2 text-xs">
              <p>Health score <span className="font-bold text-neon-cyan">{schemaRes.healthScore}/100</span> · {schemaRes.totalIssues} issue(s) · {schemaRes.normalizationTip}</p>
              {schemaRes.tables.map((t) => (
                <div key={t.table} className="bg-lattice-surface rounded p-2">
                  <p className="font-mono font-semibold">{t.table} <span className="text-gray-500 font-normal">· {t.columns} columns · PK {t.hasPrimaryKey ? 'yes' : 'no'} · {t.indexedColumns} indexed</span></p>
                  {t.issues.map((iss) => <p key={iss} className="text-amber-300">⚠ {iss}</p>)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Query optimize */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Query Optimizer</h3>
            <button onClick={runOptimize} disabled={busyKey === 'optimize' || !queryText.trim()} className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40">
              <Sparkles className="w-3.5 h-3.5" /> Optimize
            </button>
          </div>
          <textarea
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="SQL to review — prefilled with your most recent query"
            className="input-lattice w-full font-mono text-xs mb-2"
          />
          {optRes?.message && <p className="text-xs text-gray-400">{optRes.message}</p>}
          {optRes?.issues && (
            <div className="space-y-1.5 text-xs">
              <p>Grade <span className="font-bold text-neon-cyan">{optRes.grade}</span> · {optRes.issueCount} issue(s)</p>
              {optRes.issues.map((iss, i) => (
                <p key={i}><span className="text-amber-300">{iss.issue}</span> <span className="text-gray-500">({iss.severity})</span> — {iss.fix}</p>
              ))}
              {optRes.issues.length === 0 && <p className="text-emerald-300">No issues found.</p>}
            </div>
          )}
        </div>

        {/* Migration plan */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Migration Planner</h3>
            <button onClick={runMigration} disabled={busyKey === 'migration'} className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40">
              <Play className="w-3.5 h-3.5" /> Plan
            </button>
          </div>
          <div className="space-y-1.5 mb-2">
            {changes.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select value={c.type} onChange={(e) => setChanges((cs) => cs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="input-lattice text-xs" aria-label="Change type">
                  <option value="add">add</option><option value="alter">alter</option><option value="rename">rename</option><option value="drop">drop</option>
                </select>
                <input value={c.table} onChange={(e) => setChanges((cs) => cs.map((x, j) => (j === i ? { ...x, table: e.target.value } : x)))} placeholder="table" className="input-lattice text-xs w-24" />
                <input value={c.column} onChange={(e) => setChanges((cs) => cs.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))} placeholder="column" className="input-lattice text-xs w-24" />
                <input value={c.description} onChange={(e) => setChanges((cs) => cs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="description (optional)" className="input-lattice text-xs flex-1" />
                <button onClick={() => setChanges((cs) => cs.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-400" aria-label="Remove change"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setChanges((cs) => [...cs, { type: 'add', table: '', column: '', description: '' }])} className="text-[11px] text-neon-cyan hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> add change</button>
          </div>
          {migRes?.message && <p className="text-xs text-gray-400">{migRes.message}</p>}
          {migRes?.steps && (
            <div className="space-y-1.5 text-xs">
              <p className={migRes.highRiskChanges ? 'text-amber-300' : 'text-emerald-300'}>{migRes.recommendation} · downtime: {migRes.estimatedDowntime}</p>
              {migRes.steps.map((s) => (
                <p key={s.step}>{s.step}. <span className="font-mono">{s.operation} {s.table}{s.column ? `.${s.column}` : ''}</span> — {s.description} <span className="text-gray-500">(risk {s.risk}, rollback: {s.rollback})</span></p>
              ))}
            </div>
          )}
        </div>

        {/* Index recommendations */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Index Recommendations</h3>
            <button onClick={runRecs} disabled={busyKey === 'recs' || history.length === 0} className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40">
              <Play className="w-3.5 h-3.5" /> Analyze {history.length} quer{history.length === 1 ? 'y' : 'ies'}
            </button>
          </div>
          {history.length === 0 && <p className="text-xs text-gray-500">Run some queries first — recommendations are derived from your actual query history.</p>}
          {recRes?.recommendations && (
            <div className="space-y-1.5 text-xs">
              <p className="text-gray-400">{recRes.suggestedIndexes} suggestion(s) · estimated {recRes.estimatedSpeedup}</p>
              {recRes.recommendations.map((r) => {
                const target = tables.find((t) => t.columns.some((c) => c.name === r.column));
                const already = applied.has(r.column) || (target ? ws.indexes.some((ix) => ix.dataset === target.name && ix.columns.includes(r.column)) : false);
                return (
                  <div key={r.column} className="flex items-center gap-2 bg-lattice-surface rounded p-2">
                    <span className="font-mono font-semibold">{r.column}</span>
                    <span className="text-gray-400 flex-1">{r.reason} · {r.type}{target ? ` · on ${target.name}` : ''}</span>
                    {already ? (
                      <span className="text-emerald-300">indexed ✓</span>
                    ) : target ? (
                      <button onClick={() => applyRec(r.column)} disabled={ws.busy} className="btn-neon text-[11px] disabled:opacity-40">Apply</button>
                    ) : (
                      <span className="text-gray-500">no table has this column</span>
                    )}
                  </div>
                );
              })}
              {recRes.recommendations.length === 0 && <p className="text-emerald-300">No recommendations — your queries already avoid unindexed patterns.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
