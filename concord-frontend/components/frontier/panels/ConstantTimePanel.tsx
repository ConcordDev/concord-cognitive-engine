'use client';

/**
 * ConstantTimePanel — Wave W3-A, the Constant-Time / Secret-Dependent-Flow
 * Analyzer. Source: server/lib/detectors/constant-time-detector.js,
 * server/lib/detectors/index.js, server/domains/detectors.js.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, adopt its
 * exact interaction language): GITHUB CODE SCANNING's alert list. This
 * panel's Verify cell borrows that shape directly — a severity-badged,
 * rule-id-tagged, file:line-linked findings list with an expandable "why
 * this fired" + fix hint per row, plus a top-line scan summary — rather
 * than a generic table dump.
 *
 * THE READ PATH (read this before assuming it can't be reached): this
 * engine registers no `constant-time.*` macro of its own — `engine.macros`
 * in lib/frontier-engines.ts is empty, and its own honest-boundary text
 * (quoted verbatim in the Boundary cell below) says exactly that: it
 * "ships only as a detector wired into the PR gate," not as a dedicated
 * interactive tool. That is still true. But the detector suite ITSELF has
 * a real, generic, callable macro surface — `server/domains/detectors.js`
 * registers `detectors.run` (run one detector by id) and `detectors.findings`
 * (flattened, filtered findings across all of them) on the SAME macro
 * registry every other lens macro uses, reachable through the exact same
 * `POST /api/lens/run`. This is the identical mechanism
 * `app/lenses/code-quality/page.tsx`'s "Detector Suite" tab already uses.
 * So: no dedicated macro for this ONE engine, but a real, generic read
 * path for ANY registered detector — including this one, by its registry
 * id `"constant-time"` (server/lib/detectors/index.js#REGISTRY). This
 * panel calls `detectors.run({ id: 'constant-time', opts })` and renders
 * the REAL findings that comes back — never a fabricated table.
 *
 * `detectors.run`'s handler always answers `{ok:true, report, runId}` at
 * the macro-transport level, even when the detector itself failed
 * internally — the detector's OWN outcome lives in `report.ok` (see
 * `server/lib/detectors/_framework.js#makeReport`/`makeError`). This
 * panel checks `report.ok`, not the transport envelope, to decide
 * ok/refused — the same "payload carries its own `ok` with different
 * semantics" pattern `runFrontierMacro`'s doc comment describes for its
 * sibling panels, just one level deeper (inside `result.report` rather
 * than `result` itself).
 */

import { useState } from 'react';
import { AlertCircle, FileWarning, ScanSearch } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ComputeCell, VerifyCell, BoundaryCell, runFrontierMacro, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'text-red-500 bg-red-500/10 border-red-500/30',
  high: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  medium: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  low: 'text-blue-300 bg-blue-300/10 border-blue-300/30',
  info: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
};

interface Finding {
  id: string;
  severity: Severity;
  kind?: string;
  category?: string;
  message: string;
  location?: string;
  evidence?: { snippet?: string; scanned?: number; totalFiles?: number };
  fixHint?: string;
}
interface Summary { total: number; critical: number; high: number; medium: number; low: number; info: number }
interface DetectorReport {
  id: string;
  ok: boolean;
  reason?: string;
  error?: string;
  summary: Summary;
  findings: Finding[];
  durationMs: number;
}
interface RunPayload { ok: boolean; report: DetectorReport; runId: string }

