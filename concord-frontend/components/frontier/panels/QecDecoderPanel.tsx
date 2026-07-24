'use client';

/**
 * QecDecoderPanel — Wave W2-A, `quantum.qecLatticeInfo` +
 * `quantum.qecSimulateThreshold` + `quantum.qecDecodeSingle` +
 * `quantum.qecRunTrial`.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, adopt its
 * exact interaction language): Google Quantum AI's own surface-code
 * dashboards (as published with "Suppressing quantum errors by scaling a
 * surface code", Nature 2023) — a syndrome/error grid readout next to a
 * logical-vs-physical error-rate crossing plot. This panel borrows that
 * exact pairing: single-shot decode results render as chip-lists of edge
 * ids (the syndrome/error/correction sets), and the threshold sweep
 * renders as a real crossing chart, not a results table alone.
 *
 * TWO honesty notes load-bearing for this file:
 *
 * 1. `qecSimulateThreshold` is a single, SYNCHRONOUS HTTP request that can
 *    genuinely take tens of seconds at high parameter values (there is no
 *    job-id/polling backend for it). The only honest in-flight state is
 *    the real request's pending Promise — ComputeCell's spinner already
 *    reflects that. This panel does NOT add a synthetic percentage bar;
 *    it defaults to modest parameters and shows a plain-language latency
 *    warning instead of faking granularity the server doesn't provide.
 *
 * 2. The backend documents (in server/lib/simulation/qec-decoder.js
 *    comments and server/tests/qec-decoder.test.js, NOT in any macro
 *    response field) that this decoder's measured threshold crossing
 *    lands below the published ~9.9% reference (Delfosse & Nickerson,
 *    arXiv:1709.06218). The macro itself only returns the raw per-(d,p)
 *    logicalErrorRate series plus a citation string — it does not compute
 *    a crossing point. This panel computes that crossing CLIENT-SIDE, by
 *    linear interpolation over the real series the server just returned
 *    (the same method server/tests/qec-decoder.test.js uses), and shows
 *    it plainly next to the published reference — never presented as
 *    matching, never silently omitted.
 */

import { useMemo, useState } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

type ActionId = 'lattice' | 'decode' | 'trial' | 'threshold';

const ACTION_LABEL: Record<ActionId, string> = {
  lattice: 'Lattice structure',
  decode: 'Decode a single error pattern',
  trial: 'Run repeated trials',
  threshold: 'Threshold sweep (Monte Carlo)',
};

const ACTION_MACRO: Record<ActionId, string> = {
  lattice: 'qecLatticeInfo',
  decode: 'qecDecodeSingle',
  trial: 'qecRunTrial',
  threshold: 'qecSimulateThreshold',
};

// Delfosse & Nickerson, arXiv:1709.06218 — the exact published value the
// server's own `result.reference` string names. Hardcoded here ONLY for
// the numeric comparison; the citation string itself always renders
// verbatim from the real response, never from this constant.
const PUBLISHED_THRESHOLD = 0.099;

interface LatticeInfoResult {
  d: number;
  numNodes: number;
  numQubits: number;
  boundaryConditions: string;
  honestBoundary: string;
}
interface DecodeSingleResult {
  d: number;
  numQubits: number;
  channel: string;
  errorQubits: number[];
  syndromeNodes: number[];
  correctionQubits: number[];
  rounds: number;
  residualSyndromeClosed: boolean;
  logicalSuccess: boolean;
  logicalFailure: boolean;
  honestBoundary: string;
}
interface RunTrialResult {
  d: number;
  p: number;
  channel: string;
  success: boolean;
  logicalFailure: boolean;
  rounds: number;
  errorWeight?: number;
  syndromeSize?: number;
  residualSyndromeClosed: boolean;
  honestBoundary: string;
}
interface ThresholdPoint { p: number; logicalErrorRate: number; trials: number; d: number }
interface SimulateThresholdResult {
  channel: string;
  trials: number;
  pValues: number[];
  distances: number[];
  series: Record<string, ThresholdPoint[]>;
  reference: string;
  honestBoundary: string;
}

