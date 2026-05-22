'use client';

/**
 * LogViewer — search + filter over the in-process server logger buffer.
 * Backed by the `system.logs` macro (logger.query). Supports level, source,
 * and free-text search; shows a level tally strip.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Search, Loader2, RefreshCw } from 'lucide-react';

interface LogEntry {
  at?: string;
  ts?: number;
  level: string;
  source?: string;
  lens?: string;
  message?: string;
  msg?: string;
  [k: string]: unknown;
}

interface LogsResult {
  entries: LogEntry[];
  count: number;
  tally: { error: number; warn: number; info: number; debug: number };
  sources: string[];
  bufferSize: number;
}

const LEVEL_CLS: Record<string, string> = {
  error: 'text-rose-400',
  warn: 'text-yellow-400',
  info: 'text-cyan-300',
  debug: 'text-cyan-700',
};

export function LogViewer({ live }: { live: boolean }) {
  const [data, setData] = useState<LogsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [level, setLevel] = useState<'' | 'error' | 'warn' | 'info' | 'debug'>('');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');

  const load = useCallback(async () => {
    const input: Record<string, unknown> = { limit: 300 };
    if (level) input.level = level;
    if (search.trim()) input.search = search.trim();
    if (source) input.source = source;
    const r = await lensRun<LogsResult>('system', 'logs', input);
    if (r.data.ok && r.data.result) {
      setData(r.data.result);
      setErr(null);
    } else {
      setErr(r.data.error || 'logs unavailable');
    }
    setLoading(false);
  }, [level, search, source]);

  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [live, load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-700" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            placeholder="Search log messages…"
            className="w-full rounded border border-cyan-900/40 bg-cyan-950/20 py-1.5 pl-8 pr-2 text-xs text-cyan-100 placeholder:text-cyan-800 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            aria-label="Search logs"
          />
        </div>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
          className="rounded border border-cyan-900/40 bg-cyan-950/20 px-2 py-1.5 text-xs text-cyan-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          aria-label="Filter by level"
        >
          <option value="">all levels</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded border border-cyan-900/40 bg-cyan-950/20 px-2 py-1.5 text-xs text-cyan-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          aria-label="Filter by source"
        >
          <option value="">all sources</option>
          {(data?.sources ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded border border-cyan-700/50 bg-cyan-900/20 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-800/40"
        >
          <RefreshCw className="h-3 w-3" aria-hidden /> Search
        </button>
      </div>

      {data && (
        <div className="flex flex-wrap gap-3 text-[11px]">
          <span className="text-rose-400">error {data.tally.error}</span>
          <span className="text-yellow-400">warn {data.tally.warn}</span>
          <span className="text-cyan-300">info {data.tally.info}</span>
          <span className="text-cyan-700">debug {data.tally.debug}</span>
          <span className="ml-auto text-cyan-700">{data.count} shown · buffer {data.bufferSize}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-cyan-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Querying logger buffer…
        </div>
      ) : err ? (
        <div className="rounded-lg border border-rose-800/40 bg-rose-950/15 px-4 py-6 text-sm text-rose-300">{err}</div>
      ) : !data || data.entries.length === 0 ? (
        <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-6 text-center text-sm text-cyan-600">
          No log entries match the current filter.
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-cyan-900/40 bg-black/40 font-mono text-[11px]">
          {data.entries.map((e, i) => (
            <div key={i} className="flex gap-2 border-b border-cyan-900/15 px-3 py-1 hover:bg-cyan-950/20">
              <span className="shrink-0 text-cyan-800">
                {e.at ? new Date(e.at).toLocaleTimeString() : e.ts ? new Date(e.ts).toLocaleTimeString() : '—'}
              </span>
              <span className={`shrink-0 w-12 uppercase ${LEVEL_CLS[e.level] || 'text-cyan-500'}`}>{e.level}</span>
              {e.source && <span className="shrink-0 text-cyan-600">[{e.source}]</span>}
              <span className="break-all text-cyan-200">{e.message || e.msg || JSON.stringify(e)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
