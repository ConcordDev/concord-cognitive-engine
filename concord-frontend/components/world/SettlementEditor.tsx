'use client';

/**
 * SettlementEditor — Wave 6 / T3.1.
 *
 * Player-facing surface for claiming land + placing buildings on the
 * claim. Reads from /api/settlement endpoints.
 *
 * Three modes:
 *   - "claims" — list owned claims, button to start a new claim
 *   - "new"    — input world coords + radius, POST /claim
 *   - "build"  — pick a building type, click to place via /claim/:id/building
 */

import { useCallback, useEffect, useState } from 'react';

interface LandClaim {
  id: string;
  owner_user_id: string;
  world_id: string;
  anchor_x: number;
  anchor_z: number;
  radius_m: number;
  bond_sparks: number;
  status: string;
}

interface Building {
  id: string;
  building_type: string;
  name: string | null;
  x: number;
  y: number;
  z: number;
  material: string;
  state: string;
}

interface Props {
  worldId?: string;
  playerX?: number;
  playerZ?: number;
  onClose?: () => void;
}

const BUILDING_TYPES = [
  'house', 'inn', 'market', 'forge', 'well',
  'tower', 'farm', 'mine', 'dock', 'warehouse',
] as const;
type BuildingType = typeof BUILDING_TYPES[number];

const MATERIALS = ['wood', 'stone', 'brick', 'steel', 'thatch'] as const;
type Material = typeof MATERIALS[number];

