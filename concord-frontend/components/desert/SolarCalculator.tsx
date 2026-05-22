'use client';

/**
 * SolarCalculator — solar-installation sizing via desert.solarInstall.
 * Sizes a PV array by target daily load OR a fixed panel count and
 * reports yield, footprint, battery, and CO2-avoided estimates.
 */

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Sun, Zap, Battery, Maximize, Leaf } from 'lucide-react';

interface SolarResult {
  sizedFor: string;
  latitude: number;
  peakSunHours: number;
  panelCount: number;
  panelWatt: number;
  arrayKw: number;
  systemLossFactor: number;
  dailyKwh: number;
  annualKwh: number;
  annualMwh: number;
  arrayAreaM2: number;
  footprintM2: number;
  footprintAcres: number;
  batteryKwhRecommended: number;
  co2AvoidedKgYr: number;
  homesEquivalent: number;
  rating: string;
}

export function SolarCalculator() {
  const [mode, setMode] = useState<'load' | 'panels'>('load');
  const [latitude, setLatitude] = useState('25');
  const [targetDailyKwh, setTargetDailyKwh] = useState('30');
  const [panelCount, setPanelCount] = useState('20');
  const [panelWatt, setPanelWatt] = useState('450');
  const [autonomyDays, setAutonomyDays] = useState('1');
  const [result, setResult] = useState<SolarResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const compute = useCallback(async () => {
    setErr(null);
    const lat = Number(latitude);
    if (!Number.isFinite(lat)) {
      setErr('Latitude required');
      return;
    }
    const params: Record<string, unknown> = {
      latitude: lat,
      panelWatt: Number(panelWatt) || 450,
      autonomyDays: Number(autonomyDays) || 1,
    };
    if (mode === 'load') params.targetDailyKwh = Number(targetDailyKwh) || 0;
    else params.panelCount = Number(panelCount) || 0;
    setBusy(true);
    const r = await lensRun<SolarResult>('desert', 'solarInstall', params);
    setBusy(false);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data?.error || 'Calculation failed');
  }, [mode, latitude, targetDailyKwh, panelCount, panelWatt, autonomyDays]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Solar-installation calculator</h3>
        </div>
        <div className="flex gap-1 bg-zinc-950 rounded p-1 w-fit">
          <button
            onClick={() => setMode('load')}
            className={`px-3 py-1 rounded text-xs ${mode === 'load' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}
          >
            Size by load
          </button>
          <button
            onClick={() => setMode('panels')}
            className={`px-3 py-1 rounded text-xs ${mode === 'panels' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}
          >
            Fixed panel count
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="Latitude °" value={latitude} onChange={setLatitude} />
          {mode === 'load' ? (
            <Field label="Target kWh/day" value={targetDailyKwh} onChange={setTargetDailyKwh} />
          ) : (
            <Field label="Panel count" value={panelCount} onChange={setPanelCount} />
          )}
          <Field label="Panel watt" value={panelWatt} onChange={setPanelWatt} />
          <Field label="Autonomy days" value={autonomyDays} onChange={setAutonomyDays} />
        </div>
        <button
          onClick={compute}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3 py-1.5 text-xs text-white"
        >
          <Zap className="h-3.5 w-3.5" /> Calculate
        </button>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>

      {result && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">
              {result.arrayKw} kW array · {result.panelCount} panels
            </span>
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">{result.rating}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric icon={<Sun className="h-4 w-4 text-yellow-400" />} label="Peak sun" value={`${result.peakSunHours} h`} />
            <Metric icon={<Zap className="h-4 w-4 text-amber-400" />} label="Daily yield" value={`${result.dailyKwh} kWh`} />
            <Metric icon={<Zap className="h-4 w-4 text-orange-400" />} label="Annual" value={`${result.annualMwh} MWh`} />
            <Metric icon={<Battery className="h-4 w-4 text-green-400" />} label="Battery" value={`${result.batteryKwhRecommended} kWh`} />
            <Metric icon={<Maximize className="h-4 w-4 text-cyan-400" />} label="Footprint" value={`${result.footprintM2} m²`} />
            <Metric icon={<Maximize className="h-4 w-4 text-cyan-400" />} label="Acres" value={`${result.footprintAcres}`} />
            <Metric icon={<Leaf className="h-4 w-4 text-green-400" />} label="CO₂ avoided/yr" value={`${result.co2AvoidedKgYr} kg`} />
            <Metric icon={<Sun className="h-4 w-4 text-amber-400" />} label="Homes equiv." value={`${result.homesEquivalent}`} />
          </div>
          <p className="text-xs text-zinc-500">
            Sized for {result.sizedFor} at {result.latitude}° latitude · system loss factor {result.systemLossFactor}.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
      />
    </label>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-base text-white">{value}</div>
    </div>
  );
}
