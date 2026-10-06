'use client';

/**
 * DuctDesigner — size a duct run (hvac.ductulator: Darcy-Weisbach +
 * Colebrook friction, standard air, Huebscher rectangular equivalence) and
 * check a hanger spacing for it (hvac.hangerSpanCheck: beam-frame FEA over
 * the real hollow duct-wall section, self-weight + insulation load) from one
 * set of inputs. Every number shown is the engine's own output.
 */

import { useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Ruler, Wind, XCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DuctResult {
  equivalentRoundDiameterIn: number; nearestStandardRoundIn: number; velocityFpm: number; velocityAtStandardSizeFpm: number;
  frictionRatePer100ft: number; frictionAtStandardSizePer100ft: number; velocityBand: string; recommendation: string;
  rectangular?: { nominalSize: string; aspectRatio: number; actualVelocityFpm: number };
  warnings?: string[];
}
interface HangerResult {
  pass: boolean; maxDeflectionIn: number; allowableDeflectionIn: number; deflectionRatio: string; actualRatio: string;
  selfWeightLbPerFt: number; totalLoadLbPerFt: number; maxUtilization: number; recommendation: string;
}

const input = 'w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-white focus:border-sky-400/50 focus:outline-none';

function F({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-[11px] text-zinc-400">{label}{children}</label>;
}

export function DuctDesigner() {
  const [f, setF] = useState({
    cfm: '800', shape: 'round', method: 'velocity', velocityFpm: '900', frictionRate: '0.1', material: 'galvanized',
    lengthFt: '20', wallThicknessIn: '0.0276', spanFt: '8', insulationLbPerFt: '0.5', deflectionLimitRatio: '360',
  });
  const [duct, setDuct] = useState<DuctResult | null>(null);
  const [hanger, setHanger] = useState<HangerResult | null>(null);
  const [busy, setBusy] = useState<'duct' | 'hanger' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const payload = () => ({
    cfm: Number(f.cfm), shape: f.shape, method: f.method, velocityFpm: Number(f.velocityFpm), frictionRate: Number(f.frictionRate),
    material: f.material, lengthFt: Number(f.lengthFt), wallThicknessIn: Number(f.wallThicknessIn),
  });

  const size = async () => {
    setBusy('duct'); setError(null);
    try {
      const r = await lensRun<DuctResult>('hvac', 'ductulator', payload());
      if (!r.data.ok || !r.data.result) { setDuct(null); setError(r.data.error || 'Sizing failed.'); } else setDuct(r.data.result);
    } finally { setBusy(null); }
  };
  const check = async () => {
    setBusy('hanger'); setError(null);
    try {
      const r = await lensRun<HangerResult>('hvac', 'hangerSpanCheck', {
        ...payload(), spanFt: Number(f.spanFt), insulationLbPerFt: Number(f.insulationLbPerFt), deflectionLimitRatio: Number(f.deflectionLimitRatio),
      });
      if (!r.data.ok || !r.data.result) { setHanger(null); setError(r.data.error || 'Hanger check failed.'); } else setHanger(r.data.result);
    } finally { setBusy(null); }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><Wind className="h-4 w-4 text-sky-300" /> Duct designer</h3>
      <p className="mb-3 mt-1 text-xs text-zinc-500">Size by design velocity or friction rate, then check hanger spacing for the size you get.</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <F label="Airflow (CFM)"><input type="number" value={f.cfm} onChange={set('cfm')} className={input} /></F>
        <F label="Shape"><select value={f.shape} onChange={set('shape')} className={input}><option value="round">Round</option><option value="rectangular">Rectangular</option></select></F>
        <F label="Size by"><select value={f.method} onChange={set('method')} className={input}><option value="velocity">Velocity</option><option value="friction">Friction rate</option></select></F>
        {f.method === 'velocity'
          ? <F label="Velocity (fpm)"><input type="number" value={f.velocityFpm} onChange={set('velocityFpm')} className={input} /></F>
          : <F label="Friction (in.wg/100ft)"><input type="number" step="0.01" value={f.frictionRate} onChange={set('frictionRate')} className={input} /></F>}
        <F label="Material"><select value={f.material} onChange={set('material')} className={input}><option value="galvanized">Galvanized steel</option><option value="smooth">PVC / smooth aluminum</option><option value="flexible">Flex (extended)</option></select></F>
        <F label="Run length (ft)"><input type="number" value={f.lengthFt} onChange={set('lengthFt')} className={input} /></F>
      </div>
      <div className="mt-3">
        <button type="button" onClick={() => void size()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-4 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/30 disabled:opacity-50">
          {busy === 'duct' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wind className="h-3.5 w-3.5" />} Size duct
        </button>
      </div>

      {duct && (
        <div className="mt-3 rounded-xl border border-sky-400/20 bg-sky-500/5 p-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="text-sm text-zinc-200"><span className="font-mono text-2xl text-sky-200">{duct.rectangular ? duct.rectangular.nominalSize : `${duct.nearestStandardRoundIn}"`}</span> {duct.rectangular ? 'rectangular' : 'round'}</p>
            <p className="text-xs text-zinc-400">{duct.velocityAtStandardSizeFpm} fpm · {duct.frictionAtStandardSizePer100ft} in.wg/100ft at standard size · <span className="capitalize">{duct.velocityBand}</span></p>
          </div>
          <p className="mt-1 text-xs text-zinc-400">{duct.recommendation}</p>
          {duct.warnings?.map((w) => <p key={w} className="mt-1 text-xs text-amber-300">{w}</p>)}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/5 pt-4 sm:grid-cols-4">
        <F label="Hanger spacing (ft)"><input type="number" value={f.spanFt} onChange={set('spanFt')} className={input} /></F>
        <F label="Insulation (lb/ft)"><input type="number" step="0.1" value={f.insulationLbPerFt} onChange={set('insulationLbPerFt')} className={input} /></F>
        <F label="Deflection limit L/"><input type="number" value={f.deflectionLimitRatio} onChange={set('deflectionLimitRatio')} className={input} /></F>
        <F label="Wall thickness (in)"><input type="number" step="0.001" value={f.wallThicknessIn} onChange={set('wallThicknessIn')} className={input} /></F>
      </div>
      <div className="mt-3">
        <button type="button" onClick={() => void check()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-zinc-100 transition-colors hover:bg-white/15 disabled:opacity-50">
          {busy === 'hanger' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ruler className="h-3.5 w-3.5" />} Check hangers
        </button>
      </div>
      {hanger && (
        <div className={cn('mt-3 rounded-xl border p-3', hanger.pass ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-rose-400/30 bg-rose-500/5')}>
          <p className={cn('flex items-center gap-2 text-sm font-semibold', hanger.pass ? 'text-emerald-200' : 'text-rose-200')}>
            {hanger.pass ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {hanger.maxDeflectionIn}&quot; sag vs {hanger.allowableDeflectionIn}&quot; allowed ({hanger.actualRatio} against {hanger.deflectionRatio})
          </p>
          <p className="mt-1 text-xs text-zinc-400">Load {hanger.totalLoadLbPerFt.toFixed(2)} lb/ft (duct {hanger.selfWeightLbPerFt.toFixed(2)} lb/ft) · stress utilization {(hanger.maxUtilization * 100).toFixed(1)}%</p>
          <p className="mt-1 text-xs text-zinc-400">{hanger.recommendation}</p>
          <p className="mt-1 text-[10px] text-zinc-500">A serviceability screen, not a code check: confirm against SMACNA and local code for your pressure class.</p>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-rose-400">{error.replace(/_/g, ' ')}</p>}
    </section>
  );
}
