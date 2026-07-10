'use client';

/**
 * ForkAnalysisLab — real designed input surface for the two text-diffing
 * fork macros that need structured content the generic artifact store never
 * had: `fork.divergenceAnalysis` (Levenshtein + line-conflict-region
 * analysis across a base file and two forked versions) and
 * `fork.mergeComplexity` (conflict-region + dependency-overlap merge-effort
 * scoring).
 *
 * Both are called directly via lensRun — the posted `input` object becomes
 * the macro's `artifact.data` server-side (see server.js `/api/lens/run`),
 * so no generic CRUD artifact needs to exist first. Merge-complexity input
 * (`changes: [{ file, regions: [{startLine,endLine,author}] }]`) is derived
 * mechanically from the divergence result's own conflictRegions rather than
 * hand-authored — real derived data, not a JSON-paste stand-in for a form.
 */

import { useCallback, useState } from 'react';
import {
  ArrowLeftRight, Loader2, FileCode2, Sparkles, Wand2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface FileConflict {
  path: string;
  status: string;
  conflict: boolean;
  editDistanceAB: number;
  conflictRegions: { startLine: number; endLine: number; lines: number }[];
}
interface DivergenceResult {
  files: FileConflict[];
  summary: { totalFiles: number; conflictingFiles: number; modifiedInA: number; modifiedInB: number };
  divergence: { score: number; level: string; totalEditDistance: number };
}
interface MergeResult {
  message?: string;
  complexity?: { score: number; level: string; estimatedMergeHours: number };
  summary?: { totalDirectConflicts: number; autoMergeCandidate: boolean };
}

const EXAMPLE_BASE = `function greet(name) {\n  return "Hello, " + name + "!";\n}\n`;
const EXAMPLE_A = `function greet(name) {\n  return \`Hello, \${name}!\`;\n}\n`;
const EXAMPLE_B = `function greet(name, title) {\n  return "Hello, " + title + " " + name + "!";\n}\n`;

export function ForkAnalysisLab() {
  const [base, setBase] = useState('');
  const [forkA, setForkA] = useState('');
  const [forkB, setForkB] = useState('');
  const [divergence, setDivergence] = useState<DivergenceResult | null>(null);
  const [merge, setMerge] = useState<MergeResult | null>(null);
  const [busy, setBusy] = useState<'divergence' | 'merge' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadExample = () => { setBase(EXAMPLE_BASE); setForkA(EXAMPLE_A); setForkB(EXAMPLE_B); setDivergence(null); setMerge(null); };

  const runDivergence = useCallback(async () => {
    setBusy('divergence'); setErr(null); setMerge(null);
    const r = await lensRun<DivergenceResult>('fork', 'divergenceAnalysis', {
      base: { files: { 'file.txt': base } },
      forkA: { files: { 'file.txt': forkA } },
      forkB: { files: { 'file.txt': forkB } },
    });
    if (r.data?.ok && r.data.result) setDivergence(r.data.result);
    else setErr(r.data?.error || 'divergence analysis failed');
    setBusy(null);
  }, [base, forkA, forkB]);

  const runMergeEstimate = useCallback(async () => {
    if (!divergence) return;
    const conflicted = divergence.files.filter((f) => f.conflict && f.conflictRegions.length > 0);
    if (conflicted.length === 0) {
      setErr('No conflicting regions in the divergence result to estimate merge effort from.');
      return;
    }
    setBusy('merge'); setErr(null);
    const changes = conflicted.map((f) => ({
      file: f.path,
      regions: f.conflictRegions.flatMap((r) => ([
        { startLine: r.startLine, endLine: r.endLine, author: 'Fork A' },
        { startLine: r.startLine, endLine: r.endLine, author: 'Fork B' },
      ])),
    }));
    const r = await lensRun<MergeResult>('fork', 'mergeComplexity', { changes });
    if (r.data?.ok && r.data.result) setMerge(r.data.result);
    else setErr(r.data?.error || 'merge complexity estimate failed');
    setBusy(null);
  }, [divergence]);

  const taCls = 'w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-500';

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Divergence &amp; merge lab</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">3-way text diff · real Levenshtein + conflict regions</span>
        </div>
        <button onClick={loadExample} className="flex items-center gap-1 rounded bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/20">
          <Sparkles className="h-3 w-3" /> Load example
        </button>
      </header>

      <p className="text-[11px] text-zinc-400">
        Paste a base version of a file plus two forked edits. The engine finds which lines
        each fork changed, flags true conflicts (both forks touched the same line
        differently), and scores overall divergence.
      </p>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">Base</span>
          <textarea rows={6} value={base} onChange={(e) => setBase(e.target.value)} placeholder="original file content…" className={taCls} />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-cyan-300">Fork A</span>
          <textarea rows={6} value={forkA} onChange={(e) => setForkA(e.target.value)} placeholder="fork A's version…" className={taCls} />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-purple-300">Fork B</span>
          <textarea rows={6} value={forkB} onChange={(e) => setForkB(e.target.value)} placeholder="fork B's version…" className={taCls} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runDivergence}
          disabled={busy !== null || (!base && !forkA && !forkB)}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {busy === 'divergence' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCode2 className="h-3.5 w-3.5" />}
          Run divergence analysis
        </button>
        <button
          onClick={runMergeEstimate}
          disabled={busy !== null || !divergence}
          title={!divergence ? 'Run divergence analysis first' : 'Estimate merge effort from the conflicting regions above'}
          className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-200 hover:bg-purple-500/20 disabled:opacity-40"
        >
          {busy === 'merge' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Estimate merge complexity
        </button>
      </div>

      {err && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>}

      {divergence && (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['files', divergence.summary.totalFiles, 'text-zinc-100'],
              ['conflicts', divergence.summary.conflictingFiles, divergence.summary.conflictingFiles > 0 ? 'text-red-300' : 'text-emerald-300'],
              ['modified in A', divergence.summary.modifiedInA, 'text-cyan-300'],
              ['modified in B', divergence.summary.modifiedInB, 'text-purple-300'],
            ].map(([label, value, tone]) => (
              <div key={label as string} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center">
                <p className={`text-lg font-bold ${tone}`}>{value}</p>
                <p className="text-[9px] uppercase tracking-wide text-zinc-400">{label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full ${divergence.divergence.score > 70 ? 'bg-red-500' : divergence.divergence.score > 40 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${divergence.divergence.score}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-zinc-200">{divergence.divergence.score}% · {divergence.divergence.level}</span>
          </div>
        </div>
      )}

      {merge && (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {merge.message ? (
            <p className="text-xs text-zinc-400">{merge.message}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-cyan-300">{merge.complexity?.score}/100</p>
                  <p className="text-[9px] uppercase tracking-wide text-zinc-400">complexity</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center">
                  <p className="text-lg font-bold capitalize text-amber-300">{merge.complexity?.level}</p>
                  <p className="text-[9px] uppercase tracking-wide text-zinc-400">level</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-zinc-100">{merge.complexity?.estimatedMergeHours}h</p>
                  <p className="text-[9px] uppercase tracking-wide text-zinc-400">est. effort</p>
                </div>
              </div>
              {merge.summary?.autoMergeCandidate && (
                <p className="rounded border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-300">
                  Auto-merge candidate — no conflicts detected.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
