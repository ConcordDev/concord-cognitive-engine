'use client';

/**
 * WorldAdventureKitPanel — the 3D open-world feature-parity surface.
 *
 * Eight tabbed gameplay-UX systems, each wired to a `world` domain macro
 * via lensRun. Every value is real user input or computed from real
 * platform state — no seed/demo data. Empty states say "no data yet".
 *
 *   1. Build    — in-world placement editor   (placement-* macros)
 *   2. Bag      — inventory / equipment       (inventory-* macros)
 *   3. Party    — co-op grouping              (party-* macros)
 *   4. Map      — minimap + fast-travel       (marker-* macros)
 *   5. Mounts   — summon / dismiss roster     (mount-* macros)
 *   6. Combat   — lock-on, dodge, cooldowns   (combat-* macros)
 *   7. Perf     — LOD / streaming presets     (streaming-prefs-* macros)
 *   8. Photos   — photo mode + gallery        (photo-* macros)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Loader2, Hammer, Backpack, Users, Map as MapIcon, Rabbit, Swords,
  Gauge, Camera, Trash2, Plus, Pin, Globe2,
} from 'lucide-react';
import Image from 'next/image';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── Shared types ───────────────────────────────────────────────────

interface Placement {
  id: string; worldId: string; kind: string;
  x: number; y: number; z: number;
  rotation: number; scale: number; color: string | null; label: string;
}
interface InvItem {
  id: string; name: string; kind: string; slot: string | null;
  rarity: string; quantity: number; icon: string | null;
}
interface Inventory { items: InvItem[]; slots: Record<string, string | null>; slotNames: string[]; }
interface Party {
  id: string; name: string; leaderId: string; members: string[];
  memberCount: number; objective: string | null; worldId: string;
}
interface Marker {
  id: string; worldId: string; name: string; kind: string;
  x: number; y: number; z: number; fastTravel: boolean;
}
interface Mount {
  id: string; name: string; species: string; speed: number;
  stamina: number; kind: string;
}
interface Ability {
  id: string; name: string; slot: number; element: string;
  cooldownMs: number; cooldownRemainingMs: number; ready: boolean;
}
interface CombatPrefs {
  lockOn: boolean; dodgeStyle: string; blockEnabled: boolean; abilities: Ability[];
}
interface StreamPrefs {
  drawDistanceM: number; lodBias: number; shadowQuality: string;
  maxVisibleEntities: number; foliageDensity: number; streamingEnabled: boolean;
}
interface Photo {
  id: string; worldId: string; imageUrl: string; caption: string;
  filter: string; ownerId: string; public: boolean; likes: number;
}

interface Props {
  worldId: string;
  open: boolean;
  onClose: () => void;
}

type Tab = 'build' | 'bag' | 'party' | 'map' | 'mounts' | 'combat' | 'perf' | 'photos';

const TABS: { id: Tab; label: string; icon: typeof Hammer }[] = [
  { id: 'build', label: 'Build', icon: Hammer },
  { id: 'bag', label: 'Bag', icon: Backpack },
  { id: 'party', label: 'Party', icon: Users },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'mounts', label: 'Mounts', icon: Rabbit },
  { id: 'combat', label: 'Combat', icon: Swords },
  { id: 'perf', label: 'Perf', icon: Gauge },
  { id: 'photos', label: 'Photos', icon: Camera },
];

const PLACEMENT_KINDS = [
  'wall', 'floor', 'roof', 'door', 'window', 'pillar',
  'fence', 'light', 'decoration', 'prop', 'platform', 'stair',
];
const MARKER_KINDS = ['waypoint', 'town', 'dungeon', 'vendor', 'resource', 'danger', 'home', 'portal'];
const ELEMENTS = ['physical', 'fire', 'ice', 'lightning', 'bio', 'energy', 'poison'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_COLOR: Record<string, string> = {
  common: '#9ca3af', uncommon: '#4ade80', rare: '#60a5fa',
  epic: '#c084fc', legendary: '#fbbf24',
};

const inputCls =
  'bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white ' +
  'placeholder-gray-600 focus:outline-none focus:border-cyan-500/50';

// ── Component ──────────────────────────────────────────────────────

export function WorldAdventureKitPanel({ worldId, open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('build');

  if (!open) return null;

  return (
    <div className="fixed top-20 left-4 w-[440px] max-w-[100vw] max-h-[78vh] z-40 bg-[#0d1117]/97 backdrop-blur border border-cyan-500/30 rounded-lg shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-2 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-200 tracking-wider">
            Adventure kit
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close adventure kit"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="flex border-b border-white/10 bg-black/30 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 min-w-[52px] flex flex-col items-center gap-0.5 py-1.5 text-[10px] transition-colors',
              tab === t.id
                ? 'text-cyan-300 border-b-2 border-cyan-400 bg-cyan-500/5'
                : 'text-gray-500 border-b-2 border-transparent hover:text-gray-300',
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'build' && <BuildTab worldId={worldId} />}
        {tab === 'bag' && <BagTab />}
        {tab === 'party' && <PartyTab worldId={worldId} />}
        {tab === 'map' && <MapTab worldId={worldId} />}
        {tab === 'mounts' && <MountsTab />}
        {tab === 'combat' && <CombatTab />}
        {tab === 'perf' && <PerfTab />}
        {tab === 'photos' && <PhotosTab worldId={worldId} />}
      </div>
    </div>
  );
}

// ── 1. Build — in-world placement editor ───────────────────────────

function BuildTab({ worldId }: { worldId: string }) {
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('wall');
  const [coords, setCoords] = useState({ x: '0', y: '0', z: '0' });
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('world', 'placement-list', { worldId });
    if (r.data.ok && r.data.result) {
      setPlacements((r.data.result as { placements: Placement[] }).placements);
    }
    setLoading(false);
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setBusy(true); setErr(null);
    const r = await lensRun('world', 'placement-create', {
      worldId, kind,
      x: Number(coords.x), y: Number(coords.y), z: Number(coords.z),
      label: label.trim(),
    });
    if (r.data.ok) { setLabel(''); await refresh(); }
    else setErr(r.data.error || 'Failed to place');
    setBusy(false);
  };

  const remove = async (id: string) => {
    await lensRun('world', 'placement-delete', { id });
    await refresh();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Place structures directly in the 3D scene. Each placement is a real,
        editable record at world coordinates.
      </p>
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={cn(inputCls, 'w-full')}>
          {PLACEMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <div className="grid grid-cols-3 gap-1.5">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <input
              key={axis}
              type="number"
              value={coords[axis]}
              onChange={(e) => setCoords((c) => ({ ...c, [axis]: e.target.value }))}
              placeholder={axis}
              className={inputCls}
              aria-label={`${axis} coordinate`}
            />
          ))}
        </div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className={cn(inputCls, 'w-full')}
        />
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Place {kind}
        </button>
        {err && <p className="text-[10px] text-red-400">{err}</p>}
      </div>

      {loading ? (
        <Spinner />
      ) : placements.length === 0 ? (
        <EmptyState label="No placements yet" />
      ) : (
        <ul className="space-y-1">
          {placements.map((p) => (
            <li key={p.id} className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-2 py-1.5 text-xs">
              <span className="text-cyan-300 font-medium capitalize">{p.kind}</span>
              {p.label && <span className="text-gray-400 truncate">{p.label}</span>}
              <span className="text-[10px] text-gray-600 ml-auto">
                ({p.x.toFixed(0)}, {p.y.toFixed(0)}, {p.z.toFixed(0)})
              </span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-red-400"
                aria-label="Delete placement"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 2. Bag — inventory / equipment ─────────────────────────────────

function BagTab() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [slot, setSlot] = useState('');
  const [rarity, setRarity] = useState('common');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('world', 'inventory-get', {});
    if (r.data.ok && r.data.result) setInv(r.data.result as Inventory);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await lensRun('world', 'inventory-add-item', {
      name: name.trim(), rarity, ...(slot ? { slot } : {}),
    });
    setName(''); setSlot('');
    await refresh();
    setBusy(false);
  };

  const equip = async (item: InvItem) => {
    if (!item.slot) return;
    await lensRun('world', 'inventory-equip', { id: item.id, slot: item.slot });
    await refresh();
  };
  const unequip = async (s: string) => {
    await lensRun('world', 'inventory-unequip', { slot: s });
    await refresh();
  };
  const remove = async (id: string) => {
    await lensRun('world', 'inventory-remove-item', { id });
    await refresh();
  };

  const slotNames = inv?.slotNames || [];
  const itemById = useMemo(() => {
    const m = new Map<string, InvItem>();
    inv?.items.forEach((i) => m.set(i.id, i));
    return m;
  }, [inv]);

  return (
    <div className="space-y-3">
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Equipment slots</p>
        <div className="grid grid-cols-4 gap-1.5">
          {slotNames.map((s) => {
            const equipped = inv?.slots[s] ? itemById.get(inv.slots[s]!) : null;
            return (
              <button
                key={s}
                type="button"
                onClick={() => equipped && unequip(s)}
                title={equipped ? `${equipped.name} — click to unequip` : `${s} (empty)`}
                className={cn(
                  'aspect-square rounded border flex flex-col items-center justify-center p-1 text-[8px]',
                  equipped
                    ? 'border-cyan-500/40 bg-cyan-500/10'
                    : 'border-dashed border-white/10 bg-black/20 text-gray-600',
                )}
              >
                <span className="capitalize text-gray-500">{s}</span>
                {equipped && (
                  <span
                    className="font-medium truncate w-full text-center"
                    style={{ color: RARITY_COLOR[equipped.rarity] }}
                  >
                    {equipped.name}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
          className={cn(inputCls, 'w-full')}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <select value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls} aria-label="Item slot">
            <option value="">No slot</option>
            {slotNames.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} className={inputCls} aria-label="Item rarity">
            {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={busy || !name.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Add item
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : !inv || inv.items.length === 0 ? (
        <EmptyState label="No items yet" />
      ) : (
        <ul className="space-y-1">
          {inv.items.map((it) => {
            const isEquipped = !!it.slot && inv.slots[it.slot] === it.id;
            return (
              <li key={it.id} className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-2 py-1.5 text-xs">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: RARITY_COLOR[it.rarity] }} />
                <span className="font-medium" style={{ color: RARITY_COLOR[it.rarity] }}>{it.name}</span>
                {it.quantity > 1 && <span className="text-gray-500">×{it.quantity}</span>}
                {it.slot && <span className="text-[10px] text-gray-600 capitalize">{it.slot}</span>}
                <div className="ml-auto flex items-center gap-1">
                  {it.slot && (
                    <button
                      type="button"
                      onClick={() => (isEquipped ? unequip(it.slot!) : equip(it))}
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] border',
                        isEquipped
                          ? 'border-amber-500/30 text-amber-300'
                          : 'border-cyan-500/30 text-cyan-300',
                      )}
                    >
                      {isEquipped ? 'Unequip' : 'Equip'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-red-400"
                    aria-label="Remove item"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── 3. Party — co-op grouping ──────────────────────────────────────

function PartyTab({ worldId }: { worldId: string }) {
  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [joinId, setJoinId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('world', 'party-get', {});
    if (r.data.ok && r.data.result) setParty((r.data.result as { party: Party | null }).party);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setErr(null);
    const r = await lensRun('world', 'party-create', {
      name: name.trim(), objective: objective.trim(), worldId,
    });
    if (r.data.ok) { setName(''); setObjective(''); await refresh(); }
    else setErr(r.data.error || 'Failed to create party');
  };
  const join = async () => {
    setErr(null);
    const r = await lensRun('world', 'party-join', { partyId: joinId.trim() });
    if (r.data.ok) { setJoinId(''); await refresh(); }
    else setErr(r.data.error || 'Failed to join');
  };
  const leave = async () => { await lensRun('world', 'party-leave', {}); await refresh(); };
  const saveObjective = async () => {
    await lensRun('world', 'party-set-objective', { objective: objective.trim() });
    await refresh();
  };

  if (loading) return <Spinner />;

  if (party) {
    return (
      <div className="space-y-3">
        <div className="bg-white/[0.03] border border-cyan-500/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white">{party.name}</span>
            <span className="text-[10px] text-gray-500 ml-auto">{party.memberCount}/8</span>
          </div>
          <p className="text-[10px] text-gray-500 font-mono select-all">{party.id}</p>
          <ul className="space-y-1">
            {party.members.map((m) => (
              <li key={m} className="flex items-center gap-1.5 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-gray-300 truncate">{m}</span>
                {m === party.leaderId && <span className="text-[9px] text-amber-400">leader</span>}
              </li>
            ))}
          </ul>
          <div className="pt-1 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Shared objective</p>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder={party.objective || 'Set a party objective…'}
              rows={2}
              className={cn(inputCls, 'w-full resize-none')}
            />
            {party.objective && !objective && (
              <p className="text-xs text-gray-300">{party.objective}</p>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={saveObjective}
                className="flex-1 py-1 text-[10px] rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30"
              >
                Set objective
              </button>
              <button
                type="button"
                onClick={leave}
                className="flex-1 py-1 text-[10px] rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
              >
                Leave party
              </button>
            </div>
          </div>
        </div>
        {err && <p className="text-[10px] text-red-400">{err}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Create a party</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Party name"
          className={cn(inputCls, 'w-full')}
        />
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Objective (optional)"
          className={cn(inputCls, 'w-full')}
        />
        <button
          type="button"
          onClick={create}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30"
        >
          <Plus className="w-3 h-3" /> Create party
        </button>
      </div>
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Join with party ID</p>
        <input
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          placeholder="party_…"
          className={cn(inputCls, 'w-full font-mono')}
        />
        <button
          type="button"
          onClick={join}
          disabled={!joinId.trim()}
          className="w-full py-1.5 text-xs rounded bg-white/5 text-gray-300 border border-white/10 hover:border-cyan-500/30 disabled:opacity-50"
        >
          Join party
        </button>
      </div>
      {err && <p className="text-[10px] text-red-400">{err}</p>}
    </div>
  );
}

// ── 4. Map — minimap + fast-travel markers ─────────────────────────

function MapTab({ worldId }: { worldId: string }) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('waypoint');
  const [coords, setCoords] = useState({ x: '0', z: '0' });
  const [fastTravel, setFastTravel] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('world', 'marker-list', { worldId });
    if (r.data.ok && r.data.result) {
      setMarkers((r.data.result as { markers: Marker[] }).markers);
    }
    setLoading(false);
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) return;
    await lensRun('world', 'marker-create', {
      worldId, name: name.trim(), kind,
      x: Number(coords.x), z: Number(coords.z), fastTravel,
    });
    setName(''); setFastTravel(false);
    await refresh();
  };
  const remove = async (id: string) => {
    await lensRun('world', 'marker-delete', { id });
    await refresh();
  };
  const travel = async (id: string) => {
    const r = await lensRun('world', 'marker-fast-travel', { id });
    if (r.data.ok && r.data.result) {
      const dest = (r.data.result as { destination: { x: number; y: number; z: number } }).destination;
      window.dispatchEvent(new CustomEvent('world:fast-travel', { detail: dest }));
    }
  };

  // Bounds for the minimap projection — derived from real marker coords.
  const bounds = useMemo(() => {
    if (markers.length === 0) return { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    const xs = markers.map((m) => m.x);
    const zs = markers.map((m) => m.z);
    const pad = 30;
    return {
      minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad,
      minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad,
    };
  }, [markers]);
  const project = (m: Marker) => ({
    cx: ((m.x - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * 280 + 10,
    cy: ((m.z - bounds.minZ) / (bounds.maxZ - bounds.minZ || 1)) * 180 + 10,
  });

  return (
    <div className="space-y-3">
      {markers.length > 0 && (
        <svg viewBox="0 0 300 200" className="w-full bg-black/40 rounded border border-white/10">
          {markers.map((m) => {
            const { cx, cy } = project(m);
            return (
              <g key={m.id}>
                <circle
                  cx={cx} cy={cy} r={m.fastTravel ? 5 : 3}
                  fill={m.fastTravel ? '#22d3ee' : '#6b7280'}
                  stroke={m.fastTravel ? '#67e8f9' : '#9ca3af'}
                  strokeWidth={1}
                />
                <text x={cx + 7} y={cy + 3} fill="#d1d5db" fontSize="8">{m.name}</text>
              </g>
            );
          })}
        </svg>
      )}

      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Marker name"
          className={cn(inputCls, 'w-full')}
        />
        <div className="grid grid-cols-3 gap-1.5">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls} aria-label="Marker kind">
            {MARKER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input
            type="number" value={coords.x}
            onChange={(e) => setCoords((c) => ({ ...c, x: e.target.value }))}
            placeholder="x" className={inputCls} aria-label="x coordinate"
          />
          <input
            type="number" value={coords.z}
            onChange={(e) => setCoords((c) => ({ ...c, z: e.target.value }))}
            placeholder="z" className={inputCls} aria-label="z coordinate"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <input
            type="checkbox" checked={fastTravel}
            onChange={(e) => setFastTravel(e.target.checked)}
            className="accent-cyan-500"
          />
          Fast-travel destination
        </label>
        <button
          type="button"
          onClick={create}
          disabled={!name.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Drop marker
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : markers.length === 0 ? (
        <EmptyState label="No markers yet" />
      ) : (
        <ul className="space-y-1">
          {markers.map((m) => (
            <li key={m.id} className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-2 py-1.5 text-xs">
              <Pin className={cn('w-3 h-3', m.fastTravel ? 'text-cyan-400' : 'text-gray-600')} />
              <span className="text-gray-200 font-medium truncate">{m.name}</span>
              <span className="text-[10px] text-gray-600 capitalize">{m.kind}</span>
              <div className="ml-auto flex items-center gap-1">
                {m.fastTravel && (
                  <button
                    type="button"
                    onClick={() => travel(m.id)}
                    className="px-1.5 py-0.5 rounded text-[10px] border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                  >
                    Travel
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-red-400"
                  aria-label="Delete marker"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 5. Mounts — summon / dismiss roster ────────────────────────────

function MountsTab() {
  const [roster, setRoster] = useState<Mount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('horse');
  const [kind, setKind] = useState('ground');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('world', 'mount-list', {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { roster: Mount[]; activeId: string | null };
      setRoster(res.roster); setActiveId(res.activeId);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const add = async () => {
    if (!name.trim()) return;
    await lensRun('world', 'mount-add', { name: name.trim(), species, kind });
    setName('');
    await refresh();
  };
  const summon = async (id: string) => {
    await lensRun('world', 'mount-summon', { id });
    await refresh();
  };
  const dismiss = async () => { await lensRun('world', 'mount-dismiss', {}); await refresh(); };
  const remove = async (id: string) => { await lensRun('world', 'mount-remove', { id }); await refresh(); };

  return (
    <div className="space-y-3">
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mount name"
          className={cn(inputCls, 'w-full')}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <input
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            placeholder="Species"
            className={inputCls}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls} aria-label="Mount kind">
            {['ground', 'flying', 'aquatic'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!name.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add mount
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : roster.length === 0 ? (
        <EmptyState label="No mounts yet" />
      ) : (
        <ul className="space-y-1">
          {roster.map((m) => {
            const isActive = m.id === activeId;
            return (
              <li
                key={m.id}
                className={cn(
                  'bg-white/[0.03] border rounded px-2 py-1.5 text-xs',
                  isActive ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/5',
                )}
              >
                <div className="flex items-center gap-2">
                  <Rabbit className={cn('w-3.5 h-3.5', isActive ? 'text-cyan-400' : 'text-gray-500')} />
                  <span className="text-gray-200 font-medium">{m.name}</span>
                  <span className="text-[10px] text-gray-600 capitalize">{m.species} · {m.kind}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => (isActive ? dismiss() : summon(m.id))}
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] border',
                        isActive
                          ? 'border-amber-500/30 text-amber-300'
                          : 'border-cyan-500/30 text-cyan-300',
                      )}
                    >
                      {isActive ? 'Dismiss' : 'Summon'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(m.id)}
                      className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-red-400"
                      aria-label="Remove mount"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 mt-1 text-[9px] text-gray-500">
                  <span>Speed {m.speed}</span>
                  <span>Stamina {m.stamina}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── 6. Combat — lock-on / dodge / ability cooldowns ────────────────

function CombatTab() {
  const [prefs, setPrefs] = useState<CombatPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [element, setElement] = useState('physical');
  const [cooldown, setCooldown] = useState('5');
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const r = await lensRun('world', 'combat-prefs-get', {});
    if (r.data.ok && r.data.result) setPrefs(r.data.result as CombatPrefs);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // Live cooldown clock — re-render once a second so countdowns tick.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const setPref = async (patch: Record<string, unknown>) => {
    await lensRun('world', 'combat-prefs-set', patch);
    await refresh();
  };
  const addAbility = async () => {
    if (!name.trim()) return;
    const usedSlots = new Set((prefs?.abilities || []).map((a) => a.slot));
    let slot = 1;
    while (usedSlots.has(slot) && slot < 8) slot++;
    await lensRun('world', 'combat-ability-add', {
      name: name.trim(), slot, element, cooldownMs: Number(cooldown) * 1000,
    });
    setName('');
    await refresh();
  };
  const removeAbility = async (id: string) => {
    await lensRun('world', 'combat-ability-remove', { id });
    await refresh();
  };
  const trigger = async (id: string) => {
    await lensRun('world', 'combat-ability-trigger', { id });
    await refresh();
  };

  if (loading || !prefs) return <Spinner />;

  return (
    <div className="space-y-3">
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <label className="flex items-center justify-between text-xs text-gray-300">
          Lock-on targeting
          <input
            type="checkbox" checked={prefs.lockOn}
            onChange={(e) => setPref({ lockOn: e.target.checked })}
            className="accent-cyan-500"
          />
        </label>
        <label className="flex items-center justify-between text-xs text-gray-300">
          Block enabled
          <input
            type="checkbox" checked={prefs.blockEnabled}
            onChange={(e) => setPref({ blockEnabled: e.target.checked })}
            className="accent-cyan-500"
          />
        </label>
        <label className="flex items-center justify-between text-xs text-gray-300">
          Dodge style
          <select
            value={prefs.dodgeStyle}
            onChange={(e) => setPref({ dodgeStyle: e.target.value })}
            className={inputCls}
          >
            {['roll', 'dash', 'blink', 'sidestep'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Ability hotbar (8 slots)</p>
        <div className="grid grid-cols-8 gap-1">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((s) => {
            const a = prefs.abilities.find((x) => x.slot === s);
            const pct = a && a.cooldownMs > 0
              ? Math.round((1 - a.cooldownRemainingMs / a.cooldownMs) * 100)
              : 100;
            return (
              <button
                key={s}
                type="button"
                onClick={() => a && trigger(a.id)}
                disabled={!a || !a.ready}
                title={a ? `${a.name} (${a.element})` : `slot ${s}`}
                className={cn(
                  'relative aspect-square rounded border flex items-center justify-center text-[9px] overflow-hidden',
                  a
                    ? a.ready
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                      : 'border-white/10 bg-black/40 text-gray-500'
                    : 'border-dashed border-white/10 bg-black/20 text-gray-700',
                )}
              >
                {a && !a.ready && (
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-cyan-500/30"
                    style={{ height: `${pct}%` }}
                  />
                )}
                <span className="relative z-10 truncate px-0.5">
                  {a ? (a.ready ? a.name.slice(0, 3) : Math.ceil(a.cooldownRemainingMs / 1000) + 's') : s}
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ability name"
            className={inputCls}
          />
          <select value={element} onChange={(e) => setElement(e.target.value)} className={inputCls} aria-label="Ability element">
            {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
          </select>
          <input
            type="number" value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
            placeholder="CD s"
            className={cn(inputCls, 'w-14')}
            aria-label="Cooldown seconds"
          />
        </div>
        <button
          type="button"
          onClick={addAbility}
          disabled={!name.trim() || prefs.abilities.length >= 8}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Bind ability
        </button>
      </div>

      {prefs.abilities.length > 0 && (
        <ul className="space-y-1">
          {prefs.abilities.map((a) => (
            <li key={a.id} className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-2 py-1.5 text-xs">
              <span className="text-gray-600">#{a.slot}</span>
              <span className="text-gray-200 font-medium">{a.name}</span>
              <span className="text-[10px] text-gray-600 capitalize">{a.element}</span>
              <span className="text-[10px] text-gray-500 ml-auto">{a.cooldownMs / 1000}s CD</span>
              <button
                type="button"
                onClick={() => removeAbility(a.id)}
                className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-red-400"
                aria-label="Remove ability"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 7. Perf — LOD / streaming presets ──────────────────────────────

function PerfTab() {
  const [prefs, setPrefs] = useState<StreamPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await lensRun('world', 'streaming-prefs-get', {});
    if (r.data.ok && r.data.result) setPrefs((r.data.result as { prefs: StreamPrefs }).prefs);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const applyPreset = async (preset: string) => {
    const r = await lensRun('world', 'streaming-prefs-preset', { preset });
    if (r.data.ok && r.data.result) setPrefs((r.data.result as { prefs: StreamPrefs }).prefs);
  };
  const setField = async (patch: Record<string, unknown>) => {
    const r = await lensRun('world', 'streaming-prefs-set', patch);
    if (r.data.ok && r.data.result) setPrefs((r.data.result as { prefs: StreamPrefs }).prefs);
  };

  if (loading || !prefs) return <Spinner />;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Per-user perf knobs the 3D scene reads to budget draw calls for big worlds.
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {(['potato', 'balanced', 'ultra'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            className="py-1.5 text-[11px] capitalize rounded bg-white/5 text-gray-300 border border-white/10 hover:border-cyan-500/30 hover:text-cyan-300"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-3">
        <Slider
          label="Draw distance" suffix="m"
          min={50} max={4000} step={50} value={prefs.drawDistanceM}
          onChange={(v) => setField({ drawDistanceM: v })}
        />
        <Slider
          label="LOD bias" suffix="×"
          min={0.25} max={4} step={0.25} value={prefs.lodBias}
          onChange={(v) => setField({ lodBias: v })}
        />
        <Slider
          label="Max visible entities"
          min={20} max={2000} step={20} value={prefs.maxVisibleEntities}
          onChange={(v) => setField({ maxVisibleEntities: v })}
        />
        <Slider
          label="Foliage density" suffix="×"
          min={0} max={2} step={0.1} value={prefs.foliageDensity}
          onChange={(v) => setField({ foliageDensity: v })}
        />
        <label className="flex items-center justify-between text-xs text-gray-300">
          Shadow quality
          <select
            value={prefs.shadowQuality}
            onChange={(e) => setField({ shadowQuality: e.target.value })}
            className={inputCls}
          >
            {['off', 'low', 'medium', 'high'].map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between text-xs text-gray-300">
          Streaming enabled
          <input
            type="checkbox" checked={prefs.streamingEnabled}
            onChange={(e) => setField({ streamingEnabled: e.target.checked })}
            className="accent-cyan-500"
          />
        </label>
      </div>
    </div>
  );
}

function Slider({
  label, suffix, min, max, step, value, onChange,
}: {
  label: string; suffix?: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-300 mb-1">
        <span>{label}</span>
        <span className="text-cyan-300">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-500"
        aria-label={label}
      />
    </div>
  );
}

// ── 8. Photos — photo mode + gallery ───────────────────────────────

function PhotosTab({ worldId }: { worldId: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [publicWall, setPublicWall] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'mine' | 'wall'>('mine');
  const [caption, setCaption] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [mine, wall] = await Promise.all([
      lensRun('world', 'photo-list', { worldId }),
      lensRun('world', 'photo-gallery-public', { worldId }),
    ]);
    if (mine.data.ok && mine.data.result) {
      setPhotos((mine.data.result as { photos: Photo[] }).photos);
    }
    if (wall.data.ok && wall.data.result) {
      setPublicWall((wall.data.result as { photos: Photo[] }).photos);
    }
    setLoading(false);
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Capture the live 3D canvas — real pixels, no mock image.
  const capture = async () => {
    setErr(null);
    const canvas = document.querySelector('canvas');
    if (!canvas) { setErr('No 3D canvas to capture — open a world view first.'); return; }
    setCapturing(true);
    try {
      const imageUrl = (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.7);
      const r = await lensRun('world', 'photo-save', {
        worldId, imageUrl, caption: caption.trim(),
      });
      if (r.data.ok) { setCaption(''); await refresh(); }
      else setErr(r.data.error || 'Capture failed');
    } catch {
      setErr('Could not read canvas pixels (cross-origin).');
    } finally {
      setCapturing(false);
    }
  };

  const share = async (id: string, isPublic: boolean) => {
    await lensRun('world', 'photo-share', { id, public: !isPublic });
    await refresh();
  };
  const remove = async (id: string) => {
    await lensRun('world', 'photo-delete', { id });
    await refresh();
  };

  const list = view === 'mine' ? photos : publicWall;

  return (
    <div className="space-y-3">
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5 space-y-2">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional)"
          className={cn(inputCls, 'w-full')}
        />
        <button
          type="button"
          onClick={capture}
          disabled={capturing}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {capturing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
          Capture screenshot
        </button>
        {err && <p className="text-[10px] text-red-400">{err}</p>}
      </div>

      <div className="flex gap-1.5">
        {(['mine', 'wall'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              'flex-1 py-1 text-[11px] rounded border',
              view === v
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                : 'border-white/10 text-gray-500',
            )}
          >
            {v === 'mine' ? 'My photos' : 'Community wall'}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState label={view === 'mine' ? 'No photos yet' : 'No shared photos yet'} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {list.map((p) => (
            <div key={p.id} className="bg-white/[0.03] border border-white/5 rounded overflow-hidden">
              <div className="relative aspect-video bg-black">
                <Image
                  src={p.imageUrl}
                  alt={p.caption || 'World screenshot'}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="200px"
                />
              </div>
              <div className="p-1.5 space-y-1">
                {p.caption && <p className="text-[10px] text-gray-300 truncate">{p.caption}</p>}
                {view === 'mine' && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => share(p.id, p.public)}
                      className={cn(
                        'flex-1 py-0.5 rounded text-[9px] border',
                        p.public
                          ? 'border-emerald-500/30 text-emerald-300'
                          : 'border-white/10 text-gray-400',
                      )}
                    >
                      {p.public ? 'Public' : 'Share'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-red-400"
                      aria-label="Delete photo"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ───────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-8 text-xs text-gray-500">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-6 text-xs text-gray-600">{label}</div>
  );
}

export default WorldAdventureKitPanel;
