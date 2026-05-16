'use client';

/**
 * WaveEcosystemPanel — wave + marine ecosystem analyzer for the
 * ocean lens. Wires ocean.waveAnalysis + ocean.marineEcosystem.
 *
 * Refactored to use `CalcPanel` primitive. See
 * `concord-frontend/components/lens-primitives/CalcPanel.tsx`.
 */

import { useState } from 'react';
import { Waves, Fish, Plus, Trash2 } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface WaveInput { waveHeightMeters: number; wavePeriodSeconds: number; windSpeedKnots: number }
interface Species { name: string; trophicLevel: 'primary' | 'secondary' | 'tertiary' | 'apex'; threatened: boolean; invasive: boolean }
interface WaveResult { significantWaveHeight?: string; period?: string; wavelength?: string; speed?: string; energyDensity?: string; beaufortScale?: number; seaState?: string; navigationAdvisory?: string }
interface EcoResult { speciesCount?: number; trophicLevels?: Record<string, number>; shannonDiversityIndex?: number; ecosystemHealth?: string; threatened?: number; invasive?: number }

const TROPHIC_LEVELS = ['primary', 'secondary', 'tertiary', 'apex'] as const;

const DEFAULT_SPECIES: Species[] = [
  { name: 'Phytoplankton', trophicLevel: 'primary', threatened: false, invasive: false },
  { name: 'Zooplankton', trophicLevel: 'primary', threatened: false, invasive: false },
  { name: 'Anchovy', trophicLevel: 'secondary', threatened: false, invasive: false },
  { name: 'Mackerel', trophicLevel: 'secondary', threatened: false, invasive: false },
  { name: 'Bluefin tuna', trophicLevel: 'tertiary', threatened: true, invasive: false },
  { name: 'Great white shark', trophicLevel: 'apex', threatened: true, invasive: false },
  { name: 'Lionfish (Atlantic)', trophicLevel: 'tertiary', threatened: false, invasive: true },
];

const healthColour = (h?: string) => {
  if (h === 'thriving') return 'text-emerald-200';
  if (h === 'moderate') return 'text-sky-200';
  if (h === 'stressed') return 'text-amber-200';
  if (h === 'critical') return 'text-rose-200';
  return 'text-zinc-400';
};

