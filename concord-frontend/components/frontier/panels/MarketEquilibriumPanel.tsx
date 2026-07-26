'use client';

/**
 * MarketEquilibriumPanel — Wave W2-D, `markets.mixedNash` +
 * `markets.replicatorDynamics` + `markets.equilibriumAnalysis`.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, adopt its
 * exact interaction language): GAMBIT, the standard open-source
 * game-theory equilibrium computation suite — an editable payoff-matrix
 * grid feeding a list of computed equilibria, exactly the shape this
 * panel's Mixed Nash and Replicator sub-modes use. The third sub-mode,
 * Live Market Analysis, breaks from Gambit's shape on purpose: it takes NO
 * payoff matrix at all — `equilibriumAnalysis` reads Concord's own real
 * `economy_ledger` trade rows and derives its own 2x2 game from what
 * actually happened, so that sub-mode's "compute" cell has tuning knobs
 * only, never a matrix editor, because a matrix input would be fake here.
 *
 * HONEST GOTCHA this file works around rather than papers over: the
 * `mixedNash` refusal shape from `server/lib/game-theory/mixed-nash.js` is
 * `{ ok:false, reason:'support_enumeration_exhausted', maxSupportSize,
 * candidateCount }` — it uses `reason`, not `error`. The shared
 * `lensRun()` client helper (lib/api/client.ts) only recovers `.error` on
 * its generic refusal fallback path, so this specific shape collapses to
 * the literal string "lens error" on the wire — a real, verified
 * limitation of the shared helper, not something this panel can fix (it's
 * used across the whole app). Rather than inventing a specific reason the
 * client genuinely can't recover, `describeRefusal()` below detects this
 * degraded case and says so plainly.
 */

import { useState } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

type ModeId = 'mixed-nash' | 'replicator' | 'live-market';

const MODE_LABEL: Record<ModeId, string> = {
  'mixed-nash': 'Mixed Nash equilibria',
  replicator: 'Replicator dynamics',
  'live-market': 'Live market analysis',
};

const MODE_MACRO: Record<ModeId, string> = {
  'mixed-nash': 'mixedNash',
  replicator: 'replicatorDynamics',
  'live-market': 'equilibriumAnalysis',
};

/** A refusal whose reason collapsed to the shared client's generic
 *  fallback ("lens error") because the macro used `reason` instead of
 *  `error` on the wire — see the file header. Says so plainly rather than
 *  inventing specificity we can't actually recover. */
function describeRefusal(rawError: string | null | undefined, hint: string): string {
  if (rawError && rawError !== 'lens error') return rawError;
  return `Refused by the server (${hint}) — the shared lens-run client only preserves a generic message for ` +
    'this refusal shape (it reads a `reason` field the client only handles as `error`), so the exact detail ' +
    'fields are not recoverable here. The refusal itself is real, not fabricated or swallowed silently.';
}

// ── Mixed Nash ──────────────────────────────────────────────────────────

type NashPresetId = 'matching-pennies' | 'battle-of-sexes' | 'prisoners-dilemma' | 'custom';

const NASH_PRESETS: Record<Exclude<NashPresetId, 'custom'>, { label: string; A: number[][]; B: number[][] }> = {
  'matching-pennies': { label: 'Matching pennies (no pure equilibrium)', A: [[1, -1], [-1, 1]], B: [[-1, 1], [1, -1]] },
  'battle-of-sexes': { label: 'Battle of the sexes (2 pure + 1 mixed)', A: [[2, 0], [0, 1]], B: [[1, 0], [0, 2]] },
  'prisoners-dilemma': { label: "Prisoner's dilemma (T=5,R=3,P=1,S=0)", A: [[3, 0], [5, 1]], B: [[3, 5], [0, 1]] },
};

interface NashEquilibrium { support1: number[]; support2: number[]; p: number[]; q: number[]; payoffs: [number, number] }
interface MixedNashSuccess { ok: true; equilibria: NashEquilibrium[]; candidatesExamined: number }

