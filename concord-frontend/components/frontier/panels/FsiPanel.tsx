'use client';

/**
 * FsiPanel — Wave W1-B, `engineering.fsiCheck`.
 *
 * The wall model is a straight beam along global X discretized into N
 * elements, fixed at one end — the SAME fixture shape
 * `server/tests/fsi-gate.test.js` uses to validate the engine (the module
 * requires every member to lie along X; other orientations are refused
 * before any solve, per its own orientation guard). Two named wall-
 * stiffness presets are offered:
 *
 *   - "Rigid reference" (E = 1e15 Pa) — the exact validated configuration
 *     `fsi-gate.test.js` uses to isolate the flow physics from structural
 *     compliance. Not a real material; labeled as such.
 *   - "Compliant steel" (E = 200 GPa, a real structural-steel modulus) —
 *     lets the two-way coupling actually move the wall. This may
 *     genuinely diverge or collapse the channel gap — that is a real,
 *     reachable outcome of the physics, not a bug, and is rendered
 *     honestly rather than hidden.
 *
 * Section area/momentI default to the test fixture's own values
 * (0.0005 m², 5e-6 m⁴) and are user-editable.
 *
 * Uses `runFrontierMacro` (FrontierEngineShell.tsx), not the generic
 * `lensRun`, for the same reason as MaterialsDegradationPanel:
 * `checkFsiGate`'s success payload carries its own `ok` field
 * (structural pass/fail at the converged gap profile — a real,
 * reachable `false` with no `reason`) that `lensRun`'s generic unwrap
 * would misread as a transport-level refusal. `runFrontierMacro` also
 * preserves the refusal's extra honest fields (Re, regime,
 * residualHistory, memberIds) that `lensRun` drops, so
 * `reasonDetailToText` below has real data to render.
 */

import { useState } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, runFrontierMacro, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

type WallPreset = 'rigid' | 'compliant';
const WALL_E_PA: Record<WallPreset, number> = { rigid: 1e15, compliant: 200e9 };

type FluidModel = 'powerLaw' | 'carreau';

interface FsiResult {
  ok: boolean;
  converged: boolean;
  iterations: number;
  flowRate: number;
  gapProfile: number[];
  mechanicalOnlyUtilization: number | null;
  combinedUtilization: number;
  approximationCaveat: string;
  residualHistory: number[];
}

