'use client';

/**
 * The Proof Strip — the ledger every change carries. One row per check, each
 * either proved by something that actually ran or open with its reason and
 * the one action that would close it. Lime appears only on a proved check
 * and on the push control once the whole proof is green.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, GitBranch, Play, FlaskConical, Eye, UploadCloud, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProofSeal } from './ProofSeal';
import { ago, BLOCKER_TEXT, CHECK_LABEL, type CheckKey, type CheckStatus, type Ledger } from './proofApi';

export type Busy = Partial<Record<CheckKey, string>>;

export function StateMark({ s, landed }: { s: CheckStatus | 'running'; landed?: boolean }) {
  const label = { proved: 'Proved', failed: 'Failed', stale: 'Stale', not_run: 'Open', not_applicable: 'Does not apply', unavailable: 'Unavailable', running: 'Running' }[s];
  return (
    <span className="pf-state" data-s={s} data-landed={landed ? 'true' : 'false'} role="img" aria-label={label}>
      {s === 'proved' && <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden><path d="M2 5.2 4.1 7.3 8 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      {s === 'failed' && <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden><path d="M3 3l4 4M7 3 3 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>}
    </span>
  );
}

/** One sentence of evidence per check, written from the ledger's own fields. */
export function evidence(key: CheckKey, l: Ledger): string {
  const c = l.checks[key] as unknown as Record<string, unknown>;
  const st = c.status as CheckStatus;
  if (st === 'not_applicable' || st === 'unavailable') return String(c.reason || '');
  switch (key) {
    case 'types': {
      const t = l.checks.types;
      const files = `${t.filesChecked ?? 0} file${t.filesChecked === 1 ? '' : 's'}`;
      if (t.status === 'failed') return `${t.errors} error${t.errors === 1 ? '' : 's'} in ${files}`;
      const pk = t.uncheckedPackages?.length ? ` · ${t.uncheckedPackages.length} package${t.uncheckedPackages.length === 1 ? '' : 's'} not installed here` : '';
      return `TypeScript · ${files} · no errors${pk}`;
    }
    case 'lint': {
      const t = l.checks.lint;
      if (t.status === 'failed') return [t.errors ? `${t.errors} error${t.errors === 1 ? '' : 's'}` : '', t.warnings ? `${t.warnings} warning${t.warnings === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      return t.info ? `clean · ${t.info} note${t.info === 1 ? '' : 's'}` : 'clean';
    }
    case 'tests': {
      const t = l.checks.tests;
      if (t.status === 'not_run' || t.status === 'stale') return t.reason || '';
      if (t.status === 'failed' && t.total === 0) return t.reason || 'No tests ran';
      return `${t.passed}/${t.total} passed in your browser · ${ago(t.at)}`;
    }
    case 'run': {
      const t = l.checks.run;
      if (t.status === 'not_run' || t.status === 'stale') return t.reason || '';
      const how = t.timedOut ? 'timed out' : `exit ${t.exitCode}`;
      return `${t.path} · ${how}${t.durationMs != null ? ` · ${t.durationMs} ms` : ''} · ${ago(t.at)}`;
    }
    case 'review': {
      const t = l.checks.review;
      return t.status === 'proved' ? `all ${t.total} file${t.total === 1 ? '' : 's'} read` : `${t.reviewed} of ${t.total} file${t.total === 1 ? '' : 's'} read`;
    }
  }
}

const VERDICT: Record<CheckStatus | 'running', string> = { proved: 'proved', failed: 'failed', stale: 'stale', not_run: 'open', not_applicable: 'n/a', unavailable: 'n/a', running: 'running' };

export function sealLine(l: Ledger): string {
  if (l.changes.length === 0) return 'Nothing to prove yet. Change a file and the ledger starts.';
  if (l.green) return 'Every check that applies to this change is proved.';
  return `${l.open.length} check${l.open.length === 1 ? '' : 's'} open: ${l.open.map((k) => CHECK_LABEL[k].toLowerCase()).join(', ')}.`;
}

export interface ProofStripProps {
  ledger: Ledger | null;
  busy: Busy;
  onOpenProblem: (path: string, line: number | null) => void;
  onRunTests: () => void;
  onWriteTests: () => void;
  onRun: (path: string) => void;
  onReview: () => void;
  onPush: () => void;
  className?: string;
}

export function ProofStrip({ ledger, busy, onOpenProblem, onRunTests, onWriteTests, onRun, onReview, onPush, className }: ProofStripProps) {
  const [open, setOpen] = useState<CheckKey | null>(null);
  // Remember which checks were proved, so a check that just turned proved lands visibly.
  const prev = useRef<Partial<Record<CheckKey, CheckStatus>>>({});
  const [landed, setLanded] = useState<Partial<Record<CheckKey, boolean>>>({});
  useEffect(() => {
    if (!ledger) return;
    const next: Partial<Record<CheckKey, boolean>> = {};
    for (const k of ledger.order) {
      const s = ledger.checks[k].status;
      if (s === 'proved' && prev.current[k] && prev.current[k] !== 'proved') next[k] = true;
      prev.current[k] = s;
    }
    setLanded(next);
  }, [ledger]);

  if (!ledger) {
    return (
      <aside className={cn('pf-panel flex flex-col border-l pf-rule', className)} aria-label="Proof" data-testid="pf-strip">
        <div className="p-4"><div className="h-14 animate-pulse rounded pf-raised" role="status" aria-label="Loading proof" /></div>
      </aside>
    );
  }
  const l = ledger;
  const done = l.order.filter((k) => ['proved', 'not_applicable'].includes(l.checks[k].status)).length;
  const adds = l.changes.reduce((a, c) => a + c.additions, 0);
  const dels = l.changes.reduce((a, c) => a + c.deletions, 0);

  const action = (k: CheckKey) => {
    const c = l.checks[k];
    if (busy[k]) return <span className="pf-num pf-muted text-[11px]">{busy[k]}</span>;
    if (c.status === 'proved' || c.status === 'not_applicable' || c.status === 'unavailable') return null;
    if (k === 'tests') {
      if (!l.checks.tests.testFiles?.length) return <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={onWriteTests} data-testid="pf-write-tests"><Wand2 className="h-3 w-3" />Write tests</button>;
      return <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={onRunTests} data-testid="pf-run-tests"><FlaskConical className="h-3 w-3" />Run<span className="pf-kbd">⌘⇧↵</span></button>;
    }
    if (k === 'run') {
      const target = l.checks.run.candidates?.[0];
      if (!target) return null;
      return <button type="button" className="pf-btn pf-btn-ghost h-6 max-w-[150px] px-2" onClick={() => onRun(target)} data-testid="pf-run-file" title={`Run ${target}`}><Play className="h-3 w-3 flex-shrink-0" /><span className="truncate">Run</span><span className="pf-kbd">⌘↵</span></button>;
    }
    if (k === 'review') return <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={onReview} data-testid="pf-review"><Eye className="h-3 w-3" />Review<span className="pf-kbd">⌥R</span></button>;
    return null;
  };

  return (
    <aside className={cn('pf-panel flex min-h-0 flex-col border-l pf-rule', className)} aria-label="Proof" data-testid="pf-strip">
      <div className="border-b pf-rule p-3">
        <div className="pf-seal flex items-center gap-3 p-3" data-green={l.green ? 'true' : 'false'} data-testid="pf-seal">
          <ProofSeal order={l.order} states={Object.fromEntries(l.order.map((k) => [k, l.checks[k].status])) as Record<CheckKey, CheckStatus>} green={l.green} size={84} />
          <div className="min-w-0 flex-1">
            <p className="pf-label" style={l.green ? { color: 'var(--pf-proved)' } : undefined}>{l.green ? 'Proved' : 'Proof ledger'}</p>
            <p className="sr-only" data-testid="pf-seal-count">{done}/{l.order.length}</p>
            <p className="mt-1 text-[12px] leading-snug pf-text-2" data-testid="pf-seal-line">{sealLine(l)}</p>
          </div>
        </div>
      </div>

      <ol className="pf-scroll min-h-0 flex-1 overflow-y-auto" aria-label="Checks">
        {l.order.map((k) => {
          const c = l.checks[k];
          const expandable = hasDetail(k, l);
          const isOpen = open === k && expandable;
          return (
            <li key={k} className="pf-check" data-s={c.status} data-testid={`pf-check-${k}`}>
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="mt-0.5"><StateMark s={busy[k] ? 'running' : c.status} landed={landed[k]} /></span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => expandable && setOpen(isOpen ? null : k)}
                  aria-expanded={expandable ? isOpen : undefined}
                  disabled={!expandable}
                >
                  <span className="pf-ledger-head">
                    <span className="pf-ledger-no">{String(l.order.indexOf(k) + 1).padStart(2, '0')}</span>
                    <span className="pf-check-name pf-ledger-name">{CHECK_LABEL[k]}</span>
                    {expandable && <ChevronRight className={cn('h-3 w-3 pf-faint transition-transform', isOpen && 'rotate-90')} aria-hidden />}
                    <span className="pf-ledger-leader" aria-hidden />
                    <span className="pf-ledger-verdict">{VERDICT[busy[k] ? 'running' : c.status]}</span>
                  </span>
                  <span className={cn('mt-0.5 block pl-[24px] text-[11.5px] leading-snug', c.status === 'failed' ? 'pf-fail' : c.status === 'stale' ? 'pf-stale' : 'pf-muted')} data-testid={`pf-evidence-${k}`}>{evidence(k, l)}</span>
                </button>
                <span className="flex-shrink-0">{action(k)}</span>
              </div>
              {isOpen && <CheckDetail k={k} l={l} onOpenProblem={onOpenProblem} />}
            </li>
          );
        })}
      </ol>

      <div className="border-t pf-rule">
        <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
          <span className="pf-label">Change</span>
          <span className="pf-num text-[11px]"><span className="pf-add">+{adds}</span> <span className="pf-del">−{dels}</span></span>
        </div>
        <p className="truncate px-3 text-[11px] pf-faint" title={l.base.label}>against {l.base.label}</p>
        <ul className="pf-scroll max-h-32 overflow-y-auto py-1" data-testid="pf-changes">
          {l.changes.map((c) => (
            <li key={c.path}>
              <button type="button" className="pf-row py-1 text-[12px]" onClick={() => c.status !== 'deleted' && onOpenProblem(c.path, null)} title={c.path}>
                <span className={cn('pf-mono w-3 text-[11px]', c.status === 'added' ? 'pf-add' : c.status === 'deleted' ? 'pf-del' : 'pf-text-2')}>{c.status[0].toUpperCase()}</span>
                <span className="pf-mono min-w-0 flex-1 truncate">{c.path}</span>
                <span className="pf-num text-[10.5px] pf-faint">+{c.additions} −{c.deletions}</span>
                <span className={cn('h-1.5 w-1.5 rounded-full', c.reviewed ? 'bg-[var(--pf-proved)]' : 'bg-[var(--pf-line-2)]')} aria-label={c.reviewed ? 'Read' : 'Not read yet'} role="img" />
              </button>
            </li>
          ))}
          {l.changes.length === 0 && <li className="px-3 py-1 text-[11.5px] pf-faint">No changes.</li>}
        </ul>
      </div>

      <div className="border-t pf-rule p-3">
        <button type="button" className="pf-btn pf-btn-go h-8 w-full justify-center" disabled={!l.canPush} onClick={onPush} data-testid="pf-push">
          <UploadCloud className="h-3.5 w-3.5" />
          {l.remote ? `Push to ${l.remote.owner}/${l.remote.repo}` : 'Push to GitHub'}
        </button>
        {!l.canPush && (
          <ul className="mt-2 space-y-0.5" data-testid="pf-push-blockers">
            {l.pushBlockers.map((b) => <li key={b} className="text-[11px] pf-muted">{BLOCKER_TEXT[b] || b}</li>)}
          </ul>
        )}
        {l.pushes.length > 0 && (
          <p className="mt-2 flex items-center gap-1 text-[11px] pf-faint">
            <GitBranch className="h-3 w-3" />
            Last proposed <span className="pf-mono pf-text-2">{l.pushes[0].branchName}</span> · {ago(l.pushes[0].at)}
          </p>
        )}
      </div>
    </aside>
  );
}

function hasDetail(k: CheckKey, l: Ledger): boolean {
  const c = l.checks;
  if (k === 'types') return c.types.problems?.length > 0 || !!c.types.uncheckedPackages?.length;
  if (k === 'lint') return c.lint.problems?.length > 0;
  if (k === 'tests') return !!c.tests.failures?.length || !!c.tests.files?.length || !!c.tests.testFiles?.length;
  if (k === 'run') return !!(c.run.stdoutTail || c.run.stderrTail);
  return false;
}

function CheckDetail({ k, l, onOpenProblem }: { k: CheckKey; l: Ledger; onOpenProblem: (path: string, line: number | null) => void }) {
  const c = l.checks;
  if (k === 'types' || k === 'lint') {
    const problems = k === 'types' ? c.types.problems : c.lint.problems;
    return (
      <div className="pb-2">
        <ul>
          {problems.map((p, i) => (
            <li key={i}>
              <button type="button" className="pf-row items-start py-1 pl-9 text-[11.5px]" onClick={() => onOpenProblem(p.path, p.line)}>
                <span className="pf-num w-14 flex-shrink-0 truncate pf-faint" title={p.path}>{p.path.split('/').pop()}:{p.line ?? '–'}</span>
                <span className={cn('min-w-0 flex-1', p.severity === 'info' ? 'pf-muted' : '')}>{p.message}</span>
              </button>
            </li>
          ))}
        </ul>
        {k === 'types' && !!c.types.uncheckedPackages?.length && (
          <p className="px-3 pl-9 pt-1 text-[11px] pf-faint">Not installed here, so not type-checked: <span className="pf-mono pf-text-2">{c.types.uncheckedPackages.join(', ')}</span></p>
        )}
      </div>
    );
  }
  if (k === 'tests') {
    return (
      <div className="space-y-1 pb-2 pl-9 pr-3">
        {(c.tests.failures || []).map((f, i) => (
          <div key={i} className="text-[11.5px]"><span className="pf-mono pf-fail">{f.name}</span><p className="pf-mono whitespace-pre-wrap break-words pf-muted">{f.error}</p></div>
        ))}
        <p className="text-[11px] pf-faint">Test files: <span className="pf-mono pf-text-2">{(c.tests.files?.length ? c.tests.files : c.tests.testFiles || []).join(', ')}</span></p>
      </div>
    );
  }
  return (
    <div className="pb-2 pl-9 pr-3">
      <pre className="pf-mono pf-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border pf-rule bg-[var(--pf-ink)] p-2 text-[11px] pf-text-2">{(c.run.stdoutTail || '') + (c.run.stderrTail ? `\n${c.run.stderrTail}` : '')}</pre>
    </div>
  );
}
