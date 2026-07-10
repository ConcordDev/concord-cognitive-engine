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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Home, Lock, Eye, Users, RefreshCcw, Plus, Trash2, MapPin, Building2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { lensRun } from '@/lib/api/client';

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

interface LandClaim {
  id: string;
  world_id: string;
  anchor_x: number;
  anchor_z: number;
  radius_m: number;
  status: string;
  owner_user_id: string;
}

interface WorldBuilding {
  id: string;
  world_id: string;
  building_type?: string;
  name?: string;
  x: number;
  z: number;
  owner_type?: string;
  owner_id?: string;
  state?: string;
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

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export default function HousingLensPage() {
  const [tab, setTab] = useState<'mine' | 'visit'>('mine');
  const [myHouses, setMyHouses] = useState<HouseRow[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<HouseDetail | null>(null);
  const [worldId, setWorldId] = useState('tunya');
  const [publicHouses, setPublicHouses] = useState<HouseRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [mineState, setMineState] = useState<LoadState>('idle');
  const [mineError, setMineError] = useState<string | null>(null);
  const [publicState, setPublicState] = useState<LoadState>('idle');
  const [publicError, setPublicError] = useState<string | null>(null);

  // Claim-a-house flow: land_claims.list_for_user -> pick a claim -> buildings
  // in that claim's world (filtered client-side to inside the claim radius
  // and not already housed) -> POST /api/housing/claim.
  const [myClaims, setMyClaims] = useState<LandClaim[]>([]);
  const [claimsState, setClaimsState] = useState<LoadState>('idle');
  const [selectedClaimId, setSelectedClaimId] = useState<string>('');
  const [claimBuildings, setClaimBuildings] = useState<WorldBuilding[]>([]);
  const [buildingsState, setBuildingsState] = useState<LoadState>('idle');
  const [houseName, setHouseName] = useState('');
  const [claiming, setClaiming] = useState<string | null>(null);
  const [showClaimPanel, setShowClaimPanel] = useState(false);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 2500);
  }, []);

  const refreshMine = useCallback(async () => {
    setMineState('loading');
    setMineError(null);
    try {
      const r = await fetch('/api/housing/mine', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMineError(j?.error || j?.reason || `Request failed (${r.status})`);
        setMineState('error');
        return;
      }
      setMyHouses(j.houses || []);
      setMineState('ready');
    } catch (e) {
      setMineError(e instanceof Error ? e.message : 'Network error');
      setMineState('error');
    }
  }, []);

  const refreshPublic = useCallback(async (wid: string) => {
    setPublicState('loading');
    setPublicError(null);
    try {
      const r = await fetch(`/api/housing/world/${encodeURIComponent(wid)}/public`);
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setPublicError(j?.error || j?.reason || `Request failed (${r.status})`);
        setPublicState('error');
        return;
      }
      setPublicHouses(j.houses || []);
      setPublicState('ready');
    } catch (e) {
      setPublicError(e instanceof Error ? e.message : 'Network error');
      setPublicState('error');
    }
  }, []);

  const loadHouseDetail = useCallback(async (houseId: string) => {
    try {
      const r = await fetch(`/api/housing/${encodeURIComponent(houseId)}`);
      const j = await r.json();
      if (j.ok) setSelectedHouse(j.house);
      else showFlash('err', j.error || j.reason || 'Could not load house.');
    } catch (e) {
      showFlash('err', e instanceof Error ? e.message : 'Network error');
    }
  }, [showFlash]);

  useEffect(() => { refreshMine(); }, [refreshMine]);
  useEffect(() => { if (tab === 'visit') refreshPublic(worldId); }, [tab, worldId, refreshPublic]);

  const refreshClaims = useCallback(async () => {
    setClaimsState('loading');
    try {
      const r = await lensRun<{ claims: LandClaim[] }>('land_claims', 'list_for_user');
      if (r.data.ok && r.data.result) {
        const owned = (r.data.result.claims || []).filter(c => c.status === 'active');
        setMyClaims(owned);
        setClaimsState('ready');
        if (owned.length && !selectedClaimId) setSelectedClaimId(owned[0].id);
      } else {
        setClaimsState('error');
      }
    } catch {
      setClaimsState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (showClaimPanel && claimsState === 'idle') refreshClaims(); }, [showClaimPanel, claimsState, refreshClaims]);

  const selectedClaim = useMemo(() => myClaims.find(c => c.id === selectedClaimId) || null, [myClaims, selectedClaimId]);
  const housedBuildingIds = useMemo(() => new Set(myHouses.map(h => h.building_id)), [myHouses]);

  const loadClaimBuildings = useCallback(async (claim: LandClaim) => {
    setBuildingsState('loading');
    try {
      const r = await fetch(`/api/worlds/${encodeURIComponent(claim.world_id)}/buildings`);
      const j = await r.json();
      if (!r.ok || !j.ok) { setBuildingsState('error'); return; }
      const inside = (j.buildings as WorldBuilding[]).filter(b => {
        const dx = b.x - claim.anchor_x;
        const dz = b.z - claim.anchor_z;
        return Math.hypot(dx, dz) <= claim.radius_m;
      });
      setClaimBuildings(inside);
      setBuildingsState('ready');
    } catch {
      setBuildingsState('error');
    }
  }, []);

  useEffect(() => { if (selectedClaim) loadClaimBuildings(selectedClaim); }, [selectedClaim, loadClaimBuildings]);

  const claimAsHouse = useCallback(async (building: WorldBuilding) => {
    if (!selectedClaim) return;
    setClaiming(building.id);
    try {
      const r = await fetch('/api/housing/claim', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ landClaimId: selectedClaim.id, buildingId: building.id, name: houseName.trim() || undefined }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', j.alreadyExisted ? 'That building is already a house.' : `Claimed "${houseName.trim() || 'My House'}".`);
        setHouseName('');
        refreshMine();
        loadClaimBuildings(selectedClaim);
      } else {
        showFlash('err', j.error || 'Claim failed.');
      }
    } catch (e) {
      showFlash('err', e instanceof Error ? e.message : 'Network error');
    } finally {
      setClaiming(null);
    }
  }, [selectedClaim, houseName, showFlash, refreshMine, loadClaimBuildings]);

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
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[11px] uppercase tracking-wider text-emerald-300/60">My houses</h2>
                <button
                  onClick={() => setShowClaimPanel(v => !v)}
                  data-testid="housing-claim-toggle"
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] ${showClaimPanel ? 'bg-emerald-500/30 text-emerald-100' : 'border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'}`}>
                  <Plus className="h-3 w-3" /> Claim
                </button>
              </div>
              {mineState === 'loading' ? (
                <div role="status" aria-live="polite" className="space-y-1.5 py-2" data-testid="housing-mine-loading">
                  <span className="sr-only">Loading your houses…</span>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-6 animate-pulse rounded bg-slate-800/60" aria-hidden="true" />
                  ))}
                </div>
              ) : mineState === 'error' ? (
                <div role="alert" className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-200" data-testid="housing-mine-error">
                  <p className="mb-2">Couldn&apos;t load your houses: {mineError}</p>
                  <button onClick={refreshMine} className="rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-500/30">
                    <RefreshCcw className="mr-1 inline h-3 w-3" />Retry
                  </button>
                </div>
              ) : myHouses.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-slate-500" data-testid="housing-mine-empty">
                  <p>No houses yet.</p>
                  <button onClick={() => setShowClaimPanel(true)} className="mt-1 text-emerald-300 underline decoration-dotted hover:text-emerald-200">
                    Claim a building on your land as a house →
                  </button>
                </div>
              ) : (
                <ul className="space-y-1" data-testid="housing-mine-list">
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

              {showClaimPanel && (
                <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5" data-testid="housing-claim-panel">
                  <p className="flex items-center gap-1.5 text-[10px] text-emerald-300/80">
                    <MapPin className="h-3 w-3" /> Claim a building inside one of your land claims as a house.
                  </p>
                  {claimsState === 'loading' ? (
                    <div className="h-5 animate-pulse rounded bg-slate-800/60" />
                  ) : claimsState === 'error' ? (
                    <p className="text-[11px] text-rose-300">Couldn&apos;t load your land claims.</p>
                  ) : myClaims.length === 0 ? (
                    <p className="text-[11px] text-slate-500">No active land claims. Claim a plot from the <span className="text-emerald-300">Land Claims</span> lens first.</p>
                  ) : (
                    <>
                      <select
                        value={selectedClaimId}
                        onChange={(e) => setSelectedClaimId(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                        {myClaims.map(c => (
                          <option key={c.id} value={c.id}>{c.world_id} — plot @({c.anchor_x.toFixed(0)}, {c.anchor_z.toFixed(0)}) r{c.radius_m}m</option>
                        ))}
                      </select>
                      <input
                        value={houseName}
                        onChange={(e) => setHouseName(e.target.value)}
                        placeholder="House name (optional)"
                        className="w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100" />
                      {buildingsState === 'loading' ? (
                        <div className="h-10 animate-pulse rounded bg-slate-800/60" />
                      ) : buildingsState === 'error' ? (
                        <p className="text-[11px] text-rose-300">Couldn&apos;t load buildings for this plot.</p>
                      ) : (
                        <ul className="max-h-40 space-y-1 overflow-y-auto" data-testid="housing-claim-buildings">
                          {claimBuildings.filter(b => !housedBuildingIds.has(b.id)).length === 0 ? (
                            <p className="py-2 text-[11px] text-slate-500">No unclaimed buildings on this plot yet. Place a building here in the world lens first.</p>
                          ) : claimBuildings.filter(b => !housedBuildingIds.has(b.id)).map(b => (
                            <li key={b.id}>
                              <button
                                onClick={() => claimAsHouse(b)}
                                disabled={claiming === b.id}
                                className="flex w-full items-center justify-between rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-left text-[11px] text-slate-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 disabled:opacity-50">
                                <span className="flex items-center gap-1.5"><Building2 className="h-3 w-3 text-emerald-400" />{b.name || b.building_type || b.id}</span>
                                <span className="text-[10px] text-emerald-300">{claiming === b.id ? 'claiming…' : 'claim'}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </aside>

            <div className="lg:col-span-2 rounded-xl border border-emerald-500/20 bg-zinc-950/60 p-4">
              {!selectedHouse ? (
                <div className="py-12 text-center text-[12px] text-slate-500">Select a house to manage it, or use &quot;Claim&quot; on the left to turn a building on your land into a house.</div>
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
            {publicState === 'loading' ? (
              <div role="status" aria-live="polite" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="housing-public-loading">
                <span className="sr-only">Loading public houses…</span>
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-800/60" aria-hidden="true" />
                ))}
              </div>
            ) : publicState === 'error' ? (
              <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-[12px] text-rose-200" data-testid="housing-public-error">
                <p className="mb-2">Couldn&apos;t load public houses: {publicError}</p>
                <button onClick={() => refreshPublic(worldId)} className="rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-500/30">
                  <RefreshCcw className="mr-1 inline h-3 w-3" />Retry
                </button>
              </div>
            ) : publicHouses.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-slate-500" data-testid="housing-public-empty">No public houses in this world yet.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="housing-public-list">
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
