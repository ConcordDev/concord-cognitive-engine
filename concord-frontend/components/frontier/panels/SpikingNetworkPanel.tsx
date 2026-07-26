'use client';

/**
 * SpikingNetworkPanel — Wave W3-C, `sim.spikingNetworkSimulate` +
 * `sim.spikingSTDPLearn`. Source: server/lib/simulation/spiking-network.js,
 * server/lib/simulation/stdp.js, server/domains/sim.js.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, adopt its
 * exact interaction language): ABLETON LIVE's Arrangement/Session View.
 * Two of its conventions are adopted directly:
 *   - The spike raster below is a fixed-lane timeline exactly like
 *     Ableton's clip lanes — one row per neuron, filled note-like marks
 *     at each real spike time, a shared horizontal time axis. Not a
 *     generic scatter plot; a piano-roll-style lane view.
 *   - The membrane-trajectory and STDP charts follow Ableton's automation
 *     lane convention: a smooth reference curve with real recorded
 *     breakpoints snapped onto it, so a viewer can see at a glance whether
 *     the actual data tracks the theoretical curve.
 *
 * What's real vs. what's re-derived client-side (read before trusting the
 * charts):
 *   - Spike raster: every mark is a literal entry from the real
 *     `spikeTrain` array `spikingNetworkSimulate` returned.
 *   - Membrane trajectory: `finalPotentials.probe` is sampled by calling
 *     `spikingNetworkSimulate` ONCE PER sample duration (a real, separate
 *     backend solve each time — the same "sample at several checkpoints"
 *     idiom `MaterialsDegradationPanel` uses for its FEA years) with a
 *     deliberately sub-threshold current so the probe neuron never fires.
 *     The smooth reference LINE is the closed-form formula quoted
 *     verbatim in spiking-network.js — `V(t) = V_rest + R·I·(1-e^(-t/tau_m))`
 *     — evaluated at the SAME tau_m/V_rest/R/I this panel sent the engine,
 *     not a value invented on the frontend.
 *   - STDP weight-change curve: the smooth reference line is
 *     `stdpWeightChange(dt)`, the exact pairwise-exponential formula
 *     quoted verbatim in stdp.js, evaluated with the SAME A_plus/A_minus/
 *     tau_plus/tau_minus this panel sent the engine. The scatter markers
 *     are REAL (dt = t_post - t_pre) offsets derived from the real
 *     pre/post spike times in `spikeTrain`, paired by the same
 *     nearest-neighbour rule `stdp.js#pairSpikes({mode:'nearest'})`
 *     documents (reimplemented here only to know which two real spike
 *     times the backend's own STDP pass paired, for the chart's x-axis —
 *     never to compute the actual weight change). The authoritative
 *     Δw for the pre→post synapse is `spikingSTDPLearn`'s own
 *     `stdpUpdates[].deltaW`; the panel cross-checks that summing this
 *     panel's per-pair curve values reproduces that authoritative number,
 *     and shows both.
 */

import { useMemo, useState } from 'react';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceDot,
} from 'recharts';
import { Activity, Network } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, runFrontierMacro, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

/** Combines a refusal's short `error` code with its `reason`/`message` prose (when present). */
function refusalText(error: string | null, refusal: Record<string, unknown> | null): string | null {
  if (!error) return null;
  if (!refusal) return error;
  const extra = typeof refusal.reason === 'string' ? refusal.reason
    : typeof refusal.message === 'string' ? refusal.message
    : null;
  return extra && extra !== error ? `${error} — ${extra}` : error;
}

interface Spike { neuron: string; time: number }
interface SynapseWeight { id: string; from: string; to: string; weight: number; delay: number; enabled: boolean }
interface SimulateResult {
  spikeTrain: Spike[];
  spikeCounts: Record<string, number>;
  finalPotentials: Record<string, number>;
  synapses: SynapseWeight[];
  dt: number;
  duration: number;
  honestBoundary: string;
}
interface StdpUpdate { id: string; from: string; to: string; weight: number; deltaW: number; pairCount: number }
interface StdpResult {
  spikeCounts: Record<string, number>;
  weightsBefore: SynapseWeight[];
  stdpUpdates: StdpUpdate[];
  weightsAfter: SynapseWeight[];
  topology: { pruned: string[]; grown: string[] };
  dt: number;
  duration: number;
  honestBoundary: string;
}

