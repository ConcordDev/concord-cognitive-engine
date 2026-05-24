'use client';

/**
 * StandPolygonPanel — GIS stand mapping. Lets a forester enter a ring
 * of lat/lon vertices, computes acreage + perimeter server-side via
 * forestry.stand-polygon-save, and renders saved polygons on a MapView.
 */

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Map as MapIcon, Loader2, Trash2, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface Vertex { lat: number; lon: number }
interface Polygon {
  id: string;
  name: string;
  standId: string | null;
  vertices: Vertex[];
  acres: number;
  perimeterM: number;
  notes: string;
  createdAt: string;
}
interface PolyList { polygons: Polygon[]; count: number; totalAcres: number }

export function StandPolygonPanel() {
  const [polygons, setPolygons] = useState<Polygon[]>([]);
  const [totalAcres, setTotalAcres] = useState(0);
  const [name, setName] = useState('');
  const [standId, setStandId] = useState('');
  const [vertexText, setVertexText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun<PolyList>('forestry', 'stand-polygon-list', {});
    if (r.data?.ok && r.data.result) {
      setPolygons(r.data.result.polygons);
      setTotalAcres(r.data.result.totalAcres);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!name.trim()) { setErr('Polygon name required.'); return; }
    const vertices: Vertex[] = [];
    for (const line of vertexText.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/[,\s]+/).map((p) => Number(p));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        vertices.push({ lat: parts[0], lon: parts[1] });
      }
    }
    if (vertices.length < 3) { setErr('Enter at least 3 "lat, lon" lines.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun<{ polygon: Polygon }>('forestry', 'stand-polygon-save', {
      name: name.trim(), standId: standId.trim() || undefined, vertices,
    });
    if (r.data?.ok) {
      setName(''); setStandId(''); setVertexText('');
      await load();
    } else {
      setErr(r.data?.error || 'Save failed.');
    }
    setBusy(false);
  }, [name, standId, vertexText, load]);

  const del = useCallback(async (id: string) => {
    const r = await lensRun('forestry', 'stand-polygon-delete', { id });
    if (r.data?.ok) await load();
  }, [load]);

  const markers = polygons.flatMap((p) =>
    p.vertices.length
      ? [{
          lat: p.vertices.reduce((s, v) => s + v.lat, 0) / p.vertices.length,
          lng: p.vertices.reduce((s, v) => s + v.lon, 0) / p.vertices.length,
          label: p.name,
          popup: `${p.acres} acres · ${(p.perimeterM / 1000).toFixed(2)} km perimeter`,
        }]
      : []
  );

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <MapIcon className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-bold text-zinc-100">GIS Stand Mapping</h3>
        <span className="ml-auto text-[10px] text-zinc-400">
          {polygons.length} polygon{polygons.length === 1 ? '' : 's'} · {totalAcres.toLocaleString()} ac
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-2 mb-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Polygon name"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <input value={standId} onChange={(e) => setStandId(e.target.value)} placeholder="Stand id (optional)"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
      </div>
      <textarea value={vertexText} onChange={(e) => setVertexText(e.target.value)} rows={4}
        placeholder={'Boundary vertices, one per line:\n45.012, -122.034\n45.015, -122.030\n45.013, -122.025'}
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 mb-2" />
      <button onClick={save} disabled={busy}
        className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Save polygon
      </button>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}

      {markers.length > 0 && (
        <div className="mt-3 rounded-lg overflow-hidden border border-zinc-800">
          <MapView markers={markers} className="h-[300px]" />
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {polygons.map((p) => (
          <div key={p.id} className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-2.5 py-1.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-100 truncate">{p.name}</p>
              <p className="text-[10px] text-zinc-400">
                {p.acres.toLocaleString()} ac · {(p.perimeterM / 1000).toFixed(2)} km · {p.vertices.length} vertices
                {p.standId ? ` · stand ${p.standId}` : ''}
              </p>
            </div>
            <button onClick={() => del(p.id)} aria-label="Delete polygon"
              className="p-1 text-zinc-400 hover:text-rose-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {polygons.length === 0 && <p className="text-xs text-zinc-400 italic">No polygons mapped yet.</p>}
      </div>
    </div>
  );
}
