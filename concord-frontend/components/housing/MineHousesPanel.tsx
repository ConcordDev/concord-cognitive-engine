'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Users, RefreshCcw, Plus, MapPin, Building2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { RoomEditor } from './RoomEditor';
import type {
  FurnitureItem, HouseDetail, HouseRow, LandClaim, LoadState, WorldBuilding,
} from './types';

export function MineHousesPanel({
  flash,
  onFlash,
}: {
  flash: { kind: 'ok' | 'err'; msg: string } | null;
  onFlash: (kind: 'ok' | 'err', msg: string) => void;
}) {
  const [myHouses, setMyHouses] = useState<HouseRow[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<HouseDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mineState, setMineState] = useState<LoadState>('idle');
  const [mineError, setMineError] = useState<string | null>(null);

  const [myClaims, setMyClaims] = useState<LandClaim[]>([]);
  const [claimsState, setClaimsState] = useState<LoadState>('idle');
  const [selectedClaimId, setSelectedClaimId] = useState<string>('');
  const [claimBuildings, setClaimBuildings] = useState<WorldBuilding[]>([]);
  const [buildingsState, setBuildingsState] = useState<LoadState>('idle');
  const [houseName, setHouseName] = useState('');
  const [claiming, setClaiming] = useState<string | null>(null);
  const [showClaimPanel, setShowClaimPanel] = useState(false);

  // F1 / S-HO-1: claim CREATION — the lifecycle's missing first verb.
  // The land_claims macro domain has always offered it; no surface did.
  const [claimWorld, setClaimWorld] = useState('tunya');
  const [claimX, setClaimX] = useState('');
  const [claimZ, setClaimZ] = useState('');
  const [claimRadius, setClaimRadius] = useState('25');
  const [worldBuildings, setWorldBuildings] = useState<WorldBuilding[]>([]);
  const [worldBuildingsState, setWorldBuildingsState] = useState<LoadState>('idle');
  const [claimingLand, setClaimingLand] = useState(false);
  const [landError, setLandError] = useState<string | null>(null);

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

  const loadHouseDetail = useCallback(async (houseId: string) => {
    try {
      const r = await fetch(`/api/housing/${encodeURIComponent(houseId)}`);
      const j = await r.json();
      if (j.ok) setSelectedHouse(j.house);
      else onFlash('err', j.error || j.reason || 'Could not load house.');
    } catch (e) {
      onFlash('err', e instanceof Error ? e.message : 'Network error');
    }
  }, [onFlash]);

  useEffect(() => { refreshMine(); }, [refreshMine]);

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

  const loadWorldBuildings = useCallback(async (worldId: string) => {
    setWorldBuildingsState('loading');
    try {
      const r = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/buildings`);
      const j = await r.json();
      if (!r.ok || !j.ok) { setWorldBuildingsState('error'); return; }
      setWorldBuildings((j.buildings as WorldBuilding[]) || []);
      setWorldBuildingsState('ready');
    } catch {
      setWorldBuildingsState('error');
    }
  }, []);

  useEffect(() => { if (showClaimPanel) loadWorldBuildings(claimWorld); }, [showClaimPanel, claimWorld, loadWorldBuildings]);

  const submitClaim = useCallback(async (x: number, z: number) => {
    setClaimingLand(true);
    setLandError(null);
    try {
      const radiusM = Math.max(5, Math.min(200, Number(claimRadius) || 25));
      const r = await lensRun<{ ok?: boolean; claimId?: string; reason?: string }>('land_claims', 'claim', { worldId: claimWorld, x, z, radiusM });
      const res = (r.data.result ?? r.data) as { ok?: boolean; claimId?: string; reason?: string };
      if (res && res.ok && res.claimId) {
        onFlash('ok', `Plot claimed in ${claimWorld} @(${Math.round(x)}, ${Math.round(z)}) — now claim a building on it as your house.`);
        await refreshClaims();
        setSelectedClaimId(res.claimId);
      } else {
        setLandError(
          res?.reason === 'overlap'
            ? 'That plot overlaps an existing claim — pick a spot further from other plots.'
            : res?.reason || 'Could not claim that plot.',
        );
      }
    } catch (e) {
      setLandError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setClaimingLand(false);
    }
  }, [claimWorld, claimRadius, onFlash, refreshClaims]);

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
        onFlash('ok', j.alreadyExisted ? 'That building is already a house.' : `Claimed "${houseName.trim() || 'My House'}".`);
        setHouseName('');
        refreshMine();
        loadClaimBuildings(selectedClaim);
      } else {
        onFlash('err', j.error || 'Claim failed.');
      }
    } catch (e) {
      onFlash('err', e instanceof Error ? e.message : 'Network error');
    } finally {
      setClaiming(null);
    }
  }, [selectedClaim, houseName, onFlash, refreshMine, loadClaimBuildings]);

  const setVisibility = useCallback(async (houseId: string, visibility: HouseRow['visibility']) => {
    setBusy(`vis-${houseId}`);
    try {
      await fetch(`/api/housing/${houseId}/visibility`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility }),
      });
      onFlash('ok', `Visibility set to ${visibility}.`);
      refreshMine();
      if (selectedHouse?.id === houseId) loadHouseDetail(houseId);
    } finally { setBusy(null); }
  }, [refreshMine, selectedHouse, loadHouseDetail, onFlash]);

  // Lifecycle exits (FIX-housing-001): rename + release (unclaim).
  const [renameDraft, setRenameDraft] = useState('');
  useEffect(() => { setRenameDraft(selectedHouse?.name || ''); }, [selectedHouse?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const renameHouse = useCallback(async (houseId: string) => {
    if (!renameDraft.trim()) return;
    setBusy(`rename-${houseId}`);
    try {
      const r = await lensRun('housing', 'rename', { houseId, name: renameDraft.trim() });
      if (r.data?.ok) {
        onFlash('ok', `Renamed to “${renameDraft.trim()}”.`);
        refreshMine();
        loadHouseDetail(houseId);
      } else {
        onFlash('err', r.data?.error || 'Rename failed.');
      }
    } finally { setBusy(null); }
  }, [renameDraft, refreshMine, loadHouseDetail, onFlash]);

  const unclaimHouse = useCallback(async (houseId: string, name: string) => {
    setBusy(`unclaim-${houseId}`);
    try {
      const r = await lensRun('housing', 'unclaim', { houseId });
      if (r.data?.ok) {
        onFlash('ok', `Released “${name}” — it is no longer your house.`);
        setSelectedHouse(null);
        refreshMine();
      } else {
        onFlash('err', r.data?.error || 'Release failed.');
      }
    } finally { setBusy(null); }
  }, [refreshMine, onFlash]);

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
        onFlash('ok', `Lock tier ${tier}.`);
        loadHouseDetail(houseId);
      } else onFlash('err', j.error || 'lock failed');
    } finally { setBusy(null); }
  }, [loadHouseDetail, onFlash]);

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
      else onFlash('err', j.error || 'place failed');
    } finally { setBusy(null); }
  }, [loadHouseDetail, onFlash]);

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
    <section className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-3">
      <aside className="rounded-xl border border-emerald-500/20 bg-zinc-950/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-wider text-emerald-300/60">My houses</h2>
          <div className="flex items-center gap-1">
            <button onClick={refreshMine} aria-label="Refresh" className="rounded-full border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-300 hover:bg-emerald-500/20">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowClaimPanel(v => !v)}
              data-testid="housing-claim-toggle"
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] ${showClaimPanel ? 'bg-emerald-500/30 text-emerald-100' : 'border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'}`}>
              <Plus className="h-3 w-3" /> Claim
            </button>
          </div>
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
              <p className="text-[11px] text-slate-500">No active land claims yet — claim your first plot below.</p>
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
                      <p className="py-2 text-[11px] text-slate-500">No unclaimed buildings on this plot yet. Buildings rise in the world itself — or claim a plot around an existing building below.</p>
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

            <div className="space-y-2 border-t border-emerald-500/15 pt-2.5" data-testid="housing-claim-land">
              <p className="flex items-center gap-1.5 text-[10px] text-emerald-300/80">
                <MapPin className="h-3 w-3" /> Claim new land — a circular plot in a world. Buildings on it can become your house.
              </p>
              <select
                value={claimWorld}
                onChange={(e) => setClaimWorld(e.target.value)}
                aria-label="World"
                className="w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                {['tunya', 'concordia-hub', 'sere'].map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
              {worldBuildingsState === 'loading' ? (
                <div className="h-5 animate-pulse rounded bg-slate-800/60" />
              ) : worldBuildingsState === 'ready' && worldBuildings.length > 0 ? (
                <ul className="max-h-32 space-y-1 overflow-y-auto" data-testid="housing-world-buildings">
                  {worldBuildings.slice(0, 12).map(b => (
                    <li key={b.id}>
                      <button
                        onClick={() => submitClaim(b.x, b.z)}
                        disabled={claimingLand}
                        className="flex w-full items-center justify-between rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-left text-[11px] text-slate-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 disabled:opacity-50">
                        <span className="flex items-center gap-1.5"><Building2 className="h-3 w-3 text-emerald-400" />{b.name || b.building_type || b.id} <span className="text-[10px] text-slate-500">@({Math.round(b.x)}, {Math.round(b.z)})</span></span>
                        <span className="text-[10px] text-emerald-300">claim land here</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-center gap-1.5">
                <input value={claimX} onChange={(e) => setClaimX(e.target.value)} placeholder="x" inputMode="numeric" aria-label="Anchor x" className="w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100" />
                <input value={claimZ} onChange={(e) => setClaimZ(e.target.value)} placeholder="z" inputMode="numeric" aria-label="Anchor z" className="w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100" />
                <input value={claimRadius} onChange={(e) => setClaimRadius(e.target.value)} placeholder="radius m" inputMode="numeric" aria-label="Radius (metres)" className="w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100" />
                <button
                  onClick={() => {
                    const x = claimX.trim();
                    const z = claimZ.trim();
                    if (x === '' || z === '' || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) {
                      setLandError('Enter the plot x and z before claiming.');
                      return;
                    }
                    void submitClaim(Number(x), Number(z));
                  }}
                  disabled={claimingLand}
                  className="shrink-0 rounded bg-emerald-500/80 px-2 py-1 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50">
                  {claimingLand ? 'claiming…' : 'Claim plot'}
                </button>
              </div>
              {landError && <p className="text-[11px] text-rose-300" role="alert">{landError}</p>}
            </div>
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

            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
              <input aria-label={`Name for ${selectedHouse.name}`} value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                className="min-h-[40px] flex-1 min-w-[160px] rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-[12px] text-slate-200" />
              <button onClick={() => void renameHouse(selectedHouse.id)}
                disabled={busy === `rename-${selectedHouse.id}` || !renameDraft.trim() || renameDraft.trim() === selectedHouse.name}
                className="rounded bg-emerald-500/20 px-2.5 py-1 text-emerald-100 disabled:opacity-40">Rename</button>
              <StickyDeleteConfirm
                armLabel="Release house"
                confirmLabel={`Release “${selectedHouse.name}”?`}
                armAriaLabel={`Release house ${selectedHouse.name}`}
                confirmAriaLabel={`Confirm release house ${selectedHouse.name}`}
                onConfirm={() => void unclaimHouse(selectedHouse.id, selectedHouse.name)}
                disabled={busy === `unclaim-${selectedHouse.id}`}
              />
            </div>

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
      {flash ? null : null}
    </section>
  );
}
