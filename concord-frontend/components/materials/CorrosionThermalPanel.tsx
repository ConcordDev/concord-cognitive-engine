'use client';

/**
 * CorrosionThermalPanel — corrosion + thermal analyzer for the
 * materials lens. Wires materials.corrosionRisk + materials.thermalAnalysis.
 *
 * Refactored to use `CalcPanel` primitive. See
 * `concord-frontend/components/lens-primitives/CalcPanel.tsx`.
 */

import { useState } from 'react';
import { Cog, Droplet, Thermometer } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface CorrosionInput { name: string; category: 'metal' | 'polymer' | 'ceramic' | 'composite' | 'semiconductor' | 'biomaterial'; environment: 'indoor' | 'outdoor' | 'marine' | 'chemical' | 'industrial' | 'underground'; temperature: number | ''; humidity: number | '' }
interface ThermalInput { thermalConductivity: number; meltingPoint: number; thermalExpansion: number; operatingTemp: number | ''; application: string }
interface CorrosionResult {
  material?: string;
  corrosionResistance?: number | null;
  riskLevel?: string | null;
  protectionMethods?: string[];
  estimatedLifespan?: string | null;
  reason?: string | null;
  unavailable?: string[];
  message?: string;
  status?: string;
}
interface ThermalResult {
  status?: string;
  missingInputs?: string[];
  message?: string;
  thermalClass?: string;
  /** Server reports the margin as a "NN%" string in `safetyMargin`; numeric form accepted too. */
  safetyMargin?: string;
  safetyMarginPercent?: number | null;
  isSafe?: boolean | null;
  suitability?: Record<string, string>;
  warnings?: string[];
  recommendations?: string[];
}

const MISSING_INPUT_LABELS: Record<string, string> = { operatingTemp: 'operating temperature' };

/** The safety margin as a finite number, or null when the server did not compute one. */
function marginPercentOf(t: ThermalResult): number | null {
  const n = typeof t.safetyMarginPercent === 'number' ? t.safetyMarginPercent : parseFloat(t.safetyMargin ?? '');
  return Number.isFinite(n) ? n : null;
}

/** Why the thermal analysis has no verdict, or null when it has one. */
function thermalNotRecorded(t: ThermalResult): string | null {
  if (t.status !== 'NOT_COMPUTED' && marginPercentOf(t) !== null) return null;
  const missing = (t.missingInputs ?? []).map((k) => MISSING_INPUT_LABELS[k] ?? k);
  if (missing.length) return `Not recorded: ${missing.join(', ')}`;
  return t.message || 'Not recorded';
}

/** SAFE / AT-RISK only when there is a real margin and a real verdict. */
function thermalVerdict(t: ThermalResult): 'SAFE' | 'AT-RISK' | null {
  if (marginPercentOf(t) === null || typeof t.isSafe !== 'boolean') return null;
  return t.isSafe ? 'SAFE' : 'AT-RISK';
}

const CATEGORIES = ['metal', 'polymer', 'ceramic', 'composite', 'semiconductor', 'biomaterial'] as const;
const ENVS = ['indoor', 'outdoor', 'marine', 'chemical', 'industrial', 'underground'] as const;
const APPS = ['general', 'heat-sink', 'insulation', 'high-temp', 'cryogenic'];

const riskColour = (score?: number | null) => {
  if (score == null || !Number.isFinite(score)) return 'text-zinc-400';
  if (score >= 75) return 'text-emerald-200';
  if (score >= 50) return 'text-amber-200';
  return 'text-rose-200';
};
const suitColour = (s?: string) => {
  if (!s) return 'text-zinc-400';
  if (s === 'excellent' || s === 'suitable') return 'text-emerald-300';
  if (s === 'good') return 'text-sky-300';
  if (s === 'poor' || s === 'not-recommended') return 'text-rose-300';
  return 'text-amber-300';
};

