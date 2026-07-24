'use client';

/**
 * MaterialsDegradationPanel — Wave W1-A, `materials.degradationConstants` +
 * `materials.durabilityCheck`.
 *
 * The structured form drives a real single-member cantilever beam (fixed
 * at the wall, a tip load at the free end — the SAME fixture shape
 * `server/tests/durability-gate.test.js` uses to validate the engine), so
 * "compute" here is never a raw JSON paste: span, rectangular
 * cross-section, tip load, material, and mechanism-specific kinetics
 * parameters are all individual, labeled, unit-annotated fields.
 *
 * The four baseline material properties below (E, yield in MPa) are
 * copied verbatim from `server/lib/asset-gen/mass-properties.js`'s
 * `MATERIAL_LIBRARY` for the four materials `durabilityCheck` actually has
 * cited degradation constants for — used only to build a genuine,
 * consistent "undegraded baseline" member (the engine's own per-year
 * degraded samples always come from ITS OWN server-side material lookup,
 * regardless of what the client sends; feeding it the same real numbers
 * keeps the baseline-vs-year-0 comparison meaningful instead of
 * arbitrary). This is citing the same table the backend trusts, not
 * inventing one.
 *
 * Uses `runFrontierMacro` (FrontierEngineShell.tsx), not the generic
 * `lensRun`, because `checkDurabilityGate`'s success payload carries its
 * OWN `ok` field (does the structure still pass at the final sampled
 * year — a real, reachable `false` with no `reason`, e.g. an
 * overstressed but non-refused beam) which `lensRun`'s generic unwrap
 * would otherwise misread as a transport-level refusal and discard the
 * real samples/baseline data. See the helper's own doc comment.
 */

import { useEffect, useMemo, useState } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, runFrontierMacro, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

// Verbatim from server/lib/asset-gen/mass-properties.js MATERIAL_LIBRARY —
// E and yield in MPa. Only the four keys durabilityCheck has real cited
// degradation constants for (server/lib/asset-gen/degradation-constants.js).
const BASELINE_PROPS: Record<string, { label: string; E_MPa: number; yield_MPa: number }> = {
  'steel-a36': { label: 'ASTM A36 Structural Steel', E_MPa: 200000, yield_MPa: 250 },
  'aluminum-7075-t6': { label: 'Aluminum 7075-T6', E_MPa: 71700, yield_MPa: 503 },
  'concrete-30mpa': { label: 'Concrete (30 MPa)', E_MPa: 30000, yield_MPa: 30 },
  cfrp: { label: 'Carbon Fiber Reinforced Polymer', E_MPa: 70000, yield_MPa: 600 },
};

const SAMPLE_YEARS = [0, 5, 10, 25, 50];

interface MechanismFlags { fatigue: boolean; thermal: boolean; moisture: boolean }
interface MaterialConstants {
  material: string;
  known: boolean;
  label: string | null;
  mechanisms: MechanismFlags;
  paris: { C: number; m: number; source: string } | null;
  diffusion: { D_m2_s: number; referenceTempK: number; species: string; source: string } | null;
}
interface DegradationConstantsResult { materials: MaterialConstants[]; honestBoundary: string }

interface DurabilitySample { year: number; allPass: boolean; utilization: number; lawUsed: string }
interface DurabilityResult {
  ok: boolean;
  material: string;
  mechanisms: string[];
  baseline: { utilization: number };
  samples: DurabilitySample[];
  firstFailureYear: number | null;
  lawUsed: string;
}