// ── Replicator ───────────────────────────────────────────────────────────

type ReplicatorPresetId = 'hawk-dove' | 'rock-paper-scissors' | 'custom';

const REPLICATOR_PRESETS: Record<Exclude<ReplicatorPresetId, 'custom'>, { label: string; A: number[][]; x0: number[]; tEnd: number }> = {
  'hawk-dove': { label: 'Hawk-Dove (V=1, C=4 — converges to an ESS)', A: [[-1.5, 1], [0, 0.5]], x0: [0.5, 0.5], tEnd: 200 },
  'rock-paper-scissors': { label: 'Rock-Paper-Scissors (orbits forever — never converges)', A: [[0, -1, 1], [1, 0, -1], [-1, 1, 0]], x0: [0.6, 0.25, 0.15], tEnd: 60 },
};

interface TrajectorySample { t: number; x: number[] }
interface ReplicatorResult {
  converged: boolean;
  x: number[];
  finalDelta: number;
  steps: number;
  reason?: string;
  trajectorySamples?: number;
  trajectory?: TrajectorySample[];
}

// ── Live market ──────────────────────────────────────────────────────────

interface MarketRing { accounts: string[] }
interface ReciprocalPair { a: string; b: string }
interface EquilibriumAnalysisResult {
  ok: true;
  classification: 'cartel_consistent' | 'competitive_equilibrium_consistent' | 'insufficient_data';
  tradeCount: number;
  agentCount: number;
  rings: MarketRing[];
  reciprocalPairs: ReciprocalPair[];
  ringVolumeFraction?: number;
  signals?: { structuralSignal: boolean; nashSupportsRing: boolean; replicatorFavorsRing: boolean };
  disclaimer: string;
}

