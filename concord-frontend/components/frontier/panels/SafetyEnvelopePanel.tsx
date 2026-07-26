'use client';

/**
 * SafetyEnvelopePanel — Wave W1-C, `robotics.safetyEnvelopeCompile` +
 * `safetyEnvelopeGet`.
 *
 * Plant presets are the three canonical 2-state linear control-theory
 * fixtures (damped oscillator, double integrator, unstable pole) — real
 * textbook systems, not invented ones — with an editable A/B matrix grid
 * so the form stays structured (a 2×2 + 2×1 numeric grid) rather than a
 * JSON paste. `safetyEnvelopeCompile` returns only a summary (the full
 * lookup table can be huge); this panel makes a SECOND real call,
 * `safetyEnvelopeGet`, to fetch the full artifact so the Verify cell can
 * show the actual `proofOfBounds` / `empiricalBoundsEvidence` statement
 * the backend computed — never a paraphrase invented on the frontend.
 */

import { useState } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

type PresetId = 'damped-oscillator' | 'double-integrator' | 'unstable-pole';

const PRESETS: Record<PresetId, { label: string; A: number[][]; B: number[][] }> = {
  'damped-oscillator': { label: 'Damped oscillator', A: [[0, 1], [-1, -0.5]], B: [[0], [1]] },
  'double-integrator': { label: 'Double integrator', A: [[0, 1], [0, 0]], B: [[0], [1]] },
  'unstable-pole': { label: 'Unstable pole', A: [[0, 1], [2, 0]], B: [[0], [1]] },
};

interface CompileSummary {
  id: string;
  claimTier: 'certified_modulo_declared_bound' | 'empirical_sampled';
  coverageFraction: number;
  safeCount: number;
  totalCells: number;
  lipschitz: { value: number; basis: string };
}

interface FullArtifact {
  claimTier: string;
  runtimeBoundary: string;
  proofOfBounds?: { statement: string };
  empiricalBoundsEvidence?: { statement: string };
}

