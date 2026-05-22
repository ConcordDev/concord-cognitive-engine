'use client';

/**
 * KeyHealthPanel — per-slot key health status and last error.
 * Reads byo_keys.health_list. Status is recorded server-side on
 * every test ping and every outbound BYO inference call.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

interface HealthRow {
  slot: string;
  provider: string | null;
  status: 'ok' | 'error' | 'untested';
  lastError: string | null;
  lastErrorAt: number | null;
  lastOkAt: number | null;
}

function fmtRel(unix: number | null): string {
  if (!unix) return 'never';
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const DOT: Record<HealthRow['status'], string> = {
  ok: 'bg-emerald-500',
  error: 'bg-red-500',
  untested: 'bg-zinc-600',
};

export function KeyHealthPanel() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ rows: HealthRow[] }>('byo_keys', 'health_list', {});
    if (r.data?.ok && r.data.result) setRows(r.data.result.rows);
    setLoaded(true);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <section className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">Key health</h2>
        <button
          onClick={refresh}
          className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >
          refresh
        </button>
      </div>

      {loaded && rows.length === 0 && (
        <div className="text-xs text-zinc-500 rounded-md border border-dashed border-zinc-800 p-6 text-center">
          No keys configured yet. Health status appears here once you add a BYO key and run a
          test ping or an inference call.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.slot} className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3">
              <div className="flex items-center gap-2.5">
                <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[r.status]}`} />
                <span className="font-mono text-xs text-zinc-300">{r.slot}</span>
                {r.provider && (
                  <span className="font-mono text-[10px] text-zinc-500">{r.provider}</span>
                )}
                <span
                  className={`ml-auto text-[10px] font-mono uppercase ${
                    r.status === 'ok' ? 'text-emerald-400'
                      : r.status === 'error' ? 'text-red-400' : 'text-zinc-500'
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 pl-[18px]">
                {r.status === 'error' && r.lastError && (
                  <span className="text-red-400">last error: {r.lastError} ({fmtRel(r.lastErrorAt)})</span>
                )}
                {r.status === 'ok' && <span>last ok {fmtRel(r.lastOkAt)}</span>}
                {r.status === 'untested' && <span>not yet tested — run a test ping</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
