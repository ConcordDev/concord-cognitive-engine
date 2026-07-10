'use client';

/**
 * DesertFieldCalcPanel — two quick field calculators wiring the four
 * desert pure-compute macros that had no UI: desert.waterBudget +
 * desert.heatStressIndex (water/heat safety planning for a survey
 * area) and desert.terrainClassification + desert.solarPotential
 * (site characterization for a candidate camp/installation site).
 *
 * Distinct from ExpeditionPlanner (per-leg route water budgets),
 * HeatUvAlerts (live tracked-location UV/heat alerts), TerrainOverlay
 * (multi-sample terrain-class distribution) and SolarCalculator
 * (PV-array sizing) — those are live/persistent workflows; these are
 * one-shot regional estimators for early planning.
 */

import { useState } from 'react';
import { Droplets, Thermometer, Mountain, Sun } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface WaterBudgetInput { annualRainfallMm: number; evaporationMm: number; areaHectares: number }
interface HeatStressInput { temperatureCelsius: number; humidityPercent: number; windSpeedKmh: number }
interface WaterBudgetResult {
  annualRainfall?: string; evaporationRate?: string; area?: string;
  waterInflow?: string; waterLoss?: string; netBalance?: string;
  deficit?: boolean; aridity?: string; irrigationNeeded?: string;
}
interface HeatStressResult {
  temperature?: string; humidity?: string; windSpeed?: string;
  heatIndex?: number; riskLevel?: string; recommendations?: string[];
}

interface TerrainInput { elevationMeters: number; soilType: string; vegetationCoverPercent: number; slopePercent: number }
interface SolarInput { latitude: number; clearDaysPerYear: number; areaAcres: number }
interface TerrainResult {
  classification?: string; elevation?: string; soilType?: string; vegetationCover?: string;
  slope?: string; traversability?: string; ecosystem?: string; habitability?: string;
}
interface SolarResult {
  latitude?: number; clearDaysPerYear?: number; dailyIrradiance?: string; annualIrradiance?: string;
  solarArea?: string; annualOutputMWh?: number; homesEquivalent?: number; potential?: string;
}

const SOIL_TYPES = ['sand', 'rock', 'gravel', 'salt', 'clay'];

const riskColour = (risk?: string) => {
  if (risk === 'extreme-danger' || risk === 'danger') return 'text-rose-200';
  if (risk === 'extreme-caution' || risk === 'caution') return 'text-amber-200';
  return 'text-emerald-200';
};