export function MarketEquilibriumPanel({ engine }: { engine: FrontierEngineDef }) {
  const [mode, setMode] = useState<ModeId>('mixed-nash');

  // mixed nash state
  const [nashPreset, setNashPreset] = useState<NashPresetId>('battle-of-sexes');
  const [nashA, setNashA] = useState<number[][]>(NASH_PRESETS['battle-of-sexes'].A);
  const [nashB, setNashB] = useState<number[][]>(NASH_PRESETS['battle-of-sexes'].B);
  const [maxSupportSize, setMaxSupportSize] = useState('');
  const [maxCandidates, setMaxCandidates] = useState('');

  // replicator state
  const [repPreset, setRepPreset] = useState<ReplicatorPresetId>('hawk-dove');
  const [repA, setRepA] = useState<number[][]>(REPLICATOR_PRESETS['hawk-dove'].A);
  const [repX0, setRepX0] = useState<number[]>(REPLICATOR_PRESETS['hawk-dove'].x0);
  const [repTEnd, setRepTEnd] = useState(REPLICATOR_PRESETS['hawk-dove'].tEnd);
  const [repDt, setRepDt] = useState(0.01);
  const [repTolerance, setRepTolerance] = useState(1e-7);
  const [includeTrajectory, setIncludeTrajectory] = useState(true);

  // live market state
  const [minEdgeTrades, setMinEdgeTrades] = useState(3);
  const [minRingSize, setMinRingSize] = useState(3);
  const [windowDays, setWindowDays] = useState(30);
  const [minRingVolumeFraction, setMinRingVolumeFraction] = useState(0.05);

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);

  const [nashResult, setNashResult] = useState<MixedNashSuccess | null>(null);
  const [repResult, setRepResult] = useState<ReplicatorResult | null>(null);
  const [marketResult, setMarketResult] = useState<EquilibriumAnalysisResult | null>(null);

  function applyNashPreset(id: NashPresetId) {
    setNashPreset(id);
    if (id === 'custom') {
      setNashA([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
      setNashB([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    } else {
      setNashA(NASH_PRESETS[id].A.map((r) => [...r]));
      setNashB(NASH_PRESETS[id].B.map((r) => [...r]));
    }
  }

  function applyRepPreset(id: ReplicatorPresetId) {
    setRepPreset(id);
    if (id === 'custom') {
      setRepA([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
      setRepX0([1 / 3, 1 / 3, 1 / 3]);
      setRepTEnd(100);
    } else {
      setRepA(REPLICATOR_PRESETS[id].A.map((r) => [...r]));
      setRepX0([...REPLICATOR_PRESETS[id].x0]);
      setRepTEnd(REPLICATOR_PRESETS[id].tEnd);
    }
  }

  async function run() {
    setStatus('loading');
    setReason(null);
    try {
      if (mode === 'mixed-nash') {
        const input: Record<string, unknown> = { payoffA: nashA, payoffB: nashB };
        if (maxSupportSize.trim() !== '') input.maxSupportSize = Number(maxSupportSize);
        if (maxCandidates.trim() !== '') input.maxCandidates = Number(maxCandidates);
        const res = await lensRun<MixedNashSuccess>('markets', 'mixedNash', input);
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) {
          setReason(describeRefusal(res.data?.error, 'invalid matrix shape, or the support-enumeration cap was hit'));
          setStatus('refused');
          return;
        }
        setNashResult(res.data.result);
        setStatus('ok');
      } else if (mode === 'replicator') {
        const input: Record<string, unknown> = {
          payoffMatrix: repA, initialShares: repX0, dt: repDt, tEnd: repTEnd, tolerance: repTolerance, includeTrajectory,
        };
        const res = await lensRun<ReplicatorResult>('markets', 'replicatorDynamics', input);
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) {
          setReason(res.data?.error || 'Unknown refusal.');
          setStatus('error');
          return;
        }
        setRepResult(res.data.result);
        setStatus('ok');
      } else {
        const input: Record<string, unknown> = {
          minEdgeTrades, minRingSize, windowMs: windowDays * 86400000, minRingVolumeFraction,
        };
        const res = await lensRun<EquilibriumAnalysisResult>('markets', 'equilibriumAnalysis', input);
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) {
          setReason(describeRefusal(res.data?.error, 'the live ledger could not be read'));
          setStatus('refused');
          return;
        }
        setMarketResult(res.data.result);
        setStatus('ok');
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-market-equilibrium', keys: 'mod+enter', description: 'Run selected equilibrium computation', category: 'actions', action: run }],
    { lensId: 'frontier' },
  );

  const nashShapeMismatch = nashA.length !== nashB.length || nashA.some((row, i) => row.length !== nashB[i]?.length);
  const runDisabled = mode === 'mixed-nash' && (nashA.length === 0 || nashShapeMismatch);

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel={`markets.${MODE_MACRO[mode]}`}
        running={status === 'loading'}
        onRun={run}
        runLabel="Run"
        runDisabled={runDisabled}
        hotkey="⌘+Enter"
      >
        <div>
          <label className={ds.label} htmlFor="me-mode">Sub-engine</label>
          <select id="me-mode" className={ds.select} value={mode} onChange={(e) => setMode(e.target.value as ModeId)}>
            {(Object.keys(MODE_LABEL) as ModeId[]).map((id) => (
              <option key={id} value={id}>{MODE_LABEL[id]}</option>
            ))}
          </select>
        </div>

        {mode === 'mixed-nash' && (
          <div className="space-y-3">
            <div>
              <label className={ds.label} htmlFor="me-nash-preset">Game preset</label>
              <select id="me-nash-preset" className={ds.select} value={nashPreset} onChange={(e) => applyNashPreset(e.target.value as NashPresetId)}>
                {(Object.keys(NASH_PRESETS) as (keyof typeof NASH_PRESETS)[]).map((id) => (
                  <option key={id} value={id}>{NASH_PRESETS[id].label}</option>
                ))}
                <option value="custom">Custom 3×3</option>
              </select>
            </div>
            <div className="flex gap-6 items-start">
              <MatrixGrid label="Payoff A (player 1)" rows={nashA} onChange={(i, j, v) => setNashA((p) => p.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === j ? v : c)) : r)))} />
              <MatrixGrid label="Payoff B (player 2)" rows={nashB} onChange={(i, j, v) => setNashB((p) => p.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === j ? v : c)) : r)))} />
            </div>
            <div className={ds.grid2}>
              <TextField id="me-nash-maxsupport" label="Max support size (blank = min(rows,cols))" value={maxSupportSize} onChange={setMaxSupportSize} />
              <TextField id="me-nash-maxcand" label="Max candidates (blank = 20000 — lower to trigger a real support_enumeration_exhausted refusal)" value={maxCandidates} onChange={setMaxCandidates} />
            </div>
          </div>
        )}

        {mode === 'replicator' && (
          <div className="space-y-3">
            <div>
              <label className={ds.label} htmlFor="me-rep-preset">Population game preset</label>
              <select id="me-rep-preset" className={ds.select} value={repPreset} onChange={(e) => applyRepPreset(e.target.value as ReplicatorPresetId)}>
                {(Object.keys(REPLICATOR_PRESETS) as (keyof typeof REPLICATOR_PRESETS)[]).map((id) => (
                  <option key={id} value={id}>{REPLICATOR_PRESETS[id].label}</option>
                ))}
                <option value="custom">Custom 3-strategy</option>
              </select>
            </div>
            <MatrixGrid label="Payoff matrix A" rows={repA} onChange={(i, j, v) => setRepA((p) => p.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === j ? v : c)) : r)))} />
            <div>
              <p className={cn(ds.label, 'mb-1')}>Initial population shares (should sum to ~1)</p>
              <div className="flex gap-2">
                {repX0.map((v, i) => (
                  <input
                    key={i}
                    type="number"
                    step={0.05}
                    aria-label={`initial share strategy ${i + 1}`}
                    className={cn(ds.input, 'w-20 px-1.5 py-1 text-center')}
                    value={v}
                    onChange={(e) => setRepX0((prev) => prev.map((c, ci) => (ci === i ? Number(e.target.value) : c)))}
                  />
                ))}
              </div>
            </div>
            <div className={ds.grid3}>
              <NumberField id="me-rep-tend" label="tEnd (integration horizon)" value={repTEnd} onChange={setRepTEnd} min={1} max={2000} step={10} />
              <NumberField id="me-rep-dt" label="dt (RK4 step)" value={repDt} onChange={setRepDt} min={0.001} max={1} step={0.005} />
              <NumberField id="me-rep-tol" label="Convergence tolerance" value={repTolerance} onChange={setRepTolerance} min={1e-9} max={1e-2} step={1e-7} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={includeTrajectory} onChange={(e) => setIncludeTrajectory(e.target.checked)} />
              Include the full trajectory (for the chart below — otherwise only a sample count is returned)
            </label>
          </div>
        )}

        {mode === 'live-market' && (
          <div className="space-y-3">
            <p className={cn(ds.textMuted)}>
              No payoff matrix here — this sub-engine reads real recent `TRANSFER`/`MARKETPLACE_PURCHASE` rows from
              Concord&apos;s own live economy ledger, derives its own 2×2 &quot;ring vs. diversify&quot; game from what
              actually happened, and analyzes that. Only the detector&apos;s tuning knobs are exposed below.
            </p>
            <div className={ds.grid2}>
              <NumberField id="me-mkt-minedge" label="Min trades per edge to count" value={minEdgeTrades} onChange={(v) => setMinEdgeTrades(Math.round(v))} min={1} max={20} step={1} />
              <NumberField id="me-mkt-minring" label="Min ring size" value={minRingSize} onChange={(v) => setMinRingSize(Math.round(v))} min={2} max={10} step={1} />
              <NumberField id="me-mkt-window" label="Recency window (days)" value={windowDays} onChange={setWindowDays} min={1} max={365} step={1} />
              <NumberField id="me-mkt-minfrac" label="Min ring volume fraction" value={minRingVolumeFraction} onChange={setMinRingVolumeFraction} min={0} max={1} step={0.01} />
            </div>
          </div>
        )}
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {mode === 'mixed-nash' && nashResult && <NashView r={nashResult} />}
        {mode === 'replicator' && repResult && <ReplicatorView r={repResult} />}
        {mode === 'live-market' && marketResult && <MarketView r={marketResult} />}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