// NOTE: the empty-segment filter is load-bearing, not defensive noise.
// `''.split(',')` is `['']`, and `Number('')` is 0 — which is finite — so
// without it, CLEARING the distances field yielded `[0]` (a nonsensical
// distance-0 lattice) instead of `[]`. That silently defeated the
// "at least one distance and one p-value" guard below and would have sent
// the bogus value to the macro. Found by the panel's own disabled-button
// test during conductor verification.
function parseNumberList(text: string): number[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** Linear-interpolation crossing finder — identical method to the one used
 *  server/tests/qec-decoder.test.js uses internally (not exposed by the
 *  macro), ported here so the panel can compute it from real response data
 *  without inventing a number the server never gave us. */
function crossingPoint(pValues: number[], seriesLow: ThresholdPoint[], seriesHigh: ThresholdPoint[]): number | null {
  const diffs = seriesLow.map((pt, i) => (seriesHigh[i]?.logicalErrorRate ?? NaN) - pt.logicalErrorRate);
  for (let i = 0; i < diffs.length - 1; i++) {
    if (diffs[i] <= 0 && diffs[i + 1] > 0) {
      const p0 = pValues[i];
      const p1 = pValues[i + 1];
      const d0 = diffs[i];
      const d1 = diffs[i + 1];
      const frac = d0 === d1 ? 0 : -d0 / (d1 - d0);
      return p0 + frac * (p1 - p0);
    }
  }
  return null;
}

export function QecDecoderPanel({ engine }: { engine: FrontierEngineDef }) {
  const [action, setAction] = useState<ActionId>('threshold');

  // lattice
  const [latticeD, setLatticeD] = useState(3);

  // decode
  const [decodeD, setDecodeD] = useState(3);
  const [decodeP, setDecodeP] = useState(0.1);
  const [decodeSeed, setDecodeSeed] = useState('');

  // trial
  const [trialD, setTrialD] = useState(5);
  const [trialP, setTrialP] = useState(0.08);
  const [trialChannel, setTrialChannel] = useState<'bitflip' | 'depolarizing'>('bitflip');
  const [trialSeed, setTrialSeed] = useState('');
  const [trialHistory, setTrialHistory] = useState<RunTrialResult[]>([]);

  // threshold
  const [distancesText, setDistancesText] = useState('3,5');
  const [pValuesText, setPValuesText] = useState('0.05,0.08,0.099,0.12,0.15');
  const [trials, setTrials] = useState(200);
  const [thresholdChannel, setThresholdChannel] = useState<'bitflip' | 'depolarizing'>('bitflip');
  const [thresholdSeed, setThresholdSeed] = useState('');

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);

  const [latticeResult, setLatticeResult] = useState<LatticeInfoResult | null>(null);
  const [decodeResult, setDecodeResult] = useState<DecodeSingleResult | null>(null);
  const [thresholdResult, setThresholdResult] = useState<SimulateThresholdResult | null>(null);

  const distances = useMemo(() => parseNumberList(distancesText), [distancesText]);
  const pValues = useMemo(() => parseNumberList(pValuesText), [pValuesText]);
  const estimatedCells = distances.length * pValues.length * trials;

  async function run() {
    setStatus('loading');
    setReason(null);
    try {
      if (action === 'lattice') {
        const res = await lensRun<LatticeInfoResult>('quantum', 'qecLatticeInfo', { d: latticeD });
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) { setReason(res.data?.error || 'Unknown refusal.'); setStatus('error'); return; }
        setLatticeResult(res.data.result);
        setStatus('ok');
      } else if (action === 'decode') {
        const input: Record<string, unknown> = { d: decodeD, p: decodeP };
        if (decodeSeed.trim() !== '') input.seed = Number(decodeSeed);
        const res = await lensRun<DecodeSingleResult>('quantum', 'qecDecodeSingle', input);
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) { setReason(res.data?.error || 'Unknown refusal.'); setStatus('error'); return; }
        setDecodeResult(res.data.result);
        setStatus('ok');
      } else if (action === 'trial') {
        const input: Record<string, unknown> = { d: trialD, p: trialP, channel: trialChannel };
        if (trialSeed.trim() !== '') input.seed = Number(trialSeed);
        const res = await lensRun<RunTrialResult>('quantum', 'qecRunTrial', input);
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) { setReason(res.data?.error || 'Unknown refusal.'); setStatus('error'); return; }
        setTrialHistory((h) => [...h, res.data.result!]);
        setStatus('ok');
      } else {
        if (distances.length === 0 || pValues.length === 0) {
          setReason('At least one distance and one p-value are required.');
          setStatus('refused');
          return;
        }
        const input: Record<string, unknown> = {
          distances, pValues, trials, channel: thresholdChannel,
        };
        if (thresholdSeed.trim() !== '') input.seed = Number(thresholdSeed);
        const res = await lensRun<SimulateThresholdResult>('quantum', 'qecSimulateThreshold', input);
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) { setReason(res.data?.error || 'Unknown refusal.'); setStatus('error'); return; }
        setThresholdResult(res.data.result);
        setStatus('ok');
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-qec-action', keys: 'mod+enter', description: 'Run selected QEC action', category: 'actions', action: run }],
    { lensId: 'frontier' },
  );

  const runDisabled = action === 'threshold' && (distances.length === 0 || pValues.length === 0);

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel={`quantum.${ACTION_MACRO[action]}`}
        running={status === 'loading'}
        onRun={run}
        runLabel="Run"
        runDisabled={runDisabled}
        hotkey="⌘+Enter"
      >
        <div>
          <label className={ds.label} htmlFor="qec-action">Action</label>
          <select id="qec-action" className={ds.select} value={action} onChange={(e) => setAction(e.target.value as ActionId)}>
            {(Object.keys(ACTION_LABEL) as ActionId[]).map((id) => (
              <option key={id} value={id}>{ACTION_LABEL[id]}</option>
            ))}
          </select>
        </div>

        {action === 'lattice' && (
          <NumberField id="qec-lattice-d" label="Code distance d (2–15)" value={latticeD} onChange={(v) => setLatticeD(Math.round(v))} min={2} max={15} step={1} />
        )}

        {action === 'decode' && (
          <div className="space-y-2">
            <div className={ds.grid3}>
              <NumberField id="qec-decode-d" label="Distance d (2–15)" value={decodeD} onChange={(v) => setDecodeD(Math.round(v))} min={2} max={15} step={1} />
              <NumberField id="qec-decode-p" label="Physical error rate p" value={decodeP} onChange={setDecodeP} min={0} max={1} step={0.01} />
              <TextField id="qec-decode-seed" label="Seed (blank = random)" value={decodeSeed} onChange={setDecodeSeed} />
            </div>
            <p className={cn(ds.textMuted)}>
              This macro always samples via a bit-flip channel (a caller-supplied &quot;depolarizing&quot; channel is
              accepted and echoed back but does not change the sampling here — verified against the source) — no channel
              selector is shown to avoid implying a toggle that does nothing.
            </p>
          </div>
        )}

        {action === 'trial' && (
          <div className={ds.grid4}>
            <NumberField id="qec-trial-d" label="Distance d (2–15)" value={trialD} onChange={(v) => setTrialD(Math.round(v))} min={2} max={15} step={1} />
            <NumberField id="qec-trial-p" label="Physical error rate p" value={trialP} onChange={setTrialP} min={0} max={1} step={0.01} />
            <div>
              <label className={ds.label} htmlFor="qec-trial-channel">Channel</label>
              <select id="qec-trial-channel" className={ds.select} value={trialChannel} onChange={(e) => setTrialChannel(e.target.value as 'bitflip' | 'depolarizing')}>
                <option value="bitflip">Bit-flip</option>
                <option value="depolarizing">Depolarizing</option>
              </select>
            </div>
            <TextField id="qec-trial-seed" label="Seed (blank = random)" value={trialSeed} onChange={setTrialSeed} />
          </div>
        )}

        {action === 'threshold' && (
          <div className="space-y-3">
            <div className={ds.grid2}>
              <TextField id="qec-th-distances" label="Distances (comma-separated, ≤4, each 2–15)" value={distancesText} onChange={setDistancesText} />
              <TextField id="qec-th-pvalues" label="p-values (comma-separated, ≤25, each 0–1)" value={pValuesText} onChange={setPValuesText} />
            </div>
            <div className={ds.grid3}>
              <NumberField id="qec-th-trials" label="Trials per point (≤1500)" value={trials} onChange={(v) => setTrials(Math.min(1500, Math.max(1, Math.round(v))))} min={1} max={1500} step={50} />
              <div>
                <label className={ds.label} htmlFor="qec-th-channel">Channel</label>
                <select id="qec-th-channel" className={ds.select} value={thresholdChannel} onChange={(e) => setThresholdChannel(e.target.value as 'bitflip' | 'depolarizing')}>
                  <option value="bitflip">Bit-flip</option>
                  <option value="depolarizing">Depolarizing</option>
                </select>
              </div>
              <TextField id="qec-th-seed" label="Seed (blank = random)" value={thresholdSeed} onChange={setThresholdSeed} />
            </div>
            <p className={cn(ds.monoXs, 'text-gray-500')}>
              Est. {distances.length}×{pValues.length}×{trials} = {estimatedCells.toLocaleString()} sampled trials this
              call. This is a single synchronous request — larger sweeps genuinely take tens of seconds; the Run button
              above reflects the real in-flight request, never a synthetic progress percentage.
            </p>
          </div>
        )}
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {action === 'lattice' && latticeResult && <LatticeView r={latticeResult} />}
        {action === 'decode' && decodeResult && <DecodeView r={decodeResult} />}
        {action === 'trial' && trialHistory.length > 0 && <TrialHistoryView history={trialHistory} />}
        {action === 'threshold' && thresholdResult && <ThresholdView r={thresholdResult} />}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

