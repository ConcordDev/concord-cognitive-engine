'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';
import { Play, Table2, FileJson, FileSpreadsheet, Terminal, ChevronLeft, ChevronRight } from 'lucide-react';
import { exportCSV, exportJSON, type QueryResult } from './db-utils';

export function QueryEditorPanel({ seedSql, onSeedConsumed }: { seedSql?: string | null; onSeedConsumed?: () => void }) {
  const { items: queryItems, create: saveQuery } = useLensData('database', 'query', { seed: [] });
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

  const addToHistory = useCallback((query: string, duration: number, rowCount: number, success: boolean) => {
    historyIdRef.current += 1;
    const entry = { id: historyIdRef.current, sql: query, timestamp: Date.now(), duration, rowCount, success };
    saveQuery({ title: query.slice(0, 80), data: entry as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to save query to history:', err instanceof Error ? err.message : err));
  }, [saveQuery]);

  const executeQuery = useMutation({
    mutationFn: (query: string) => apiHelpers.graph.query(query).then(r => r.data),
    onSuccess: (data: QueryResult, query: string) => {
      setQueryResult(data);
      setResultPage(0);
      addToHistory(query, data.duration, data.rowCount, true);
    },
    onError: (err: unknown, query: string) => {
      setQueryResult({ columns: [], rows: [], rowCount: 0, duration: 0, error: err instanceof Error ? err.message : 'Query execution failed' });
      setResultPage(0);
      addToHistory(query, 0, 0, false);
    },
  });

  const runQuery = useCallback(() => {
    const trimmed = sql.trim();
    if (!trimmed) return;
    executeQuery.mutate(trimmed);
  }, [sql, executeQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }, [runQuery]);

  const paginatedRows = useMemo(() => {
    if (!queryResult) return [];
    const start = resultPage * ROWS_PER_PAGE;
    return queryResult.rows.slice(start, start + ROWS_PER_PAGE);
  }, [queryResult, resultPage]);

  const totalPages = queryResult ? Math.max(1, Math.ceil(queryResult.rows.length / ROWS_PER_PAGE)) : 0;

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
            {executeQuery.isPending ? 'Executing...' : 'Execute'}
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
              <button
                key={item.id}
                onClick={() => { setSql(String((item.data as Record<string, unknown>)?.sql || item.title)); }}
                className="w-full text-left bg-lattice-surface border border-lattice-border/50 rounded p-2 hover:bg-lattice-elevated transition-colors"
              >
                <p className="text-xs font-medium text-white truncate">{item.title}</p>
                <p className="text-[11px] text-gray-400 font-mono truncate">{String((item.data as Record<string, unknown>)?.sql || '').slice(0, 60)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
