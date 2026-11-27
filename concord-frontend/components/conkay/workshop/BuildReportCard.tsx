'use client';

/**
 * BuildReportCard — what a ConKay build proved, and where you change it.
 * Every row is a solver run: "Checked" compares a demand with a capacity
 * (pass / fail, with the basis); "Not checked" says why. Pick a part (in the
 * model or the list) to see its own checks and edit its sizes and material in
 * any unit; loads and the safety factor are edited the same way. An edit
 * re-runs every solver on the server; nothing changes here until it returns.
 */

import { useState } from 'react';
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BuildCheck, BuildParameter, BuildPart, BuildReport, PartStatus } from '@/lib/conkay/build-report';

export type BuildEdit = { id: string; value: string };
export type EditResult = { ok: boolean; errors?: string[] };

const STATUS_TEXT: Record<PartStatus, string> = { pass: 'passes its checks', warn: 'passes, with warnings', fail: 'fails a check', unchecked: 'nothing checked it yet' };
const STATUS_CLASS: Record<PartStatus, string> = {
  pass: 'text-[color:var(--ws-go)]', warn: 'text-[color:var(--ws-amber)]', fail: 'text-[color:var(--ws-bad,#f87171)]', unchecked: 'text-[color:var(--ws-faint)]',
};

function PartRow({ p, depth, mass, status, selected, onSelect }: { p: BuildPart; depth: number; mass: Map<string, string | null>; status?: Record<string, PartStatus>; selected?: string | null; onSelect?: (id: string | null) => void }) {
  const st = status?.[p.id];
  const label = (
    <span className="block min-w-0 truncate capitalize">
      {st ? <span aria-hidden className={cn('mr-1', STATUS_CLASS[st])}>●</span> : null}
      {p.name}{p.material ? <span className="text-[color:var(--ws-faint)]"> · {p.material}</span> : null}
    </span>
  );
  return (
    <>
      <li className="flex min-w-0 justify-between gap-2 py-0.5" style={{ paddingLeft: depth * 10 }}>
        {onSelect && p.shape ? (
          <button type="button" onClick={() => onSelect(selected === p.id ? null : p.id)} aria-pressed={selected === p.id} data-testid={`build-part-${p.id}`}
            className={cn('min-w-0 flex-1 text-left hover:text-[color:var(--ws-arc)]', selected === p.id && 'font-semibold text-[color:var(--ws-arc)]')}>{label}</button>
        ) : <span className="min-w-0 flex-1">{label}</span>}
        {mass.get(p.id) ? <span className="ws-num shrink-0 text-[color:var(--ws-faint)]">{mass.get(p.id)}</span> : null}
      </li>
      {p.children.map((k) => <PartRow key={k.id} p={k} depth={depth + 1} mass={mass} status={status} selected={selected} onSelect={onSelect} />)}
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

function CheckList({ checks }: { checks: BuildCheck[] }) {
  if (!checks.length) return <p>No check had a limit to compare against yet.</p>;
  return (
    <ul className="space-y-1">
      {checks.map((c, i) => (
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
  );
}

const HINT: Record<string, string> = { length: 'e.g. 3/4 in, 2 ft 3 in, 19 mm', force: 'e.g. 200 N, 45 lbf', force_per_length: 'e.g. 25 lbf/ft, 350 N/m', ratio: 'a number' };

function ParamRow({ p, busy, onEdit }: { p: BuildParameter; busy: boolean; onEdit: (e: BuildEdit[]) => Promise<EditResult> }) {
  const [text, setText] = useState(p.value);
  const [seen, setSeen] = useState(p.value);
  const [error, setError] = useState('');
  if (seen !== p.value) { setSeen(p.value); setText(p.value); }
  const commit = async (value: string) => {
    if (value.trim() === p.value || !value.trim()) { setText(p.value); return; }
    setError('');
    const r = await onEdit([{ id: p.id, value: value.trim() }]);
    if (!r.ok) { setError((r.errors || ['not changed']).join('; ')); setText(p.value); }
  };
  const id = `param-${p.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return (
    <li className="py-0.5">
      <label htmlFor={id} className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate" title={p.label}>{p.label}</span>
        {p.dim === 'material' && p.options ? (
          <select id={id} value={text} disabled={busy} data-testid={id}
            onChange={(e) => { setText(e.target.value); void commit(e.target.value); }}
            className="max-w-[9rem] rounded border border-[color:var(--ws-line-strong)] bg-transparent px-1 py-0.5 text-[11px] text-[color:var(--ws-text)]">
            {p.options.map((o) => <option key={o} value={o} className="bg-black">{o}</option>)}
          </select>
        ) : (
          <input id={id} value={text} disabled={busy} data-testid={id} title={HINT[p.dim] || ''} placeholder={HINT[p.dim] || ''}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => { setText(e.target.value); if (error) setError(''); }}
            onBlur={() => void commit(text)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(p.value); (e.target as HTMLInputElement).blur(); } }}
            className="ws-num w-28 rounded border border-[color:var(--ws-line-strong)] bg-transparent px-1.5 py-0.5 text-right text-[11px] text-[color:var(--ws-text)] focus:border-[color:var(--ws-arc)] focus:outline-none" />
        )}
      </label>
      {error ? <p id={`${id}-err`} role="alert" className="mt-0.5 text-right text-[10.5px] text-[color:var(--ws-amber)]">{error}</p> : null}
    </li>
  );
}

export function BuildReportCard({ report, title, onClose, className, selected = null, onSelect, onEdit, busy = false, stepHref }: {
  report: BuildReport; title?: string; onClose?: () => void; className?: string;
  /** The build as real B-rep solids (STEP), made by the CAD kernel on the server. */
  stepHref?: string;
  selected?: string | null; onSelect?: (id: string | null) => void;
  onEdit?: (edits: BuildEdit[]) => Promise<EditResult>; busy?: boolean;
}) {
  const mass = new Map(report.masses.map((m) => [m.id, m.mass]));
  const tone = report.verdict === 'fails' ? 'text-[color:var(--ws-bad,#f87171)]' : report.verdict === 'passes_checked' ? 'text-[color:var(--ws-go)]' : 'text-[color:var(--ws-amber)]';
  const params = report.parameters || [];
  const partIds = new Set(Object.keys(report.partStatus || {}));
  const findPart = (ps: BuildPart[]): BuildPart | null => { for (const p of ps) { if (p.id === selected) return p; const k = findPart(p.children); if (k) return k; } return null; };
  const sel = selected ? findPart(report.parts) : null;
  const selStatus = selected ? report.partStatus?.[selected] : undefined;
  // conditions (loads, flight, a drink, carried masses) live under Loads and settings, whatever node
  // holds them; a part's own panel keeps its sizes and material
  const isCondition = (p: BuildParameter) => !partIds.has(p.node) || p.id.split(':')[1]?.startsWith('props.');
  const settings = params.filter(isCondition);
  const selChecks = selected ? report.checked.filter((c) => c.part === selected || c.target === selected) : [];
  const selGaps = selected ? report.gaps.filter((g) => g.target === selected) : [];
  return (
    <div className={cn('ws-glass flex flex-col overflow-hidden rounded-lg text-[11.5px] text-[color:var(--ws-muted)]', className)} data-testid="build-report">
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium capitalize text-[color:var(--ws-text)]">{title || 'Build'}</p>
          <p className={cn('mt-0.5 text-[11.5px] font-medium', tone)} data-testid="build-headline">
            {busy ? <><Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />Re-checking…</> : report.headline}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {stepHref ? (
            <a href={stepHref} download data-testid="build-step" title="Real solids (B-rep) for CAD and CAM, made by the CAD kernel from this exact design"
              className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ws-arc)] hover:bg-[color:var(--ws-arc-soft)]">STEP</a>
          ) : null}
          {onClose && <button type="button" onClick={onClose} className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ws-arc)] hover:bg-[color:var(--ws-arc-soft)]">Close</button>}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {sel ? (
          <div className="border-t border-[color:var(--ws-line)] px-3 py-2" data-testid="build-part-focus">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-medium capitalize text-[color:var(--ws-text)]">{sel.name}{sel.material ? <span className="text-[color:var(--ws-faint)]"> · {sel.material}</span> : null}</p>
              <button type="button" onClick={() => onSelect?.(null)} className="shrink-0 text-[11px] text-[color:var(--ws-arc)]">All parts</button>
            </div>
            {selStatus ? <p className={cn('text-[11px]', STATUS_CLASS[selStatus])} data-testid="build-part-status">{STATUS_TEXT[selStatus]}</p> : null}
            {onEdit && params.some((p) => p.node === sel.id && !isCondition(p)) ? (
              <ul className="mt-1.5" data-testid="build-part-params">
                {params.filter((p) => p.node === sel.id && !isCondition(p)).map((p) => <ParamRow key={p.id} p={p} busy={busy} onEdit={onEdit} />)}
              </ul>
            ) : null}
            <div className="mt-2"><CheckList checks={selChecks} /></div>
            {selGaps.map((g, i) => (
              <p key={i} className="mt-1 flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ws-amber)]" aria-hidden />{g.reason}</p>
            ))}
          </div>
        ) : onSelect && partIds.size ? (
          <p className="border-t border-[color:var(--ws-line)] px-3 py-1.5 text-[10.5px] text-[color:var(--ws-faint)]">Pick a part (in the model or under Parts) to see its checks and change it.</p>
        ) : null}
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
        {onEdit && settings.length > 0 && (
          <Section title="Loads and settings" count={settings.length} open={false} testId="build-settings">
            <ul>{settings.map((p) => <ParamRow key={p.id} p={p} busy={busy} onEdit={onEdit} />)}</ul>
          </Section>
        )}
        <Section title="Checked" count={report.checked.length} open={!sel} testId="build-checked">
          <CheckList checks={report.checked} />
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
        <Section title="Parts" count={report.parts.length} open={Boolean(onSelect)} testId="build-parts">
          <ul>{report.parts.map((p) => <PartRow key={p.id} p={p} depth={0} mass={mass} status={report.partStatus} selected={selected} onSelect={onSelect} />)}</ul>
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
