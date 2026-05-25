'use client';

import { Lock, Unlock, ScrollText } from 'lucide-react';
import type { QuarantineLogEntry } from './types';

/**
 * QuarantineLog — audited record of every quarantine and release action.
 * Releases require a reason at the macro layer; this surfaces the trail.
 */
export function QuarantineLog({ log }: { log: QuarantineLogEntry[] }) {
  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <ScrollText className="h-4 w-4 text-rose-400" /> Quarantine audit log
      </h2>
      <p className="text-[11px] text-zinc-400">
        Every quarantine and audited release, newest first. A release cannot be
        recorded without a reason.
      </p>
      {log.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-5 text-center text-xs italic text-zinc-400">
          No quarantine actions yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {log.map((e) => (
            <li
              key={e.id}
              className={`flex items-start gap-2 rounded-lg border p-2.5 text-[11px] ${
                e.action === 'quarantine'
                  ? 'border-rose-800/50 bg-rose-950/20'
                  : 'border-emerald-800/50 bg-emerald-950/20'
              }`}
            >
              {e.action === 'quarantine' ? (
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
              ) : (
                <Unlock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-zinc-200">
                  <span className="font-semibold uppercase">{e.action}</span> · {e.entityId}
                </p>
                <p className="text-zinc-400">{e.reason}</p>
                <p className="font-mono text-[9px] text-zinc-400">
                  {new Date(e.at).toLocaleString()} · {e.by}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
