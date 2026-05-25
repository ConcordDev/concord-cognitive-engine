'use client';

/**
 * TerrainOverlay — classify a grid of survey samples into terrain
 * classes via desert.terrainOverlay and render the class distribution
 * plus a map overlay of classified sample points.
 */

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Plus, Trash2, Mountain, Layers } from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

const SOILS = ['sand', 'rock', 'gravel', 'salt', 'clay'];

interface Sample {
  lat: string;
  lng: string;
  soil: string;
  slopePercent: string;
  duneHeightM: string;
  vegetationCoverPercent: string;
}

interface ClassifiedSample {
  lat: number;
  lng: number;
  class: string;
  slopePercent: number;
  duneHeightM: number;
  vegetationCoverPercent: number;
  traversability: number;
}

interface OverlayResult {
  samples: ClassifiedSample[];
  count: number;
  distribution: { class: string; count: number; share: number }[];
  dominant: string;
  avgTraversability: number;
  overallTraversability: string;
}

const blank = (): Sample => ({ lat: '', lng: '', soil: 'sand', slopePercent: '', duneHeightM: '', vegetationCoverPercent: '' });

export function TerrainOverlay() {
  const [samples, setSamples] = useState<Sample[]>([blank(), blank(), blank()]);
  const [result, setResult] = useState<OverlayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Sample>) => {
    setSamples((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };

  const classify = useCallback(async () => {
    setErr(null);
    const valid = samples
      .map((s) => ({
        lat: Number(s.lat),
        lng: Number(s.lng),
        soil: s.soil,
        slopePercent: Number(s.slopePercent) || 0,
        duneHeightM: Number(s.duneHeightM) || 0,
        vegetationCoverPercent: Number(s.vegetationCoverPercent) || 0,
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && (s.lat !== 0 || s.lng !== 0));
    if (!valid.length) {
      setErr('Add at least one sample with coordinates');
      return;
    }
    setBusy(true);
    const r = await lensRun<OverlayResult>('desert', 'terrainOverlay', { samples: valid });
    setBusy(false);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data?.error || 'Classification failed');
  }, [samples]);

  const markers =
    result?.samples.map((s) => ({
      lat: s.lat,
      lng: s.lng,
      label: s.class,
      popup: `${s.class} · traversability ${s.traversability}`,
    })) || [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Terrain dataset overlay</h3>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-7 gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
            <span>lat</span>
            <span>lng</span>
            <span>soil</span>
            <span>slope%</span>
            <span>dune m</span>
            <span>veg %</span>
            <span />
          </div>
          {samples.map((s, i) => (
            <div key={i} className="grid grid-cols-7 gap-1.5">
              <input
                value={s.lat}
                onChange={(e) => update(i, { lat: e.target.value })}
                className="rounded bg-zinc-950 border border-zinc-800 px-1.5 py-1 text-xs text-white"
              />
              <input
                value={s.lng}
                onChange={(e) => update(i, { lng: e.target.value })}
                className="rounded bg-zinc-950 border border-zinc-800 px-1.5 py-1 text-xs text-white"
              />
              <select
                value={s.soil}
                onChange={(e) => update(i, { soil: e.target.value })}
                className="rounded bg-zinc-950 border border-zinc-800 px-1 py-1 text-xs text-white"
              >
                {SOILS.map((so) => (
                  <option key={so} value={so}>
                    {so}
                  </option>
                ))}
              </select>
              <input
                value={s.slopePercent}
                onChange={(e) => update(i, { slopePercent: e.target.value })}
                className="rounded bg-zinc-950 border border-zinc-800 px-1.5 py-1 text-xs text-white"
              />
              <input
                value={s.duneHeightM}
                onChange={(e) => update(i, { duneHeightM: e.target.value })}
                className="rounded bg-zinc-950 border border-zinc-800 px-1.5 py-1 text-xs text-white"
              />
              <input
                value={s.vegetationCoverPercent}
                onChange={(e) => update(i, { vegetationCoverPercent: e.target.value })}
                className="rounded bg-zinc-950 border border-zinc-800 px-1.5 py-1 text-xs text-white"
              />
              {samples.length > 1 && (
                <button
                  onClick={() => setSamples((ss) => ss.filter((_, j) => j !== i))}
                  className="p-1 text-zinc-400 hover:text-red-400"
                  aria-label="Remove sample"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSamples((ss) => [...ss, blank()])}
            className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-xs text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add sample
          </button>
          <button
            onClick={classify}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Mountain className="h-3.5 w-3.5" /> Classify overlay
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>

      {result && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-white">
              Dominant: <span className="font-semibold text-amber-300">{result.dominant}</span>
            </span>
            <span className="text-zinc-400">{result.count} samples</span>
            <span className="text-zinc-400">
              Traversability: <span className="text-white">{result.overallTraversability}</span> ({result.avgTraversability})
            </span>
          </div>
          <ChartKit
            kind="bar"
            height={200}
            data={result.distribution.map((d) => ({ class: d.class, share: d.share, count: d.count }))}
            xKey="class"
            series={[{ key: 'share', label: 'Share %', color: '#f59e0b' }]}
          />
        </div>
      )}

      {markers.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <MapView markers={markers} className="h-[320px]" center={[markers[0].lat, markers[0].lng]} zoom={8} />
        </div>
      )}
    </div>
  );
}
