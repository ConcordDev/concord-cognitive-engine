'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useState } from 'react';
import { GitMerge, Server, Smartphone, Check, Loader2, ShieldQuestion } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { markClean } from './local-store';

export interface Conflict {
  id: string;
  serverRev: string;
  serverBody: any;
  clientRev: string | null;
  clientBody: any;
  reason: string;
}

interface ResolveResult {
  id: string;
  rev: string;
  seq: number;
  winner: string;
  resolvedBody: any;
}

type Winner = 'server' | 'client' | 'merged';

function pretty(v: any): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Side-by-side conflict merge picker. Surfaces rev-mismatch conflicts returned
 * by `replicationPush` and lets the user pick the server branch, the client
 * branch, or a hand-merged body — then commits the decision via the
 * `offline.mergeResolve` macro and reconciles the local IndexedDB store.
 */
export function ConflictMergePanel({
  conflicts,
  onResolved,
}: {
  conflicts: Conflict[];
  onResolved: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resolve = useCallback(
    async (c: Conflict, winner: Winner) => {
      setBusy(`${c.id}:${winner}`);
      setErrors((e) => ({ ...e, [c.id]: '' }));
      try {
        const input: Record<string, unknown> = {
          id: c.id,
          winner,
          clientBody: c.clientBody,
        };
        if (winner === 'merged') {
          const raw = drafts[c.id] ?? pretty(c.clientBody ?? c.serverBody);
          let mergedBody: unknown;
          try {
            mergedBody = JSON.parse(raw);
          } catch {
            setErrors((e) => ({ ...e, [c.id]: 'merged body is not valid JSON' }));
            setBusy(null);
            return;
          }
          input.mergedBody = mergedBody;
        }
        const r = await lensRun<ResolveResult>('offline', 'mergeResolve', input);
        if (!r.data.ok || !r.data.result) {
          setErrors((e) => ({ ...e, [c.id]: r.data.error || 'resolve failed' }));
          return;
        }
        // Reconcile the local store with the committed revision.
        await markClean(c.id, r.data.result.rev, r.data.result.resolvedBody == null);
        onResolved(c.id);
      } catch (e) {
        setErrors((err) => ({
          ...err,
          [c.id]: e instanceof Error ? e.message : 'resolve error',
        }));
      } finally {
        setBusy(null);
      }
    },
    [drafts, onResolved],
  );

  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/20 pb-3">
        <GitMerge className="h-5 w-5 text-amber-400" />
        <div>
          <h2 className="text-sm font-semibold text-white">
            Conflict resolution · {conflicts.length} divergence
            {conflicts.length === 1 ? '' : 's'}
          </h2>
          <p className="text-[11px] text-zinc-400">
            The client did not branch from the server&apos;s current revision. Pick a
            winning branch.
          </p>
        </div>
      </header>

      {conflicts.map((c) => {
        const draft = drafts[c.id] ?? pretty(c.clientBody ?? c.serverBody);
        return (
          <div
            key={c.id}
            className="space-y-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.03] p-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] text-zinc-100">{c.id}</span>
              <span className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                <ShieldQuestion className="h-3 w-3" />
                {c.reason}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                  <Server className="h-3 w-3" /> Server · {c.serverRev}
                </div>
                <pre className="max-h-40 overflow-auto font-mono text-[10px] text-zinc-300">
                  {pretty(c.serverBody)}
                </pre>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  <Smartphone className="h-3 w-3" /> Client · {c.clientRev ?? 'new'}
                </div>
                <pre className="max-h-40 overflow-auto font-mono text-[10px] text-zinc-300">
                  {pretty(c.clientBody)}
                </pre>
              </div>
            </div>

            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Hand-merged body
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                rows={5}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-[10px] text-white"
              />
            </div>

            {errors[c.id] && (
              <p className="rounded border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[10px] text-red-300">
                {errors[c.id]}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => resolve(c, 'server')}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50"
              >
                {busy === `${c.id}:server` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Server className="h-3.5 w-3.5" />
                )}
                Keep server
              </button>
              <button
                onClick={() => resolve(c, 'client')}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
              >
                {busy === `${c.id}:client` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Smartphone className="h-3.5 w-3.5" />
                )}
                Keep client
              </button>
              <button
                onClick={() => resolve(c, 'merged')}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
              >
                {busy === `${c.id}:merged` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Commit merge
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
