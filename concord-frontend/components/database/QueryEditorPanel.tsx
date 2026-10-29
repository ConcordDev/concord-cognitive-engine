'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { Play, Table2, FileJson, FileSpreadsheet, Terminal, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { exportCSV, exportJSON, type QueryResult } from './db-utils';

export function QueryEditorPanel({ seedSql, onSeedConsumed }: { seedSql?: string | null; onSeedConsumed?: () => void }) {
  const { items: queryItems, create: saveQuery, update: updateQuery, remove: removeQuery } = useLensData('database', 'query', { seed: [] });
  const [sql, setSql] = useState('SELECT id, title, tier, tags, created_at\nFROM dtus\nORDER BY created_at DESC\nLIMIT 50;');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [resultPage, setResultPage] = useState(0);
  const ROWS_PER_PAGE = 25;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyIdRef = useRef(0);

  useEffect(() => {
    if (seedSql) {
      setSql(seedSql);
      onSeedConsumed?.();
      textareaRef.current?.focus();
    }
  }, [seedSql, onSeedConsumed]);

  // Auto-save into Saved Queries (S10): re-running the same SQL updates
  // the existing entry instead of piling up duplicates. (Execution
  // history proper is the server's query-history — see History tab.)
  const addToHistory = useCallback((query: string, duration: number, rowCount: number, success: boolean) => {
    const existing = queryItems.find((it) => String((it.data as Record<string, unknown>)?.sql || '') === query);
    if (existing) {
      const prev = existing.data as Record<string, unknown>;
      updateQuery(existing.id, {
        data: { ...prev, timestamp: Date.now(), duration, rowCount, success },
      }).catch((err) => console.error('Failed to update saved query:', err instanceof Error ? err.message : err));
      return;
    }
    historyIdRef.current += 1;
    const entry = { id: historyIdRef.current, sql: query, timestamp: Date.now(), duration, rowCount, success };
    saveQuery({ title: query.slice(0, 80), data: entry as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to save query:', err instanceof Error ? err.message : err));
  }, [saveQuery, updateQuery, queryItems]);

  // Saved Queries management (S10): rename + delete.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const title = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    if (title) updateQuery(id, { title }).catch(() => undefined);
  }, [renamingId, renameDraft, updateQuery]);
  const deleteSaved = useCallback((id: string) => {
    if (armedDeleteId !== id) { setArmedDeleteId(id); return; }
    setArmedDeleteId(null);
    removeQuery(id).catch(() => undefined);
  }, [armedDeleteId, removeQuery]);

  const [pendingConfirm, setPendingConfirm] = useState<{ sql: string; message: string } | null>(null);
  const executeQuery = useMutation({
    // The Query Editor runs against the workspace SQL engine (database
    // query-run) — the same engine as the SQL Console. It previously sent
    // SQL to the graph query API, whose result shape the renderer assumed
    // and crashed on (F1). The result is normalised defensively: a missing
    // rows/columns field renders as an empty result, never a crash.
    mutationFn: async (vars: { sql: string; confirmDestructive?: boolean }): Promise<QueryResult & { needsConfirm?: boolean }> => {
      const r = await lensRun<{
        columns?: string[]; rows?: Record<string, unknown>[]; rowCount?: number;
        durationMs?: number; success?: boolean; error?: string; needsConfirm?: boolean;
      }>('database', 'query-run', { sql: vars.sql, ...(vars.confirmDestructive ? { confirmDestructive: true } : {}) });
      return {
        columns: Array.isArray(r?.columns) ? r.columns : [],
        rows: Array.isArray(r?.rows) ? r.rows : [],
        rowCount: typeof r?.rowCount === 'number' ? r.rowCount : (Array.isArray(r?.rows) ? r.rows.length : 0),
        duration: typeof r?.durationMs === 'number' ? r.durationMs : 0,
        ...(r?.error ? { error: r.error } : {}),
        ...(r?.needsConfirm ? { needsConfirm: true } : {}),
      };
    },
    onSuccess: (data: QueryResult & { needsConfirm?: boolean }, vars: { sql: string }) => {
      if (data.needsConfirm) {
        // S5 guard: nothing ran; ask before running an unscoped write.
        setPendingConfirm({ sql: vars.sql, message: data.error || 'This statement affects every row.' });
        return;
      }
      setPendingConfirm(null);
      setQueryResult(data);
      setResultPage(0);
      addToHistory(vars.sql, data.duration, data.rowCount, !data.error);
    },
    onError: (err: unknown, vars: { sql: string }) => {
      setQueryResult({ columns: [], rows: [], rowCount: 0, duration: 0, error: err instanceof Error ? err.message : 'Query execution failed' });
      setResultPage(0);
      addToHistory(vars.sql, 0, 0, false);
    },
  });

  const runQuery = useCallback(() => {
    const trimmed = sql.trim();
    if (!trimmed) return;
    executeQuery.mutate({ sql: trimmed });
  }, [sql, executeQuery]);

  // Pending + elapsed state for runs (S12): a ticking clock while the
  // statement is in flight, so a slow run never looks like a hang.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!executeQuery.isPending) { setElapsedMs(0); return; }
    const t0 = Date.now();
    const iv = window.setInterval(() => setElapsedMs(Date.now() - t0), 100);
    return () => window.clearInterval(iv);
  }, [executeQuery.isPending]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }, [runQuery]);

  const paginatedRows = useMemo(() => {
    if (!queryResult) return [];
    const rows = Array.isArray(queryResult.rows) ? queryResult.rows : [];
    const start = resultPage * ROWS_PER_PAGE;
    return rows.slice(start, start + ROWS_PER_PAGE);
  }, [queryResult, resultPage]);

  const totalPages = queryResult ? Math.max(1, Math.ceil((Array.isArray(queryResult.rows) ? queryResult.rows.length : 0) / ROWS_PER_PAGE)) : 0;

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-cyan">
            <Terminal className="w-4 h-4" />
            SQL Query
          </h2>
          <span className="text-xs text-gray-400">Ctrl+Enter to execute</span>
        </div>
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={6}
          spellCheck={false}
          className="input-lattice w-full font-mono text-sm resize-y min-h-[120px]"
          placeholder="SELECT * FROM dtus LIMIT 10;"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={runQuery}
            disabled={executeQuery.isPending || !sql.trim()}
            className="btn-neon flex items-center gap-2 text-sm"
          >
            <Play className="w-4 h-4" />
            {executeQuery.isPending ? `Executing… ${(elapsedMs / 1000).toFixed(1)}s` : 'Execute'}
          </button>
          <button
            onClick={() => { setSql(''); setQueryResult(null); }}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-lattice-border rounded transition-colors"
          >
            Clear
          </button>
          {queryResult && (
            <span className="text-xs text-gray-400 ml-auto">
              {queryResult.rowCount} row{queryResult.rowCount !== 1 ? 's' : ''} in {queryResult.duration}ms
              {queryResult.error && <span className="text-red-400 ml-2">{queryResult.error}</span>}
            </span>
          )}
        </div>
        {pendingConfirm && (
          <div className="border border-amber-500/40 bg-amber-500/5 rounded p-3 space-y-2" role="alert">
            <p className="text-xs text-amber-200">{pendingConfirm.message}</p>
            <div className="flex gap-2">
              <button
                onClick={() => executeQuery.mutate({ sql: pendingConfirm.sql, confirmDestructive: true })}
                disabled={executeQuery.isPending}
                className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-semibold disabled:opacity-40"
              >
                Run anyway
              </button>
              <button
                onClick={() => setPendingConfirm(null)}
                className="px-3 py-1.5 text-xs border border-lattice-border rounded hover:bg-lattice-surface text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {queryResult && queryResult.rows.length > 0 ? (
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Table2 className="w-4 h-4 text-neon-green" />
              Results
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={() => exportCSV(queryResult.columns, queryResult.rows)} className="flex items-center gap-1 px-2 py-1 text-xs border border-lattice-border rounded hover:bg-lattice-surface transition-colors text-neon-yellow">
                <FileSpreadsheet className="w-3 h-3" />
                CSV
              </button>
              <button onClick={() => exportJSON(queryResult.rows)} className="flex items-center gap-1 px-2 py-1 text-xs border border-lattice-border rounded hover:bg-lattice-surface transition-colors text-neon-blue">
                <FileJson className="w-3 h-3" />
                JSON
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border">
                  {queryResult.columns.map(col => (
                    <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-neon-purple whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedRows.length === 0 ? (
                  <tr><td colSpan={queryResult.columns.length} className="px-3 py-8 text-center text-gray-400">No rows returned</td></tr>
                ) : (
                  paginatedRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-lattice-border/40 hover:bg-lattice-surface/60 transition-colors">
                      {queryResult.columns.map(col => (
                        <td key={col} className="px-3 py-2 text-gray-300 max-w-[300px] truncate font-mono text-xs">
                          {row[col] === null ? <span className="text-gray-600 italic">NULL</span> : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-400">
                Page {resultPage + 1} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setResultPage(p => Math.max(0, p - 1))}
                  disabled={resultPage === 0}
                  className="p-1 rounded border border-lattice-border disabled:opacity-30 hover:bg-lattice-surface transition-colors"
                  aria-label="Previous">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setResultPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={resultPage >= totalPages - 1}
                  className="p-1 rounded border border-lattice-border disabled:opacity-30 hover:bg-lattice-surface transition-colors"
                  aria-label="Next">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No query results yet. Run a query to see results here.</p>
        </div>
      )}

      {queryItems.length > 0 && (
        <div className="panel p-4 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-blue">
            <FileJson className="w-4 h-4" />
            Saved Queries ({queryItems.length})
          </h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {queryItems.map(item => (
              <div
                key={item.id}
                className="flex items-start gap-1.5 w-full text-left bg-lattice-surface border border-lattice-border/50 rounded p-2 hover:bg-lattice-elevated transition-colors"
              >
                <button
                  onClick={() => { setSql(String((item.data as Record<string, unknown>)?.sql || item.title)); }}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-xs font-medium text-white truncate">{item.title}</p>
                  <p className="text-[11px] text-gray-400 font-mono truncate">{String((item.data as Record<string, unknown>)?.sql || '').slice(0, 60)}</p>
                </button>
                {renamingId === item.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={commitRename}
                    aria-label="Rename saved query"
                    className="w-28 bg-lattice-bg border border-neon-cyan/50 rounded px-1 py-0.5 text-[11px] text-gray-100"
                  />
                ) : (
                  <button
                    onClick={() => { setRenamingId(item.id); setRenameDraft(item.title); }}
                    className="p-1 text-gray-500 hover:text-gray-300"
                    aria-label={`Rename saved query ${item.title}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => deleteSaved(item.id)}
                  onBlur={() => setArmedDeleteId(a => (a === item.id ? null : a))}
                  className={armedDeleteId === item.id ? 'px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-semibold' : 'p-1 text-gray-500 hover:text-red-400'}
                  aria-label={armedDeleteId === item.id ? 'Confirm delete saved query' : `Delete saved query ${item.title}`}
                >
                  {armedDeleteId === item.id ? 'Delete?' : <Trash2 className="w-3 h-3" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
