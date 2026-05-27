'use client';

/**
 * /lenses/housing — Phase BA1+BA2 player housing.
 *
 * Two views in one lens:
 *   - "My Houses" — list, decorate, lock, set visibility, toggle live.
 *   - "Visit" — browse public houses in a world; click to visit.
 *
 * Per-coord furniture placement uses a 2D grid editor (top-down view of
 * the room); the 3D walkthrough lives in HouseInteriorRenderer when the
 * player teleports in via the world lens.
 */

import { useCallback, useEffect, useState } from 'react';
import { Home, Lock, Eye, Users, RefreshCcw, Plus, Trash2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

interface HouseRow {
  id: string;
  user_id?: string;
  name: string | null;
  building_id: string;
  world_id?: string;
  visibility: 'private' | 'friends' | 'public';
  allow_live_visits: number;
  last_decorated_at: number;
}

interface FurnitureItem { itemId: string; x: number; y: number; z: number; rot: number; }
interface RoomDetail {
  id: string;
  room_type: string;
  name: string;
  width: number; depth: number; height: number;
  floor: number;
  lock_tier: number;
  lock_state: string;
  furniture_layout: FurnitureItem[];
  furniture: string[];
}
interface HouseDetail extends HouseRow {
  rooms: RoomDetail[];
}

export default function HousingLensPage() {
  const [tab, setTab] = useState<'mine' | 'visit'>('mine');
  const [myHouses, setMyHouses] = useState<HouseRow[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<HouseDetail | null>(null);
  const [worldId, setWorldId] = useState('tunya');
  const [publicHouses, setPublicHouses] = useState<HouseRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 2500);
  }, []);

  const refreshMine = useCallback(async () => {
    try {
      const r = await fetch('/api/housing/mine', { credentials: 'include' });
      const j = await r.json();
      if (j.ok) setMyHouses(j.houses || []);
    } catch { /* network */ }
  }, []);

  const refreshPublic = useCallback(async (wid: string) => {
    try {
      const r = await fetch(`/api/housing/world/${encodeURIComponent(wid)}/public`);
      const j = await r.json();
      if (j.ok) setPublicHouses(j.houses || []);
    } catch { /* network */ }
  }, []);

  const loadHouseDetail = useCallback(async (houseId: string) => {
    try {
      const r = await fetch(`/api/housing/${encodeURIComponent(houseId)}`);
      const j = await r.json();
      if (j.ok) setSelectedHouse(j.house);
    } catch { /* network */ }
  }, []);

  useEffect(() => { refreshMine(); }, [refreshMine]);
  useEffect(() => { if (tab === 'visit') refreshPublic(worldId); }, [tab, worldId, refreshPublic]);

  const setVisibility = useCallback(async (houseId: string, visibility: HouseRow['visibility']) => {
    setBusy(`vis-${houseId}`);
    try {
      await fetch(`/api/housing/${houseId}/visibility`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility }),
      });
      showFlash('ok', `Visibility set to ${visibility}.`);
      refreshMine();
      if (selectedHouse?.id === houseId) loadHouseDetail(houseId);
    } finally { setBusy(null); }
  }, [refreshMine, selectedHouse, loadHouseDetail, showFlash]);

  const toggleLiveVisits = useCallback(async (houseId: string, current: number) => {
    setBusy(`live-${houseId}`);
    try {
      await fetch(`/api/housing/${houseId}/visibility`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowLiveVisits: !current }),
      });
      refreshMine();
    } finally { setBusy(null); }
  }, [refreshMine]);

  const setLock = useCallback(async (houseId: string, roomId: string, tier: number) => {
    setBusy(`lock-${roomId}`);
    try {
      const r = await fetch(`/api/housing/${houseId}/lock`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, lockTier: tier }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', `Lock tier ${tier}.`);
        loadHouseDetail(houseId);
      } else showFlash('err', j.error || 'lock failed');
    } finally { setBusy(null); }
  }, [loadHouseDetail, showFlash]);

  const placeAt = useCallback(async (houseId: string, roomId: string, item: FurnitureItem) => {
    setBusy(`place-${item.itemId}`);
    try {
      const r = await fetch(`/api/housing/${houseId}/furniture/place`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, item }),
      });
      const j = await r.json();
      if (j.ok) loadHouseDetail(houseId);
      else showFlash('err', j.error || 'place failed');
    } finally { setBusy(null); }
  }, [loadHouseDetail, showFlash]);

  const removeItem = useCallback(async (houseId: string, roomId: string, itemId: string) => {
    setBusy(`rm-${itemId}`);
    try {
      await fetch(`/api/housing/${houseId}/furniture/remove`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, itemId }),
      });
      loadHouseDetail(houseId);
    } finally { setBusy(null); }
  }, [loadHouseDetail]);

  return (
    <LensShell lensId="housing" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-emerald-950/10 text-slate-100">
        <header className="border-b border-emerald-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
              <Home className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Housing</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Claim land, place a building, decorate, lock the door.</p>
            </div>
            <div className="flex gap-1">
              {(['mine', 'visit'] as const).map(t => (
                <button key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-2 py-1 text-xs ${tab === t ? 'bg-emerald-500/20 text-emerald-100' : 'text-slate-400 hover:text-slate-200'}`}>
                  {t === 'mine' ? 'My houses' : 'Visit'}
                </button>
              ))}
              <button onClick={refreshMine} aria-label="Refresh" className="ml-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-300 hover:bg-emerald-500/20">
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {flash && (
            <div className={`mx-auto mt-2 max-w-screen-2xl rounded-md px-3 py-1 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {flash.msg}
            </div>
          )}
        </header>

        {tab === 'mine' && (
          <section className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-3">
            <aside className="rounded-xl border border-emerald-500/20 bg-zinc-950/60 p-3">
              <h2 className="mb-2 text-[11px] uppercase tracking-wider text-emerald-300/60">My houses</h2>
              {myHouses.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-slate-500">No houses yet. Claim a land plot, place a building, then claim it as a house.</p>
              ) : (
                <ul className="space-y-1">
                  {myHouses.map(h => (
                    <li key={h.id}>
                      <button onClick={() => loadHouseDetail(h.id)}
                        className={`w-full rounded px-2 py-1 text-left text-[12px] ${selectedHouse?.id === h.id ? 'bg-emerald-500/20 text-emerald-100' : 'text-slate-300 hover:bg-slate-800/50'}`}>
                        {h.name || 'Unnamed'}
                        <span className="ml-2 text-[10px] text-slate-500">{h.visibility}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <div className="lg:col-span-2 rounded-xl border border-emerald-500/20 bg-zinc-950/60 p-4">
              {!selectedHouse ? (
                <div className="py-12 text-center text-[12px] text-slate-500">Select a house to manage it.</div>
              ) : (
                <>
                  <header className="mb-3 flex items-baseline justify-between gap-2">
                    <h2 className="text-base font-semibold text-emerald-100">{selectedHouse.name}</h2>
                    <div className="flex gap-1 text-[11px]">
                      {(['private', 'friends', 'public'] as const).map(v => (
                        <button key={v} onClick={() => setVisibility(selectedHouse.id, v)}
                          disabled={busy === `vis-${selectedHouse.id}`}
                          className={`rounded px-2 py-0.5 ${selectedHouse.visibility === v ? 'bg-emerald-500/30 text-emerald-100' : 'text-slate-400 hover:text-slate-200'}`}>
                          <Eye className="inline h-3 w-3 mr-1" />{v}
                        </button>
                      ))}
                      <button onClick={() => toggleLiveVisits(selectedHouse.id, selectedHouse.allow_live_visits)}
                        className={`rounded px-2 py-0.5 ${selectedHouse.allow_live_visits ? 'bg-sky-500/30 text-sky-100' : 'text-slate-400 hover:text-slate-200'}`}>
                        <Users className="inline h-3 w-3 mr-1" />{selectedHouse.allow_live_visits ? 'live on' : 'live off'}
                      </button>
                    </div>
                  </header>

                  <div className="space-y-3">
                    {selectedHouse.rooms.map(room => (
                      <RoomEditor
                        key={room.id}
                        room={room}
                        onLockChange={(tier) => setLock(selectedHouse.id, room.id, tier)}
                        onPlace={(item) => placeAt(selectedHouse.id, room.id, item)}
                        onRemove={(itemId) => removeItem(selectedHouse.id, room.id, itemId)}
                        busyKey={busy}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {tab === 'visit' && (
          <section className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6">
            <div className="mb-3 flex items-center gap-2 text-[12px]">
              <span className="text-slate-400">World:</span>
              <input value={worldId} onChange={(e) => setWorldId(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-100" />
              <button onClick={() => refreshPublic(worldId)} className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-100">Browse</button>
            </div>
            {publicHouses.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-slate-500">No public houses in this world yet.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {publicHouses.map(h => (
                  <li key={h.id} className="rounded-xl border border-emerald-500/20 bg-zinc-950/60 p-3">
                    <h3 className="font-semibold text-emerald-100">{h.name || 'Unnamed'}</h3>
                    <p className="mt-0.5 text-[10px] text-emerald-300/60">{h.allow_live_visits ? 'Live visits open' : 'Snapshot only'}</p>
                    <button
                      onClick={() => fetch(`/api/housing/${h.id}/visit`, {
                        method: 'POST', credentials: 'include',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ isFriend: false }),
                      }).then(r => r.json()).then(j => showFlash(j.ok ? 'ok' : 'err', j.ok ? `Entered in ${j.mode} mode` : (j.error || 'visit failed')))}
                      className="mt-2 w-full rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/30">
                      Visit
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </LensShell>
  );
}

interface RoomEditorProps {
  room: RoomDetail;
  onLockChange: (tier: number) => void;
  onPlace: (item: FurnitureItem) => void;
  onRemove: (itemId: string) => void;
  busyKey: string | null;
}

function RoomEditor({ room, onLockChange, onPlace, onRemove, busyKey }: RoomEditorProps) {
  const [newItem, setNewItem] = useState({ itemId: '', x: 0, y: 0, z: 0, rot: 0 });

  return (
    <div className="rounded border border-emerald-500/20 bg-zinc-900/50 p-2">
      <header className="mb-2 flex items-center justify-between text-[12px]">
        <span className="font-medium text-emerald-200">{room.name} <span className="text-[10px] text-slate-500">{room.room_type} · {room.width}×{room.depth}</span></span>
        <div className="flex items-center gap-1">
          <Lock className="h-3 w-3 text-amber-400" />
          {[0, 1, 2, 3, 4, 5].map(t => (
            <button key={t} onClick={() => onLockChange(t)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${room.lock_tier === t ? 'bg-amber-500/30 text-amber-100' : 'text-slate-500 hover:text-slate-300'}`}>
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-1 text-[11px]">
        {room.furniture_layout && room.furniture_layout.length > 0 ? room.furniture_layout.map(f => (
          <div key={f.itemId} className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1">
            <span className="text-slate-200">{f.itemId} <span className="text-[10px] text-slate-500">@({f.x.toFixed(1)}, {f.y.toFixed(1)}, {f.z.toFixed(1)}) rot {f.rot.toFixed(0)}°</span></span>
            <button onClick={() => onRemove(f.itemId)} disabled={busyKey === `rm-${f.itemId}`} aria-label="Remove" className="rounded p-1 text-rose-400 hover:bg-rose-500/20 disabled:opacity-40">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )) : (
          <p className="text-[10px] text-slate-500">Empty.</p>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (newItem.itemId) { onPlace(newItem); setNewItem({ itemId: '', x: 0, y: 0, z: 0, rot: 0 }); } }}
        className="mt-2 grid grid-cols-6 gap-1 text-[10px]">
        <input placeholder="itemId" value={newItem.itemId} onChange={(e) => setNewItem({ ...newItem, itemId: e.target.value })}
          className="col-span-2 rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <input type="number" step="0.5" placeholder="x" value={newItem.x} onChange={(e) => setNewItem({ ...newItem, x: Number(e.target.value) })}
          className="rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <input type="number" step="0.5" placeholder="z" value={newItem.z} onChange={(e) => setNewItem({ ...newItem, z: Number(e.target.value) })}
          className="rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <input type="number" placeholder="rot" value={newItem.rot} onChange={(e) => setNewItem({ ...newItem, rot: Number(e.target.value) })}
          className="rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <button type="submit" className="rounded bg-emerald-500/20 px-1 py-0.5 text-emerald-100 hover:bg-emerald-500/30">
          <Plus className="inline h-3 w-3" /> place
        </button>
      </form>
    </div>
  );
}
