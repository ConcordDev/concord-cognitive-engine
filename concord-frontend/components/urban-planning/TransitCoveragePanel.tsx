'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { CityMap } from './CityMap';
import type { MapParcel, MapCatchment } from './CityMap';
import { TrainFront, Plus, Trash2, Loader2, Radar } from 'lucide-react';

interface Parcel {
  id: string;
  apn: string;
  address: string;
  zoneType: string;
  lotSizeSqFt: number;
  lat: number | null;
  lng: number | null;
}

interface Stop {
  id: string;
  name: string;
  mode: string;
  lat: number;
  lng: number;
}

interface CoverageResult {
  catchments: MapCatchment[];
  stopCount: number;
  totalCatchmentAcres: number;
  parcelsEvaluated: number;
  parcelsServed: number;
  parcelCoveragePct: number | null;
}

const MODES = ['bus', 'brt', 'rail', 'ferry'];

export function TransitCoveragePanel() {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [result, setResult] = useState<CoverageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [mode, setMode] = useState('rail');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const loadParcels = useCallback(async () => {
    const r = await lensRun<{ parcels: Parcel[] }>('urban-planning', 'parcel-list', {});
    if (r.data.ok && r.data.result) setParcels(r.data.result.parcels);
  }, []);

  useEffect(() => {
    loadParcels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addStop = useCallback(() => {
    if (!lat || !lng) {
      setError('stop latitude + longitude are required');
      return;
    }
    setError(null);
    setStops((s) => [
      ...s,
      {
        id: `stop_${Date.now().toString(36)}_${s.length}`,
        name: name.trim() || `${mode} stop ${s.length + 1}`,
        mode,
        lat: Number(lat),
        lng: Number(lng),
      },
    ]);
    setName('');
    setLat('');
    setLng('');
  }, [name, mode, lat, lng]);

  const removeStop = useCallback((id: string) => {
    setStops((s) => s.filter((x) => x.id !== id));
    setResult(null);
  }, []);

  // Run the transit-coverage catchment-buffer analysis on the server.
  const analyze = useCallback(async () => {
    if (stops.length === 0) {
      setError('add at least one transit stop');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun<CoverageResult>('urban-planning', 'transitCoverage', {
      stops,
      parcels: parcels.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
    });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setError(r.data.error || 'analysis failed');
  }, [stops, parcels]);

  const mapParcels: MapParcel[] = parcels.map((p) => ({
    id: p.id,
    apn: p.apn,
    address: p.address,
    zoneType: p.zoneType,
    lotSizeSqFt: p.lotSizeSqFt,
    lat: p.lat,
    lng: p.lng,
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <TrainFront className="h-4 w-4 text-emerald-400" /> Transit Stops
        </h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stop name"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                Mode: {m}
              </option>
            ))}
          </select>
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            type="number"
            step="0.0001"
            placeholder="Latitude"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            type="number"
            step="0.0001"
            placeholder="Longitude"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={addStop}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" /> Add Stop
          </button>
          <button
            onClick={analyze}
            disabled={busy || stops.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
            Analyze Coverage
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}
        {stops.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stops.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300"
              >
                {s.name} <span className="text-zinc-400">({s.mode})</span>
                <button
                  onClick={() => removeStop(s.id)}
                  className="text-zinc-400 hover:text-red-400"
                  aria-label={`Remove ${s.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['Transit stops', result.stopCount],
              ['Catchment acres', result.totalCatchmentAcres],
              ['Parcels served', `${result.parcelsServed}/${result.parcelsEvaluated}`],
              [
                'Parcel coverage',
                result.parcelCoveragePct != null ? `${result.parcelCoveragePct}%` : 'n/a',
              ],
            ].map(([label, val]) => (
              <div
                key={label as string}
                className="rounded-lg border border-emerald-500/20 bg-zinc-900/60 p-3"
              >
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                  {label}
                </div>
                <div className="mt-0.5 font-mono text-lg text-emerald-300">{val}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Radar className="h-4 w-4 text-emerald-400" /> Walk-Shed Catchment Map
            </h3>
            <CityMap parcels={mapParcels} catchments={result.catchments} height={420} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="py-1 pr-3">Stop</th>
                  <th className="py-1 pr-3">Mode</th>
                  <th className="py-1 pr-3 text-right">Walk radius (m)</th>
                  <th className="py-1 pr-3 text-right">Catchment (acres)</th>
                </tr>
              </thead>
              <tbody>
                {result.catchments.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-800">
                    <td className="py-1 pr-3 text-zinc-300">{c.name}</td>
                    <td className="py-1 pr-3 text-zinc-400">{c.mode}</td>
                    <td className="py-1 pr-3 text-right font-mono text-zinc-300">
                      {c.radiusMeters}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono text-emerald-300">
                      {c.catchmentAcres.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