// ── Client-side re-derivations of the exact documented formulas ──────────
// (see the header comment — these mirror stdp.js verbatim; they never
// replace the backend's own authoritative numbers, only visualize them).

function stdpWeightChange(dt: number, p: { A_plus: number; A_minus: number; tau_plus: number; tau_minus: number }): number {
  if (dt === 0) return 0;
  if (dt > 0) return p.A_plus * Math.exp(-dt / p.tau_plus);
  return -p.A_minus * Math.exp(dt / p.tau_minus);
}

/** Mirrors stdp.js#pairSpikes({mode:'nearest', window:Infinity}) exactly. */
function pairSpikesNearest(preTimes: number[], postTimes: number[]): number[] {
  const pre = [...preTimes].sort((a, b) => a - b);
  const post = [...postTimes].sort((a, b) => a - b);
  const pairs: number[] = [];
  for (const tpost of post) {
    let bestPre = -Infinity;
    for (const tpre of pre) if (tpre < tpost && tpre > bestPre) bestPre = tpre;
    if (bestPre > -Infinity) pairs.push(tpost - bestPre);
  }
  for (const tpre of pre) {
    let bestPost = -Infinity;
    for (const tpost of post) if (tpost < tpre && tpost > bestPost) bestPost = tpost;
    if (bestPost > -Infinity) pairs.push(bestPost - tpre);
  }
  return pairs;
}

/** V(t) = V_rest + R*I*(1 - e^(-t/tau_m)) — quoted verbatim from spiking-network.js. */
function analyticSubthresholdV(t: number, tau_m: number, V_rest: number, R: number, I: number): number {
  return V_rest + R * I * (1 - Math.exp(-t / tau_m));
}

const PROBE_SAMPLE_FRACTIONS = [0.1, 0.25, 0.4, 0.6, 0.8, 1.0];

interface RunResult {
  simulate: SimulateResult;
  stdp: StdpResult;
  stdpParams: { A_plus: number; A_minus: number; tau_plus: number; tau_minus: number };
  crosscheck: { pairs: { dt: number; deltaW: number }[]; predictedSum: number; backendDeltaW: number | null; matches: boolean };
  membrane: { samples: { t: number; V: number; spiked: boolean }[]; reference: { t: number; V: number }[]; firstSpikeT: number | null; probeParams: { tau_m: number; V_rest: number; V_th: number; R: number; I: number } };
}

