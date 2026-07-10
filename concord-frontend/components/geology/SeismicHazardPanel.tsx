'use client';

/**
 * SeismicHazardPanel — site seismic-hazard bench for the geology lens.
 * Wires geology.seismicRisk (a deterministic amplification-factor
 * heuristic — no external call, works anywhere) side-by-side with
 * geology.usgs-seismic-hazard (the REAL USGS DESIGNMAPS ASCE 7-22 web
 * service — US territory only). Both macros had zero UI before this
 * rebuild despite live earthquake data (EarthquakeList/UsgsQuakePanel)
 * already being surfaced elsewhere on the lens.
 */

import { useState } from 'react';
import { ShieldAlert, Building2 } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface RiskResult {
  location?: { lat: number; lon: number }; soilType?: string; amplificationFactor?: number;
  baseSeismicRisk?: number; adjustedRisk?: number; riskLevel?: string; buildingCode?: string; recommendations?: string[];
}
interface DesignResult {
  location?: { lat: number; lng: number }; riskCategory?: number; siteClass?: string;
  ss?: number; s1?: number; sds?: number; sd1?: number; sdc?: string; pga?: number; tl?: number; error?: string;
}

const SOIL_TYPES = ['rock', 'stiff-soil', 'soft-soil', 'very-soft', 'sand', 'clay'];
const SITE_CLASSES = ['A', 'B', 'BC', 'C', 'CD', 'D', 'DE', 'E', 'F'];
const RISK_COLOR: Record<string, string> = { high: 'text-rose-200', moderate: 'text-amber-200', low: 'text-emerald-200' };

export function SeismicHazardPanel() {
  const [lat, setLat] = useState(37.7749);
  const [lon, setLon] = useState(-122.4194);
  const [soilType, setSoilType] = useState('soft-soil');
  const [buildingCode, setBuildingCode] = useState('IBC 2021');
  const [riskCategory, setRiskCategory] = useState(2);
  const [siteClass, setSiteClass] = useState('D');

  return (
    <CalcPanel<RiskResult, DesignResult>
      title="Seismic hazard & site design"
      domain="geology"
      icon={<ShieldAlert className="h-5 w-5 text-red-400" />}
      macroBadge="geology.seismicRisk + usgs-seismic-hazard"
      accent="red"
      left={{
        macro: 'seismicRisk',
        buildArtifact: () => ({ data: { latitude: lat, longitude: lon, soilType, buildingCode } }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><ShieldAlert className="h-3 w-3" />Site (any location)</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Latitude</span>
                <input type="number" step={0.0001} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={lat} onChange={(e) => setLat(Number(e.target.value) || 0)} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Longitude</span>
                <input type="number" step={0.0001} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={lon} onChange={(e) => setLon(Number(e.target.value) || 0)} /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={soilType} onChange={(e) => setSoilType(e.target.value)}>
                {SOIL_TYPES.map((s) => <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>)}
              </select>
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Building code" value={buildingCode} onChange={(e) => setBuildingCode(e.target.value)} />
            </div>
            <p className="text-[9px] text-zinc-500">Deterministic amplification heuristic — works anywhere on Earth, no external call.</p>
          </div>
        ),
      }}
      right={{
        macro: 'usgs-seismic-hazard',
        buildArtifact: () => ({ latitude: lat, longitude: lon, riskCategory, siteClass }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Building2 className="h-3 w-3" />ASCE 7-22 design parameters (US only)</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Risk category</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={riskCategory} onChange={(e) => setRiskCategory(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((r) => <option key={r} value={r}>Category {r}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Site class</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={siteClass} onChange={(e) => setSiteClass(e.target.value)}>
                  {SITE_CLASSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></label>
            </div>
            <p className="text-[9px] text-zinc-500">Live USGS DESIGNMAPS lookup — coverage lat 18–72, lng -180 to -65 (US territory only).</p>
          </div>
        ),
      }}
      renderResults={(riskResult, designResult) => (
        <>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><ShieldAlert className="h-3 w-3" />Site risk</div>
            {!riskResult && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {riskResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-2xl capitalize ${RISK_COLOR[riskResult.riskLevel || 'low']}`}>{riskResult.riskLevel}</span>
                  <span className="text-zinc-400">{riskResult.adjustedRisk}% adjusted risk</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded border border-red-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Amplification</div><div className="font-mono text-red-200">{riskResult.amplificationFactor}×</div></div>
                  <div className="rounded border border-red-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Base risk</div><div className="font-mono text-red-200">{riskResult.baseSeismicRisk}%</div></div>
                </div>
                {!!riskResult.recommendations?.length && (
                  <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                    {riskResult.recommendations.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Building2 className="h-3 w-3" />ASCE 7-22 design spectrum</div>
            {!designResult && <div className="text-[11px] text-zinc-400">Analyze to look up (US locations only).</div>}
            {designResult?.error && <div className="text-[11px] text-amber-300">{designResult.error}</div>}
            {designResult && !designResult.error && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-lg text-blue-200">SDC {designResult.sdc}</span>
                  <span className="text-zinc-400">site class {designResult.siteClass}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded border border-blue-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Sds</div><div className="font-mono text-blue-200">{designResult.sds}</div></div>
                  <div className="rounded border border-blue-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Sd1</div><div className="font-mono text-blue-200">{designResult.sd1}</div></div>
                  <div className="rounded border border-blue-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">PGA</div><div className="font-mono text-blue-200">{designResult.pga}</div></div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-geology-seismic-hazard',
        title: (r, d) => `Seismic hazard — ${r.riskLevel ?? '—'} risk${d?.sdc ? ` · SDC ${d.sdc}` : ''}`,
        content: (r, d) =>
          `Site risk (${r.location?.lat}, ${r.location?.lon}):\n  Level: ${r.riskLevel} (${r.adjustedRisk}% adjusted, ${r.amplificationFactor}× amplification)\n  Soil: ${r.soilType}\n  Recommendations: ${(r.recommendations || []).join('; ')}\n\nASCE 7-22 design:\n  ${d?.error ? d.error : `SDC ${d?.sdc}, Sds=${d?.sds}, Sd1=${d?.sd1}, PGA=${d?.pga}`}`,
        tags: () => ['geology', 'seismic', 'hazard', 'engineering'],
        rawData: (r, d) => ({ lat, lon, soilType, buildingCode, riskCategory, siteClass, riskResult: r, designResult: d }),
      }}
    />
  );
}