export function ConstantTimePanel({ engine }: { engine: FrontierEngineDef }) {
  const [useNamingConvention, setUseNamingConvention] = useState(false);
  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [report, setReport] = useState<DetectorReport | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);
  const [minSeverity, setMinSeverity] = useState<Severity>('info');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function runAnalyzer() {
    setStatus('loading');
    setReason(null);
    setReport(null);
    setExpanded(new Set());
    try {
      const input: Record<string, unknown> = { id: 'constant-time' };
      if (useNamingConvention) input.opts = { useNamingConvention: true };
      const res = await runFrontierMacro<RunPayload>('detectors', 'run', input);
      setRunCount((n) => n + 1);
      if (!res.ok || !res.result) {
        setReason(res.error || 'Could not reach the detector runner.');
        setStatus('refused');
        return;
      }
      const rep = res.result.report;
      if (!rep) {
        setReason('detectors.run returned no report.');
        setStatus('refused');
        return;
      }
      setRunId(res.result.runId || null);
      if (!rep.ok) {
        // The detector itself failed internally (report.ok, NOT the
        // transport ok) — a genuine refusal, not a UI bug.
        setReport(rep);
        setReason(`${rep.reason || 'exception'}${rep.error ? ` — ${rep.error}` : ''}`);
        setStatus('refused');
        return;
      }
      setReport(rep);
      setStatus('ok');
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  const minRank = SEVERITIES.indexOf(minSeverity);
  const visibleFindings = (report?.findings ?? []).filter((f) => SEVERITIES.indexOf(f.severity) <= minRank);

  function toggleExpanded(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel="detectors.run (id: 'constant-time')"
        running={status === 'loading'}
        onRun={runAnalyzer}
        runLabel="Run the analyzer"
      >
        <div className="rounded-lg border border-lattice-border bg-lattice-surface p-3 space-y-2">
          <p className={cn(ds.textBody, 'text-sm')}>
            No macro is registered for this engine by name — this panel reaches it through the
            detector suite&apos;s generic runner (<span className={ds.monoXs}>detectors.run</span>),
            the same mechanism the Code Quality lens&apos;s Detector Suite tab uses to invoke any
            registered detector by id. This is a real, callable path, not a workaround.
          </p>
          <p className={cn(ds.textMuted, 'text-xs')}>
            Scans <span className={ds.monoXs}>server/</span> for AST-visible secret-dependent
            branches, indices, loop bounds, and early exits — see the Boundary cell below for
            what it can and cannot see.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={useNamingConvention}
            onChange={(e) => setUseNamingConvention(e.target.checked)}
          />
          <span>
            Also taint by naming convention (identifiers matching <span className={ds.monoXs}>secret|password|token|apiKey|…</span>)
            — off by default, matching the detector&apos;s own documented default. This is
            substantially noisier: a real run against this repo hit the 500-finding cap after a
            small fraction of files. With it off, only explicit <span className={ds.monoXs}>{'// @secret'}</span> annotations
            taint data.
          </span>
        </label>
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {report && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <ScanSearch className="w-4 h-4" aria-hidden="true" />
              <span>
                Real run{runId ? ` ${runId}` : ''} — {report.durationMs}ms — {report.summary.total} finding{report.summary.total === 1 ? '' : 's'} total.
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((s) => (
                <span key={s} className={cn('px-2 py-0.5 rounded-full text-xs font-medium border', SEVERITY_STYLE[s])}>
                  {s}: {report.summary[s]}
                </span>
              ))}
            </div>

            <div>
              <label className={ds.label} htmlFor="ct-min-severity">Show down to severity</label>
              <select
                id="ct-min-severity"
                className={cn(ds.select, 'max-w-xs')}
                value={minSeverity}
                onChange={(e) => setMinSeverity(e.target.value as Severity)}
              >
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {visibleFindings.length === 0 ? (
              <p className={cn(ds.textMuted, 'text-sm')}>No findings at or above this severity.</p>
            ) : (
              <ul className="space-y-2">
                {visibleFindings.map((f, i) => {
                  const isSummary = f.id === 'constant_time_summary';
                  const isDegraded = f.id === 'constant_time_parser_unavailable';
                  return (
                    <li
                      key={`${f.id}-${f.location || i}`}
                      className={cn(
                        'rounded-lg border p-3',
                        isDegraded ? 'border-amber-500/40 bg-amber-500/5' : 'border-lattice-border bg-lattice-surface',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {isDegraded ? (
                          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
                        ) : (
                          <FileWarning className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium border', SEVERITY_STYLE[f.severity])}>{f.severity}</span>
                            <span className={cn(ds.monoXs, 'text-gray-500')}>{f.id}</span>
                            {f.location && <span className={cn(ds.monoXs, 'text-gray-400')}>{f.location}</span>}
                          </div>
                          <p className={cn(ds.textBody, 'text-sm mt-1')}>{f.message}</p>
                          {!isSummary && (f.evidence?.snippet || f.fixHint) && (
                            <button
                              type="button"
                              className={cn(ds.monoXs, 'text-neon-blue hover:underline mt-1')}
                              onClick={() => toggleExpanded(i)}
                            >
                              {expanded.has(i) ? 'Hide detail' : 'Show snippet + fix hint'}
                            </button>
                          )}
                          {expanded.has(i) && (
                            <div className="mt-2 space-y-1">
                              {f.evidence?.snippet && (
                                <pre className={cn(ds.monoXs, 'whitespace-pre-wrap break-all bg-black/30 rounded p-2 text-gray-300')}>{f.evidence.snippet}</pre>
                              )}
                              {f.fixHint && <p className={cn(ds.textMuted, 'text-xs italic')}>Fix: {f.fixHint}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

export default ConstantTimePanel;