function LatticeView({ r }: { r: LatticeInfoResult }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <Stat label="Distance d" value={String(r.d)} />
      <Stat label="Nodes (stabilizers)" value={String(r.numNodes)} />
      <Stat label="Qubits (edges)" value={String(r.numQubits)} />
      <Stat label="Boundary" value={r.boundaryConditions} />
    </div>
  );
}

function DecodeView({ r }: { r: DecodeSingleResult }) {
  return (
    <div className="space-y-3">
      <div
        className={cn(
          'rounded-lg border px-3 py-2 text-sm font-medium inline-block',
          r.logicalSuccess ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-red-500/40 bg-red-500/10 text-red-400',
        )}
      >
        {r.logicalSuccess ? 'Logical success — decoded correctly' : 'Logical failure — correction did not restore the encoded state'}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="d / qubits" value={`${r.d} / ${r.numQubits}`} />
        <Stat label="Union-Find rounds" value={String(r.rounds)} />
        <Stat label="Residual syndrome closed" value={r.residualSyndromeClosed ? 'yes' : 'no'} tone={r.residualSyndromeClosed ? 'good' : undefined} />
      </div>
      <ChipRow label={`Error qubits (${r.errorQubits.length})`} values={r.errorQubits} tone="red" />
      <ChipRow label={`Syndrome nodes (${r.syndromeNodes.length})`} values={r.syndromeNodes} tone="amber" />
      <ChipRow label={`Correction qubits (${r.correctionQubits.length})`} values={r.correctionQubits} tone="cyan" />
    </div>
  );
}