function WaterHeatPanel() {
  const [water, setWater] = useState<WaterBudgetInput>({ annualRainfallMm: 250, evaporationMm: 2000, areaHectares: 100 });
  const [heat, setHeat] = useState<HeatStressInput>({ temperatureCelsius: 40, humidityPercent: 20, windSpeedKmh: 10 });

  return (
    <CalcPanel<WaterBudgetResult, HeatStressResult>
      title="Water & heat safety planner"
      domain="desert"
      icon={<Droplets className="h-5 w-5 text-sky-400" />}
      macroBadge="desert.waterBudget + heatStressIndex"
      accent="sky"
      left={{
        macro: 'waterBudget',
        buildArtifact: () => ({ data: water }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Droplets className="h-3 w-3" />Survey area water budget</div>
            <div className="grid grid-cols-1 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Annual rainfall (mm)</span>
                <input type="number" min={0} max={2000} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={water.annualRainfallMm} onChange={(e) => setWater({ ...water, annualRainfallMm: Math.max(0, Number(e.target.value) || 0) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Evaporation (mm/yr)</span>
                <input type="number" min={0} max={5000} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={water.evaporationMm} onChange={(e) => setWater({ ...water, evaporationMm: Math.max(0, Number(e.target.value) || 0) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Survey area (hectares)</span>
                <input type="number" min={1} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={water.areaHectares} onChange={(e) => setWater({ ...water, areaHectares: Math.max(1, Number(e.target.value) || 1) })} /></label>
            </div>
          </div>
        ),
      }}
      right={{
        macro: 'heatStressIndex',
        buildArtifact: () => ({ data: heat }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Thermometer className="h-3 w-3" />Heat stress at midday</div>
            <div className="grid grid-cols-1 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Temperature (&deg;C)</span>
                <input type="number" min={-10} max={60} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={heat.temperatureCelsius} onChange={(e) => setHeat({ ...heat, temperatureCelsius: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Humidity (%)</span>
                <input type="number" min={0} max={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={heat.humidityPercent} onChange={(e) => setHeat({ ...heat, humidityPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Wind speed (km/h)</span>
                <input type="number" min={0} max={150} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={heat.windSpeedKmh} onChange={(e) => setHeat({ ...heat, windSpeedKmh: Math.max(0, Number(e.target.value) || 0) })} /></label>
            </div>
          </div>
        ),
      }}
      renderResults={(w, h) => (
        <>
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Droplets className="h-3 w-3" />Water budget</div>
            {!w && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {w && (
              <div className="space-y-1.5 text-[11px]">
                <div className={`font-mono text-lg ${w.deficit ? 'text-rose-200' : 'text-emerald-200'}`}>{w.netBalance}</div>
                <div className="text-zinc-400">{w.aridity} · inflow {w.waterInflow} · loss {w.waterLoss}</div>
                <div className="rounded border border-sky-500/15 bg-zinc-950/40 px-2 py-1 text-[10px] text-zinc-300">{w.irrigationNeeded}</div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Thermometer className="h-3 w-3" />Heat stress index</div>
            {!h && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {h && (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-2xl ${riskColour(h.riskLevel)}`}>{h.heatIndex}</span>
                  <span className="text-zinc-400 uppercase tracking-wide">{h.riskLevel}</span>
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-[10px] text-zinc-400">
                  {(h.recommendations || []).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-desert-water-heat',
        title: (w, h) => `Field prep — ${w.aridity ?? '—'} · heat ${h.riskLevel ?? '—'}`,
        content: (w, h) => `Water budget:\n  ${w.annualRainfall} rainfall, ${w.evaporationRate} evaporation over ${w.area}\n  Net balance: ${w.netBalance} (${w.aridity})\n  ${w.irrigationNeeded}\n\nHeat stress:\n  ${h.temperature} / ${h.humidity} / ${h.windSpeed} wind\n  Heat index: ${h.heatIndex} — ${h.riskLevel}\n  ${(h.recommendations || []).map((r) => `  • ${r}`).join('\n')}`,
        tags: () => ['desert', 'water-budget', 'heat-stress', 'field-prep'],
        rawData: (w, h) => ({ water, heat, waterResult: w, heatResult: h }),
      }}
    />
  );
}

function TerrainSolarPanel() {
  const [terrain, setTerrain] = useState<TerrainInput>({ elevationMeters: 500, soilType: 'sand', vegetationCoverPercent: 5, slopePercent: 2 });
  const [solar, setSolar] = useState<SolarInput>({ latitude: 25, clearDaysPerYear: 300, areaAcres: 10 });

  return (
    <CalcPanel<TerrainResult, SolarResult>
      title="Terrain & solar-site survey"
      domain="desert"
      icon={<Mountain className="h-5 w-5 text-amber-400" />}
      macroBadge="desert.terrainClassification + solarPotential"
      accent="amber"
      left={{
        macro: 'terrainClassification',
        buildArtifact: () => ({ data: terrain }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Mountain className="h-3 w-3" />Site terrain</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Elevation (m)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={terrain.elevationMeters} onChange={(e) => setTerrain({ ...terrain, elevationMeters: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Soil type</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={terrain.soilType} onChange={(e) => setTerrain({ ...terrain, soilType: e.target.value })}>
                  {SOIL_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Vegetation cover (%)</span>
                <input type="number" min={0} max={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={terrain.vegetationCoverPercent} onChange={(e) => setTerrain({ ...terrain, vegetationCoverPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Slope (%)</span>
                <input type="number" min={0} max={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={terrain.slopePercent} onChange={(e) => setTerrain({ ...terrain, slopePercent: Math.max(0, Number(e.target.value) || 0) })} /></label>
            </div>
          </div>
        ),
      }}
      right={{
        macro: 'solarPotential',
        buildArtifact: () => ({ data: solar }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Sun className="h-3 w-3" />Regional solar potential</div>
            <div className="grid grid-cols-1 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Latitude</span>
                <input type="number" min={-60} max={60} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={solar.latitude} onChange={(e) => setSolar({ ...solar, latitude: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Clear days/year</span>
                <input type="number" min={0} max={365} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={solar.clearDaysPerYear} onChange={(e) => setSolar({ ...solar, clearDaysPerYear: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Array area (acres)</span>
                <input type="number" min={0.1} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={solar.areaAcres} onChange={(e) => setSolar({ ...solar, areaAcres: Math.max(0.1, Number(e.target.value) || 0.1) })} /></label>
            </div>
          </div>
        ),
      }}
      renderResults={(t, s) => (
        <>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Mountain className="h-3 w-3" />Terrain classification</div>
            {!t && <div className="text-[11px] text-zinc-400">Analyze to classify.</div>}
            {t && (
              <div className="space-y-1.5 text-[11px]">
                <div className="font-mono text-lg text-amber-200 capitalize">{t.classification}</div>
                <div className="text-zinc-400">{t.ecosystem} · traversability: {t.traversability}</div>
                <div className="text-zinc-400">habitability: {t.habitability}</div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Sun className="h-3 w-3" />Solar potential</div>
            {!s && <div className="text-[11px] text-zinc-400">Analyze to estimate.</div>}
            {s && (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl text-yellow-200">{s.annualOutputMWh}</span>
                  <span className="text-zinc-400">MWh/yr &middot; {s.potential}</span>
                </div>
                <div className="text-zinc-400">{s.dailyIrradiance}/day &middot; {s.solarArea} &middot; ~{s.homesEquivalent} homes equivalent</div>
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-desert-terrain-solar',
        title: (t, s) => `Site survey — ${t.classification ?? '—'} · ${s.annualOutputMWh ?? '—'} MWh/yr`,
        content: (t, s) => `Terrain:\n  ${t.classification} at ${t.elevation}, ${t.soilType} soil, ${t.vegetationCover} vegetation, slope ${t.slope}\n  Traversability: ${t.traversability} · Ecosystem: ${t.ecosystem} · Habitability: ${t.habitability}\n\nSolar:\n  ${s.dailyIrradiance}/day over ${s.clearDaysPerYear} clear days at lat ${s.latitude}\n  Array: ${s.solarArea} → ${s.annualOutputMWh} MWh/yr (${s.potential}, ~${s.homesEquivalent} homes equivalent)`,
        tags: () => ['desert', 'terrain', 'solar-siting'],
        rawData: (t, s) => ({ terrain, solar, terrainResult: t, solarResult: s }),
      }}
    />
  );
}

export function DesertFieldCalcPanel() {
  return (
    <div className="space-y-6">
      <WaterHeatPanel />
      <div className="border-t border-zinc-800 pt-6">
        <TerrainSolarPanel />
      </div>
    </div>
  );
}
