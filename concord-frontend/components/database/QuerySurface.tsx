'use client';

/**
 * Database north star: one query and its rows.
 * Runs database.query-run against a real connection. Schema counts come
 * from database.schema-dashboard. Nothing is filled in before a run.
 */

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { northCtaClass } from '@/components/code/CodeFamilyChrome';

interface ConnectionRow { id: string; name: string; engine: string; datasetCount: number; }
interface QueryResult {
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string | null;
  success?: boolean;
  durationMs?: number;
}

const STARTER_SQL = "SELECT * FROM datasets";

export function QuerySurface({ initialSql = '' }: { initialSql?: string }) {
  const qc = useQueryClient();
  const [sql, setSql] = useState(initialSql);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const connections = useQuery({
    queryKey: ['database', 'connection-list'],
    queryFn: async () => {
      const r = await lensRun<{ connections: ConnectionRow[]; count: number }>('database', 'connection-list', {});
      if (!r.data?.ok) throw new Error(r.data?.error || 'Could not list connections');
      return r.data.result?.connections ?? [];
    },
  });

  const dashboard = useQuery({
    queryKey: ['database', 'schema-dashboard'],
    queryFn: async () => {
      const r = await lensRun<{ totalTables?: number; schemas?: number }>('database', 'schema-dashboard', {});
      if (!r.data?.ok) return null;
      return r.data.result;
    },
  });

  const list = connections.data ?? [];
  const activeId = connectionId && list.some((c) => c.id === connectionId) ? connectionId : (list[0]?.id ?? null);

  const run = useCallback(async () => {
    const statement = sql.trim();
    if (!statement) {
      setNote('Write a statement, then run it.');
      setResult(null);
      return;
    }
    if (!activeId) {
      setNote('No connection yet. SQL runs against a connection you create.');
      setResult(null);
      return;
    }
    setRunning(true);
    setNote(null);
    const r = await lensRun<QueryResult>('database', 'query-run', { connectionId: activeId, sql: statement });
    setRunning(false);
    if (!r.data?.ok) {
      setResult(null);
      setNote(r.data?.error || 'Query failed');
      return;
    }
    const body = r.data.result;
    if (body?.error || body?.success === false) {
      setResult(null);
      setNote(body?.error || 'Query failed');
      return;
    }
    setResult(body);
  }, [sql, activeId]);

  const createLocal = useCallback(async () => {
    setCreating(true);
    setNote(null);
    const r = await lensRun<{ connection: ConnectionRow }>('database', 'connection-create', {
      name: 'local',
      engine: 'in-memory',
    });
    setCreating(false);
    if (!r.data?.ok || !r.data.result?.connection?.id) {
      setNote(r.data?.error || 'Could not create a connection');
      return;
    }
    setConnectionId(r.data.result.connection.id);
    await qc.invalidateQueries({ queryKey: ['database', 'connection-list'] });
  }, [qc]);

  const columns = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const tableCount = dashboard.data?.totalTables;

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <label className="sr-only" htmlFor="db-sql">SQL</label>
        <textarea
          id="db-sql"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          rows={3}
          placeholder={STARTER_SQL}
          className="w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />

        {connections.isLoading && (
          <p role="status" className="border-t border-white/10 px-4 py-3 text-[13px] text-zinc-500">Loading connections…</p>
        )}
        {connections.isError && (
          <p role="alert" className="border-t border-white/10 px-4 py-3 text-[13px] text-red-300">
            {(connections.error as Error)?.message || 'Could not list connections'}
          </p>
        )}

        {!connections.isLoading && list.length === 0 && (
          <div className="border-t border-white/10 px-4 py-3 text-[13px] text-zinc-500">
            No connection yet.{' '}
            <button
              type="button"
              onClick={() => void createLocal()}
              disabled={creating}
              className="text-zinc-200 underline-offset-2 hover:underline disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create a local one'}
            </button>
          </div>
        )}

        {list.length > 1 && (
          <div className="border-t border-white/10 px-4 py-2">
            <label className="sr-only" htmlFor="db-connection">Connection</label>
            <select
              id="db-connection"
              value={activeId ?? ''}
              onChange={(e) => setConnectionId(e.target.value)}
              className="bg-transparent text-[13px] text-zinc-300 focus:outline-none"
            >
              {list.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.engine}</option>
              ))}
            </select>
          </div>
        )}

        {note && (
          <p role="alert" className="border-t border-white/10 px-4 py-3 text-[13px] text-zinc-400">{note}</p>
        )}

        {result && (
          <div className="border-t border-white/10">
            {rows.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-zinc-500">
                {result.rowCount ?? 0} row{(result.rowCount ?? 0) === 1 ? '' : 's'}
                {result.durationMs != null ? ` · ${result.durationMs} ms` : ''}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  {columns.length > 0 && (
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="px-4 py-2 font-normal">#</th>
                        {columns.map((col) => (
                          <th key={col} className="px-4 py-2 font-normal">{col}</th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-t border-white/[0.06] text-zinc-200">
                        <td className="px-4 py-2 text-zinc-500">{i + 1}</td>
                        {(columns.length > 0 ? columns : Object.keys(row)).map((col) => (
                          <td key={col} className="px-4 py-2 font-mono">{formatCell(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {typeof tableCount === 'number' && tableCount > 0 && (
              <p className="border-t border-white/[0.06] px-4 py-2 text-[12px] text-zinc-500">
                {tableCount} table{tableCount === 1 ? '' : 's'} in your schemas
              </p>
            )}
          </div>
        )}
      </div>

      <button type="button" onClick={() => void run()} disabled={running} className={northCtaClass}>
        {running && <Loader2 className="h-4 w-4 animate-spin" />}
        Run query
      </button>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
