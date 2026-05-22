'use client';


/**
 * SentinelSemantic — semantic-search workbench over the DTU corpus with a
 * saved-query book and result export. Runs the real `semantic` macro
 * domain (similar / classify_intent / extract_entities) and persists
 * queries + exports results via sentinel.query.*.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Search, Loader2, Save, Trash2, Play, Download, BookMarked,
} from 'lucide-react';

type SemanticMode = 'similar' | 'classify_intent' | 'extract_entities';
const MODES: SemanticMode[] = ['similar', 'classify_intent', 'extract_entities'];

interface SavedQuery {
  queryId: string;
  name: string;
  query: string;
  mode: SemanticMode;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

interface ResultRow { [k: string]: unknown }

function toRows(result: unknown): ResultRow[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  for (const key of ['results', 'similar', 'matches', 'entities', 'items']) {
    if (Array.isArray(r[key])) return r[key] as ResultRow[];
  }
  // classify_intent and similar single-object responses → single row
  return [r];
}

export function SentinelSemantic() {
  const [mode, setMode] = useState<SemanticMode>('similar');
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [rawResult, setRawResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [busy, setBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const r = await lensRun('sentinel', 'query.list', {});
    setSaved((r.data?.result as { queries?: SavedQuery[] } | null)?.queries ?? []);
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const runSemantic = useCallback(async (q: string, m: SemanticMode, savedId?: string) => {
    if (!q.trim()) return;
    setRunning(true);
    setError(null);
    setExportNote(null);
    const input = m === 'similar' ? { query: q, limit: 10 } : { text: q };
    const r = await lensRun('semantic', m, input);
    if (r.data?.ok === false) {
      setError(r.data.error || 'semantic query failed');
      setRows([]);
      setRawResult(null);
    } else {
      const res = r.data?.result ?? r.data;
      setRawResult(res);
      setRows(toRows(res));
    }
    if (savedId) {
      await lensRun('sentinel', 'query.touch', { queryId: savedId });
      await loadSaved();
    }
    setRunning(false);
  }, [loadSaved]);

  async function saveQuery() {
    if (!query.trim()) return;
    setBusy(true);
    await lensRun('sentinel', 'query.save', { query: query.trim(), mode });
    await loadSaved();
    setBusy(false);
  }

  async function deleteQuery(queryId: string) {
    setBusy(true);
    await lensRun('sentinel', 'query.delete', { queryId });
    await loadSaved();
    setBusy(false);
  }

  function runSaved(q: SavedQuery) {
    setMode(q.mode);
    setQuery(q.query);
    runSemantic(q.query, q.mode, q.queryId);
  }

  async function exportResults(format: 'csv' | 'json') {
    if (rows.length === 0) return;
    setBusy(true);
    const r = await lensRun('sentinel', 'query.export', { results: rows, query, format });
    const res = r.data?.result as { payload?: string; filename?: string; rowCount?: number } | null;
    if (res?.payload && res.filename) {
      const blob = new Blob([res.payload], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportNote(`Exported ${res.rowCount} row(s) → ${res.filename}`);
    } else {
      setExportNote('Export failed.');
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
            <Search className="h-4 w-4" /> Semantic search
          </h3>
          <div className="mb-2 flex flex-wrap gap-1">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-2 py-1 text-xs ${
                  mode === m ? 'bg-blue-700/50 text-blue-100' : 'bg-blue-950/30 text-blue-500 hover:text-blue-300'
                }`}
                aria-pressed={mode === m}
              >
                {m.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'similar' ? 'Query the DTU corpus for similar content…' : 'Text to classify / extract from…'}
            className="h-24 w-full rounded border border-blue-900/40 bg-black/40 p-2 font-mono text-sm text-blue-100 focus:border-blue-500 focus:outline-none"
            aria-label="Semantic query"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={!query.trim() || running}
              onClick={() => runSemantic(query, mode)}
              className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Run
            </button>
            <button
              disabled={!query.trim() || busy}
              onClick={saveQuery}
              className="inline-flex items-center gap-1.5 rounded bg-blue-950/40 px-3 py-1.5 text-xs text-blue-300 hover:text-blue-100 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" /> Save query
            </button>
            <div className="ml-auto flex gap-2">
              <button
                disabled={rows.length === 0 || busy}
                onClick={() => exportResults('csv')}
                className="inline-flex items-center gap-1.5 rounded bg-blue-950/40 px-3 py-1.5 text-xs text-blue-300 hover:text-blue-100 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                disabled={rows.length === 0 || busy}
                onClick={() => exportResults('json')}
                className="inline-flex items-center gap-1.5 rounded bg-blue-950/40 px-3 py-1.5 text-xs text-blue-300 hover:text-blue-100 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" /> JSON
              </button>
            </div>
          </div>
          {exportNote && <p className="mt-2 text-[11px] text-emerald-400">{exportNote}</p>}
          {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
        </div>

        <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-blue-700">
            Results {rows.length > 0 && `(${rows.length})`}
          </p>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-blue-700">
              No results yet. Run a query above.
            </p>
          ) : (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto">
              {rows.map((row, i) => (
                <li key={i} className="rounded border border-blue-900/20 bg-black/30 px-2.5 py-1.5">
                  <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed text-blue-300">
                    {JSON.stringify(row, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
          {rawResult != null && rows.length <= 1 && (
            <details className="mt-2 rounded border border-blue-900/20 bg-black/20">
              <summary className="cursor-pointer px-2 py-1 text-[10px] text-blue-600">Raw response</summary>
              <pre className="overflow-auto p-2 font-mono text-[10px] text-blue-500">
                {JSON.stringify(rawResult, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
          <BookMarked className="h-4 w-4" /> Saved queries ({saved.length})
        </h3>
        {saved.length === 0 ? (
          <p className="py-6 text-center text-xs text-blue-700">No saved queries.</p>
        ) : (
          <ul className="space-y-1.5">
            {saved.map((q) => (
              <li key={q.queryId} className="rounded border border-blue-900/30 bg-black/30 px-2.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-blue-100">{q.name}</span>
                  <span className="ml-auto shrink-0 rounded bg-blue-900/40 px-1 py-0.5 text-[9px] text-blue-300">
                    {q.mode.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-blue-600">{q.query}</p>
                <div className="mt-1.5 flex items-center gap-2 text-[9px] text-blue-700">
                  <span>{q.runCount} runs</span>
                  {q.lastRunAt && <span>last {new Date(q.lastRunAt).toLocaleDateString()}</span>}
                  <div className="ml-auto flex gap-1">
                    <button
                      disabled={running}
                      onClick={() => runSaved(q)}
                      className="inline-flex items-center gap-1 rounded bg-blue-700/50 px-1.5 py-0.5 text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
                    >
                      <Play className="h-2.5 w-2.5" /> Run
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => deleteQuery(q.queryId)}
                      className="rounded bg-blue-950/40 px-1.5 py-0.5 text-blue-400 hover:text-rose-400 disabled:opacity-40"
                      aria-label="Delete saved query"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