export function FsiPanel({ engine }: { engine: FrontierEngineDef }) {
  const [wallPreset, setWallPreset] = useState<WallPreset>('rigid');
  const [wallElements, setWallElements] = useState(16);
  const [lengthM, setLengthM] = useState(1);
  const [area, setArea] = useState(0.0005);
  const [momentI, setMomentI] = useState(0.000005);
  const [fluidModel, setFluidModel] = useState<FluidModel>('powerLaw');
  const [K, setK] = useState(1);
  const [n, setN] = useState(0.7);
  const [mu0, setMu0] = useState(1);
  const [muInf, setMuInf] = useState(0.01);
  const [lambda, setLambda] = useState(1);
  const [deltaP, setDeltaP] = useState(500);
  const [density, setDensity] = useState(1000);
  const [nominalGapMm, setNominalGapMm] = useState(10);
  const [channelWidthM, setChannelWidthM] = useState(1);

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [reasonDetail, setReasonDetail] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<FsiResult | null>(null);
  const [runCount, setRunCount] = useState(0);

  async function runCheck() {
    setStatus('loading');
    setReason(null);
    setReasonDetail(null);
    setResult(null);
    try {
      const nodes = Array.from({ length: wallElements + 1 }, (_, i) => ({
        id: i, x: (lengthM * i) / wallElements, y: 0, z: 0,
      }));
      const members = Array.from({ length: wallElements }, (_, i) => ({
        id: `w${i}`, nodeI: i, nodeJ: i + 1,
        area, momentI, elasticModulus: WALL_E_PA[wallPreset], allowableStress: 250e6,
      }));
      const model = {
        nodes,
        members,
        supports: [{ nodeId: 0, fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] }],
        loads: [],
      };
      const input: Record<string, unknown> = {
        model,
        fluidModel,
        deltaP,
        density,
        nominalGap: nominalGapMm / 1000,
        channelWidth: channelWidthM,
      };
      if (fluidModel === 'powerLaw') {
        input.K = K;
        input.n = n;
      } else {
        input.mu0 = mu0;
        input.muInf = muInf;
        input.lambda = lambda;
        input.n = n;
      }
      const res = await runFrontierMacro<FsiResult>('engineering', 'fsiCheck', input);
      setRunCount((r) => r + 1);
      if (res.ok && res.result) {
        setResult(res.result);
        setStatus('ok');
      } else {
        setReason(res.error || 'Unknown refusal.');
        setReasonDetail(res.refusal);
        setStatus('refused');
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-fsi-check', keys: 'mod+enter', description: 'Run FSI check', category: 'actions', action: runCheck }],
    { lensId: 'frontier' },
  );

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel="engineering.fsiCheck"
        running={status === 'loading'}
        onRun={runCheck}
        runLabel="Run FSI check"
        hotkey="⌘+Enter"
      >
        <div>
          <p className={cn(ds.label, 'mb-2')}>Wall — a straight beam along global X, fixed at one end</p>
          <div className={ds.grid4}>
            <div>
              <label className={ds.label} htmlFor="fsi-preset">Wall stiffness preset</label>
              <select id="fsi-preset" className={ds.select} value={wallPreset} onChange={(e) => setWallPreset(e.target.value as WallPreset)}>
                <option value="rigid">Rigid reference (E = 1e15 Pa, validated fixture)</option>
                <option value="compliant">Compliant steel (E = 200 GPa) — may diverge/collapse</option>
              </select>
            </div>
            <div>
              <label className={ds.label} htmlFor="fsi-elements">Wall elements</label>
              <select id="fsi-elements" className={ds.select} value={wallElements} onChange={(e) => setWallElements(Number(e.target.value))}>
                <option value={8}>8</option>
                <option value={16}>16 (min recommended for a real answer)</option>
                <option value={32}>32</option>
              </select>
            </div>
            <NumberField id="fsi-length" label="Length (m)" value={lengthM} onChange={setLengthM} min={0.1} max={10} step={0.1} />
            <NumberField id="fsi-channel-width" label="Channel width (m)" value={channelWidthM} onChange={setChannelWidthM} min={0.01} max={10} step={0.1} />
            <NumberField id="fsi-area" label="Section area (m²)" value={area} onChange={setArea} min={0.00001} max={0.1} step={0.00005} />
            <NumberField id="fsi-momenti" label="Section momentI (m⁴)" value={momentI} onChange={setMomentI} min={0.0000001} max={0.001} step={0.000001} />
          </div>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>Fluid — driving the channel between the wall and its mirror</p>
          <div className={ds.grid4}>
            <div>
              <label className={ds.label} htmlFor="fsi-fluid-model">Constitutive model</label>
              <select id="fsi-fluid-model" className={ds.select} value={fluidModel} onChange={(e) => setFluidModel(e.target.value as FluidModel)}>
                <option value="powerLaw">Power-law (Ostwald-de Waele)</option>
                <option value="carreau">Carreau</option>
              </select>
            </div>
            {fluidModel === 'powerLaw' ? (
              <>
                <NumberField id="fsi-K" label="Consistency K (Pa·sⁿ)" value={K} onChange={setK} min={0.0001} max={1000} step={0.1} />
                <NumberField id="fsi-n" label="Flow index n" value={n} onChange={setN} min={0.1} max={2} step={0.05} />
              </>
            ) : (
              <>
                <NumberField id="fsi-mu0" label="Zero-shear μ₀ (Pa·s)" value={mu0} onChange={setMu0} min={0.001} max={1000} step={0.1} />
                <NumberField id="fsi-muinf" label="Infinite-shear μ∞ (Pa·s)" value={muInf} onChange={setMuInf} min={0} max={100} step={0.01} />
                <NumberField id="fsi-lambda" label="Time constant λ (s)" value={lambda} onChange={setLambda} min={0} max={100} step={0.1} />
                <NumberField id="fsi-n-carreau" label="Shape index n" value={n} onChange={setN} min={0.1} max={2} step={0.05} />
              </>
            )}
            <NumberField id="fsi-deltap" label="Pressure drop ΔP (Pa)" value={deltaP} onChange={setDeltaP} min={0} max={100000} step={50} />
            <NumberField id="fsi-density" label="Density (kg/m³)" value={density} onChange={setDensity} min={1} max={20000} step={10} />
            <NumberField id="fsi-gap" label="Nominal gap (mm)" value={nominalGapMm} onChange={setNominalGapMm} min={1} max={200} step={1} />
          </div>
        </div>
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reasonDetailToText(reason, reasonDetail)}>
        {result && (
          <div className="space-y-4">
            <p className={cn(ds.textBody)}>
              Checked by iterating flow → wall load → beam-frame deflection → gap update until the gap
              profile settled within tolerance, then re-solving the mechanical-only and combined loads for
              a direct utilization comparison.
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <Stat label="Converged" value={result.converged ? `yes (${result.iterations} iters)` : 'no'} tone={result.converged ? 'good' : 'bad'} />
              <Stat label="Overall pass" value={result.ok ? 'pass' : 'fail'} tone={result.ok ? 'good' : 'bad'} />
              <Stat label="Flow rate Q" value={result.flowRate.toExponential(3)} />
              <Stat label="Mechanical-only utilization" value={result.mechanicalOnlyUtilization?.toFixed(3) ?? 'n/a'} />
              <Stat label="Combined utilization" value={result.combinedUtilization.toFixed(3)} />
              <Stat label="Gap range (mm)" value={`${(Math.min(...result.gapProfile) * 1000).toFixed(2)} – ${(Math.max(...result.gapProfile) * 1000).toFixed(2)}`} />
            </div>
            <p className={cn(ds.monoXs, 'text-gray-500')}>Residual history: {result.residualHistory.map((r) => r.toExponential(1)).join(' → ')}</p>
            <p className={cn(ds.textMuted, 'italic')}>{result.approximationCaveat}</p>
          </div>
        )}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

function reasonDetailToText(reason: string | null, detail: Record<string, unknown> | null): string | null {
  if (!reason) return null;
  if (!detail) return reason;
  const extras: string[] = [];
  if (typeof detail.Re === 'number') extras.push(`Re=${(detail.Re as number).toFixed(1)}`);
  if (typeof detail.regime === 'string') extras.push(`regime=${detail.regime}`);
  if (Array.isArray(detail.residualHistory) && detail.residualHistory.length > 0) {
    extras.push(`residuals=[${(detail.residualHistory as number[]).map((r) => r.toExponential(1)).join(', ')}]`);
  }
  return extras.length > 0 ? `${reason} (${extras.join(', ')})` : reason;
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-[9rem]">
      <div className={ds.textMuted}>{label}</div>
      <div className={cn(ds.monoBase, tone === 'good' && 'text-emerald-400', tone === 'bad' && 'text-red-400')}>{value}</div>
    </div>
  );
}

export default FsiPanel;
