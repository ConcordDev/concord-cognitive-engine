'use client';

import { CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { Escalation } from './types';

export function EscalationInboxPanel({
  escalations, selectedEscalationId, setSelectedEscalationId,
  pendingEscalationId, resolve,
}: {
  escalations: Escalation[];
  selectedEscalationId: string | null;
  setSelectedEscalationId: (id: string | null) => void;
  pendingEscalationId: string | null;
  resolve: (id: string, resolution: 'approved' | 'dismissed') => void;
}) {
  return (
    <section aria-labelledby="escalation-heading" className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3">
      <h2 id="escalation-heading" className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber-300">
        <ShieldAlert className="h-4 w-4" /> Escalation inbox ({escalations.length})
        <span className="text-[10px] font-normal normal-case text-slate-500">value/arc calls the cortex refused to make</span>
        {escalations.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-normal normal-case text-slate-500">
            <kbd className="rounded border border-white/10 bg-black/20 px-1 font-mono">j</kbd>/<kbd className="rounded border border-white/10 bg-black/20 px-1 font-mono">k</kbd> select
            <kbd className="ml-1 rounded border border-white/10 bg-black/20 px-1 font-mono">a</kbd> approve
            <kbd className="rounded border border-white/10 bg-black/20 px-1 font-mono">x</kbd> dismiss
          </span>
        )}
      </h2>
      {escalations.length === 0 ? (
        <p className="text-[11px] text-slate-500">Nothing awaiting your decision.</p>
      ) : (
        <div className="grid gap-2">
          {escalations.map((e) => {
            const isSelected = selectedEscalationId === e.id;
            const isPending = pendingEscalationId === e.id;
            return (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedEscalationId(e.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelectedEscalationId(e.id); } }}
                className={cn(
                  'rounded-lg border p-3 text-sm transition-colors duration-150 cursor-pointer',
                  isSelected ? 'border-amber-400/60 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/40 hover:border-amber-500/30',
                )}
              >
                <div className="mb-2 flex items-start gap-2">
                  <span className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                    e.priority === 'high' ? 'bg-red-500/20 text-red-300' : 'bg-slate-500/20 text-slate-300',
                  )}>{e.priority}</span>
                  <span className="flex-1 text-[13px] leading-snug text-slate-200">{e.message}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(ev) => { ev.stopPropagation(); void resolve(e.id, 'approved'); }}
                    disabled={isPending}
                    className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve
                  </button>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); void resolve(e.id, 'dismissed'); }}
                    disabled={isPending}
                    className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Dismiss
                  </button>
                  <span className="ml-auto text-[10px] text-slate-500">{formatRelativeTime(e.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
