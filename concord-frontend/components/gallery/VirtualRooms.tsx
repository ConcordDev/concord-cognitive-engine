'use client';

/**
 * VirtualRooms — "view in your room" / virtual gallery walkthrough.
 * Backs gallery virtual-room-* macros: rooms have at-scale walls (metres)
 * and artworks hung at normalized [0,1] positions.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Home, Plus, Loader2, AlertTriangle, Trash2, ChevronLeft, Frame,
} from 'lucide-react';

interface Placement {
  id: string;
  title: string;
  artist: string;
  image?: string | null;
  museum?: string | null;
  x: number;
  y: number;
  widthM: number;
}
interface VirtualRoom {
  id: string;
  name: string;
  preset: string;
  wallWidthM: number;
  wallHeightM: number;
  placements: Placement[];
}
interface RoomSummary {
  id: string;
  name: string;
  preset: string;
  wallWidthM: number;
  wallHeightM: number;
  placementCount: number;
}
interface RoomPreset { wallWidthM: number; wallHeightM: number; label: string }

export function VirtualRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [presets, setPresets] = useState<Record<string, RoomPreset>>({});
  const [active, setActive] = useState<VirtualRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPreset, setNewPreset] = useState('living_room');

  // Place-artwork form.
  const [aTitle, setATitle] = useState('');
  const [aArtist, setAArtist] = useState('');
  const [aImage, setAImage] = useState('');
  const [aWidth, setAWidth] = useState('0.8');
  const [aX, setAX] = useState('0.5');

  const refreshList = useCallback(async () => {
    const r = await lensRun<{ rooms: RoomSummary[]; presets: Record<string, RoomPreset> }>('gallery', 'virtual-room-list', {});
    if (r.data?.ok && r.data.result) {
      setRooms(r.data.result.rooms || []);
      if (r.data.result.presets) setPresets(r.data.result.presets);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  const openRoom = useCallback(async (id: string) => {
    setError(null);
    const r = await lensRun<{ room: VirtualRoom }>('gallery', 'virtual-room-detail', { id });
    if (r.data?.ok && r.data.result?.room) setActive(r.data.result.room);
    else setError(r.data?.error || 'Could not open room.');
  }, []);

  const createRoom = useCallback(async () => {
    if (!newName.trim()) { setError('Room name required.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun<{ room: VirtualRoom }>('gallery', 'virtual-room-create', {
      name: newName.trim(), preset: newPreset,
    });
    if (r.data?.ok && r.data.result?.room) {
      setNewName('');
      await refreshList();
      setActive(r.data.result.room);
    } else setError(r.data?.error || 'Could not create room.');
    setBusy(false);
  }, [newName, newPreset, refreshList]);

  const placeArtwork = useCallback(async () => {
    if (!active || !aTitle.trim()) { setError('Artwork title required.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('gallery', 'virtual-room-place', {
      roomId: active.id, title: aTitle.trim(),
      artist: aArtist.trim() || undefined,
      image: aImage.trim() || undefined,
      x: Number(aX) || 0.5,
      widthM: Number(aWidth) || 0.8,
    });
    if (r.data?.ok) {
      setATitle(''); setAArtist(''); setAImage('');
      await openRoom(active.id);
    } else setError(r.data?.error || 'Could not place artwork.');
    setBusy(false);
  }, [active, aTitle, aArtist, aImage, aX, aWidth, openRoom]);

  const removePlacement = useCallback(async (placementId: string) => {
    if (!active) return;
    setBusy(true);
    const r = await lensRun('gallery', 'virtual-room-remove-placement', { roomId: active.id, placementId });
    if (r.data?.ok) await openRoom(active.id);
    setBusy(false);
  }, [active, openRoom]);

  const deleteRoom = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('gallery', 'virtual-room-delete', { id });
    if (r.data?.ok) { setActive(null); await refreshList(); }
    setBusy(false);
  }, [refreshList]);

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <Home className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Virtual rooms</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">View in your room</span>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {!active ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white"
              placeholder="New room name"
            />
            <select
              value={newPreset} onChange={(e) => setNewPreset(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white"
            >
              {Object.entries(presets).map(([key, p]) => (
                <option key={key} value={key}>{p.label} ({p.wallWidthM}×{p.wallHeightM}m)</option>
              ))}
              {Object.keys(presets).length === 0 && <option value="living_room">Living room</option>}
            </select>
            <button
              type="button" onClick={createRoom} disabled={busy}
              className="flex items-center gap-1 rounded bg-rose-600/80 hover:bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>

          {loading ? (
            <div className="py-6 text-center text-zinc-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
          ) : rooms.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-zinc-400 italic">No rooms yet. Create one to preview artworks at scale on your wall.</div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rooms.map((rm) => (
                <li key={rm.id}>
                  <button
                    type="button" onClick={() => openRoom(rm.id)}
                    className="w-full flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 p-2 text-left hover:border-rose-400/50 transition-colors"
                  >
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-100">{rm.name}</div>
                      <div className="text-[10px] text-zinc-400">{rm.wallWidthM}×{rm.wallHeightM}m · {rm.placementCount} hung</div>
                    </div>
                    <Home className="w-4 h-4 text-zinc-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setActive(null)} className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white">
              <ChevronLeft className="w-3.5 h-3.5" /> All rooms
            </button>
            <button type="button" onClick={() => deleteRoom(active.id)} disabled={busy} className="rounded border border-red-500/30 bg-red-500/10 p-1 text-red-300 hover:bg-red-500/20 disabled:opacity-40" aria-label="Delete room">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          <div>
            <h4 className="text-base font-bold text-white">{active.name}</h4>
            <p className="text-[11px] text-zinc-400">Wall {active.wallWidthM}×{active.wallHeightM}m · {active.placements.length} artwork(s)</p>
          </div>

          {/* At-scale wall preview — aspect ratio matches the physical wall. */}
          <div
            className="relative w-full rounded border border-rose-500/20 bg-gradient-to-b from-zinc-800/60 to-zinc-900 overflow-hidden"
            style={{ aspectRatio: `${active.wallWidthM} / ${active.wallHeightM}` }}
          >
            {/* floor line */}
            <div className="absolute bottom-0 left-0 right-0 h-[8%] bg-zinc-950/70 border-t border-zinc-700" />
            {active.placements.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-400 italic">
                Empty wall — place an artwork below
              </div>
            )}
            {active.placements.map((p) => {
              const wPct = (p.widthM / active.wallWidthM) * 100;
              // Assume artwork is roughly square unless image dictates otherwise.
              return (
                <div
                  key={p.id}
                  className="absolute group"
                  style={{
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    width: `${wPct}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <div className="rounded-sm border-2 border-amber-900/80 bg-zinc-950 shadow-lg overflow-hidden">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                      <img src={p.image} alt={p.title} className="w-full object-cover" style={{ aspectRatio: '1 / 1' }} />
                    ) : (
                      <div className="flex aspect-square items-center justify-center"><Frame className="w-5 h-5 text-zinc-700" /></div>
                    )}
                  </div>
                  <button
                    type="button" onClick={() => removePlacement(p.id)}
                    className="absolute -top-2 -right-2 hidden group-hover:flex rounded-full bg-red-600 p-0.5"
                    aria-label="Remove placement"
                  >
                    <Trash2 className="w-2.5 h-2.5 text-white" />
                  </button>
                  <div className="mt-0.5 text-center text-[8px] text-zinc-400 truncate">{p.title} · {p.widthM}m</div>
                </div>
              );
            })}
          </div>

          {/* Place-artwork form */}
          <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2.5 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold">Hang an artwork</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" value={aTitle} onChange={(e) => setATitle(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Artwork title *" />
              <input type="text" value={aArtist} onChange={(e) => setAArtist(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Artist" />
            </div>
            <input type="text" value={aImage} onChange={(e) => setAImage(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Image URL (optional)" />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                Width
                <input type="number" step="0.1" min="0.2" max={active.wallWidthM} value={aWidth} onChange={(e) => setAWidth(e.target.value)} className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-white" />
                m
              </label>
              <label className="flex items-center gap-1 text-[10px] text-zinc-400 flex-1">
                Position
                <input type="range" min="0" max="1" step="0.01" value={aX} onChange={(e) => setAX(e.target.value)} className="flex-1 accent-rose-500" />
              </label>
              <button type="button" onClick={placeArtwork} disabled={busy} className="flex items-center gap-1 rounded bg-rose-600/80 hover:bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Hang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
