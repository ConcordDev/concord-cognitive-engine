'use client';

/**
 * BiomePreview — visual biome / climate preview before committing a
 * world. Pulls the climate day-curve + hazard forecast from the
 * `world-creator.biome-preview` macro and renders a palette swatch,
 * a temperature/light line chart, and a hazard readout.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface ClimatePoint { hour: number; temperatureC: number; lightPct: number; }
interface PreviewResult {
  biome: string;
  label: string;
  palette: string[];
  baseTemperatureC: number;
  baseHumidityPct: number;
  baseLightPct: number;
  hazard: string;
  growthMultiplier: number;
  climateCurve: ClimatePoint[];
  stormChancePct: number;
  summary: string;
}

const HAZARD_TONE: Record<string, string> = {
  low: 'text-emerald-300', medium: 'text-amber-300',
  high: 'text-orange-300', extreme: 'text-red-300',
};

export function BiomePreview({ biome, weatherIntensity }: { biome: string; weatherIntensity: number }) {
  const [data, setData] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!biome) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    lensRun<PreviewResult>('world-creator', 'biome-preview', { biome, weatherIntensity })
      .then(r => {
        if (cancelled) return;
        if (r.data?.ok && r.data.result) setData(r.data.result);
        else setErr(r.data?.error || 'preview unavailable');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [biome, weatherIntensity]);

  if (loading && !data) {
    return <div className="rounded border border-stone-800 bg-stone-950 p-4 text-xs text-stone-500">Loading biome preview…</div>;
  }
  if (err) {
    return <div className="rounded border border-red-800 bg-red-950/40 p-3 text-xs text-red-300">{err}</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-3 rounded-lg border border-stone-800 bg-stone-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-100">{data.label}</h3>
        <span className={`text-xs font-medium ${HAZARD_TONE[data.hazard] || 'text-stone-400'}`}>
          {data.hazard} hazard
        </span>
      </div>

      {/* palette swatch */}
      <div className="flex gap-1.5">
        {data.palette.map((c, i) => (
          <div key={i} className="h-8 flex-1 rounded" style={{ background: c }} title={c} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Base temp" value={`${data.baseTemperatureC}°C`} />
        <Stat label="Humidity" value={`${data.baseHumidityPct}%`} />
        <Stat label="Growth" value={`${data.growthMultiplier.toFixed(1)}×`} />
      </div>

      {/* day-cycle climate curve */}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-stone-500">Day-cycle climate</div>
        <ChartKit
          kind="line"
          height={140}
          xKey="hourLabel"
          data={data.climateCurve.map(p => ({
            hourLabel: `${p.hour}h`,
            temperatureC: p.temperatureC,
            lightPct: p.lightPct,
          }))}
          series={[
            { key: 'temperatureC', label: 'Temp °C', color: '#f97316' },
            { key: 'lightPct', label: 'Light %', color: '#facc15' },
          ]}
        />
      </div>

      <div className="rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
        Storm chance: <strong>{data.stormChancePct}%</strong> at current weather intensity.
      </div>
      <p className="text-[11px] text-stone-500">{data.summary}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-stone-800 bg-stone-900 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-stone-200">{value}</div>
    </div>
  );
}