export function WaveEcosystemPanel() {
  const [wave, setWave] = useState<WaveInput>({ waveHeightMeters: 2.5, wavePeriodSeconds: 9, windSpeedKnots: 22 });
  const [species, setSpecies] = useState<Species[]>(DEFAULT_SPECIES);

  const addSpecies = () => setSpecies((ss) => [...ss, { name: '', trophicLevel: 'primary', threatened: false, invasive: false }]);
  const updateSpecies = <K extends keyof Species>(i: number, key: K, value: Species[K]) =>
    setSpecies((ss) => ss.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  const removeSpecies = (i: number) => setSpecies((ss) => ss.filter((_, idx) => idx !== i));

  return (
    <CalcPanel<WaveResult, EcoResult>
      title="Wave + ecosystem analyzer"
      domain="ocean"
      icon={<Waves className="h-5 w-5 text-cyan-400" />}
      macroBadge="ocean.waveAnalysis + marineEcosystem"
      accent="cyan"
      left={{
        macro: 'waveAnalysis',
        buildArtifact: () => ({ data: wave }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Waves className="h-3 w-3" />Wave inputs</div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Height (m)</span>
                <input type="number" step={0.1} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={wave.waveHeightMeters} onChange={(e) => setWave({ ...wave, waveHeightMeters: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Period (s)</span>
                <input type="number" step={0.5} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={wave.wavePeriodSeconds} onChange={(e) => setWave({ ...wave, wavePeriodSeconds: Number(e.target.value) || 0 })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Wind (kt)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={wave.windSpeedKnots} onChange={(e) => setWave({ ...wave, windSpeedKnots: Number(e.target.value) || 0 })} /></label>
            </div>
          </div>
        ),
      }}
      right={{
        macro: 'marineEcosystem',
        buildArtifact: () => ({ data: { species: species.filter((s) => s.name.trim()) } }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Fish className="h-3 w-3" />Species inventory</div>
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {species.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_55px_55px_30px] gap-1.5">
                  <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" placeholder="Species" value={s.name} onChange={(e) => updateSpecies(i, 'name', e.target.value)} />
                  <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" value={s.trophicLevel} onChange={(e) => updateSpecies(i, 'trophicLevel', e.target.value as Species['trophicLevel'])}>
                    {TROPHIC_LEVELS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-zinc-950 text-[10px] text-zinc-400"><input type="checkbox" checked={s.threatened} onChange={(e) => updateSpecies(i, 'threatened', e.target.checked)} />T</label>
                  <label className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-zinc-950 text-[10px] text-zinc-400"><input type="checkbox" checked={s.invasive} onChange={(e) => updateSpecies(i, 'invasive', e.target.checked)} />I</label>
                  <button type="button" onClick={() => removeSpecies(i)} className="rounded border border-zinc-800 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addSpecies} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500/40 hover:text-cyan-200"><Plus className="h-3 w-3" />Add species</button>
          </div>
        ),
      }}
      renderResults={(waveResult, ecoResult) => (
        <>
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Waves className="h-3 w-3" />Sea conditions</div>
            {!waveResult && <div className="text-[11px] text-zinc-500">Analyze to compute.</div>}
            {waveResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-mono ${waveResult.seaState === 'rough' || waveResult.seaState === 'very-rough' ? 'bg-rose-500/20 text-rose-200' : waveResult.seaState === 'moderate' ? 'bg-amber-500/20 text-amber-200' : 'bg-emerald-500/20 text-emerald-200'}`}>{waveResult.seaState}</span>
                  <span className="font-mono text-cyan-200">B{waveResult.beaufortScale}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Wavelength</div><div className="font-mono text-cyan-200">{waveResult.wavelength}</div></div>
                  <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Speed</div><div className="font-mono text-cyan-200">{waveResult.speed}</div></div>
                  <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1 col-span-2"><div className="text-[9px] text-zinc-500">Energy density</div><div className="font-mono text-cyan-200">{waveResult.energyDensity}</div></div>
                </div>
                <div className={`rounded border px-2 py-1 ${waveResult.navigationAdvisory?.includes('advisory') ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200'}`}>{waveResult.navigationAdvisory}</div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Fish className="h-3 w-3" />Ecosystem health</div>
            {!ecoResult && <div className="text-[11px] text-zinc-500">Analyze to score.</div>}
            {ecoResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-2xl ${healthColour(ecoResult.ecosystemHealth)}`}>{ecoResult.ecosystemHealth}</span>
                  <span className="text-zinc-500">· Shannon {ecoResult.shannonDiversityIndex}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Species</div><div className="font-mono text-emerald-200">{ecoResult.speciesCount}</div></div>
                  <div className="rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Threatened</div><div className="font-mono text-amber-200">{ecoResult.threatened}</div></div>
                  <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Invasive</div><div className="font-mono text-rose-200">{ecoResult.invasive}</div></div>
                </div>
                {ecoResult.trophicLevels && (
                  <div className="space-y-0.5">
                    <div className="text-[9px] uppercase text-zinc-500">Trophic levels</div>
                    {Object.entries(ecoResult.trophicLevels).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2 py-0.5">
                        <span className="text-zinc-300 capitalize">{k}</span>
                        <span className="font-mono text-emerald-200">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-ocean-wave-ecosystem',
        title: (w, e) => `Ocean — ${w.seaState ?? '—'} seas · ${e.speciesCount ?? 0} species`,
        content: (w, e) => `Wave conditions:\n  Sig. height: ${w.significantWaveHeight}\n  Period: ${w.period} | Wavelength: ${w.wavelength}\n  Speed: ${w.speed} | Energy: ${w.energyDensity}\n  Beaufort: ${w.beaufortScale} | Sea state: ${w.seaState}\n  Advisory: ${w.navigationAdvisory}\n\nEcosystem:\n  Species: ${e.speciesCount} (Shannon ${e.shannonDiversityIndex})\n  Health: ${e.ecosystemHealth}\n  Threatened: ${e.threatened} | Invasive: ${e.invasive}\n  Trophic:\n${Object.entries(e.trophicLevels || {}).map(([k, v]) => `    ${k}: ${v}`).join('\n')}`,
        tags: () => ['ocean', 'wave', 'ecosystem'],
        rawData: (w, e) => ({ wave, species, waveResult: w, ecoResult: e }),
      }}
    />
  );
}
