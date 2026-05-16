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

interface CorrosionInput { name: string; category: 'metal' | 'polymer' | 'ceramic' | 'composite' | 'semiconductor' | 'biomaterial'; environment: 'indoor' | 'outdoor' | 'marine' | 'chemical' | 'industrial' | 'underground'; temperature: number; humidity: number }
interface ThermalInput { thermalConductivity: number; meltingPoint: number; thermalExpansion: number; operatingTemp: number; application: string }
interface CorrosionResult { material?: string; resistanceScore?: number; riskClass?: string; recommendations?: string[]; estimatedLifeYears?: number; environmentFactor?: number }
interface ThermalResult { thermalClass?: string; safetyMarginPercent?: number; isSafe?: boolean; suitability?: Record<string, string>; warnings?: string[]; recommendations?: string[] }

const CATEGORIES = ['metal', 'polymer', 'ceramic', 'composite', 'semiconductor', 'biomaterial'] as const;
const ENVS = ['indoor', 'outdoor', 'marine', 'chemical', 'industrial', 'underground'] as const;
const APPS = ['general', 'heat-sink', 'insulation', 'high-temp', 'cryogenic'];

const riskColour = (score?: number) => {
  if (!score) return 'text-zinc-400';
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
  const [corrosion, setCorrosion] = useState<CorrosionInput>({ name: '316L stainless', category: 'metal', environment: 'marine', temperature: 22, humidity: 75 });
  const [thermal, setThermal] = useState<ThermalInput>({ thermalConductivity: 16, meltingPoint: 1400, thermalExpansion: 16, operatingTemp: 200, application: 'high-temp' });

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
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Droplet className="h-3 w-3" />Corrosion inputs</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block col-span-2"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Material name</span>
                <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={corrosion.name} onChange={(e) => setCorrosion({ ...corrosion, name: e.target.value })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Category</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={corrosion.category} onChange={(e) => setCorrosion({ ...corrosion, category: e.target.value as CorrosionInput['category'] })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Environment</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={corrosion.environment} onChange={(e) => setCorrosion({ ...corrosion, environment: e.target.value as CorrosionInput['environment'] })}>
                  {ENVS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Temperature (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={corrosion.temperature} onChange={(e) => setCorrosion({ ...corrosion, temperature: Number(e.target.value) || 25 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Humidity (%)</span>
                <input type="number" min={0} max={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={corrosion.humidity} onChange={(e) => setCorrosion({ ...corrosion, humidity: Math.max(0, Math.min(100, Number(e.target.value) || 50)) })} /></label>
            </div>
          </div>
        ),
      }}
      right={{
        macro: 'thermalAnalysis',
        buildArtifact: () => ({ data: thermal }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Thermometer className="h-3 w-3" />Thermal inputs</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Thermal cond. (W/mK)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.thermalConductivity} onChange={(e) => setThermal({ ...thermal, thermalConductivity: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Melting point (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.meltingPoint} onChange={(e) => setThermal({ ...thermal, meltingPoint: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Thermal exp. (µm/m·K)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.thermalExpansion} onChange={(e) => setThermal({ ...thermal, thermalExpansion: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Operating temp (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={thermal.operatingTemp} onChange={(e) => setThermal({ ...thermal, operatingTemp: Number(e.target.value) || 25 })} /></label>
              <label className="block col-span-2"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Application</span>
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
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Droplet className="h-3 w-3" />Corrosion resistance</div>
            {!corResult && <div className="text-[11px] text-zinc-500">Analyze to score.</div>}
            {corResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-3xl ${riskColour(corResult.resistanceScore)}`}>{corResult.resistanceScore}</span>
                  <span className="text-zinc-500">/100</span>
                </div>
                <div className={`inline-block rounded px-2 py-0.5 text-[10px] ${corResult.resistanceScore && corResult.resistanceScore >= 75 ? 'bg-emerald-500/20 text-emerald-200' : corResult.resistanceScore && corResult.resistanceScore >= 50 ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-500/20 text-rose-200'}`}>{corResult.riskClass}</div>
                {corResult.estimatedLifeYears != null && (
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                    <div className="text-[9px] text-zinc-500">Estimated service life</div>
                    <div className="font-mono text-blue-200">{corResult.estimatedLifeYears} years</div>
                  </div>
                )}
                {corResult.recommendations && corResult.recommendations.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                    {corResult.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Thermometer className="h-3 w-3" />Thermal profile</div>
            {!thermResult && <div className="text-[11px] text-zinc-500">Analyze to evaluate.</div>}
            {thermResult && (
              <div className="space-y-2 text-[11px]">
                <div className={`inline-block rounded px-2 py-0.5 text-[10px] font-mono ${thermResult.thermalClass === 'excellent-conductor' ? 'bg-orange-500/20 text-orange-200' : 'bg-zinc-800 text-zinc-300'}`}>{thermResult.thermalClass}</div>
                <div className={`text-[10px] ${thermResult.isSafe ? 'text-emerald-300' : 'text-rose-300'}`}>Safety margin: {thermResult.safetyMarginPercent}% — {thermResult.isSafe ? 'SAFE' : 'AT-RISK'}</div>
                {thermResult.suitability && (
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(thermResult.suitability).map(([k, v]) => (
                      <div key={k} className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                        <div className="text-[9px] text-zinc-500">{k}</div>
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
        title: (cor, therm) => `${corrosion.name} — corrosion ${cor.resistanceScore ?? '—'} · thermal ${therm.thermalClass ?? '—'}`,
        content: (cor, therm) => `Corrosion (${corrosion.name} in ${corrosion.environment}):\n  Resistance: ${cor.resistanceScore}/100 (${cor.riskClass})\n  Estimated life: ${cor.estimatedLifeYears ?? '—'} years\n${(cor.recommendations || []).map((r) => `  • ${r}`).join('\n')}\n\nThermal (operating ${thermal.operatingTemp}°C, app=${thermal.application}):\n  Class: ${therm.thermalClass}\n  Safety margin: ${therm.safetyMarginPercent}% (${therm.isSafe ? 'SAFE' : 'AT-RISK'})\n  Suitability:\n${Object.entries(therm.suitability || {}).map(([k, v]) => `    ${k}: ${v}`).join('\n')}\n${(therm.warnings || []).map((w) => `  ⚠ ${w}`).join('\n')}`,
        tags: () => ['materials', corrosion.category, corrosion.environment],
        rawData: (cor, therm) => ({ corrosion, thermal, corResult: cor, thermResult: therm }),
      }}
    />
  );
}
