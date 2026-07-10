'use client';

// SeverityWeightsPanel — surfaces the REAL per-codebase severity-tuning
// substrate (server/lib/dx/severity-evo.js + server/lib/dx/codebase-registry.js,
// reached via the `dx` macro domain). This is deliberately distinct from
// DxWorkbench's in-browser paste-based "codebases" (the `dx-platform`
// domain's ephemeral chat/review/search demo substrate, held only in
// process memory) — the rows here come from `codebases` +
// `codebase_severity_weights`, written by the real VS Code / JetBrains
// extension's activation + repair-cortex accept/reject/ignore flow (see
// `concord-vscode/src/api/concord-client.ts#registerCodebase`,
// `#recordFixDecision`), or the `/lenses/dx-platform/web-editor` demo's
// `dx.register_codebase` call.
//
// Before this component existed, the lens's "Per-codebase severity" quick
// link pointed at `#severity` with nothing on the page rendering that id —
// a dead in-page anchor — while `dx.list_codebases` and `dx.list_weights`
// had no caller anywhere in the frontend or either IDE plugin (verified via
// `node scripts/lens-unsurfaced.mjs --lens dx`). This wires the real,
// already-built read surface in rather than inventing new backend.
//
// No seed/demo data: an account with nothing registered renders an honest
// empty state pointing at how to register one, not a placeholder table.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Scale, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface CodebaseRow {
  id: string;
  repo_root: string;
  detector_version: string | null;
  created_at: number;
  last_seen_at: number;
}
interface WeightRow {
  detector_id: string;
  rule_id: string;
  weight: number;
  accept_count: number;
  reject_count: number;
  ignore_count: number;
  updated_at: number;
}

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-zinc-400" aria-hidden />;
}

// Matches the read-side projection bands in server/lib/dx/severity-evo.js#applyWeights.
function weightTone(w: number): string {
  if (w >= 1.5) return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
  if (w <= 0.3) return 'text-red-300 bg-red-500/15 border-red-500/30';
  if (w <= 0.7) return 'text-orange-300 bg-orange-500/15 border-orange-500/30';
  return 'text-zinc-300 bg-zinc-500/15 border-zinc-500/30';
}

export function SeverityWeightsPanel() {
  const [codebases, setCodebases] = useState<CodebaseRow[]>([]);
  const [activeCb, setActiveCb] = useState('');
  const [weights, setWeights] = useState<WeightRow[]>([]);
  const [loadingCb, setLoadingCb] = useState(true);
  const [loadingW, setLoadingW] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadCodebases = useCallback(async () => {
    setLoadingCb(true);
    setErr(null);
    try {
      const r = await lensRun('dx', 'list_codebases', {});
      if (r.data?.ok && r.data.result) {
        const list = (r.data.result as { codebases: CodebaseRow[] }).codebases || [];
        setCodebases(list);
        setActiveCb((prev) => prev || list[0]?.id || '');
      } else {
        setErr(r.data?.error || 'Could not load registered codebases.');
      }
    } catch {
      setErr('Network error loading registered codebases.');
    } finally {
      setLoadingCb(false);
    }
  }, []);

  useEffect(() => { void loadCodebases(); }, [loadCodebases]);

  const loadWeights = useCallback(async (codebaseId: string) => {
    if (!codebaseId) { setWeights([]); return; }
    setLoadingW(true);
    try {
      const r = await lensRun('dx', 'list_weights', { codebaseId });
      if (r.data?.ok && r.data.result) {
        setWeights((r.data.result as { weights: WeightRow[] }).weights || []);
      } else {
        setWeights([]);
      }
    } finally {
      setLoadingW(false);
    }
  }, []);

  useEffect(() => { void loadWeights(activeCb); }, [activeCb, loadWeights]);

  return (
    <section id="severity" className="scroll-mt-20 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-medium text-white">
        <Scale className="h-4 w-4 text-amber-400" aria-hidden /> Per-codebase severity weights
      </h2>
      <p className="max-w-2xl text-xs text-zinc-400">
        Every accept / reject / ignore decision on a repair-cortex proposal in your editor
        nudges that detector&apos;s weight for this codebase — accept trusts it more, reject
        and ignore trust it less — once a rule has at least 20 recorded decisions. Below the
        threshold weight stays at the 1.00× default. This reads the same registry your
        extension writes to; nothing here is a demo.
      </p>

      {loadingCb ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Spinner /> Loading your registered codebases…</div>
      ) : err ? (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {err}
        </div>
      ) : codebases.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-400">
          No codebase registered yet. Install the{' '}
          <a href="https://marketplace.visualstudio.com/items?itemName=concord-os.concord-dx" target="_blank" rel="noreferrer" className="underline">
            VS Code
          </a>{' '}
          or{' '}
          <a href="https://plugins.jetbrains.com/plugin/concord-dx" target="_blank" rel="noreferrer" className="underline">
            JetBrains
          </a>{' '}
          extension and open a workspace, or run a pass from the{' '}
          <Link href="/lenses/dx-platform/web-editor" className="underline">web editor</Link> demo, to
          register one.
        </div>
      ) : (
        <>
          <select
            value={activeCb}
            onChange={(e) => setActiveCb(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
            aria-label="Select registered codebase"
          >
            {codebases.map((c) => (
              <option key={c.id} value={c.id}>{c.repo_root}</option>
            ))}
          </select>
          {loadingW ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400"><Spinner /> Loading weights…</div>
          ) : weights.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-400">
              No fix decisions recorded yet for this codebase. Accept, reject, or ignore a
              repair-cortex proposal in the editor to start tuning weights.
            </div>
          ) : (
            <ul className="space-y-1">
              {weights.map((w) => (
                <li
                  key={`${w.detector_id}:${w.rule_id}`}
                  className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs"
                >
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${weightTone(w.weight)}`}>
                    {w.weight.toFixed(2)}×
                  </span>
                  <span className="text-zinc-200">{w.detector_id}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{w.rule_id}</span>
                  <span className="ml-auto flex gap-2 text-[10px] text-zinc-400">
                    <span className="text-emerald-400">{w.accept_count} accepted</span>
                    <span className="text-red-400">{w.reject_count} rejected</span>
                    <span>{w.ignore_count} ignored</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