export function MaterialsDegradationPanel({ engine }: { engine: FrontierEngineDef }) {
  const [constants, setConstants] = useState<DegradationConstantsResult | null>(null);
  const [constantsError, setConstantsError] = useState<string | null>(null);

  const [material, setMaterial] = useState('steel-a36');
  const [mechanism, setMechanism] = useState<'fatigue' | 'moisture'>('fatigue');
  const [spanM, setSpanM] = useState(0.5);
  const [widthMm, setWidthMm] = useState(50);
  const [heightMm, setHeightMm] = useState(10);
  const [tipLoadN, setTipLoadN] = useState(200);
  const [deltaSigmaMpa, setDeltaSigmaMpa] = useState(80);
  const [crackY, setCrackY] = useState(1.2);
  const [a0Mm, setA0Mm] = useState(0);
  const [cyclesPerYear, setCyclesPerYear] = useState(300);
  const [temperatureK, setTemperatureK] = useState(296.15);

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [result, setResult] = useState<DurabilityResult | null>(null);
  const [runCount, setRunCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await runFrontierMacro<DegradationConstantsResult>('materials', 'degradationConstants', {});
        if (cancelled) return;
        if (res.ok && res.result) {
          setConstants(res.result);
        } else {
          setConstantsError(res.error || 'Could not load material constants.');
        }
      } catch (e) {
        if (!cancelled) setConstantsError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedConstants = useMemo(
    () => constants?.materials.find((m) => m.material === material) ?? null,
    [constants, material],
  );

  const availableMaterials = useMemo(
    () => (constants?.materials ?? []).filter((m) => m.known && BASELINE_PROPS[m.material]),
    [constants],
  );

  // Keep the selected mechanism valid whenever the material changes.
  useEffect(() => {
    if (!selectedConstants) return;
    if (mechanism === 'fatigue' && !selectedConstants.mechanisms.fatigue) {
      if (selectedConstants.mechanisms.moisture) setMechanism('moisture');
    } else if (mechanism === 'moisture' && !selectedConstants.mechanisms.moisture) {
      if (selectedConstants.mechanisms.fatigue) setMechanism('fatigue');
    }
  }, [selectedConstants, mechanism]);

  async function runCheck() {
    setStatus('loading');
    setReason(null);
    setResult(null);
    try {
      const widthM = widthMm / 1000;
      const heightM = heightMm / 1000;
      const area = widthM * heightM;
      const momentI = (widthM * Math.pow(heightM, 3)) / 12;
      const baseline = BASELINE_PROPS[material];
      const model = {
        nodes: [
          { id: 'A', x: 0, y: 0, z: 0 },
          { id: 'B', x: spanM, y: 0, z: 0 },
        ],
        members: [
          {
            id: 'm1', nodeI: 'A', nodeJ: 'B', area, momentI,
            elasticModulus: baseline.E_MPa * 1e6,
            allowableStress: baseline.yield_MPa * 1e6,
          },
        ],
        supports: [{ nodeId: 'A', type: 'fixed' }],
        loads: [{ nodeId: 'B', Fy: -Math.abs(tipLoadN) }],
      };
      const input: Record<string, unknown> = {
        model,
        materialKey: material,
        mechanisms: [mechanism],
        sampleYears: SAMPLE_YEARS,
      };
      if (mechanism === 'fatigue') {
        input.fatigue = {
          deltaSigma: deltaSigmaMpa,
          Y: crackY,
          a0: a0Mm / 1000,
          thickness: heightM,
          cyclesPerYear,
        };
      } else {
        input.moisture = { h: heightM, temperatureK };
      }
      const res = await runFrontierMacro<DurabilityResult>('materials', 'durabilityCheck', input);
      setRunCount((n) => n + 1);
      if (res.ok && res.result) {
        setResult(res.result);
        setStatus('ok');
      } else {
        setReason(res.error || 'Unknown refusal.');
        setStatus('refused');
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-durability-check', keys: 'mod+enter', description: 'Run durability check', category: 'actions', action: runCheck }],
    { lensId: 'frontier' },
  );

  const mechanismAvailable = selectedConstants?.mechanisms ?? { fatigue: false, thermal: false, moisture: false };
  const citedSource = mechanism === 'fatigue' ? selectedConstants?.paris?.source : selectedConstants?.diffusion?.source;

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel="materials.durabilityCheck"
        running={status === 'loading'}
        onRun={runCheck}
        runLabel="Run durability check"
        runDisabled={!selectedConstants || (!mechanismAvailable.fatigue && !mechanismAvailable.moisture)}
        hotkey="⌘+Enter"
      >
        {constantsError && (
          <p className="text-sm text-red-400">Could not load material list: {constantsError}</p>
        )}

        <div className={ds.grid2}>
          <div>
            <label className={ds.label} htmlFor="materials-material">Material</label>
            <select
              id="materials-material"
              className={ds.select}
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              disabled={!constants}
            >
              {availableMaterials.length === 0 && <option value={material}>Loading materials…</option>}
              {availableMaterials.map((m) => (
                <option key={m.material} value={m.material}>{m.label ?? m.material}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={ds.label} htmlFor="materials-mechanism">Degradation mechanism</label>
            <select
              id="materials-mechanism"
              className={ds.select}
              value={mechanism}
              onChange={(e) => setMechanism(e.target.value as 'fatigue' | 'moisture')}
            >
              <option value="fatigue" disabled={!mechanismAvailable.fatigue}>
                Fatigue (Paris crack growth){!mechanismAvailable.fatigue ? ' — unavailable for this material' : ''}
              </option>
              <option value="moisture" disabled={!mechanismAvailable.moisture}>
                Moisture ingress (Fickian diffusion){!mechanismAvailable.moisture ? ' — unavailable for this material' : ''}
              </option>
            </select>
          </div>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>Cantilever beam geometry — fixed at the wall, load at the free tip</p>
          <div className={ds.grid4}>
            <NumberField id="materials-span" label="Span (m)" value={spanM} onChange={setSpanM} min={0.1} max={5} step={0.1} />
            <NumberField id="materials-width" label="Section width (mm)" value={widthMm} onChange={setWidthMm} min={5} max={500} step={1} />
            <NumberField id="materials-height" label="Section height (mm)" value={heightMm} onChange={setHeightMm} min={2} max={200} step={1} />
            <NumberField id="materials-load" label="Tip load (N)" value={tipLoadN} onChange={setTipLoadN} min={1} max={100000} step={10} />
          </div>
        </div>

        {mechanism === 'fatigue' ? (
          <div>
            <p className={cn(ds.label, 'mb-2')}>Fatigue loading (cyclic ΔK drives Paris crack growth)</p>
            <div className={ds.grid4}>
              <NumberField id="materials-deltasigma" label="Stress range ΔΣ (MPa)" value={deltaSigmaMpa} onChange={setDeltaSigmaMpa} min={1} max={1000} step={5} />
              <NumberField id="materials-y" label="Geometry factor Y" value={crackY} onChange={setCrackY} min={0.5} max={3} step={0.1} />
              <NumberField id="materials-a0" label="Initial crack a0 (mm)" value={a0Mm} onChange={setA0Mm} min={0} max={heightMm} step={0.1} />
              <NumberField id="materials-cycles" label="Cycles / year" value={cyclesPerYear} onChange={setCyclesPerYear} min={1} max={100000} step={50} />
            </div>
          </div>
        ) : (
          <div>
            <p className={cn(ds.label, 'mb-2')}>Moisture ingress — slab thickness reuses the section height above</p>
            <div className={ds.grid2}>
              <NumberField id="materials-tempk" label="Service temperature (K)" value={temperatureK} onChange={setTemperatureK} min={250} max={400} step={0.5} />
            </div>
          </div>
        )}

        <p className={cn(ds.monoXs, 'text-gray-500')}>
          Sampled at years: {SAMPLE_YEARS.join(', ')} (server default — every sampled year re-solves the full beam-frame FEA)
        </p>
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {result && (
          <div className="space-y-4">
            <p className={cn(ds.textBody)}>
              Checked against the cited {mechanism === 'fatigue' ? 'Paris-law' : 'Fickian diffusion'} constants for{' '}
              <strong>{selectedConstants?.label}</strong>
              {citedSource && (
                <>: <span className="italic text-gray-400">{citedSource}</span></>
              )}
              , re-solved through the unchanged beam-frame FEA solver at each sampled year.
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <Stat label="Baseline utilization" value={result.baseline.utilization.toFixed(3)} />
              <Stat label="Final ok" value={result.ok ? 'pass' : 'fail'} tone={result.ok ? 'good' : 'bad'} />
              <Stat
                label="First failure year"
                value={result.firstFailureYear === null ? 'none in horizon' : String(result.firstFailureYear)}
                tone={result.firstFailureYear === null ? 'good' : 'bad'}
              />
              <Stat label="Knockdown law" value={result.lawUsed} />
            </div>
            <div className="overflow-x-auto">
              <table className={cn(ds.monoXs, 'w-full border-collapse')}>
                <thead>
                  <tr className="text-left text-gray-500 border-b border-lattice-border">
                    <th className="py-1 pr-4">Year</th>
                    <th className="py-1 pr-4">Utilization</th>
                    <th className="py-1 pr-4">Pass</th>
                  </tr>
                </thead>
                <tbody>
                  {result.samples.map((s) => (
                    <tr key={s.year} className="border-b border-lattice-border/40">
                      <td className="py-1 pr-4">{s.year}</td>
                      <td className="py-1 pr-4">{s.utilization.toFixed(3)}</td>
                      <td className={cn('py-1 pr-4', s.allPass ? 'text-emerald-400' : 'text-red-400')}>
                        {s.allPass ? 'pass' : 'fail'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-[8rem]">
      <div className={ds.textMuted}>{label}</div>
      <div className={cn(ds.monoBase, tone === 'good' && 'text-emerald-400', tone === 'bad' && 'text-red-400')}>{value}</div>
    </div>
  );
}

export default MaterialsDegradationPanel;
