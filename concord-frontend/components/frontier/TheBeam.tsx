'use client';

/**
 * Frontier north star — the open cantilever. Nothing about stress is painted
 * until materials.durabilityCheck returns it. Safety is the other pill.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { FRONTIER_ENGINES } from '@/lib/frontier-engines';
import { SafetyEnvelopePanel } from '@/components/frontier/panels/SafetyEnvelopePanel';

const BASELINE: Record<string, { label: string; E_MPa: number; yield_MPa: number }> = {
  'steel-a36': { label: 'ASTM A36', E_MPa: 200000, yield_MPa: 250 },
  'aluminum-7075-t6': { label: 'Aluminum 7075-T6', E_MPa: 71700, yield_MPa: 503 },
  'concrete-30mpa': { label: 'Concrete 30 MPa', E_MPa: 30000, yield_MPa: 30 },
  cfrp: { label: 'CFRP', E_MPa: 70000, yield_MPa: 600 },
};

const SAMPLE_YEARS = [0, 5, 10, 25, 50];

type Constants = { materials?: { material: string; known?: boolean }[] };
type Sample = { year?: number; utilization?: number };
type Durability = { firstFailureYear?: number | null; lawUsed?: string; samples?: Sample[] };

export function TheBeam({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('frontier');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const safety = FRONTIER_ENGINES.find((engine) => engine.id === 'safety-envelope') ?? null;
  const [mode, setMode] = useState<'beam' | 'safety'>('beam');
  const [material, setMaterial] = useState('steel-a36');
  const [spanM, setSpanM] = useState('0.5');
  const [widthMm, setWidthMm] = useState('50');
  const [heightMm, setHeightMm] = useState('10');
  const [tipLoadN, setTipLoadN] = useState('200');
  const [cyclesPerYear, setCyclesPerYear] = useState('300');
  const [result, setResult] = useState<Durability | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const constantsQ = useMacro<Constants>(
    ['frontier-northstar', 'constants'],
    'materials',
    'degradationConstants',
    {},
    (payload) => payload,
  );
  const known = constantsQ.data?.materials?.some((row) => row.material === material && row.known !== false) ?? false;

  const compute = async () => {
    const span = Number(spanM);
    const width = Number(widthMm) / 1000;
    const height = Number(heightMm) / 1000;
    const tip = Number(tipLoadN);
    const cycles = Number(cyclesPerYear);
    const baseline = BASELINE[material];
    if (!baseline || ![span, width, height, tip, cycles].every((n) => Number.isFinite(n) && n > 0)) {
      setError('The case needs a span, a section, a tip load, and cycles per year.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    const area = width * height;
    const momentI = (width * Math.pow(height, 3)) / 12;
    try {
      const res = await lensRun<Durability>('materials', 'durabilityCheck', {
        model: {
          nodes: [{ id: 'A', x: 0, y: 0, z: 0 }, { id: 'B', x: span, y: 0, z: 0 }],
          members: [{
            id: 'm1', nodeI: 'A', nodeJ: 'B', area, momentI,
            elasticModulus: baseline.E_MPa * 1e6,
            allowableStress: baseline.yield_MPa * 1e6,
          }],
          supports: [{ nodeId: 'A', type: 'fixed' }],
          loads: [{ nodeId: 'B', Fy: -Math.abs(tip) }],
        },
        materialKey: material,
        mechanisms: ['fatigue'],
        sampleYears: SAMPLE_YEARS,
        fatigue: { deltaSigma: 80, Y: 1.2, a0: 0, thickness: height, cyclesPerYear: cycles },
      });
      if (!res.data.ok || !res.data.result) {
        setError(res.data.error || 'The check did not answer.');
        return;
      }
      setResult(res.data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check did not answer.');
    } finally {
      setBusy(false);
    }
  };

  const year0 = result?.samples?.find((sample) => sample.year === 0);
  const constantsError = constantsQ.error instanceof Error ? constantsQ.error.message : '';

  return (
    <LensShell lensId="frontier" asMain={false} disableAgentFab>
      <div data-lens-theme="frontier" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Frontier" title={who ? `The beam, ${who}` : 'The beam'} />
            <nav aria-label="Frontier" className="mt-5 inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1">
              {(['beam', 'safety'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={mode === id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'rounded-full px-3.5 py-1 text-[13px]',
                    mode === id ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  {id === 'beam' ? 'Degradation' : 'Safety'}
                </button>
              ))}
            </nav>
          </div>
          <QuietMore items={[{ id: 'desk', label: 'All engines' }]} onPick={onOpenDesk} />
        </div>

        {(constantsError || error) && <NorthError message={error || constantsError} />}

        {mode === 'safety' && safety && (
          <div className="mt-6 max-w-3xl">
            <SafetyEnvelopePanel engine={safety} />
          </div>
        )}

        {mode === 'beam' && (
          <form className="mt-6 grid max-w-xl grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void compute(); }}>
            <label className="col-span-2 text-[13px] text-zinc-500">
              Material
              <select aria-label="Material" value={material} onChange={(e) => setMaterial(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px] text-zinc-100">
                {Object.entries(BASELINE).map(([id, row]) => <option key={id} value={id}>{row.label}</option>)}
              </select>
            </label>
            <Field label="Span m" value={spanM} onChange={setSpanM} />
            <Field label="Width mm" value={widthMm} onChange={setWidthMm} />
            <Field label="Height mm" value={heightMm} onChange={setHeightMm} />
            <Field label="Tip load N" value={tipLoadN} onChange={setTipLoadN} />
            <Field label="Cycles per year" value={cyclesPerYear} onChange={setCyclesPerYear} />
          </form>
        )}

        {result && (
          <div className="mt-6 max-w-xl rounded-xl border border-white/10 px-4 py-3" data-testid="beam-result">
            {result.lawUsed && <p className="text-[14px] text-zinc-300">{result.lawUsed}</p>}
            <p className="mt-1 text-[14px] text-zinc-400">
              First failure year: {result.firstFailureYear == null ? '—' : String(result.firstFailureYear)}
            </p>
            {typeof year0?.utilization === 'number' && (
              <p className="mt-1 text-[14px] tabular-nums text-zinc-400">Year 0 utilization {year0.utilization}</p>
            )}
          </div>
        )}

        {mode === 'beam' && (
          <button type="button" className={northCtaClass} onClick={() => void compute()} disabled={busy || !known}>
            Compute
          </button>
        )}
      </div>
    </LensShell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-[13px] text-zinc-500">
      {label}
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px] text-zinc-100" />
    </label>
  );
}
