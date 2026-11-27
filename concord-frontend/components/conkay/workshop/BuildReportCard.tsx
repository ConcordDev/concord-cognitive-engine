'use client';

/**
 * BuildReportCard — what a ConKay build proved. Every row is a solver run:
 * "Checked" compares a demand with a capacity (pass / fail, with the basis);
 * "Not checked" says why and what would check it. Values are in the units
 * the person used. Nothing here is Kay's word.
 */

import { useState } from 'react';
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BuildPart, BuildReport } from '@/lib/conkay/build-report';

function PartRow({ p, depth, mass }: { p: BuildPart; depth: number; mass: Map<string, string | null> }) {
  return (
    <>
      <li className="flex justify-between gap-2 py-0.5" style={{ paddingLeft: depth * 10 }}>
        <span className="truncate capitalize">{p.name}{p.material ? <span className="text-[color:var(--ws-faint)]"> · {p.material}</span> : null}</span>
        {mass.get(p.id) ? <span className="ws-num shrink-0 text-[color:var(--ws-faint)]">{mass.get(p.id)}</span> : null}
      </li>
      {p.children.map((k) => <PartRow key={k.id} p={k} depth={depth + 1} mass={mass} />)}
    </>
  );
}

function Section({ title, count, open: start, children, testId }: { title: string; count: number; open: boolean; children: React.ReactNode; testId: string }) {
  const [open, setOpen] = useState(start);
  return (
    <div className="border-t border-[color:var(--ws-line)]" data-testid={testId}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-[color:var(--ws-text)] hover:bg-[color:var(--ws-arc-soft)]">
        <span>{title} <span className="ws-num text-[color:var(--ws-faint)]">{count}</span></span>
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

export function BuildReportCard({ report, title, onClose, className }: { report: BuildReport; title?: string; onClose?: () => void; className?: string }) {
  const mass = new Map(report.masses.map((m) => [m.id, m.mass]));
  const tone = report.verdict === 'fails' ? 'text-[color:var(--ws-bad,#f87171)]' : report.verdict === 'passes_checked' ? 'text-[color:var(--ws-go)]' : 'text-[color:var(--ws-amber)]';
  return (
    <div className={cn('ws-glass flex flex-col overflow-hidden rounded-lg text-[11.5px] text-[color:var(--ws-muted)]', className)} data-testid="build-report">
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium capitalize text-[color:var(--ws-text)]">{title || 'Build'}</p>
          <p className={cn('mt-0.5 text-[11.5px] font-medium', tone)} data-testid="build-headline">{report.headline}</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ws-arc)] hover:bg-[color:var(--ws-arc-soft)]">Close</button>}
      </div>
      <div className="min-h-0 overflow-y-auto">
        {report.questions.length > 0 && (
          <div className="border-t border-[color:var(--ws-line)] px-3 py-2" data-testid="build-questions">
            {report.questions.map((q) => (
              <p key={q.ask} className="flex gap-1.5 py-0.5 text-[color:var(--ws-text)]">
                <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ws-arc)]" aria-hidden />
                <span>{q.ask}{q.default ? <span className="text-[color:var(--ws-faint)]"> (assuming {q.default})</span> : null}</span>
              </p>
            ))}
          </div>
        )}
        <Section title="Checked" count={report.checked.length} open testId="build-checked">
          {report.checked.length ? (
            <ul className="space-y-1">
              {report.checked.map((c, i) => (
                <li key={`${c.solver}-${c.check}-${i}`} className="flex gap-1.5">
                  {c.pass ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ws-go)]" aria-label="passes" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ws-bad,#f87171)]" aria-label="fails" />}
                  <span className="min-w-0">
                    <span className="text-[color:var(--ws-text)]">{c.targetName}: {c.check}</span>
                    <span className="ws-num block text-[color:var(--ws-muted)]">{c.demand} vs {c.capacity}{c.utilization != null ? ` · ${Math.round(c.utilization * 100)} %` : ''}</span>
                    {c.basis ? <span className="block text-[10.5px] text-[color:var(--ws-faint)]">limit: {c.basis}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p>No check had a limit to compare against yet.</p>}
        </Section>
        {report.computed.length > 0 && (
          <Section title="Computed, not checked" count={report.computed.length} open={false} testId="build-computed">
            <ul className="space-y-1">
              {report.computed.map((c, i) => (
                <li key={`${c.solver}-${i}`}>
                  <span className="text-[color:var(--ws-text)]">{c.targetName}</span>
                  {c.outputs?.length ? <span className="ws-num block">{c.outputs.map((o) => `${o.name} ${o.value}`).join(' · ')}</span> : null}
                  {c.note ? <span className="block text-[10.5px] text-[color:var(--ws-faint)]">{c.note}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Not checked" count={report.gaps.length} open={report.checked.length === 0} testId="build-gaps">
          {report.gaps.length ? (
            <ul className="space-y-1">
              {report.gaps.map((g, i) => (
                <li key={`${g.target}-${g.solver || g.domain}-${i}`} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ws-amber)]" aria-hidden />
                  <span className="min-w-0"><span className="text-[color:var(--ws-text)]">{g.targetName}</span>: {g.reason}</span>
                </li>
              ))}
            </ul>
          ) : <p>Every applicable check ran.</p>}
        </Section>
        <Section title="Parts" count={report.parts.length} open={false} testId="build-parts">
          <ul>{report.parts.map((p) => <PartRow key={p.id} p={p} depth={0} mass={mass} />)}</ul>
        </Section>
        {(report.assumptions.length > 0 || report.sources.length > 0) && (
          <Section title="Assumptions and sources" count={report.assumptions.length + report.sources.length} open={false} testId="build-sources">
            <ul className="space-y-1">
              {report.assumptions.map((a) => <li key={a}>· {a}</li>)}
              {report.sources.map((s, i) => (
                <li key={`${s.book}-${i}`} className="flex gap-1.5">
                  <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{s.for}: {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--ws-arc)] underline underline-offset-2">{s.book}, {s.section}</a> : `${s.book}, ${s.section}`}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

export default BuildReportCard;
