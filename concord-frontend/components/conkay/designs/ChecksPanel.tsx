'use client';

/**
 * ChecksPanel — every solver run in the snapshot with its status and margins
 * (demand vs capacity, margin %), filterable by status. Rows open to the
 * solver's method and reason. Margins are shown exactly as the solver stated
 * them; a run with no margin says so rather than showing a blank bar.
 */

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CHECK_STATUSES, formatValue, type CheckStatus, type DesignCheck, type CheckCounts } from '@/lib/conkay/designs-api';
import { CHECK_LABEL, CHECK_STYLE, PANEL } from './design-styles';

export function ChecksPanel({ checks, counts, perPartRuns }: { checks: DesignCheck[]; counts: CheckCounts; perPartRuns?: CheckCounts }) {
  const [filter, setFilter] = useState<CheckStatus | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const order = (s: CheckStatus) => ['FAIL', 'ERROR', 'WARN', 'NOT_COMPUTED', 'PASS'].indexOf(s);
    return checks.filter((c) => filter === 'all' || c.status === filter).sort((a, b) => order(a.status) - order(b.status));
  }, [checks, filter]);
  const perPartTotal = perPartRuns ? Object.values(perPartRuns).reduce((a, b) => a + b, 0) : 0;

  return (
    <section className={PANEL} aria-label="Solver checks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Solver checks</h2>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter checks by status">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All {checks.length}</FilterChip>
          {CHECK_STATUSES.filter((s) => counts[s] > 0).map((s) => (
            <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} className={CHECK_STYLE[s]}>
              {CHECK_LABEL[s]} {counts[s]}
            </FilterChip>
          ))}
        </div>
      </div>
      {perPartTotal > 0 && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          Plus {perPartTotal} per-part mass/cost runs ({CHECK_STATUSES.filter((s) => perPartRuns![s]).map((s) => `${perPartRuns![s]} ${CHECK_LABEL[s].toLowerCase()}`).join(', ')}), rolled into the mass breakdown.
        </p>
      )}
      <ul className="mt-3 divide-y divide-white/5">
        {shown.map((c) => {
          const isOpen = open === c.runId;
          const worst = c.margins.reduce<number | null>((m, x) => (x.marginPct == null ? m : m == null ? x.marginPct : Math.min(m, x.marginPct)), null);
          return (
            <li key={c.runId}>
              <button
                onClick={() => setOpen(isOpen ? null : c.runId)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 py-2 text-left hover:bg-white/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/50"
              >
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
                <span className={`w-24 shrink-0 rounded-md border px-1.5 py-0.5 text-center text-[10px] ${CHECK_STYLE[c.status]}`}>{CHECK_LABEL[c.status]}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{c.runId}</span>
                <span className="shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                  {worst == null ? 'no margin stated' : `min margin ${formatValue(worst, 3)} %`}
                </span>
              </button>
              {isOpen && (
                <div className="mb-3 ml-6 space-y-2 text-xs text-slate-300">
                  {c.margins.length > 0 && (
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-slate-500"><tr><th className="font-normal">Check</th><th className="font-normal">Demand</th><th className="font-normal">Capacity</th><th className="font-normal">Margin</th></tr></thead>
                      <tbody className="tabular-nums">
                        {c.margins.map((m, i) => (
                          <tr key={i} className="border-t border-white/5">
                            <td className="py-1 pr-2">{m.check}</td>
                            <td className="pr-2">{formatValue(m.demand)} {m.unit}</td>
                            <td className="pr-2">{formatValue(m.capacity)} {m.unit}</td>
                            <td className={m.marginPct != null && m.marginPct < 0 ? 'text-rose-300' : ''}>{m.marginPct == null ? '—' : `${formatValue(m.marginPct, 3)} %`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {c.reason && <p className="leading-relaxed text-slate-400">{c.reason}</p>}
                  {[...c.failures, ...c.warnings].map((w, i) => <p key={i} className="leading-relaxed text-amber-200/90">{w}</p>)}
                  {c.method && <p className="leading-relaxed text-slate-500"><span className="text-slate-400">Method:</span> {c.method}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FilterChip({ active, onClick, className = '', children }: { active: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2 py-0.5 text-[11px] tabular-nums transition-opacity ${className || 'border-white/10 text-slate-300'} ${active ? 'opacity-100 ring-1 ring-white/30' : 'opacity-70 hover:opacity-100'}`}
    >
      {children}
    </button>
  );
}