export function CorrosionThermalPanel() {
  const [corrosion, setCorrosion] = useState<CorrosionInput>({ name: '', category: 'metal', environment: 'indoor', temperature: '', humidity: '' });
  const [thermal, setThermal] = useState<ThermalInput>({ thermalConductivity: 0, meltingPoint: 0, thermalExpansion: 0, operatingTemp: '', application: 'general' });

  return (
    <CalcPanel<CorrosionResult, ThermalResult>
      title="Corrosion + thermal analyzer"
      domain="materials"
      icon={<Cog className="h-5 w-5 text-orange-400" />}
      macroBadge="materials.corrosionRisk + thermalAnalysis"
      accent="orange"
      left={{
        macro: 'corrosionRisk',
        buildArtifact: () => ({ data: corrosion }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Droplet className="h-3 w-3" />Corrosion inputs</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block col-span-2"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Material name</span>
                <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={corrosion.name} onChange={(e) => setCorrosion({ ...corrosion, name: e.target.value })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Category</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={corrosion.category} onChange={(e) => setCorrosion({ ...corrosion, category: e.target.value as CorrosionInput['category'] })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Environment</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={corrosion.environment} onChange={(e) => setCorrosion({ ...corrosion, environment: e.target.value as CorrosionInput['environment'] })}>
                  {ENVS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Temperature (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={corrosion.temperature} onChange={(e) => setCorrosion({ ...corrosion, temperature: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Humidity (%)</span>
                <input type="number" min={0} max={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={corrosion.humidity} onChange={(e) => {
                  const v = e.target.value;
                  setCorrosion({ ...corrosion, humidity: v === '' ? '' : Math.max(0, Math.min(100, Number(v))) });
                }} /></label>
            </div>
          </div>
        ),
      }}
      right={{
        macro: 'thermalAnalysis',
        buildArtifact: () => ({ data: thermal }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Thermometer className="h-3 w-3" />Thermal inputs</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Thermal cond. (W/mK)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.thermalConductivity} onChange={(e) => setThermal({ ...thermal, thermalConductivity: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Melting point (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.meltingPoint} onChange={(e) => setThermal({ ...thermal, meltingPoint: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Thermal exp. (µm/m·K)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.thermalExpansion} onChange={(e) => setThermal({ ...thermal, thermalExpansion: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Operating temp (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.operatingTemp} onChange={(e) => setThermal({ ...thermal, operatingTemp: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
              <label className="block col-span-2"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Application</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={thermal.application} onChange={(e) => setThermal({ ...thermal, application: e.target.value })}>
                  {APPS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select></label>
            </div>
          </div>
        ),
      }}
      renderResults={(corResult, thermResult) => (
        <>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Droplet className="h-3 w-3" />Corrosion resistance</div>
            {!corResult && <div className="text-[11px] text-zinc-400">Analyze to score.</div>}
            {corResult && corResult.corrosionResistance == null && (
              <p className="text-[11px] text-zinc-400">
                {corResult.message
                  || (corResult.unavailable?.length ? `Not recorded: ${corResult.unavailable.join(', ')}` : null)
                  || '—'}
              </p>
            )}
            {corResult && corResult.corrosionResistance != null && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-3xl ${riskColour(corResult.corrosionResistance)}`}>{corResult.corrosionResistance}</span>
                  <span className="text-zinc-400">/100</span>
                </div>
                <div className={`inline-block rounded px-2 py-0.5 text-[10px] ${corResult.corrosionResistance >= 75 ? 'bg-emerald-500/20 text-emerald-200' : corResult.corrosionResistance >= 50 ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-500/20 text-rose-200'}`}>{corResult.riskLevel}</div>
                {corResult.estimatedLifespan != null && (
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                    <div className="text-[9px] text-zinc-400">Estimated service life</div>
                    <div className="font-mono text-blue-200">{corResult.estimatedLifespan}</div>
                  </div>
                )}
                {corResult.protectionMethods && corResult.protectionMethods.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                    {corResult.protectionMethods.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Thermometer className="h-3 w-3" />Thermal profile</div>
            {!thermResult && <div className="text-[11px] text-zinc-400">Analyze to evaluate.</div>}
            {thermResult && thermalNotRecorded(thermResult) && (
              <p className="text-[11px] text-zinc-400">{thermalNotRecorded(thermResult)}</p>
            )}
            {thermResult && !thermalNotRecorded(thermResult) && (
              <div className="space-y-2 text-[11px]">
                <div className={`inline-block rounded px-2 py-0.5 text-[10px] font-mono ${thermResult.thermalClass === 'excellent-conductor' ? 'bg-orange-500/20 text-orange-200' : 'bg-zinc-800 text-zinc-300'}`}>{thermResult.thermalClass}</div>
                <div className={`text-[10px] ${thermalVerdict(thermResult) === 'SAFE' ? 'text-emerald-300' : thermalVerdict(thermResult) === 'AT-RISK' ? 'text-rose-300' : 'text-zinc-400'}`}>
                  Safety margin: {marginPercentOf(thermResult)}%{thermalVerdict(thermResult) && ` — ${thermalVerdict(thermResult)}`}
                </div>
                {thermResult.suitability && (
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(thermResult.suitability).map(([k, v]) => (
                      <div key={k} className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                        <div className="text-[9px] text-zinc-400">{k}</div>
                        <div className={`font-mono ${suitColour(v)}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                {thermResult.warnings && thermResult.warnings.length > 0 && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">
                    {thermResult.warnings.map((w, i) => <div key={i} className="text-amber-200">⚠ {w}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-materials-corrosion-thermal',
        title: (cor, therm) => `${corrosion.name} — corrosion ${cor.corrosionResistance ?? '—'} · thermal ${therm.thermalClass ?? '—'}`,
        content: (cor, therm) => {
          const notRecorded = thermalNotRecorded(therm);
          const verdict = thermalVerdict(therm);
          const thermalLines = notRecorded
            ? `  ${notRecorded}`
            : `  Class: ${therm.thermalClass}\n  Safety margin: ${marginPercentOf(therm)}%${verdict ? ` (${verdict})` : ''}\n  Suitability:\n${Object.entries(therm.suitability || {}).map(([k, v]) => `    ${k}: ${v}`).join('\n')}\n${(therm.warnings || []).map((w) => `  ⚠ ${w}`).join('\n')}`;
          return `Corrosion (${corrosion.name} in ${corrosion.environment}):\n  Resistance: ${cor.corrosionResistance ?? '—'}/100 (${cor.riskLevel ?? '—'})\n  Estimated life: ${cor.estimatedLifespan ?? '—'}\n${(cor.protectionMethods || []).map((r) => `  • ${r}`).join('\n')}\n\nThermal (operating ${thermal.operatingTemp === '' ? '—' : thermal.operatingTemp}°C, app=${thermal.application}):\n${thermalLines}`;
        },
        tags: () => ['materials', corrosion.category, corrosion.environment],
        rawData: (cor, therm) => ({ corrosion, thermal, corResult: cor, thermResult: therm }),
      }}
    />
  );
}
