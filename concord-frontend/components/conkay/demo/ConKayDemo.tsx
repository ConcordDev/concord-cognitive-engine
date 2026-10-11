'use client';

/**
 * ConKayDemo — the no-login ConKay page (/conkay/demo). A visitor sizes an
 * I-beam and runs the real beam-frame FEA; the viewport, parameter card and
 * result cards are the workspace's own components. Every number on screen
 * came back from a solve. Nothing is saved: keeping a study, saving a model
 * and talking to ConKay need an account and link to sign-up.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, LogIn, UserPlus } from 'lucide-react';
import { ParameterPanel } from '@/components/conkay/workspace/ParameterPanel';
import { StudyCards } from '@/components/conkay/workspace/StudyCards';
import {
  NEW_STUDY,
  inputsMatchResult,
  type Material,
  type SolveStatus,
  type StudyInputs,
} from '@/components/conkay/workspace/useConKayWorkspace';
import type { BeamStudyResult } from '@/lib/conkay/workspace-commands';
import { DISPLAY_LABELS, VIEW_LABELS, type DisplayMode, type ViewPreset } from '@/lib/conkay/beam-view';
import {
  DEMO_SIGNIN_HREF,
  DEMO_SIGNUP_HREF,
  depthSweepValues,
  fetchDemoMaterials,
  retryNotice,
  type DemoRetry,
  solveDemoBeam,
  sweepDemoBeam,
  type DemoSweep,
} from '@/lib/conkay/demo-api';

const BeamViewport = dynamic(() => import('@/components/conkay/workspace/BeamViewport'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading viewport…
    </div>
  ),
});

type NoticeKey = 'materials' | 'solve' | 'sweep';

export function ConKayDemo() {
  const router = useRouter();
  const [inputs, setInputs] = useState<StudyInputs>(NEW_STUDY);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [result, setResult] = useState<BeamStudyResult | null>(null);
  const [status, setStatus] = useState<SolveStatus>('idle');
  const [error, setError] = useState('');
  const [view, setView] = useState<ViewPreset>('isometric');
  const [display, setDisplay] = useState<DisplayMode>('wire-stress');
  const [sweep, setSweep] = useState<DemoSweep | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepError, setSweepError] = useState('');
  // Set only while the server has answered 503 and a retry is pending. Keyed
  // by request so one request finishing never clears another's notice.
  const [notice, setNotice] = useState<{ key: NoticeKey; text: string } | null>(null);
  const retryFor = useCallback((key: NoticeKey) => (r: DemoRetry) => setNotice({ key, text: retryNotice(r) }), []);
  const clearNotice = useCallback((key: NoticeKey) => setNotice((n) => (n?.key === key ? null : n)), []);

  useEffect(() => {
    let live = true;
    const onRetry = retryFor('materials');
    void fetchDemoMaterials((r) => { if (live) onRetry(r); }).then((r) => {
      if (!live) return;
      clearNotice('materials');
      if (Array.isArray(r)) setMaterials(r);
      else setError(r.error);
    });
    return () => { live = false; };
  }, [retryFor, clearNotice]);

  const stale = Boolean(result) && !inputsMatchResult(inputs, result);
  const utilization = useMemo(
    () => (result && !stale ? result.utilizationByMember.map((m) => m.utilization) : null),
    [result, stale],
  );

  const run = useCallback(async () => {
    setStatus('solving');
    setError('');
    const r = await solveDemoBeam(inputs, retryFor('solve'));
    clearNotice('solve');
    if ('error' in r) {
      setStatus('error');
      setError(r.error);
      return;
    }
    setResult(r);
    setStatus('idle');
  }, [inputs, retryFor, clearNotice]);

  const runSweep = useCallback(async () => {
    setSweeping(true);
    setSweepError('');
    const r = await sweepDemoBeam(inputs, 'height', depthSweepValues(inputs.dims.height), retryFor('sweep'));
    setSweeping(false);
    clearNotice('sweep');
    if ('error' in r) { setSweep(null); setSweepError(r.error); return; }
    setSweep(r);
  }, [inputs, retryFor, clearNotice]);

  const solving = status === 'solving';

  return (
    <div className="flex min-h-screen flex-col bg-[#040a13] text-slate-100" data-lens-theme="conkay">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Bot className="h-5 w-5 text-sky-300" aria-hidden />
          <h1 className="text-base font-semibold tracking-tight">ConKay</h1>
          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-200">
            Demo · no account · nothing is saved
          </span>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={DEMO_SIGNIN_HREF} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/5">
            <LogIn className="h-4 w-4" aria-hidden /> Sign in
          </Link>
          <Link href={DEMO_SIGNUP_HREF} className="flex items-center gap-1.5 rounded-lg bg-sky-500/90 px-3 py-1.5 font-medium text-white hover:bg-sky-500">
            <UserPlus className="h-4 w-4" aria-hidden /> Create account
          </Link>
        </nav>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-4 p-3 sm:p-4 lg:grid-cols-[1fr_20rem]">
        <section className="flex min-w-0 flex-col gap-3" aria-label="Beam study">
          <div className="relative h-[52vh] min-h-[320px] overflow-hidden rounded-2xl border border-white/10 bg-[#050d18]">
            <BeamViewport dims={inputs.dims} support={inputs.support} utilization={utilization} view={view} display={display} showDims leftInset={0.22} />
            <div className="absolute left-3 top-3 z-10 w-52 max-w-[calc(100%-1.5rem)] rounded-xl border border-white/10 bg-[#06101c]/85 p-3 backdrop-blur">
              <p className="mb-1.5 text-xs font-medium text-slate-200">Parameters</p>
              <ParameterPanel inputs={inputs} materials={materials} onChange={setInputs} />
              <button
                type="button"
                onClick={() => void run()}
                disabled={solving}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500/90 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {solving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} Run FEA
              </button>
            </div>
            <div className="absolute bottom-2 right-2 z-10 flex flex-wrap items-center justify-end gap-1.5">
              <label className="flex items-center gap-1 rounded-md border border-white/10 bg-[#06101c]/85 px-2 py-1 text-[11px] text-slate-300">
                View:
                <select value={view} onChange={(e) => setView(e.target.value as ViewPreset)} aria-label="View" className="bg-transparent text-slate-100 focus:outline-none">
                  {(Object.keys(VIEW_LABELS) as ViewPreset[]).map((v) => <option key={v} value={v} className="bg-[#06101c]">{VIEW_LABELS[v]}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 rounded-md border border-white/10 bg-[#06101c]/85 px-2 py-1 text-[11px] text-slate-300">
                Display:
                <select value={display} onChange={(e) => setDisplay(e.target.value as DisplayMode)} aria-label="Display" className="bg-transparent text-slate-100 focus:outline-none">
                  {(Object.keys(DISPLAY_LABELS) as DisplayMode[]).map((v) => <option key={v} value={v} className="bg-[#06101c]">{DISPLAY_LABELS[v]}</option>)}
                </select>
              </label>
            </div>
          </div>
          {notice && (
            <p role="status" aria-live="polite" className="flex items-center gap-1.5 px-1 text-xs text-amber-200">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {notice.text}
            </p>
          )}
          {error && <p role="alert" className="px-1 text-xs text-rose-300">{error}</p>}
          <StudyCards
            result={result}
            stale={stale}
            status={status}
            onRun={() => void run()}
            onKeep={() => router.push(DEMO_SIGNUP_HREF)}
            keeping={false}
            keepLabel="Create an account to keep it"
          />
        </section>

        <aside className="flex flex-col gap-3" aria-label="About this demo">
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <h2 className="text-sm font-semibold">What runs here</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Your beam goes to Concord&apos;s beam-frame finite-element solver. Stress, deflection and
              utilization come back from that solve, checked against the closed-form hand calculation,
              with the solver&apos;s receipt. Change a number and the old result is hidden until you run it again.
            </p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Sweep the depth</h2>
              <button
                type="button"
                onClick={() => void runSweep()}
                disabled={sweeping}
                className="flex items-center gap-1 rounded-md border border-sky-400/30 px-2 py-1 text-[11px] text-sky-200 hover:bg-sky-400/10 disabled:opacity-60"
              >
                {sweeping && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} Run 5 solves
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Same beam at 60–140% of the current depth.</p>
            {sweepError && <p role="alert" className="mt-2 text-xs text-rose-300">{sweepError}</p>}
            {sweep && (
              <table className="mt-2 w-full text-left font-mono text-[11px]">
                <thead className="text-slate-500">
                  <tr><th className="py-1 font-normal">D mm</th><th className="font-normal">σ MPa</th><th className="font-normal">util.</th><th className="font-normal" /></tr>
                </thead>
                <tbody>
                  {sweep.rows.map((row) => (
                    <tr key={row.value} className={row.value === sweep.lightestPassing ? 'text-emerald-200' : 'text-slate-300'}>
                      <td className="py-0.5">{row.value}</td>
                      {row.ok ? (
                        <>
                          <td>{row.maxStressMPa?.toFixed(1)}</td>
                          <td>{((row.utilization ?? 0) * 100).toFixed(0)}%</td>
                          <td>{row.pass ? 'pass' : 'fail'}</td>
                        </>
                      ) : (
                        <td colSpan={3} className="text-rose-300">{row.error}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {sweep && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                {sweep.lightestPassing != null
                  ? `Lightest depth that passes: ${sweep.lightestPassing} mm.`
                  : 'None of these depths pass under this load.'}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.04] p-4">
            <h2 className="text-sm font-semibold">With an account</h2>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-slate-300">
              <li>Talk to ConKay and have it change and re-run the study</li>
              <li>Save models and keep studies as DTUs you can cite</li>
              <li>Workspaces that follow you across devices</li>
            </ul>
            <Link href={DEMO_SIGNUP_HREF} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500">
              <UserPlus className="h-3.5 w-3.5" aria-hidden /> Create account
            </Link>
          </section>
        </aside>
      </main>
    </div>
  );
}
