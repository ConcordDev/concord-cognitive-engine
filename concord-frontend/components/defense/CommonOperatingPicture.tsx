'use client';

/**
 * CommonOperatingPicture — geospatial COP for the defense lens.
 * Plots assets / threats / operations on a world map.
 * Backed by defense.cop-add / cop-map / cop-update / cop-remove macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { MapView, type MapMarker } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { MapPin, Plus, Loader2, Crosshair, Pencil } from 'lucide-react';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';

interface CopMarker {
  id: string;
  kind: 'asset' | 'threat' | 'operation';
  label: string;
  // null/missing for an asset or threat saved without coordinates (the Assets editor has no coordinate fields)
  lat: number | null;
  lon: number | null;
  affiliation?: string;
  status?: string;
  severity?: string;
  note?: string;
}

interface CopMapResult {
  markers: CopMarker[];
  count: number;
  byKind: Record<string, number>;
  // Registry truth beside the mapped truth (C2): totals count every record
  // in the registry; unmapped names the records that hold no coordinates.
  totals?: { asset: number; threat: number; operation: number };
  unmapped?: { assets: { id: string; label: string }[]; threats: { id: string; label: string }[] };
}

const AFFIL_TONE: Record<string, MapMarker['tone']> = {
  friendly: 'good',
  hostile: 'bad',
  neutral: 'info',
  unknown: 'default',
};

const hasCoords = (m: CopMarker): m is CopMarker & { lat: number; lon: number } =>
  typeof m.lat === 'number' && Number.isFinite(m.lat) && typeof m.lon === 'number' && Number.isFinite(m.lon);

export function CommonOperatingPicture() {
  const [markers, setMarkers] = useState<CopMarker[]>([]);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<{ asset: number; threat: number; operation: number } | null>(null);
  const [unmapped, setUnmapped] = useState<{ assets: { id: string; label: string }[]; threats: { id: string; label: string }[] }>({ assets: [], threats: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setTotals(r.data.result.totals || null);
      setUnmapped(r.data.result.unmapped || { assets: [], threats: [] });
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

  // FIX-defense-003: own plotted markers gain an in-place edit.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: '', lat: '', lon: '', note: '' });
  const saveEdit = useCallback(async (marker: CopMarker) => {
    if (!editForm.label.trim()) return;
    setBusy(true);
    setError(null);
    const r = await lensRun('defense', 'cop-update', {
      id: marker.id, label: editForm.label.trim(),
      lat: editForm.lat === '' ? undefined : Number(editForm.lat),
      lon: editForm.lon === '' ? undefined : Number(editForm.lon),
      note: editForm.note,
    });
    if (r.data?.ok) {
      setEditingId(null);
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to update marker');
    }
    setBusy(false);
  }, [editForm, refresh]);

  const remove = useCallback(async (marker: CopMarker) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    const r = await lensRun('defense', 'cop-remove', { id: marker.id });
    if (r.data?.ok) {
      setNotice(`Removed marker — ${marker.label}`);
      await refresh();
    } else {
      setError(r.data?.error || 'Marker not removable (auto-derived from asset/threat)');
    }
    setBusy(false);
  }, [refresh]);

  const mapMarkers: MapMarker[] = markers.filter(hasCoords).map((m) => ({
    id: m.id,
    lat: m.lat,
    lon: m.lon,
    label: m.label,
    tone: AFFIL_TONE[m.affiliation || 'unknown'] || 'default',
  }));

  // Counts count what they label (C2): the headline numbers are registry
  // totals; the "on map" numbers say how many of those records are plotted.
  // (Fallbacks cover a response without totals: count the plotted markers.)
  const assetTotal = totals ? totals.asset : (byKind.asset || 0);
  const threatTotal = totals ? totals.threat : (byKind.threat || 0);
  const markerTotal = totals ? totals.operation : markers.filter((m) => m.id.startsWith('cop_')).length;
  const assetMapped = totals
    ? totals.asset - unmapped.assets.length
    : markers.filter((m) => m.kind === 'asset' && hasCoords(m)).length;
  const threatMapped = totals
    ? totals.threat - unmapped.threats.length
    : markers.filter((m) => m.kind === 'threat' && hasCoords(m)).length;
  const unmappedCount = unmapped.assets.length + unmapped.threats.length;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Common Operating Picture</h3>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="text-green-400">{assetTotal} assets · {assetMapped} on map</span>
          <span className="text-red-400">{threatTotal} threats · {threatMapped} on map</span>
          <span className="text-indigo-400">{markerTotal} markers</span>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <MapView markers={mapMarkers} height={320} />
      )}

      {/* Unmapped records are named, never silently absent (C2) */}
      {!loading && unmappedCount > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
            No coordinates — not on the map ({unmappedCount})
          </div>
          {unmapped.assets.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] mt-0.5">
              <MapPin className="w-3 h-3 shrink-0 text-zinc-500" />
              <span className="text-zinc-200">{a.label}</span>
              <span className="text-zinc-500">asset · no coordinates</span>
            </div>
          ))}
          {unmapped.threats.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[11px] mt-0.5">
              <MapPin className="w-3 h-3 shrink-0 text-zinc-500" />
              <span className="text-zinc-200">{t.label}</span>
              <span className="text-zinc-500">threat · no coordinates</span>
            </div>
          ))}
        </div>
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
              className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
            >
            <div className="flex items-center justify-between">
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
                  {hasCoords(m) ? `${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}` : 'no coordinates'}
                </span>
                <span className="text-[10px] text-zinc-400 shrink-0">{m.kind}</span>
              </div>
              {m.id.startsWith('cop_') && (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setEditingId(editingId === m.id ? null : m.id);
                      setEditForm({
                        label: m.label,
                        lat: m.lat != null ? String(m.lat) : '',
                        lon: m.lon != null ? String(m.lon) : '',
                        note: m.note || '',
                      });
                    }}
                    disabled={busy}
                    className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
                    title="Edit marker" aria-label={`Edit marker ${m.label}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <ConfirmDeleteButton
                    ariaLabel="Remove marker"
                    itemLabel={`marker "${m.label}"`}
                    disabled={busy}
                    onConfirm={() => remove(m)}
                  />
                </span>
              )}
            </div>
            {editingId === m.id && (
              <div className="flex flex-wrap gap-2 mt-2 border-t border-zinc-800 pt-2">
                <input value={editForm.label} onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                  aria-label="Edit marker label" placeholder="Label"
                  className="flex-1 min-w-32 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-white" />
                <input type="number" step="any" value={editForm.lat} onChange={(e) => setEditForm((f) => ({ ...f, lat: e.target.value }))}
                  aria-label="Edit marker latitude" placeholder="Lat"
                  className="w-24 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-white" />
                <input type="number" step="any" value={editForm.lon} onChange={(e) => setEditForm((f) => ({ ...f, lon: e.target.value }))}
                  aria-label="Edit marker longitude" placeholder="Lon"
                  className="w-24 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-white" />
                <input value={editForm.note} onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                  aria-label="Edit marker note" placeholder="Note"
                  className="flex-1 min-w-32 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-white" />
                <button onClick={() => saveEdit(m)} disabled={!editForm.label.trim() || busy}
                  className="rounded bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Save</button>
                <button onClick={() => setEditingId(null)} className="text-xs text-zinc-400 px-1.5">Cancel</button>
              </div>
            )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
