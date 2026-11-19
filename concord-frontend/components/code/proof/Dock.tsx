'use client';

/** The bottom dock: project-wide problems, the last run's output, the last test run, references and blame. */

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { code, type Problem } from './proofApi';
import type { TestRunReport } from './proofRunner';

export type DockTab = 'problems' | 'output' | 'tests' | 'refs' | 'blame';
export interface RunOutput { path: string; stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; elapsedMs: number; where: 'browser' | 'sandbox'; note?: string }
export interface Refs { symbol: string | null; source: string; references: { path: string; line: number; snippet?: string; preview?: string; text?: string }[] }
export interface Blame { path: string; blame: { lineNo: number; commitId: string | null; author?: string | null; message?: string | null; committedAt?: string | null; text: string }[] }

export function Dock({ projectId, tab, setTab, onClose, onReveal, fingerprint, output, tests, refs, blame }: {
  projectId: string; tab: DockTab; setTab: (t: DockTab) => void; onClose: () => void;
  onReveal: (path: string, line: number | null) => void; fingerprint: string | undefined;
  output: RunOutput | null; tests: TestRunReport | null; refs: Refs | null; blame: Blame | null;
}) {
  const [problems, setProblems] = useState<{ problems: Problem[]; engine: string; filesScanned: number } | null>(null);
  const loadProblems = useCallback(async () => {
    const r = await code<{ problems: Problem[]; engine: string; filesScanned: number }>('diagnostics', { projectId });
    if (r.ok) setProblems(r.result);
  }, [projectId]);
  useEffect(() => { if (tab === 'problems') void loadProblems(); }, [tab, loadProblems, fingerprint]);

  const tabs: { id: DockTab; label: string; count?: number }[] = [
    { id: 'problems', label: 'Problems', count: problems?.problems.filter((p) => p.severity !== 'info').length },
    { id: 'output', label: 'Output' },
    { id: 'tests', label: 'Tests', count: tests?.failed || undefined },
    ...(refs ? [{ id: 'refs' as const, label: 'References', count: refs.references.length }] : []),
    ...(blame ? [{ id: 'blame' as const, label: 'Blame' }] : []),
  ];

  return (
    <section className="pf-panel flex h-full min-h-0 flex-col border-t pf-rule" aria-label="Dock" data-testid="pf-dock">
      <div className="flex h-8 flex-shrink-0 items-center border-b pf-rule pl-1" role="tablist" aria-label="Dock">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn('h-8 px-3 text-[11.5px]', tab === t.id ? 'text-[color:var(--pf-text)] shadow-[inset_0_-1px_0_var(--pf-text-2)]' : 'pf-muted hover:text-[color:var(--pf-text)]')}>
            {t.label}{t.count ? <span className="pf-num ml-1 pf-faint">{t.count}</span> : null}
          </button>
        ))}
        <button type="button" className="ml-auto mr-1 rounded p-1 pf-faint hover:text-[color:var(--pf-text)]" onClick={onClose} aria-label="Close dock" title="Close (⌃`)"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="pf-scroll min-h-0 flex-1 overflow-auto">
        {tab === 'problems' && (
          <div data-testid="pf-dock-problems">
            {problems && <p className="px-3 pt-1.5 text-[10.5px] pf-faint">{problems.filesScanned} files · {problems.engine === 'typescript' ? 'TypeScript + lint rules' : 'lint rules only (TypeScript service unavailable)'}</p>}
            <ul className="py-1">
              {problems?.problems.map((p, i) => (
                <li key={i}>
                  <button type="button" className="pf-row py-[3px] text-[12px]" onClick={() => onReveal(p.path, p.line)}>
                    <span className={cn('pf-mono w-12 flex-shrink-0 text-[10px]', p.severity === 'error' ? 'pf-fail' : p.severity === 'warning' ? 'pf-stale' : 'pf-faint')}>{p.severity}</span>
                    <span className="min-w-0 flex-1 truncate">{p.message}</span>
                    <span className="pf-num text-[10.5px] pf-faint">{p.path}:{p.line ?? '–'}</span>
                  </button>
                </li>
              ))}
              {problems && problems.problems.length === 0 && <li className="px-3 py-2 text-[12px] pf-faint">No problems in the project.</li>}
            </ul>
          </div>
        )}
        {tab === 'output' && (
          <div className="p-3" data-testid="pf-dock-output">
            {!output && <p className="text-[12px] pf-faint">Run a file with ⌘↵. It runs in your browser, and the result goes into the proof.</p>}
            {output && (
              <>
                <p className="pf-num mb-2 text-[11px] pf-muted"><span className="pf-mono pf-text-2">{output.path}</span> · {output.where === 'browser' ? 'your browser' : 'server sandbox'} · {output.timedOut ? <span className="pf-fail">timed out</span> : output.exitCode === null ? <span className="pf-muted">did not run</span> : <span className={output.exitCode === 0 ? 'pf-ok' : 'pf-fail'}>exit {output.exitCode}</span>}{output.exitCode !== null || output.timedOut ? ` · ${output.elapsedMs} ms` : ''}{output.note ? ` · ${output.note}` : ''}</p>
                <pre className="pf-mono whitespace-pre-wrap break-words text-[12px] pf-text-2">{output.stdout || (output.stderr ? '' : '(no output)')}</pre>
                {output.stderr && <pre className="pf-mono mt-1 whitespace-pre-wrap break-words text-[12px] pf-fail">{output.stderr}</pre>}
              </>
            )}
          </div>
        )}
        {tab === 'tests' && (
          <div className="p-3" data-testid="pf-dock-tests">
            {!tests && <p className="text-[12px] pf-faint">Run the tests with ⌘⇧↵.</p>}
            {tests && (
              <>
                <p className="pf-num mb-2 text-[11.5px]"><span className={tests.failed ? 'pf-fail' : 'pf-ok'}>{tests.passed}/{tests.total} passed</span> <span className="pf-faint">in your browser · {tests.files.length} file{tests.files.length === 1 ? '' : 's'}</span></p>
                {tests.failures.map((f, i) => <div key={i} className="mb-1.5 text-[12px]"><p className="pf-mono pf-fail">✕ {f.name}</p><p className="pf-mono whitespace-pre-wrap pl-3 pf-muted">{f.error}</p></div>)}
                <pre className="pf-mono whitespace-pre-wrap text-[11.5px] pf-faint">{tests.output}</pre>
              </>
            )}
          </div>
        )}
        {tab === 'refs' && refs && (
          <ul className="py-1" data-testid="pf-dock-refs">
            <li className="px-3 pb-1 text-[11px] pf-faint">{refs.references.length} reference{refs.references.length === 1 ? '' : 's'} to <span className="pf-mono pf-text-2">{refs.symbol || '—'}</span> · {refs.source}</li>
            {refs.references.map((r, i) => (
              <li key={i}><button type="button" className="pf-row py-[3px] text-[12px]" onClick={() => onReveal(r.path, r.line)}><span className="pf-num w-28 flex-shrink-0 truncate text-[10.5px] pf-faint">{r.path}:{r.line}</span><span className="pf-mono truncate">{(r.snippet || r.preview || r.text || '').trim()}</span></button></li>
            ))}
          </ul>
        )}
        {tab === 'blame' && blame && (
          <ul className="py-1 pf-mono text-[11.5px]" data-testid="pf-dock-blame">
            {blame.blame.map((b) => (
              <li key={b.lineNo}><button type="button" className="pf-row py-0 text-[11.5px]" onClick={() => onReveal(blame.path, b.lineNo)}><span className="pf-num w-8 text-right pf-faint">{b.lineNo}</span><span className={cn('w-40 flex-shrink-0 truncate', b.commitId ? 'pf-muted' : 'pf-faint')}>{b.message}</span><span className="truncate pf-text-2">{b.text}</span></button></li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
