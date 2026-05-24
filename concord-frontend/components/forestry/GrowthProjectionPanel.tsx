'use client';

/**
 * GrowthProjectionPanel — projects timber volume over a rotation from
 * species, current age, site index. Wires forestry.growth-projection.
 */

import { useCallback, useState } from 'react';
import { LineChart, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface ProjRow {
  year: number;
  age: number;
  volumePerAcre: number;
  totalVolume: number;
  mai: number;
  cai: number;
}
interface ProjResult {
  species: string;
  acres: number;
  rotationYears: number;
  currentVolumePerAcre: number;
  currentTotalVolume: number;
  finalVolumePerAcre: number;
  finalTotalVolume: number;
  biologicalRotationAge: number;
  peakMai: number;
  projection: ProjRow[];
}

const SPECIES = ['douglas_fir', 'ponderosa_pine', 'loblolly_pine', 'oak', 'maple', 'spruce', 'mixed', 'other'];

export function GrowthProjectionPanel() {
  const [species, setSpecies] = useState('douglas_fir');
  const [acres, setAcres] = useState('');
  const [age, setAge] = useState('');
  const [siteIndex, setSiteIndex] = useState('');
  const [curVol, setCurVol] = useState('');
  const [result, setResult] = useState<ProjResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const project = useCallback(async () => {
    const a = Number(acres);
    if (!Number.isFinite(a) || a <= 0) { setErr('Enter a valid acreage.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun<ProjResult>('forestry', 'growth-projection', {
      species,
      acres: a,
      currentAge: Number(age) || 0,
      siteIndex: Number(siteIndex) || 0,
      currentVolumePerAcre: Number(curVol) || 0,
    });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data?.error || 'Projection failed.');
    setBusy(false);
  }, [species, acres, age, siteIndex, curVol]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <LineChart className="w-4 h-4 text-green-400" />
        <h3 className="text-sm font-bold text-zinc-100">Growth &amp; Yield Projection</h3>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <select value={species} onChange={(e) => setSpecies(e.target.value)}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {SPECIES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input value={acres} onChange={(e) => setAcres(e.target.value.replace(/[^\d.]/g, ''))} placeholder="acres"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} placeholder="age yrs"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={siteIndex} onChange={(e) => setSiteIndex(e.target.value.replace(/\D/g, ''))} placeholder="site index"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={curVol} onChange={(e) => setCurVol(e.target.value.replace(/[^\d.]/g, ''))} placeholder="cur. bf/ac (opt)"
          className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={project} disabled={busy}
          className="px-2.5 py-1 text-xs rounded bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Project
        </button>
      </div>

      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([
              ['Now (bf/ac)', result.currentVolumePerAcre.toLocaleString()],
              ['Final (bf/ac)', result.finalVolumePerAcre.toLocaleString()],
              ['Final total (bf)', result.finalTotalVolume.toLocaleString()],
              ['Biological rotation', `${result.biologicalRotationAge} yr`],
            ] as const).map(([l, v]) => (
              <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
                <p className="text-sm font-bold text-green-300">{v}</p>
                <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
              </div>
            ))}
          </div>
          <ChartKit
            kind="area"
            data={result.projection.map((p) => ({ age: p.age, volumePerAcre: p.volumePerAcre, mai: p.mai }))}
            xKey="age"
            series={[
              { key: 'volumePerAcre', label: 'Volume bf/ac', color: '#22c55e' },
              { key: 'mai', label: 'MAI bf/ac/yr', color: '#f59e0b' },
            ]}
            height={220}
          />
          <p className="text-[10px] text-zinc-400">
            Peak mean annual increment of {result.peakMai.toLocaleString()} bf/ac/yr at age {result.biologicalRotationAge} —
            the economically optimal rotation point for {result.species.replace(/_/g, ' ')}.
          </p>
        </div>
      )}
      {!result && !busy && <p className="text-xs text-zinc-400 italic">No projection yet. Enter stand details above.</p>}
    </div>
  );
}
