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
import { Scale, Loader2, AlertTriangle, Search, ListOrdered, Plus, X } from 'lucide-react';
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

// A candidate finding the user is previewing against `dx.weighted_findings`
// — `id` doubles as the rule id, `category` as the detector id (the exact
// shape server/lib/dx/severity-evo.js#applyWeights reads off each finding).
interface PreviewRow {
  key: string;
  detectorId: string;
  ruleId: string;
  severity: string;
}
interface WeightedResult {
  id: string;
  category?: string;
  severity: string;
  _baseSeverity: string;
  _codebaseWeight: number;
}

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

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

function severityTone(s: string): string {
  if (s === 'critical') return 'text-red-300 bg-red-500/15 border-red-500/30';
  if (s === 'high') return 'text-orange-300 bg-orange-500/15 border-orange-500/30';
  if (s === 'medium') return 'text-amber-300 bg-amber-500/15 border-amber-500/30';
  if (s === 'low') return 'text-sky-300 bg-sky-500/15 border-sky-500/30';
  return 'text-zinc-300 bg-zinc-500/15 border-zinc-500/30';
}

export function SeverityWeightsPanel() {
  const [codebases, setCodebases] = useState<CodebaseRow[]>([]);
  const [activeCb, setActiveCb] = useState('');
  const [weights, setWeights] = useState<WeightRow[]>([]);
  const [loadingCb, setLoadingCb] = useState(true);
  const [loadingW, setLoadingW] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── dx.get_weight — single (detector, rule) quick lookup ──
  const [lookupDetectorId, setLookupDetectorId] = useState('');
  const [lookupRuleId, setLookupRuleId] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ detectorId: string; ruleId: string; weight: number } | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  // ── dx.weighted_findings — apply this codebase's weights to a small
  // user-built candidate list, then render the reprioritized order ──
  const [pickPair, setPickPair] = useState('');
  const [pickSeverity, setPickSeverity] = useState<string>('medium');
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [weighted, setWeighted] = useState<WeightedResult[] | null>(null);
  const [weightedBusy, setWeightedBusy] = useState(false);
  const [weightedErr, setWeightedErr] = useState<string | null>(null);

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

  useEffect(() => {
    void loadWeights(activeCb);
    // Switching codebases invalidates any in-flight preview state — the
    // weight rows (and the results derived from them) belong to a
    // different (user, codebase) scope now.
    setLookupResult(null);
    setLookupErr(null);
    setPreviewRows([]);
    setWeighted(null);
    setWeightedErr(null);
  }, [activeCb, loadWeights]);

  const lookupWeight = useCallback(async () => {
    if (!activeCb || !lookupDetectorId.trim() || !lookupRuleId.trim()) return;
    setLookupBusy(true);
    setLookupErr(null);
    try {
      const r = await lensRun('dx', 'get_weight', {
        codebaseId: activeCb,
        detectorId: lookupDetectorId.trim(),
        ruleId: lookupRuleId.trim(),
      });
      const body = r.data.result as { ok: boolean; weight?: number; reason?: string } | null;
      if (r.data.ok && body?.ok && typeof body.weight === 'number') {
        setLookupResult({ detectorId: lookupDetectorId.trim(), ruleId: lookupRuleId.trim(), weight: body.weight });
      } else {
        setLookupErr(body?.reason || r.data.error || 'Lookup failed.');
      }
    } catch {
      setLookupErr('Network error during lookup.');
    } finally {
      setLookupBusy(false);
    }
  }, [activeCb, lookupDetectorId, lookupRuleId]);

  const addPreviewRow = useCallback(() => {
    if (!pickPair) return;
    const [detectorId, ruleId] = pickPair.split('::');
    const key = `${detectorId}::${ruleId}::${pickSeverity}::${Date.now()}`;
    setPreviewRows((prev) => [...prev, { key, detectorId, ruleId, severity: pickSeverity }]);
    setWeighted(null);
  }, [pickPair, pickSeverity]);

  const removePreviewRow = useCallback((key: string) => {
    setPreviewRows((prev) => prev.filter((r) => r.key !== key));
    setWeighted(null);
  }, []);

  const applyWeighted = useCallback(async () => {
    if (!activeCb || previewRows.length === 0) return;
    setWeightedBusy(true);
    setWeightedErr(null);
    try {
      const r = await lensRun('dx', 'weighted_findings', {
        codebaseId: activeCb,
        findings: previewRows.map((row) => ({ id: row.ruleId, category: row.detectorId, severity: row.severity })),
      });
      const body = r.data.result as { ok: boolean; findings?: WeightedResult[]; reason?: string } | null;
      if (r.data.ok && body?.ok && Array.isArray(body.findings)) {
        const sorted = [...body.findings].sort(
          (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
        );
        setWeighted(sorted);
      } else {
        setWeightedErr(body?.reason || r.data.error || 'Could not apply weights.');
      }
    } catch {
      setWeightedErr('Network error applying weights.');
    } finally {
      setWeightedBusy(false);
    }
  }, [activeCb, previewRows]);

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

          {/* dx.get_weight — single (detector, rule) quick lookup, useful
              for checking an untuned rule (defaults to 1.00× below the
              20-decision threshold) without loading the whole table. */}
          <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Search className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Quick weight lookup
            </h3>
            <p className="text-[11px] text-zinc-400">
              Look up the current weight for a single (detector, rule) pair. Untouched
              pairs return the 1.00× default.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={lookupDetectorId}
                onChange={(e) => setLookupDetectorId(e.target.value)}
                placeholder="detector id"
                aria-label="Detector id"
                className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white"
              />
              <input
                value={lookupRuleId}
                onChange={(e) => setLookupRuleId(e.target.value)}
                placeholder="rule id"
                aria-label="Rule id"
                className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white"
              />
              <button
                onClick={() => void lookupWeight()}
                disabled={lookupBusy || !lookupDetectorId.trim() || !lookupRuleId.trim()}
                className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300 disabled:opacity-40"
              >
                {lookupBusy ? <Spinner /> : <Search className="h-3 w-3" aria-hidden />} Look up
              </button>
            </div>
            {lookupErr && <p className="text-[11px] text-red-300">{lookupErr}</p>}
            {lookupResult && (
              <p className="flex items-center gap-2 text-[11px] text-zinc-300" data-testid="dx-weight-lookup-result">
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${weightTone(lookupResult.weight)}`}>
                  {lookupResult.weight.toFixed(2)}×
                </span>
                {lookupResult.detectorId} · {lookupResult.ruleId}
              </p>
            )}
          </div>

          {/* dx.weighted_findings — apply this codebase's weights to a
              user-built list drawn from its own rule ids, then show the
              severity-adjusted, reprioritized order the engine computes. */}
          {weights.length > 0 && (
            <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                <ListOrdered className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Weighted findings preview
              </h3>
              <p className="text-[11px] text-zinc-400">
                Build a small candidate list from this codebase&apos;s tracked rules, pick a
                base severity for each, then apply the real per-codebase weights to see the
                reprioritized order — the same projection the repair cortex uses.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={pickPair}
                  onChange={(e) => setPickPair(e.target.value)}
                  aria-label="Detector / rule"
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white"
                >
                  <option value="">Select a tracked rule…</option>
                  {weights.map((w) => (
                    <option key={`${w.detector_id}:${w.rule_id}`} value={`${w.detector_id}::${w.rule_id}`}>
                      {w.detector_id} · {w.rule_id}
                    </option>
                  ))}
                </select>
                <select
                  value={pickSeverity}
                  onChange={(e) => setPickSeverity(e.target.value)}
                  aria-label="Base severity"
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  onClick={addPreviewRow}
                  disabled={!pickPair}
                  className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" aria-hidden /> Add
                </button>
              </div>

              {previewRows.length > 0 && (
                <ul className="space-y-1">
                  {previewRows.map((row) => (
                    <li key={row.key} className="flex items-center gap-2 rounded bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-300">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${severityTone(row.severity)}`}>{row.severity}</span>
                      <span>{row.detectorId} · {row.ruleId}</span>
                      <button onClick={() => removePreviewRow(row.key)} aria-label="Remove row" className="ml-auto text-zinc-500 hover:text-red-300">
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={() => void applyWeighted()}
                disabled={weightedBusy || previewRows.length === 0}
                className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300 disabled:opacity-40"
              >
                {weightedBusy ? <Spinner /> : <ListOrdered className="h-3 w-3" aria-hidden />} Apply weights
              </button>
              {weightedErr && <p className="text-[11px] text-red-300">{weightedErr}</p>}

              {weighted && (
                <ul className="space-y-1" data-testid="dx-weighted-findings-result">
                  {weighted.map((f, i) => (
                    <li key={`${f.id}-${i}`} className="flex flex-wrap items-center gap-2 rounded bg-zinc-950/60 px-2 py-1.5 text-[11px] text-zinc-300">
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${weightTone(f._codebaseWeight)}`}>
                        {f._codebaseWeight.toFixed(2)}×
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${severityTone(f._baseSeverity)}`}>{f._baseSeverity}</span>
                      {f.severity !== f._baseSeverity && (
                        <>
                          <span className="text-zinc-500">→</span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${severityTone(f.severity)}`}>{f.severity}</span>
                        </>
                      )}
                      <span className="ml-auto text-zinc-400">{f.category} · {f.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