export default function SettlementEditor({ worldId = 'concordia-hub', playerX = 0, playerZ = 0, onClose }: Props) {
  const [mode, setMode] = useState<'claims' | 'new' | 'build'>('claims');
  const [claims, setClaims] = useState<LandClaim[]>([]);
  const [activeClaim, setActiveClaim] = useState<LandClaim | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Claim form state
  const [claimX, setClaimX] = useState<number>(playerX);
  const [claimZ, setClaimZ] = useState<number>(playerZ);
  const [claimR, setClaimR] = useState<number>(40);

  // Build form state
  const [bldType, setBldType] = useState<BuildingType>('house');
  const [bldMaterial, setBldMaterial] = useState<Material>('wood');
  const [bldX, setBldX] = useState<number>(0);
  const [bldZ, setBldZ] = useState<number>(0);
  const [bldName, setBldName] = useState<string>('');

  const refreshClaims = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/settlement/my-claims', { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) setClaims(j.claims ?? []);
      else setError(j?.error || 'failed');
    } catch (e) { setError(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  }, []);

  const loadBuildings = useCallback(async (claim: LandClaim) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/settlement/${encodeURIComponent(claim.id)}/buildings`, { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) {
        setBuildings(j.buildings ?? []);
        setActiveClaim(claim);
      }
    } catch { /* best-effort */ }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refreshClaims(); }, [refreshClaims]);

  const doClaim = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/settlement/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ worldId, x: claimX, z: claimZ, radiusM: claimR }),
      });
      const j = await r.json();
      if (j?.ok) { await refreshClaims(); setMode('claims'); }
      else setError(j?.reason || j?.error || 'failed');
    } catch (e) { setError(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  }, [worldId, claimX, claimZ, claimR, refreshClaims]);

  const doBuild = useCallback(async () => {
    if (!activeClaim) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/settlement/${encodeURIComponent(activeClaim.id)}/building`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          buildingType: bldType, x: bldX, z: bldZ, material: bldMaterial,
          name: bldName || undefined,
        }),
      });
      const j = await r.json();
      if (j?.ok) { await loadBuildings(activeClaim); setBldName(''); }
      else setError(j?.error || 'failed');
    } catch (e) { setError(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  }, [activeClaim, bldType, bldX, bldZ, bldMaterial, bldName, loadBuildings]);

  return (
    <div className="bg-slate-950/95 border border-amber-500/30 rounded-lg p-4 backdrop-blur-md w-[460px] max-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wider">
          {mode === 'claims' ? 'My Settlements' : mode === 'new' ? 'Claim New Land' : `Build in ${activeClaim?.id?.slice(0, 6)}`}
        </h3>
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">✕</button>}
      </div>

      {error && (
        <div className="mb-2 px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-[10px] text-red-300">
          {error}
        </div>
      )}

      {/* Claims list */}
      {mode === 'claims' && (
        <>
          <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
            {busy && <div className="text-xs text-slate-400 text-center py-4">Loading…</div>}
            {!busy && claims.length === 0 && (
              <div className="text-xs text-slate-400 text-center py-6 leading-relaxed">
                No claims yet. Plant your first stake on the map to build a settlement.
              </div>
            )}
            {claims.map((c) => (
              <button
                key={c.id}
                onClick={() => { void loadBuildings(c); setBldX(c.anchor_x); setBldZ(c.anchor_z); setMode('build'); }}
                className="w-full text-left border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 rounded px-2 py-1.5 transition-colors"
              >
                <div className="text-xs text-white font-semibold">
                  Claim @ ({c.anchor_x.toFixed(0)}, {c.anchor_z.toFixed(0)}) · radius {c.radius_m}m
                </div>
                <div className="text-[10px] text-slate-400">
                  {c.world_id} · bond {c.bond_sparks} · {c.status}
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => { setClaimX(playerX); setClaimZ(playerZ); setMode('new'); }}
            className="mt-3 px-3 py-1.5 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 text-[11px] uppercase tracking-wider"
          >
            + Claim Land
          </button>
        </>
      )}

      {/* New claim form */}
      {mode === 'new' && (
        <div className="space-y-2">
          <NumberRow label="World X" value={claimX} onChange={setClaimX} />
          <NumberRow label="World Z" value={claimZ} onChange={setClaimZ} />
          <NumberRow label="Radius (m)" value={claimR} onChange={setClaimR} min={5} max={200} />
          <div className="flex gap-2 mt-2">
            <button
              onClick={doClaim} disabled={busy}
              className="flex-1 px-2 py-1.5 rounded bg-amber-500/30 text-amber-100 hover:bg-amber-500/40 text-xs uppercase tracking-wider disabled:opacity-50"
            >
              Plant Stake
            </button>
            <button
              onClick={() => setMode('claims')}
              className="px-2 py-1.5 rounded border border-white/10 text-slate-300 hover:bg-slate-800 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Build form */}
      {mode === 'build' && activeClaim && (
        <>
          <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
            <div className="text-[10px] text-slate-400 mb-1">
              {buildings.length} building{buildings.length === 1 ? '' : 's'} in this claim
            </div>
            {buildings.map((b) => (
              <div key={b.id} className="border border-white/5 bg-slate-900/40 rounded px-2 py-1">
                <div className="text-xs text-white truncate">{b.name || b.building_type}</div>
                <div className="text-[10px] text-slate-400">
                  {b.building_type} · {b.material} · ({b.x.toFixed(0)}, {b.z.toFixed(0)}) · {b.state}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
            <div className="flex gap-2">
              <select value={bldType} onChange={(e) => setBldType(e.target.value as BuildingType)}
                className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white">
                {BUILDING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={bldMaterial} onChange={(e) => setBldMaterial(e.target.value as Material)}
                className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white">
                {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <NumberRow label="X" value={bldX} onChange={setBldX} />
            <NumberRow label="Z" value={bldZ} onChange={setBldZ} />
            <input
              type="text"
              placeholder="name (optional)"
              value={bldName}
              onChange={(e) => setBldName(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white"
            />
            <div className="flex gap-2">
              <button
                onClick={doBuild} disabled={busy}
                className="flex-1 px-2 py-1.5 rounded bg-amber-500/30 text-amber-100 hover:bg-amber-500/40 text-xs uppercase tracking-wider disabled:opacity-50"
              >
                Place
              </button>
              <button
                onClick={() => { setMode('claims'); setActiveClaim(null); }}
                className="px-2 py-1.5 rounded border border-white/10 text-slate-300 hover:bg-slate-800 text-xs"
              >
                Back
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NumberRow({
  label, value, onChange, min, max,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] uppercase tracking-wider text-slate-400 w-20">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white font-mono"
      />
    </div>
  );
}