function ChipRow({ label, values, tone }: { label: string; values: number[]; tone: 'red' | 'amber' | 'cyan' }) {
  const toneClass = tone === 'red' ? 'border-red-500/30 text-red-400' : tone === 'amber' ? 'border-amber-500/30 text-amber-400' : 'border-cyan-500/30 text-cyan-400';
  return (
    <div>
      <p className={cn(ds.textMuted, 'mb-1')}>{label}</p>
      {values.length === 0 ? (
        <p className={cn(ds.monoXs, 'text-gray-500')}>(none)</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {values.map((v, i) => (
            <span key={i} className={cn(ds.monoXs, 'px-1.5 py-0.5 rounded border', toneClass)}>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function TrialHistoryView({ history }: { history: RunTrialResult[] }) {
  const successes = history.filter((h) => h.success).length;
  const observedRate = 1 - successes / history.length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Trials run this session" value={String(history.length)} />
        <Stat label="Successes" value={`${successes} / ${history.length}`} tone={successes === history.length ? 'good' : undefined} />
        <Stat label="Observed logical error rate" value={observedRate.toFixed(3)} />
      </div>
      <div className="overflow-x-auto">
        <table className={cn(ds.monoXs, 'w-full border-collapse')}>
          <thead>
            <tr className="text-left text-gray-500 border-b border-lattice-border">
              <th className="py-1 pr-4">#</th>
              <th className="py-1 pr-4">d</th>
              <th className="py-1 pr-4">p</th>
              <th className="py-1 pr-4">channel</th>
              <th className="py-1 pr-4">rounds</th>
              <th className="py-1 pr-4">error weight</th>
              <th className="py-1 pr-4">result</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} className="border-b border-lattice-border/40">
                <td className="py-1 pr-4">{i + 1}</td>
                <td className="py-1 pr-4">{h.d}</td>
                <td className="py-1 pr-4">{h.p}</td>
                <td className="py-1 pr-4">{h.channel}</td>
                <td className="py-1 pr-4">{h.rounds}</td>
                <td className="py-1 pr-4">{h.errorWeight ?? '—'}</td>
                <td className={cn('py-1 pr-4', h.success ? 'text-emerald-400' : 'text-red-400')}>{h.success ? 'success' : 'failure'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThresholdView({ r }: { r: SimulateThresholdResult }) {
  const sortedD = [...r.distances].sort((a, b) => a - b);
  const crossings = sortedD.slice(0, -1).map((dLow, i) => {
    const dHigh = sortedD[i + 1];
    const seriesLow = r.series[`d${dLow}`];
    const seriesHigh = r.series[`d${dHigh}`];
    const crossing = seriesLow && seriesHigh ? crossingPoint(r.pValues, seriesLow, seriesHigh) : null;
    return { dLow, dHigh, crossing };
  });

  return (
    <div className="space-y-4">
      <p className={cn(ds.textBody, 'text-sm italic')}>{r.reference}</p>

      {crossings.map(({ dLow, dHigh, crossing }) => (
        <div key={`${dLow}-${dHigh}`} className="flex flex-wrap gap-4 text-sm">
          <Stat
            label={`Measured crossing (d${dLow}↔d${dHigh}, this run)`}
            value={crossing === null ? 'no sign change in this p range' : crossing.toFixed(4)}
          />
          {crossing !== null && (
            <Stat
              label="vs. published 9.9%"
              value={`${crossing < PUBLISHED_THRESHOLD ? 'below' : 'at/above'} by ${Math.abs(crossing - PUBLISHED_THRESHOLD).toFixed(4)}`}
              tone={crossing < PUBLISHED_THRESHOLD ? undefined : 'good'}
            />
          )}
        </div>
      ))}

      <ThresholdChart r={r} crossings={crossings} />

      <div className="overflow-x-auto">
        <table className={cn(ds.monoXs, 'w-full border-collapse')}>
          <thead>
            <tr className="text-left text-gray-500 border-b border-lattice-border">
              <th className="py-1 pr-4">d</th>
              <th className="py-1 pr-4">p</th>
              <th className="py-1 pr-4">logical error rate</th>
              <th className="py-1 pr-4">trials</th>
            </tr>
          </thead>
          <tbody>
            {sortedD.flatMap((d) => (r.series[`d${d}`] || []).map((pt, i) => (
              <tr key={`${d}-${i}`} className="border-b border-lattice-border/40">
                <td className="py-1 pr-4">{d}</td>
                <td className="py-1 pr-4">{pt.p}</td>
                <td className="py-1 pr-4">{pt.logicalErrorRate.toFixed(4)}</td>
                <td className="py-1 pr-4">{pt.trials}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHART_COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399'];

function ThresholdChart({
  r, crossings,
}: { r: SimulateThresholdResult; crossings: { dLow: number; dHigh: number; crossing: number | null }[] }) {
  const W = 560;
  const H = 220;
  const padL = 40;
  const padB = 24;
  const padT = 10;
  const padR = 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const sortedD = [...r.distances].sort((a, b) => a - b);
  const allRates = sortedD.flatMap((d) => (r.series[`d${d}`] || []).map((pt) => pt.logicalErrorRate));
  const maxRate = Math.max(0.05, ...allRates, 0);
  const minP = Math.min(...r.pValues);
  const maxP = Math.max(...r.pValues);
  const spanP = maxP - minP || 1;

  function x(p: number) { return padL + ((p - minP) / spanP) * plotW; }
  function y(rate: number) { return padT + (1 - rate / maxRate) * plotH; }

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} role="img" aria-label="Logical error rate vs physical error rate, per code distance">
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="currentColor" className="text-lattice-border" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="currentColor" className="text-lattice-border" />
        <text x={4} y={padT + 6} className="fill-gray-500" fontSize="9">{maxRate.toFixed(2)}</text>
        <text x={4} y={H - padB} className="fill-gray-500" fontSize="9">0</text>
        <text x={padL} y={H - 4} className="fill-gray-500" fontSize="9">{minP}</text>
        <text x={W - padR - 20} y={H - 4} className="fill-gray-500" fontSize="9">{maxP}</text>

        {/* published reference */}
        {minP <= PUBLISHED_THRESHOLD && PUBLISHED_THRESHOLD <= maxP && (
          <line x1={x(PUBLISHED_THRESHOLD)} y1={padT} x2={x(PUBLISHED_THRESHOLD)} y2={H - padB} stroke="#94a3b8" strokeDasharray="3,3" />
        )}
        {/* measured crossings */}
        {crossings.filter((c) => c.crossing !== null).map((c) => (
          <line key={`${c.dLow}-${c.dHigh}`} x1={x(c.crossing as number)} y1={padT} x2={x(c.crossing as number)} y2={H - padB} stroke="#ef4444" strokeDasharray="2,2" />
        ))}

        {sortedD.map((d, i) => {
          const pts = r.series[`d${d}`] || [];
          const path = pts.map((pt, j) => `${j === 0 ? 'M' : 'L'}${x(pt.p)},${y(pt.logicalErrorRate)}`).join(' ');
          const color = CHART_COLORS[i % CHART_COLORS.length];
          return (
            <g key={d}>
              <path d={path} fill="none" stroke={color} strokeWidth={2} />
              {pts.map((pt, j) => (
                <circle key={j} cx={x(pt.p)} cy={y(pt.logicalErrorRate)} r={2.5} fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs mt-1">
        {sortedD.map((d, i) => (
          <span key={d} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
            d={d}
          </span>
        ))}
        <span className="flex items-center gap-1 text-gray-400">
          <span className="w-3 border-t border-dashed border-gray-400 inline-block" /> published 9.9%
        </span>
        <span className="flex items-center gap-1 text-red-400">
          <span className="w-3 border-t border-dashed border-red-400 inline-block" /> measured crossing
        </span>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div className="min-w-[10rem]">
      <div className={ds.textMuted}>{label}</div>
      <div className={cn(ds.monoBase, tone === 'good' && 'text-emerald-400')}>{value}</div>
    </div>
  );
}

export default QecDecoderPanel;
