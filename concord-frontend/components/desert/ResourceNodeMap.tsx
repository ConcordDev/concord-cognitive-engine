'use client';

/**
 * ResourceNodeMap — map-pinned water sources, shade, hazards and supply
 * caches via desert.nodeSave / nodeList / nodeDelete and a proximity
 * query through desert.nodesNearby.
 */

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Droplets, MapPin, Search } from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

const KINDS = ['water', 'shade', 'hazard', 'supply', 'shelter', 'fuel'];
const RELIABILITY = ['confirmed', 'reported', 'seasonal', 'depleted'];
const SEVERITY = ['', 'low', 'moderate', 'high', 'extreme'];

interface Node {
  id: string;
  kind: string;
  name: string;
  lat: number;
  lng: number;
  notes: string;
  reliability: string;
  severity: string | null;
  distanceKm?: number;
}

interface NearbyResult {
  nodes: Node[];
  nearestWater: Node | null;
  nearestShade: Node | null;
  hazards: Node[];
}

const KIND_COLOR: Record<string, string> = {
  water: 'text-blue-400',
  shade: 'text-green-400',
  hazard: 'text-red-400',
  supply: 'text-amber-400',
  shelter: 'text-cyan-400',
  fuel: 'text-orange-400',
};

export function ResourceNodeMap() {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('water');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [reliability, setReliability] = useState('reported');
  const [severity, setSeverity] = useState('');
  const [notes, setNotes] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState('');
  const [near, setNear] = useState<NearbyResult | null>(null);
  const [nearLat, setNearLat] = useState('');
  const [nearLng, setNearLng] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun<{ nodes: Node[]; byKind: Record<string, number> }>('desert', 'nodeList', {
      kind: filter || undefined,
    });
    if (r.data?.ok && r.data.result) {
      setNodes(r.data.result.nodes);
      setByKind(r.data.result.byKind);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    setErr(null);
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng required');
      return;
    }
    setBusy(true);
    const r = await lensRun('desert', 'nodeSave', {
      name: name || `${kind} node`,
      kind,
      lat: la,
      lng: ln,
      reliability,
      severity: severity || undefined,
      notes,
    });
    setBusy(false);
    if (r.data?.ok) {
      setName('');
      setLat('');
      setLng('');
      setNotes('');
      load();
    } else {
      setErr(r.data?.error || 'Save failed');
    }
  }, [name, kind, lat, lng, reliability, severity, notes, load]);

  const remove = useCallback(
    async (id: string) => {
      await lensRun('desert', 'nodeDelete', { id });
      load();
    },
    [load],
  );

  const findNearby = useCallback(async () => {
    setErr(null);
    const la = Number(nearLat);
    const ln = Number(nearLng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng for proximity search required');
      return;
    }
    setBusy(true);
    const r = await lensRun<NearbyResult>('desert', 'nodesNearby', { lat: la, lng: ln, radiusKm: 100 });
    setBusy(false);
    if (r.data?.ok && r.data.result) setNear(r.data.result);
    else setErr(r.data?.error || 'Search failed');
  }, [nearLat, nearLng]);

  const markers = nodes.map((n) => ({
    lat: n.lat,
    lng: n.lng,
    label: n.name,
    popup: `${n.kind} · ${n.reliability}${n.severity ? ` · ${n.severity}` : ''}`,
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Resource node mapping</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Node name"
            className="flex-1 min-w-[140px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="lat"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="lng"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={reliability}
            onChange={(e) => setReliability(e.target.value)}
            className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          >
            {RELIABILITY.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          >
            {SEVERITY.map((s) => (
              <option key={s || 'none'} value={s}>
                {s || 'no severity'}
              </option>
            ))}
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            className="flex-1 min-w-[140px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <button
            onClick={save}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add node
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => setFilter('')}
            className={`rounded px-2 py-1 ${filter === '' ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}
          >
            all ({nodes.length})
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded px-2 py-1 ${filter === k ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}
            >
              {k} ({byKind[k] || 0})
            </button>
          ))}
        </div>
      </div>

      {markers.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <MapView markers={markers} className="h-[340px]" center={[markers[0].lat, markers[0].lng]} zoom={6} />
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Search className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-white">Nearest resources within 100 km</span>
          <input
            value={nearLat}
            onChange={(e) => setNearLat(e.target.value)}
            placeholder="lat"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
          />
          <input
            value={nearLng}
            onChange={(e) => setNearLng(e.target.value)}
            placeholder="lng"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
          />
          <button
            onClick={findNearby}
            disabled={busy}
            className="rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 px-2.5 py-1 text-xs text-white"
          >
            Find
          </button>
        </div>
        {near && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <NearCard title="Nearest water" node={near.nearestWater} />
            <NearCard title="Nearest shade" node={near.nearestShade} />
            <div className="rounded bg-zinc-950 border border-zinc-800 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">Hazards in range</span>
              <div className="mt-1 font-mono text-sm text-red-400">{near.hazards.length}</div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {nodes.map((n) => (
          <div key={n.id} className="flex items-center justify-between rounded bg-zinc-900 border border-zinc-800 px-3 py-2">
            <div className="flex items-center gap-2">
              <MapPin className={`h-4 w-4 ${KIND_COLOR[n.kind] || 'text-zinc-400'}`} />
              <span className="text-sm text-white">{n.name}</span>
              <span className="text-xs text-zinc-400">
                {n.kind} · {n.reliability}
                {n.severity ? ` · ${n.severity}` : ''}
              </span>
            </div>
            <button onClick={() => remove(n.id)} className="p-1 text-zinc-400 hover:text-red-400" aria-label="Delete node">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {nodes.length === 0 && <p className="text-center text-sm text-zinc-400 py-6">No resource nodes mapped.</p>}
      </div>
    </div>
  );
}

function NearCard({ title, node }: { title: string; node: Node | null }) {
  return (
    <div className="rounded bg-zinc-950 border border-zinc-800 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{title}</span>
      {node ? (
        <div className="mt-1">
          <div className="text-sm text-white">{node.name}</div>
          <div className="font-mono text-xs text-amber-300">{node.distanceKm} km</div>
        </div>
      ) : (
        <div className="mt-1 text-sm text-zinc-600">none in range</div>
      )}
    </div>
  );
}
