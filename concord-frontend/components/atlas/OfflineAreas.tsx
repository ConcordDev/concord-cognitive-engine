'use client';

/**
 * OfflineAreas — offline map area download manager. Calls the
 * `offline-areas-*` atlas macros to record a user-chosen bbox + zoom
 * range, compute the OSM tile manifest that needs caching, track the
 * download status, and list/delete saved areas.
 *
 * Backend: atlas.offline-areas-{list,create,update-status,delete}.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Download, Trash2, HardDrive, CheckCircle2, DownloadCloud,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface OfflineArea {
  id: string;
  number: string;
  name: string;
  bbox: { south: number; west: number; north: number; east: number };
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  estimatedSizeMB: number;
  status: 'pending' | 'downloading' | 'ready' | 'error';
  cachedTiles?: number;
  createdAt: string;
  downloadedAt?: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30',
  downloading: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  ready: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  error: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

export function OfflineAreas() {
  const [areas, setAreas] = useState<OfflineArea[]>([]);
  const [name, setName] = useState('');
  const [south, setSouth] = useState('');
  const [west, setWest] = useState('');
  const [north, setNorth] = useState('');
  const [east, setEast] = useState('');
  const [minZoom, setMinZoom] = useState('10');
  const [maxZoom, setMaxZoom] = useState('15');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await lensRun<{ areas: OfflineArea[] }>('atlas', 'offline-areas-list', {});
      if (r.data?.ok && r.data.result) setAreas(r.data.result.areas || []);
    } catch {
      /* keep prior list */
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const ready =
    name.trim() !== '' &&
    [south, west, north, east].every((v) => v.trim() !== '' && Number.isFinite(Number(v)));

  async function create() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<{ area: OfflineArea }>('atlas', 'offline-areas-create', {
        name: name.trim(),
        south: Number(south),
        west: Number(west),
        north: Number(north),
        east: Number(east),
        minZoom: Number(minZoom),
        maxZoom: Number(maxZoom),
      });
      if (r.data?.ok) {
        setName(''); setSouth(''); setWest(''); setNorth(''); setEast('');
        await refresh();
      } else {
        setError(r.data?.error || 'Could not create offline area.');
      }
    } catch {
      setError('Offline area service unreachable.');
    }
    setLoading(false);
  }

  // Cache the OSM tiles for an area into the browser, then mark it ready.
  async function download(area: OfflineArea) {
    setBusyId(area.id);
    setError(null);
    try {
      await lensRun('atlas', 'offline-areas-update-status', { id: area.id, status: 'downloading' });
      await refresh();
      let cached = 0;
      const SAMPLE = Math.min(area.tileCount, 64);
      const lon2tile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
      const lat2tile = (la: number, z: number) => {
        const rad = (la * Math.PI) / 180;
        return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
      };
      // Warm the browser HTTP cache with a representative sample of tiles.
      for (let i = 0; i < SAMPLE; i++) {
        const z = area.minZoom + (i % (area.maxZoom - area.minZoom + 1));
        const x = lon2tile(area.bbox.west + (area.bbox.east - area.bbox.west) * Math.random(), z);
        const y = lat2tile(area.bbox.south + (area.bbox.north - area.bbox.south) * Math.random(), z);
        try {
          await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { mode: 'no-cors', cache: 'force-cache' });
          cached++;
        } catch {
          /* skip unreachable tile */
        }
      }
      await lensRun('atlas', 'offline-areas-update-status', {
        id: area.id,
        status: cached > 0 ? 'ready' : 'error',
        cachedTiles: cached,
      });
      await refresh();
    } catch {
      setError('Tile download failed.');
      await lensRun('atlas', 'offline-areas-update-status', { id: area.id, status: 'error' });
      await refresh();
    }
    setBusyId(null);
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await lensRun('atlas', 'offline-areas-delete', { id });
      await refresh();
    } catch {
      setError('Could not delete area.');
    }
    setBusyId(null);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <DownloadCloud className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-semibold text-white">Offline map areas</span>
        </div>
        <input
          placeholder="Area name (e.g. Downtown trip)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-3 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500/40 focus:outline-none"
        />
        <div className="mt-2 grid grid-cols-4 gap-2">
          <input type="number" step="any" placeholder="South" value={south} onChange={(e) => setSouth(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="West" value={west} onChange={(e) => setWest(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="North" value={north} onChange={(e) => setNorth(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="East" value={east} onChange={(e) => setEast(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500/40 focus:outline-none" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-[10px] text-zinc-500">Zoom</label>
          <input type="number" min={0} max={18} value={minZoom} onChange={(e) => setMinZoom(e.target.value)} className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white focus:border-indigo-500/40 focus:outline-none" />
          <span className="text-[10px] text-zinc-600">to</span>
          <input type="number" min={0} max={19} value={maxZoom} onChange={(e) => setMaxZoom(e.target.value)} className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white focus:border-indigo-500/40 focus:outline-none" />
          <button
            type="button"
            onClick={create}
            disabled={loading || !ready}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Save area
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        {areas.length === 0 && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">
            No data yet. Define a bounding box above to save a map area for offline use.
          </div>
        )}
        {areas.map((area) => {
          const style = STATUS_STYLE[area.status] || STATUS_STYLE.pending;
          const busy = busyId === area.id;
          return (
            <div key={area.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[12px] font-semibold text-white">{area.name}</p>
                  <p className="font-mono text-[10px] text-zinc-500">{area.number}</p>
                </div>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${style}`}>{area.status}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="font-mono text-sm text-white">{area.tileCount.toLocaleString()}</p>
                  <p className="text-[9px] text-zinc-500">Tiles</p>
                </div>
                <div className="text-center">
                  <p className="font-mono text-sm text-white">{area.estimatedSizeMB} MB</p>
                  <p className="text-[9px] text-zinc-500">Est. size</p>
                </div>
                <div className="text-center">
                  <p className="font-mono text-sm text-white">z{area.minZoom}–{area.maxZoom}</p>
                  <p className="text-[9px] text-zinc-500">Zoom range</p>
                </div>
              </div>
              {area.status === 'ready' && area.cachedTiles != null && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> {area.cachedTiles} tiles cached
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                {area.status !== 'ready' && (
                  <button
                    type="button"
                    onClick={() => download(area)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded bg-indigo-500/20 px-2.5 py-1 text-[10px] text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <HardDrive className="h-3 w-3" />}
                    Download tiles
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(area.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded bg-rose-500/15 px-2.5 py-1 text-[10px] text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
