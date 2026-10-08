'use client';

/**
 * StudyCards — the strip under the viewport. Each card shows a value only when
 * a solve produced it: pass/fail and the hand check from the FEA summary,
 * utilization from the solver, the DTU only once the study was kept as one
 * and read back. Before the first solve, or after an edit, the cards say so.
 */

import { Cpu, FileCheck2, Loader2, Receipt, ShieldAlert, ShieldCheck, Sigma } from 'lucide-react';
import type { BeamStudyResult } from '@/lib/conkay/workspace-commands';
import type { SolveStatus } from './useConKayWorkspace';

interface Props {
  result: BeamStudyResult | null;
  stale: boolean;
  status: SolveStatus;
  onRun: () => void;
  onKeep: () => void;
  keeping: boolean;
  /** Link text under "Not kept". The no-login demo uses it to say keeping needs an account. */
  keepLabel?: string;
}

const card = 'flex min-w-0 items-center gap-2.5 rounded-xl border border-sky-400/15 bg-[#081423]/80 px-3 py-2.5';

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function StudyCards({ result, stale, status, onRun, onKeep, keeping, keepLabel = 'Keep as DTU' }: Props) {
  const solving = status === 'solving';
  if (!result || stale) {
    return (
      <div className={`${card} justify-between`}>
        <p className="text-sm text-slate-300">
          {solving ? 'Solving…' : stale ? 'Inputs changed since the last solve. Results are hidden until it is re-run.' : 'Not solved yet. Run FEA to compute stress, deflection and utilization.'}
        </p>
        <button
          type="button"
          onClick={onRun}
          disabled={solving}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-500/90 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {solving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Run FEA
        </button>
      </div>
    );
  }

  const util = result.utilization * 100;
  return (
    <div className="grid grid-cols-2 gap-2 2xl:grid-cols-4">
      <div className={card}>
        {result.pass
          ? <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-300" aria-hidden />
          : <ShieldAlert className="h-6 w-6 shrink-0 text-rose-300" aria-hidden />}
        <div className="min-w-0">
          <p className={`text-sm font-medium ${result.pass ? 'text-emerald-200' : 'text-rose-200'}`}>{result.pass ? 'Within yield' : 'Exceeds yield'}</p>
          <p className="truncate text-[11px] text-slate-400" title={`Hand calculation: ${result.handCheck.maxStressMPa.toFixed(2)} MPa, ${result.handCheck.maxDeflectionMm.toFixed(4)} mm`}>
            {result.handCheck.agrees ? 'Hand check agrees' : 'Hand check disagrees'}
          </p>
        </div>
      </div>
      <div className={card}>
        <Cpu className={`h-6 w-6 shrink-0 ${util > 100 ? 'text-rose-300' : util > 80 ? 'text-amber-300' : 'text-violet-300'}`} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">FEA util. {util.toFixed(1)}%</p>
          <p className="truncate text-[11px] text-slate-400">SF {result.safetyFactor.toFixed(2)} · {result.maxStressMPa.toFixed(1)} MPa</p>
        </div>
      </div>
      <div className={card}>
        <FileCheck2 className={`h-6 w-6 shrink-0 ${result.dtuId ? 'text-teal-300' : 'text-slate-500'}`} aria-hidden />
        <div className="min-w-0">
          {result.dtuId ? (
            <>
              <p className="text-sm font-medium text-slate-100">Kept as DTU</p>
              <p className="truncate font-mono text-[11px] text-slate-400" title={result.dtuId}>{result.dtuId}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-300">Not kept</p>
              <button type="button" onClick={onKeep} disabled={keeping} className="text-[11px] text-sky-300 hover:underline disabled:opacity-60">
                {keeping ? 'Keeping…' : keepLabel}
              </button>
            </>
          )}
        </div>
      </div>
      <div className={card}>
        <Sigma className="h-6 w-6 shrink-0 text-sky-300" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">δ {result.maxDeflectionMm.toFixed(3)} mm</p>
          <p className="truncate text-[11px] text-slate-400">
            Solved {ago(result.updatedAt)}{typeof result.elapsedMs === 'number' ? ` in ${result.elapsedMs} ms` : ''}
          </p>
        </div>
      </div>
      {result.analysisReceipt && (
        <div className={`${card} col-span-2 2xl:col-span-4`} title={`assumptions: ${(result.analysisReceipt.assumptions || []).join('; ')}; out of scope: ${(result.analysisReceipt.outOfScope || []).join(', ')}`}>
          <Receipt className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] text-slate-300">
              {result.analysisReceipt.solver} · {result.analysisReceipt.units} · {result.analysisReceipt.inputHash.slice(0, 12)}…
            </p>
            <p className="truncate text-[10px] text-slate-500">
              {(result.analysisReceipt.assumptions || []).slice(0, 3).join(' · ')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