function NashView({ r }: { r: MixedNashSuccess }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Equilibria found" value={String(r.equilibria.length)} />
        <Stat label="Candidates examined" value={String(r.candidatesExamined)} />
      </div>
      <div className="overflow-x-auto">
        <table className={cn(ds.monoXs, 'w-full border-collapse')}>
          <thead>
            <tr className="text-left text-gray-500 border-b border-lattice-border">
              <th className="py-1 pr-4">#</th>
              <th className="py-1 pr-4">Support 1</th>
              <th className="py-1 pr-4">p (player 1)</th>
              <th className="py-1 pr-4">Support 2</th>
              <th className="py-1 pr-4">q (player 2)</th>
              <th className="py-1 pr-4">Payoffs</th>
            </tr>
          </thead>
          <tbody>
            {r.equilibria.map((eq, i) => (
              <tr key={i} className="border-b border-lattice-border/40">
                <td className="py-1 pr-4">{i + 1}</td>
                <td className="py-1 pr-4">{`{${eq.support1.join(',')}}`}</td>
                <td className="py-1 pr-4">{`[${eq.p.map((v) => v.toFixed(3)).join(', ')}]`}</td>
                <td className="py-1 pr-4">{`{${eq.support2.join(',')}}`}</td>
                <td className="py-1 pr-4">{`[${eq.q.map((v) => v.toFixed(3)).join(', ')}]`}</td>
                <td className="py-1 pr-4">{`(${eq.payoffs[0].toFixed(2)}, ${eq.payoffs[1].toFixed(2)})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReplicatorView({ r }: { r: ReplicatorResult }) {
  return (
    <div className="space-y-3">
      <div
        className={cn(
          'rounded-lg border px-3 py-2 text-sm font-medium inline-block',
          r.converged ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-400',
        )}
      >
        {r.converged ? 'Converged to a fixed point' : 'Did not converge within the horizon — a real, complete outcome (e.g. an orbiting interior equilibrium), not an error'}
      </div>
      {r.reason && <p className={cn(ds.monoXs, 'text-amber-400/80')}>reason: {r.reason}</p>}
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Final shares" value={`[${r.x.map((v) => v.toFixed(3)).join(', ')}]`} />
        <Stat label="Final Δ" value={r.finalDelta.toExponential(2)} />
        <Stat label="Steps" value={String(r.steps)} />
      </div>
      {r.trajectory && r.trajectory.length > 1 && <TrajectoryChart trajectory={r.trajectory} />}
      {!r.trajectory && r.trajectorySamples !== undefined && (
        <p className={cn(ds.textMuted)}>Server returned {r.trajectorySamples} trajectory samples (not fetched — check &quot;include full trajectory&quot; to chart it).</p>
      )}
    </div>
  );
}

const TRAJ_COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399'];

function TrajectoryChart({ trajectory }: { trajectory: TrajectorySample[] }) {
  const W = 560;
  const H = 200;
  const padL = 32;
  const padB = 20;
  const padT = 8;
  const padR = 8;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = trajectory[0]?.x.length ?? 0;
  const tMax = trajectory[trajectory.length - 1]?.t ?? 1;

  function x(t: number) { return padL + (t / (tMax || 1)) * plotW; }
  function y(share: number) { return padT + (1 - Math.max(0, Math.min(1, share))) * plotH; }

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} role="img" aria-label="Population share vs time per strategy">
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="currentColor" className="text-lattice-border" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="currentColor" className="text-lattice-border" />
        <text x={2} y={padT + 6} className="fill-gray-500" fontSize="9">1</text>
        <text x={2} y={H - padB} className="fill-gray-500" fontSize="9">0</text>
        <text x={W - padR - 24} y={H - 2} className="fill-gray-500" fontSize="9">t={tMax.toFixed(0)}</text>
        {Array.from({ length: n }).map((_, s) => {
          const path = trajectory.map((pt, j) => `${j === 0 ? 'M' : 'L'}${x(pt.t)},${y(pt.x[s])}`).join(' ');
          return <path key={s} d={path} fill="none" stroke={TRAJ_COLORS[s % TRAJ_COLORS.length]} strokeWidth={2} />;
        })}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs mt-1">
        {Array.from({ length: n }).map((_, s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: TRAJ_COLORS[s % TRAJ_COLORS.length] }} />
            strategy {s + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

function MarketView({ r }: { r: EquilibriumAnalysisResult }) {
  const tone = r.classification === 'cartel_consistent' ? 'text-red-400 border-red-500/40 bg-red-500/10'
    : r.classification === 'competitive_equilibrium_consistent' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
      : 'text-gray-400 border-gray-500/40 bg-gray-500/10';
  return (
    <div className="space-y-3">
      <div className={cn('rounded-lg border px-3 py-2 text-sm font-medium inline-block', tone)}>
        {r.classification.replace(/_/g, ' ')}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Trades in window" value={String(r.tradeCount)} />
        <Stat label="Distinct agents" value={String(r.agentCount)} />
        {r.ringVolumeFraction !== undefined && <Stat label="Ring volume fraction" value={r.ringVolumeFraction.toFixed(4)} />}
      </div>
      {r.rings.length > 0 && (
        <div>
          <p className={cn(ds.label, 'mb-1')}>Detected rings</p>
          <ul className={cn(ds.monoXs, 'space-y-0.5')}>
            {r.rings.map((ring, i) => <li key={i}>{ring.accounts.join(' → ')}</li>)}
          </ul>
        </div>
      )}
      {r.reciprocalPairs.length > 0 && (
        <div>
          <p className={cn(ds.label, 'mb-1')}>Reciprocal pairs</p>
          <ul className={cn(ds.monoXs, 'space-y-0.5')}>
            {r.reciprocalPairs.map((p, i) => <li key={i}>{p.a} ↔ {p.b}</li>)}
          </ul>
        </div>
      )}
      {r.signals && (
        <div className="flex flex-wrap gap-4 text-sm">
          <Stat label="Structural signal" value={r.signals.structuralSignal ? 'yes' : 'no'} />
          <Stat label="Nash supports ring" value={r.signals.nashSupportsRing ? 'yes' : 'no'} />
          <Stat label="Replicator favors ring" value={r.signals.replicatorFavorsRing ? 'yes' : 'no'} />
        </div>
      )}
      <p className={cn(ds.textMuted, 'italic text-sm')}>{r.disclaimer}</p>
    </div>
  );
}

function MatrixGrid({ label, rows, onChange }: { label: string; rows: number[][]; onChange: (i: number, j: number, v: number) => void }) {
  return (
    <div>
      <p className={cn(ds.label, 'mb-1')}>{label}</p>
      <div className="inline-flex flex-col gap-1 p-2 border border-lattice-border rounded-lg">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1">
            {row.map((v, j) => (
              <input
                key={j}
                type="number"
                step={0.1}
                className={cn(ds.input, 'w-16 px-1.5 py-1 text-center')}
                value={v}
                onChange={(e) => onChange(i, j, Number(e.target.value))}
                aria-label={`${label} row ${i + 1} column ${j + 1}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  id, label, value, onChange, min, max, step,
}: { id: string; label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div>
      <label className={ds.label} htmlFor={id}>{label}</label>
      <input id={id} type="number" className={ds.input} value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function TextField({
  id, label, value, onChange,
}: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={ds.label} htmlFor={id}>{label}</label>
      <input id={id} type="text" className={ds.input} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[10rem]">
      <div className={ds.textMuted}>{label}</div>
      <div className={ds.monoBase}>{value}</div>
    </div>
  );
}

export default MarketEquilibriumPanel;
