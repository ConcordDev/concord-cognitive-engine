'use client';

import { Sparkles } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { RepairPattern } from './types';

export function PatternsPanel({ topPatterns }: { topPatterns: RepairPattern[] }) {
  return (
    <section aria-labelledby="patterns-heading" className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      <h2 id="patterns-heading" className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
        <Sparkles className="h-4 w-4" /> Learned patterns
        <span className="text-[10px] font-normal normal-case text-slate-500">what the cortex has seen before, ranked by occurrence</span>
      </h2>
      {topPatterns.length === 0 ? (
        <p className="text-[11px] text-slate-500">No repair patterns recorded yet in this process&apos;s memory.</p>
      ) : (
        <div className="space-y-1.5">
          {topPatterns.map((p, i) => (
            <div key={`${p.pattern}-${i}`} className="flex items-center gap-3 rounded border border-zinc-800/60 bg-black/20 px-2.5 py-1.5 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-mono text-slate-300" title={p.pattern}>{p.pattern}</span>
              <span className="shrink-0 text-slate-500" title="occurrences">{p.occurrences}×</span>
              <div className="hidden w-20 shrink-0 items-center gap-1 sm:flex" title={`${Math.round(p.successRate * 100)}% success`}>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={cn('h-full rounded-full', p.successRate >= 0.6 ? 'bg-emerald-400' : p.successRate >= 0.3 ? 'bg-amber-400' : 'bg-red-400')}
                    style={{ width: `${Math.round(p.successRate * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-slate-500">{Math.round(p.successRate * 100)}%</span>
              </div>
              {p.securityRelated && (
                <span className="shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-300" title={p.cveId ? `CVE: ${p.cveId}` : 'security-related'}>
                  {p.cveId || 'CVE'}
                </span>
              )}
              {p.deprecated && (
                <span className="shrink-0 rounded bg-slate-600/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300" title="success rate dropped below 30% — fix marked unreliable">
                  deprecated
                </span>
              )}
              <span className="hidden shrink-0 text-slate-600 md:inline">{formatRelativeTime(p.lastSeen)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
