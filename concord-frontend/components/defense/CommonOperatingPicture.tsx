'use client';

/**
 * CommonOperatingPicture — geospatial COP for the defense lens.
 * Plots assets / threats / operations on a world map.
 * Backed by defense.cop-add / cop-map / cop-remove macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { MapView, type MapMarker } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { MapPin, Plus, Trash2, Loader2, Crosshair } from 'lucide-react';

interface CopMarker {
  id: string;
  kind: 'asset' | 'threat' | 'operation';
  label: string;
  lat: number;
  lon: number;
  affiliation?: string;
  status?: string;
  severity?: string;
  note?: string;
}

interface CopMapResult {
  markers: CopMarker[];
  count: number;
  byKind: Record<string, number>;
}

const AFFIL_TONE: Record<string, MapMarker['tone']> = {
  friendly: 'good',
  hostile: 'bad',
  neutral: 'info',
  unknown: 'default',
};

export function CommonOperatingPicture() {
  const [markers, setMarkers] = useState<CopMarker[]>([]);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'asset' | 'threat' | 'operation'>('operation');
  const [affiliation, setAffiliation] = useState('unknown');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<CopMapResult>('defense', 'cop-map', {});
    if (r.data?.ok && r.data.result) {
      setMarkers(r.data.result.markers || []);
      setByKind(r.data.result.byKind || {});
    } else {
      setError(r.data?.error || 'Failed to load common operating picture');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(async () => {
    if (!label.trim() || !lat.trim() || !lon.trim()) {
      setError('Label, latitude and longitude are required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('defense', 'cop-add', {
      kind,
      label: label.trim(),
      affiliation,
      lat: Number(lat),
      lon: Number(lon),
      note: note.trim(),
    });
    if (r.data?.ok) {
      setLabel('');
      setLat('');
      setLon('');
      setNote('');
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to plot marker');
    }
    setBusy(false);
  }, [kind, label, affiliation, lat, lon, note, refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'cop-remove', { id });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Marker not removable (auto-derived from asset/threat)');
    setBusy(false);
  }, [refresh]);

  const mapMarkers: MapMarker[] = markers.map((m) => ({
    id: m.id,
    lat: m.lat,
    lon: m.lon,
    label: m.label,
    tone: AFFIL_TONE[m.affiliation || 'unknown'] || 'default',
  }));

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Common Operating Picture</h3>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="text-green-400">{byKind.asset || 0} assets</span>
          <span className="text-red-400">{byKind.threat || 0} threats</span>
          <span className="text-indigo-400">{byKind.operation || 0} ops</span>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <MapView markers={mapMarkers} height={320} />
      )}

      {/* Plot a new marker */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Marker label"
          className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        >
          <option value="operation">operation</option>
          <option value="asset">asset</option>
          <option value="threat">threat</option>
        </select>
        <select
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        >
          <option value="friendly">friendly</option>
          <option value="hostile">hostile</option>
          <option value="neutral">neutral</option>
          <option value="unknown">unknown</option>
        </select>
        <input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="Lat"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono"
        />
        <input
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          placeholder="Lon"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono"
        />
      </div>
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
        <button
          onClick={add}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Plot
        </button>
      </div>

      {/* Marker list */}
      {markers.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {markers.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <MapPin
                  className={`w-3.5 h-3.5 shrink-0 ${
                    m.affiliation === 'hostile'
                      ? 'text-red-400'
                      : m.affiliation === 'friendly'
                        ? 'text-green-400'
                        : 'text-zinc-400'
                  }`}
                />
                <span className="text-xs text-white truncate">{m.label}</span>
                <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                  {m.lat.toFixed(2)}, {m.lon.toFixed(2)}
                </span>
                <span className="text-[10px] text-zinc-400 shrink-0">{m.kind}</span>
              </div>
              {m.id.startsWith('cop_') && (
                <button
                  onClick={() => remove(m.id)}
                  disabled={busy}
                  aria-label="Remove marker"
                  className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