export function SafetyEnvelopePanel({ engine }: { engine: FrontierEngineDef }) {
  const [preset, setPreset] = useState<PresetId>('damped-oscillator');
  const [A, setA] = useState<number[][]>(PRESETS['damped-oscillator'].A);
  const [B, setB] = useState<number[][]>(PRESETS['damped-oscillator'].B);
  const [x0Min, setX0Min] = useState(-2);
  const [x0Max, setX0Max] = useState(2);
  const [x0N, setX0N] = useState(20);
  const [x1Min, setX1Min] = useState(-2);
  const [x1Max, setX1Max] = useState(2);
  const [x1N, setX1N] = useState(20);
  const [uMin, setUMin] = useState(-1);
  const [uMax, setUMax] = useState(1);
  const [constraintRhs, setConstraintRhs] = useState(1.8);
  const [tHorizon, setTHorizon] = useState(2);
  const [dt, setDt] = useState(0.05);
  const [adversarialInput, setAdversarialInput] = useState(false);
  const [declaredLipschitz, setDeclaredLipschitz] = useState<string>('');

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [summary, setSummary] = useState<CompileSummary | null>(null);
  const [artifact, setArtifact] = useState<FullArtifact | null>(null);
  const [runCount, setRunCount] = useState(0);

  function applyPreset(id: PresetId) {
    setPreset(id);
    setA(PRESETS[id].A.map((row) => [...row]));
    setB(PRESETS[id].B.map((row) => [...row]));
  }

  function setAij(i: number, j: number, v: number) {
    setA((prev) => prev.map((row, ri) => (ri === i ? row.map((c, ci) => (ci === j ? v : c)) : row)));
  }
  function setBi(i: number, v: number) {
    setB((prev) => prev.map((row, ri) => (ri === i ? [v] : row)));
  }

  async function runCompile() {
    setStatus('loading');
    setReason(null);
    setSummary(null);
    setArtifact(null);
    try {
      const plant = { kind: 'linear' as const, A, B };
      const stateBox = [
        { name: 'position', min: x0Min, max: x0Max, n: x0N },
        { name: 'velocity', min: x1Min, max: x1Max, n: x1N },
      ];
      const inputBox = { min: uMin, max: uMax };
      const constraints = [{ coeffs: [1, 0], op: '<=' as const, rhs: constraintRhs }];
      const horizon = { tHorizon, dt };
      const input: Record<string, unknown> = {
        plant, stateBox, inputBox, constraints, horizon, adversarialInput,
      };
      if (declaredLipschitz.trim() !== '') input.declaredLipschitz = Number(declaredLipschitz);

      const compileRes = await lensRun<CompileSummary>('robotics', 'safetyEnvelopeCompile', input);
      setRunCount((r) => r + 1);
      if (!compileRes.data?.ok || !compileRes.data.result) {
        setReason(compileRes.data?.error || 'Unknown refusal.');
        setStatus('refused');
        return;
      }
      setSummary(compileRes.data.result);

      const getRes = await lensRun<{ artifact: FullArtifact }>('robotics', 'safetyEnvelopeGet', { id: compileRes.data.result.id });
      if (getRes.data?.ok && getRes.data.result) {
        setArtifact(getRes.data.result.artifact);
      }
      setStatus('ok');
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-safety-envelope', keys: 'mod+enter', description: 'Compile safety envelope', category: 'actions', action: runCompile }],
    { lensId: 'frontier' },
  );

  const totalCells = x0N * x1N;

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel="robotics.safetyEnvelopeCompile"
        running={status === 'loading'}
        onRun={runCompile}
        runLabel="Compile envelope"
        runDisabled={totalCells > 250000}
        hotkey="⌘+Enter"
      >
        <div>
          <label className={ds.label} htmlFor="env-preset">Linear plant preset</label>
          <select
            id="env-preset"
            className={ds.select}
            value={preset}
            onChange={(e) => applyPreset(e.target.value as PresetId)}
          >
            {Object.entries(PRESETS).map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>dx/dt = A·x + B·u — editable matrices</p>
          <div className="flex gap-6 items-start">
            <MatrixGrid label="A (2×2)" rows={A} onChange={setAij} />
            <MatrixGrid label="B (2×1)" rows={B} onChange={(i, _j, v) => setBi(i, v)} />
          </div>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>State box — grid resolution per axis</p>
          <div className={ds.grid3}>
            <NumberField id="env-x0min" label="position min" value={x0Min} onChange={setX0Min} step={0.1} />
            <NumberField id="env-x0max" label="position max" value={x0Max} onChange={setX0Max} step={0.1} />
            <NumberField id="env-x0n" label="position grid n" value={x0N} onChange={(v) => setX0N(Math.round(v))} min={4} max={200} step={1} />
            <NumberField id="env-x1min" label="velocity min" value={x1Min} onChange={setX1Min} step={0.1} />
            <NumberField id="env-x1max" label="velocity max" value={x1Max} onChange={setX1Max} step={0.1} />
            <NumberField id="env-x1n" label="velocity grid n" value={x1N} onChange={(v) => setX1N(Math.round(v))} min={4} max={200} step={1} />
          </div>
          <p className={cn(ds.monoXs, 'text-gray-500 mt-1')}>
            Total grid cells: {totalCells.toLocaleString()} {totalCells > 250000 && '— exceeds MAX_GRID_CELLS, reduce the grid n above'}
          </p>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>Admissible input + safety constraint (position ≤ bound)</p>
          <div className={ds.grid4}>
            <NumberField id="env-umin" label="input min" value={uMin} onChange={setUMin} step={0.1} />
            <NumberField id="env-umax" label="input max" value={uMax} onChange={setUMax} step={0.1} />
            <NumberField id="env-rhs" label="position ≤ (bound)" value={constraintRhs} onChange={setConstraintRhs} step={0.1} />
            <label className="flex items-center gap-2 mt-6 text-sm text-gray-300">
              <input type="checkbox" checked={adversarialInput} onChange={(e) => setAdversarialInput(e.target.checked)} />
              Adversarial (safe for EVERY input, not just some)
            </label>
          </div>
        </div>

        <div>
          <p className={cn(ds.label, 'mb-2')}>Horizon + optional declared Lipschitz bound</p>
          <div className={ds.grid3}>
            <NumberField id="env-thorizon" label="Horizon (s)" value={tHorizon} onChange={setTHorizon} min={0.1} max={60} step={0.1} />
            <NumberField id="env-dt" label="Integration step dt (s)" value={dt} onChange={setDt} min={0.001} max={1} step={0.005} />
            <div>
              <label className={ds.label} htmlFor="env-lipschitz">Declared Lipschitz bound (optional)</label>
              <input
                id="env-lipschitz"
                type="text"
                inputMode="decimal"
                className={ds.input}
                placeholder="leave blank to estimate"
                value={declaredLipschitz}
                onChange={(e) => setDeclaredLipschitz(e.target.value)}
              />
            </div>
          </div>
        </div>
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {summary && (
          <div className="space-y-4">
            <p className={cn(ds.textBody)}>
              Checked by gridded forward reachability with Grönwall inflation, then fetched back in full
              (<span className={ds.monoXs}>robotics.safetyEnvelopeGet</span>) to read the engine&apos;s own claim tier.
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <Stat label="Claim tier" value={summary.claimTier} tone={summary.claimTier === 'certified_modulo_declared_bound' ? 'good' : undefined} />
              <Stat label="Coverage" value={`${(summary.coverageFraction * 100).toFixed(1)}%`} />
              <Stat label="Safe cells" value={`${summary.safeCount} / ${summary.totalCells}`} />
              <Stat label="Lipschitz bound" value={`${summary.lipschitz.value.toFixed(3)} (${summary.lipschitz.basis})`} />
            </div>
            {artifact && (
              <p className={cn(ds.textMuted, 'italic')}>
                {artifact.proofOfBounds?.statement ?? artifact.empiricalBoundsEvidence?.statement ?? artifact.runtimeBoundary}
              </p>
            )}
          </div>
        )}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div className="min-w-[10rem]">
      <div className={ds.textMuted}>{label}</div>
      <div className={cn(ds.monoBase, tone === 'good' && 'text-emerald-400')}>{value}</div>
    </div>
  );
}

export default SafetyEnvelopePanel;