export function SpikingNetworkPanel({ engine }: { engine: FrontierEngineDef }) {
  // Shared LIF params for the pre/post pair.
  const [tau_m, setTauM] = useState(10);
  const [V_rest, setVRest] = useState(-65);
  const [V_th, setVTh] = useState(-50);
  const [R, setR] = useState(10);
  const [V_reset, setVReset] = useState(-65);
  const [refractory, setRefractory] = useState(2);
  const [I_pre, setIPre] = useState(2.0);
  const [I_post, setIPost] = useState(1.7);

  // Synapse + simulation window.
  const [weight, setWeight] = useState(0.05);
  const [delay, setDelay] = useState(1);
  const [duration, setDuration] = useState(200);
  const [dt, setDt] = useState(0.1);

  // STDP params.
  const [A_plus, setAPlus] = useState(0.01);
  const [A_minus, setAMinus] = useState(0.012);
  const [tau_plus, setTauPlus] = useState(20);
  const [tau_minus, setTauMinus] = useState(20);
  const [w_min, setWMin] = useState(0);
  const [w_max, setWMax] = useState(1);
  const [dynamicTopology, setDynamicTopology] = useState(false);

  // Membrane probe.
  const [I_probe, setIProbe] = useState(0.9);
  const [probeDuration, setProbeDuration] = useState(60);

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runCount, setRunCount] = useState(0);

  const maxSubthresholdI = useMemo(() => Math.max(0, (V_th - V_rest) / R), [V_th, V_rest, R]);

  async function runDemo() {
    setStatus('loading');
    setReason(null);
    setResult(null);
    try {
      const neurons = [
        { id: 'pre', tau_m, V_rest, V_th, V_reset, R, refractory },
        { id: 'post', tau_m, V_rest, V_th, V_reset, R, refractory },
      ];
      const synapses = [{ id: 'syn_pre_post', from: 'pre', to: 'post', weight, delay }];
      const externalCurrents = { pre: I_pre, post: I_post };
      const netCfg = { neurons, synapses, dt, duration, externalCurrents, seed: 42 };

      const simRes = await runFrontierMacro<SimulateResult>('sim', 'spikingNetworkSimulate', netCfg);
      // Bump the session run counter as soon as the FIRST real response for
      // this click lands (matching the convention every sibling panel uses:
      // increment right after `await`, before checking ok/refusal) — one
      // Run click is one entry, no matter how many of the up-to-8 macro
      // calls below it takes. Fixed during test authoring: this used to
      // only increment at the very end of the success path, so a refusal
      // on the FIRST run of a session left `runCount === 0` and
      // VerifyCell's `runCount === 0 ? 'idle' : status` silently rendered
      // the real refusal as the idle "run the compute cell" placeholder
      // instead of the honest refused state.
      setRunCount((n) => n + 1);
      if (!simRes.ok || !simRes.result) {
        setReason(refusalText(simRes.error, simRes.refusal) || 'Unknown refusal.');
        setStatus('refused');
        return;
      }

      const stdpParams = { A_plus, A_minus, tau_plus, tau_minus, w_min, w_max, mode: 'nearest' as const };
      const stdpInput: Record<string, unknown> = { ...netCfg, stdp: stdpParams };
      if (dynamicTopology) {
        stdpInput.topology = {
          prune: { floor: w_min, epsilon: 1e-6 },
          grow: { formationProbability: 0.15, initialWeight: 0.05, delay: 1, correlationWindow: 5 },
        };
      }
      const stdpRes = await runFrontierMacro<StdpResult>('sim', 'spikingSTDPLearn', stdpInput);
      if (!stdpRes.ok || !stdpRes.result) {
        setReason(refusalText(stdpRes.error, stdpRes.refusal) || 'Unknown refusal.');
        setStatus('refused');
        return;
      }

      // Real per-pair offsets from the real spike train (visualization only).
      const preTimes = simRes.result.spikeTrain.filter((s) => s.neuron === 'pre').map((s) => s.time);
      const postTimes = simRes.result.spikeTrain.filter((s) => s.neuron === 'post').map((s) => s.time);
      const dts = pairSpikesNearest(preTimes, postTimes);
      const pairs = dts.map((d) => ({ dt: d, deltaW: stdpWeightChange(d, stdpParams) }));
      const predictedSum = pairs.reduce((s, p) => s + p.deltaW, 0);
      const backendSyn = stdpRes.result.stdpUpdates.find((u) => u.from === 'pre' && u.to === 'post') || null;
      const backendDeltaW = backendSyn ? backendSyn.deltaW : null;
      const crosscheck = {
        pairs,
        predictedSum,
        backendDeltaW,
        matches: backendDeltaW !== null && Math.abs(predictedSum - backendDeltaW) < 1e-6,
      };

      // Membrane probe — real, separate sub-threshold sample calls.
      const probeSamples: { t: number; V: number; spiked: boolean }[] = [];
      let firstSpikeT: number | null = null;
      for (const frac of PROBE_SAMPLE_FRACTIONS) {
        const t = Math.max(dt, +(probeDuration * frac).toFixed(3));
        const probeRes = await runFrontierMacro<SimulateResult>('sim', 'spikingNetworkSimulate', {
          neurons: [{ id: 'probe', tau_m, V_rest, V_th, V_reset, R, refractory }],
          synapses: [],
          dt,
          duration: t,
          externalCurrents: { probe: I_probe },
          seed: 42,
        });
        if (!probeRes.ok || !probeRes.result) {
          setReason(refusalText(probeRes.error, probeRes.refusal) || 'Membrane probe refused.');
          setStatus('refused');
          return;
        }
        const spiked = (probeRes.result.spikeCounts.probe || 0) > 0;
        if (spiked && firstSpikeT === null) firstSpikeT = t;
        probeSamples.push({ t, V: probeRes.result.finalPotentials.probe, spiked });
      }
      const refCutoff = firstSpikeT ?? probeDuration;
      const reference = Array.from({ length: 41 }, (_, i) => {
        const t = (refCutoff * i) / 40;
        return { t: +t.toFixed(2), V: +analyticSubthresholdV(t, tau_m, V_rest, R, I_probe).toFixed(3) };
      });

      setResult({
        simulate: simRes.result,
        stdp: stdpRes.result,
        stdpParams,
        crosscheck,
        membrane: { samples: probeSamples, reference, firstSpikeT, probeParams: { tau_m, V_rest, V_th, R, I: I_probe } },
      });
      setStatus('ok');
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-spiking-demo', keys: 'mod+enter', description: 'Run spiking network + STDP demo', category: 'actions', action: runDemo }],
    { lensId: 'frontier' },
  );

  const raster = result?.simulate.spikeTrain ?? null;
  const rasterDuration = result?.simulate.duration ?? duration;

  const stdpCurve = useMemo(() => {
    if (!result) return [];
    const span = Math.max(2 * tau_plus, 2 * tau_minus, 40);
    return Array.from({ length: 81 }, (_, i) => {
      const d = -span + (2 * span * i) / 80;
      return { dt: +d.toFixed(1), deltaW: +stdpWeightChange(d, result.stdpParams).toFixed(6) };
    });
  }, [result, tau_plus, tau_minus]);

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel="sim.spikingNetworkSimulate · spikingSTDPLearn"
        running={status === 'loading'}
        onRun={runDemo}
        runLabel="Run network + STDP demo"
        hotkey="⌘+Enter"
      >
        <div>
          <p className={cn(ds.label, 'mb-2')}>Two LIF neurons, pre → post — shared membrane parameters</p>
          <div className={ds.grid4}>
            <NumberField id="spk-taum" label="τ_m — membrane time const (ms)" value={tau_m} onChange={setTauM} min={1} max={100} step={0.5} />
            <NumberField id="spk-vrest" label="V_rest (mV)" value={V_rest} onChange={setVRest} min={-100} max={0} step={1} />
            <NumberField id="spk-vth" label="V_th — spike threshold (mV)" value={V_th} onChange={setVTh} min={-90} max={0} step={1} />
            <NumberField id="spk-r" label="R — membrane resistance (MΩ)" value={R} onChange={setR} min={0.5} max={100} step={0.5} />
          </div>
          <div className={cn(ds.grid4, 'mt-3')}>
            <NumberField id="spk-vreset" label="V_reset (mV)" value={V_reset} onChange={setVReset} min={-100} max={0} step={1} />
            <NumberField id="spk-refrac" label="Refractory period (ms)" value={refractory} onChange={setRefractory} min={0} max={20} step={0.5} />
            <NumberField id="spk-ipre" label="I_pre — drive current (model units)" value={I_pre} onChange={setIPre} min={0} max={10} step={0.1} />
            <NumberField id="spk-ipost" label="I_post — drive current" value={I_post} onChange={setIPost} min={0} max={10} step={0.1} />
          </div>
          <p className={cn(ds.monoXs, 'text-gray-500 mt-1')}>
            Subthreshold current cutoff at these params: R·I &lt; {(V_th - V_rest).toFixed(1)} mV (I &lt; {maxSubthresholdI.toFixed(3)}) — pre/post are set above this so they actually fire.
          </p>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>Synapse (pre→post) + simulation window</p>
          <div className={ds.grid4}>
            <NumberField id="spk-weight" label="Initial weight" value={weight} onChange={setWeight} min={0} max={1} step={0.01} />
            <NumberField id="spk-delay" label="Synaptic delay (ms)" value={delay} onChange={setDelay} min={0} max={20} step={0.5} />
            <NumberField id="spk-duration" label="Duration (ms)" value={duration} onChange={setDuration} min={10} max={2000} step={10} />
            <NumberField id="spk-dt" label="Step dt (ms)" value={dt} onChange={setDt} min={0.01} max={1} step={0.01} />
          </div>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>STDP — canonical pairwise exponential window</p>
          <div className={ds.grid4}>
            <NumberField id="spk-aplus" label="A_plus (potentiation)" value={A_plus} onChange={setAPlus} min={0} max={0.5} step={0.001} />
            <NumberField id="spk-aminus" label="A_minus (depression)" value={A_minus} onChange={setAMinus} min={0} max={0.5} step={0.001} />
            <NumberField id="spk-tauplus" label="τ_plus (ms)" value={tau_plus} onChange={setTauPlus} min={1} max={100} step={1} />
            <NumberField id="spk-tauminus" label="τ_minus (ms)" value={tau_minus} onChange={setTauMinus} min={1} max={100} step={1} />
          </div>
          <div className={cn(ds.grid4, 'mt-3')}>
            <NumberField id="spk-wmin" label="w_min (clamp floor)" value={w_min} onChange={setWMin} min={0} max={1} step={0.01} />
            <NumberField id="spk-wmax" label="w_max (clamp ceiling)" value={w_max} onChange={setWMax} min={0} max={5} step={0.05} />
            <label className="flex items-center gap-2 mt-6 text-sm text-gray-300 col-span-2">
              <input type="checkbox" checked={dynamicTopology} onChange={(e) => setDynamicTopology(e.target.checked)} />
              Also run a dynamic-topology pass (prune at floor + Hebbian growth)
            </label>
          </div>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>Membrane probe — a third, unconnected neuron sampled at several durations</p>
          <div className={ds.grid2}>
            <NumberField id="spk-iprobe" label={`I_probe (subthreshold if < ${maxSubthresholdI.toFixed(3)})`} value={I_probe} onChange={setIProbe} min={0} max={10} step={0.05} />
            <NumberField id="spk-probeduration" label="Probe window (ms)" value={probeDuration} onChange={setProbeDuration} min={5} max={500} step={5} />
          </div>
          <p className={cn(ds.monoXs, 'text-gray-500 mt-1')}>
            Sampled at {PROBE_SAMPLE_FRACTIONS.map((f) => `${Math.round(f * probeDuration)}ms`).join(', ')} — each a real, independent {'{'} duration: t {'}'} call.
          </p>
        </div>
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {result && (
          <div className="space-y-8">
            {/* Spike raster — Ableton clip-lane convention. */}
            <div>
              <p className={cn(ds.textBody, 'mb-2')}>
                Spike raster — every mark below is a real entry from the returned <span className={ds.monoXs}>spikeTrain</span>.
              </p>
              <SpikeRaster spikes={raster || []} duration={rasterDuration} />
              <p className={cn(ds.monoXs, 'text-gray-500 mt-1')}>
                pre fired {result.simulate.spikeCounts.pre ?? 0}x, post fired {result.simulate.spikeCounts.post ?? 0}x over {rasterDuration}ms
              </p>
            </div>

            {/* Membrane trajectory vs analytic reference. */}
            <div>
              <p className={cn(ds.textBody, 'mb-2')}>
                Membrane trajectory (probe neuron) vs. the closed-form analytic reference
                <span className={ds.monoXs}> V(t) = V_rest + R·I·(1-e^(-t/τ_m))</span>{result.membrane.firstSpikeT !== null && ' — cut off at the probe\'s first real spike, past which the sub-threshold formula no longer applies'}.
              </p>
              <div className="h-64 w-full overflow-x-auto">
                <div className="min-w-[420px] h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--lattice-border, #333)" />
                      <XAxis dataKey="t" type="number" domain={[0, 'auto']} unit="ms" tick={{ fontSize: 11 }} allowDuplicatedCategory={false} />
                      <YAxis dataKey="V" type="number" unit="mV" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line data={result.membrane.reference} dataKey="V" name="analytic reference" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} type="monotone" />
                      <Scatter data={result.membrane.samples} dataKey="V" name="real sampled call" fill="#34d399" />
                      {result.membrane.firstSpikeT !== null && (
                        <ReferenceDot x={result.membrane.firstSpikeT} y={result.membrane.probeParams.V_th} r={4} fill="#f87171" stroke="none" />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* STDP weight-change window. */}
            <div>
              <p className={cn(ds.textBody, 'mb-2')}>
                STDP weight change vs. spike-time offset — the reference curve is
                <span className={ds.monoXs}> stdpWeightChange(dt)</span> evaluated at the params above; markers are the
                real (dt = t_post − t_pre) offsets paired from the real spike train.
              </p>
              <div className="h-64 w-full overflow-x-auto">
                <div className="min-w-[420px] h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--lattice-border, #333)" />
                      <XAxis dataKey="dt" type="number" unit="ms" tick={{ fontSize: 11 }} label={{ value: 't_post − t_pre', position: 'insideBottom', offset: -4, fontSize: 11 }} />
                      <YAxis dataKey="deltaW" type="number" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line data={stdpCurve} dataKey="deltaW" name="canonical window" stroke="#a78bfa" dot={false} strokeWidth={2} isAnimationActive={false} type="monotone" />
                      <Scatter data={result.crosscheck.pairs} dataKey="deltaW" name="real spike pairs" fill="#fbbf24" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <p className={cn(ds.monoXs, 'mt-2', result.crosscheck.matches ? 'text-emerald-400' : 'text-amber-400')}>
                Σ(per-pair Δw computed here) = {result.crosscheck.predictedSum.toFixed(6)} vs. backend-authoritative deltaW = {result.crosscheck.backendDeltaW !== null ? result.crosscheck.backendDeltaW.toFixed(6) : 'n/a (no pre→post synapse in stdpUpdates)'}
                {result.crosscheck.matches ? ' — match.' : ''}
              </p>
            </div>

            {/* Weights + topology. */}
            <div>
              <p className={cn(ds.textBody, 'mb-2')}>Synapse weights before / after this STDP pass</p>
              <div className="overflow-x-auto">
                <table className={cn(ds.monoXs, 'w-full border-collapse')}>
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-lattice-border">
                      <th className="py-1 pr-4">Synapse</th>
                      <th className="py-1 pr-4">from → to</th>
                      <th className="py-1 pr-4">weight before</th>
                      <th className="py-1 pr-4">weight after</th>
                      <th className="py-1 pr-4">Δw</th>
                      <th className="py-1 pr-4">pairs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.stdp.stdpUpdates.map((u) => (
                      <tr key={u.id} className="border-b border-lattice-border/40">
                        <td className="py-1 pr-4">{u.id}</td>
                        <td className="py-1 pr-4">{u.from} → {u.to}</td>
                        <td className="py-1 pr-4">{result.stdp.weightsBefore.find((w) => w.id === u.id)?.weight.toFixed(4) ?? '—'}</td>
                        <td className="py-1 pr-4">{u.weight.toFixed(4)}</td>
                        <td className={cn('py-1 pr-4', u.deltaW >= 0 ? 'text-emerald-400' : 'text-red-400')}>{u.deltaW >= 0 ? '+' : ''}{u.deltaW.toFixed(4)}</td>
                        <td className="py-1 pr-4">{u.pairCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dynamicTopology && (
                <p className={cn(ds.textMuted, 'mt-2 text-xs')}>
                  Dynamic topology pass: pruned {result.stdp.topology.pruned.length} synapse(s){result.stdp.topology.pruned.length > 0 ? ` (${result.stdp.topology.pruned.join(', ')})` : ''}; grew {result.stdp.topology.grown.length} synapse(s){result.stdp.topology.grown.length > 0 ? ` (${result.stdp.topology.grown.join(', ')})` : ''}.
                </p>
              )}
            </div>
          </div>
        )}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

/** Fixed-lane spike raster — Ableton clip-lane convention: one row per neuron, marks at real spike times on a shared timeline. */
function SpikeRaster({ spikes, duration }: { spikes: Spike[]; duration: number }) {
  const lanes = ['pre', 'post'];
  const safeDuration = duration > 0 ? duration : 1;
  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface p-3">
      <div className="flex items-center gap-2 mb-2">
        <Network className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
        <span className={cn(ds.monoXs, 'text-gray-500')}>0ms</span>
        <div className="flex-1" />
        <span className={cn(ds.monoXs, 'text-gray-500')}>{safeDuration}ms</span>
      </div>
      <div className="space-y-2">
        {lanes.map((lane) => (
          <div key={lane} className="flex items-center gap-3">
            <span className={cn(ds.monoXs, 'w-10 text-gray-400 shrink-0')}>{lane}</span>
            <div className="relative flex-1 h-5 rounded bg-black/30 border border-lattice-border/60">
              {spikes.filter((s) => s.neuron === lane).map((s, i) => (
                <span
                  key={`${lane}-${i}-${s.time}`}
                  title={`${lane} @ ${s.time.toFixed(2)}ms`}
                  className={cn(
                    'absolute top-0.5 bottom-0.5 w-1 rounded-sm',
                    lane === 'pre' ? 'bg-neon-blue' : 'bg-emerald-400',
                  )}
                  style={{ left: `${Math.min(99, (s.time / safeDuration) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className={cn(ds.monoXs, 'text-gray-500 mt-2 flex items-center gap-1')}>
        <Activity className="w-3 h-3" aria-hidden="true" /> {spikes.length} total spikes across {lanes.length} neurons
      </p>
    </div>
  );
}

function NumberField({
  id, label, value, onChange, min, max, step,
}: { id: string; label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div>
      <label className={ds.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        className={ds.input}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default SpikingNetworkPanel;
