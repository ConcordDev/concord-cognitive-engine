'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { CityMap } from './CityMap';
import type { MapParcel } from './CityMap';
import { LandPlot, Plus, Trash2, Loader2, RefreshCw, Ruler } from 'lucide-react';

interface Parcel {
  id: string;
  apn: string;
  address: string;
  zoneType: string;
  lotSizeSqFt: number;
  lat: number | null;
  lng: number | null;
  owner: string;
  district: string;
  createdAt: string;
}

interface Massing {
  floors: number;
  buildingHeightFt: number;
  grossFloorAreaSqFt: number;
  dwellingUnits: number;
  jobs: number;
  maxBuildableSqFt?: number;
}

const ZONES = ['residential', 'commercial', 'mixed', 'industrial'];

export function ParcelManager({ onParcelsChange }: { onParcelsChange?: (p: Parcel[]) => void }) {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [massing, setMassing] = useState<Record<string, Massing>>({});

  const [apn, setApn] = useState('');
  const [address, setAddress] = useState('');
  const [zoneType, setZoneType] = useState('residential');
  const [lotSizeSqFt, setLotSizeSqFt] = useState('5000');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [owner, setOwner] = useState('');
  const [district, setDistrict] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<{ parcels: Parcel[] }>('urban-planning', 'parcel-list', {});
    if (r.data.ok && r.data.result) {
      setParcels(r.data.result.parcels);
      onParcelsChange?.(r.data.result.parcels);
    } else {
      setError(r.data.error || 'failed to load parcels');
    }
    setLoading(false);
  }, [onParcelsChange]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(async () => {
    if (!apn.trim()) {
      setError('parcel APN / id is required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('urban-planning', 'parcel-add', {
      apn,
      address,
      zoneType,
      lotSizeSqFt: Number(lotSizeSqFt),
      lat: lat ? Number(lat) : 0,
      lng: lng ? Number(lng) : 0,
      owner,
      district,
    });
    setBusy(false);
    if (r.data.ok) {
      setApn('');
      setAddress('');
      setLat('');
      setLng('');
      setOwner('');
      setDistrict('');
      await refresh();
    } else {
      setError(r.data.error || 'add failed');
    }
  }, [apn, address, zoneType, lotSizeSqFt, lat, lng, owner, district, refresh]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      await lensRun('urban-planning', 'parcel-remove', { id });
      setBusy(false);
      await refresh();
    },
    [refresh],
  );

  // Run the 3D massing envelope macro for a parcel's zone + lot size.
  const analyzeMassing = useCallback(async (p: Parcel) => {
    const r = await lensRun<Massing>('urban-planning', 'massingEnvelope', {
      zoneType: p.zoneType,
      lotSizeSqFt: p.lotSizeSqFt,
      useMix: p.zoneType,
    });
    if (r.data.ok && r.data.result) {
      setMassing((m) => ({ ...m, [p.id]: r.data.result as Massing }));
    }
  }, []);

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
          <LandPlot className="h-4 w-4 text-emerald-400" /> Add Parcel
        </h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input
            value={apn}
            onChange={(e) => setApn(e.target.value)}
            placeholder="Parcel APN / id"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <select
            value={zoneType}
            onChange={(e) => setZoneType(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {ZONES.map((z) => (
              <option key={z} value={z}>
                Zone: {z}
              </option>
            ))}
          </select>
          <input
            value={lotSizeSqFt}
            onChange={(e) => setLotSizeSqFt(e.target.value)}
            type="number"
            placeholder="Lot size (sqft)"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
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
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Owner (optional)"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <input
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder="District (optional)"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={add}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add Parcel
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Refresh parcels"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Ruler className="h-4 w-4 text-emerald-400" /> Parcel Map
        </h3>
        <CityMap parcels={mapParcels} height={380} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading parcels…
        </div>
      ) : parcels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-500">
          No parcels yet. Add one above to map it and model its build-out envelope.
        </div>
      ) : (
        <div className="grid gap-2">
          {parcels.map((p) => {
            const m = massing[p.id];
            return (
              <div
                key={p.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-white">{p.apn}</h4>
                    <p className="text-xs text-zinc-500">
                      {p.address || 'no address'} · {p.zoneType} ·{' '}
                      {p.lotSizeSqFt.toLocaleString()} sqft
                      {p.district ? ` · ${p.district}` : ''}
                    </p>
                    {p.lat != null && p.lng != null && (p.lat !== 0 || p.lng !== 0) && (
                      <p className="text-[10px] text-zinc-600">
                        {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                        {p.owner ? ` · ${p.owner}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => analyzeMassing(p)}
                      className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/20"
                    >
                      Massing
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                      aria-label="Delete parcel"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {m && (
                  <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                    {[
                      ['Floors', m.floors],
                      ['Height ft', m.buildingHeightFt],
                      ['GFA sqft', m.grossFloorAreaSqFt],
                      ['Units', m.dwellingUnits],
                      ['Jobs', m.jobs],
                    ].map(([label, val]) => (
                      <div
                        key={label as string}
                        className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1"
                      >
                        <div className="text-[9px] uppercase tracking-wider text-zinc-500">
                          {label}
                        </div>
                        <div className="font-mono text-sm text-emerald-300">
                          {(val as number).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
