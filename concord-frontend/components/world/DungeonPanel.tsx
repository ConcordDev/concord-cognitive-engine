'use client';

/**
 * DungeonPanel — Wave F frontend / dungeon explorer.
 *
 * 2D top-down room graph. Click a room to enter (rolls loot on first
 * visit, applies opinion + objective events server-side). Boss room
 * highlighted in red; cleared rooms gray; current room cyan ring.
 *
 * Lifecycle:
 *   - Mounts when player presses U (toggle) near a DungeonEntranceMarker
 *     OR when a dungeon id is selected from the WorldMap.
 *   - Listens for `concordia:dungeon-open` events with detail.dungeonId.
 *
 * Loot pickup is inline — clicking a loot card POSTs /loot/:id/claim.
 *
 * Closing returns to overworld; the dungeon state persists server-side.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Room {
  dungeon_id: string;
  room_idx: number;
  kind: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  is_boss: 0 | 1;
  cleared: 0 | 1;
  creature_count: number;
  connections: number[];
  hazards: string[];
}

interface Dungeon {
  id: string;
  world_id: string;
  template_kind: string;
  name: string;
  anchor_x: number;
  anchor_z: number;
  depth_level: number;
  room_count: number;
  status: string;
  rooms: Room[];
}

interface LootItem {
  id: string;
  claimedBy: string | null;
  item: {
    item_id: string;
    item_name: string;
    item_type: string;
    weapon_class: string | null;
    rarity: string | null;
    quality: number;
    gear_level: number;
  };
}

const TEMPLATE_THEME: Record<string, { accent: string; mood: string }> = {
  crypts_of_the_old_order: { accent: '#f59e0b', mood: 'ancient stone, torchlight, things older than memory' },
  data_vault:              { accent: '#22d3ee', mood: 'cold neon, server racks, things you shouldn\'t access' },
  kingpin_compound:        { accent: '#ef4444', mood: 'concrete walls, cigarette smoke, blood money' },
  villain_lair:            { accent: '#a78bfa', mood: 'concrete + neon, laser grids, henchmen watching cameras' },
  buried_throne:           { accent: '#facc15', mood: 'crypt-air, refusal-glyph scars, things that refuse to die' },
  crucible_core:           { accent: '#67e8f9', mood: 'humming reactor, simulation glitches, recursive engineers' },
  outpost_complex:         { accent: '#fbbf24', mood: 'corrugated steel, frostbite chambers, comms ghosts' },
  ancestor_grove:          { accent: '#86efac', mood: 'spirit-haze, ritual smoke, ancestors watching' },
  council_undercity:       { accent: '#fde047', mood: 'sealed wards, warden traps, refusal-bursts in the dark' },
  generic_ruin:            { accent: '#a3a3a3', mood: 'old stone, forgotten place' },
};

const RARITY_COLOR: Record<string, string> = {
  common:    '#9ca3af',
  uncommon:  '#22c55e',
  rare:      '#3b82f6',
  epic:      '#a855f7',
  legendary: '#f59e0b',
};

interface Props {
  dungeonId: string;
  worldId?: string;
  onClose?: () => void;
}

export default function DungeonPanel({ dungeonId, worldId = 'concordia-hub', onClose }: Props) {
  const [dungeon, setDungeon] = useState<Dungeon | null>(null);
  const [currentRoomIdx, setCurrentRoomIdx] = useState<number | null>(null);
  const [currentLoot, setCurrentLoot] = useState<LootItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insideInterior, setInsideInterior] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/dungeons/${encodeURIComponent(dungeonId)}`, { credentials: 'same-origin' });
      const j = await r.json();
      if (!j?.ok) { setError(j?.error || 'failed'); return; }
      setDungeon(j.dungeon);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [dungeonId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const enterRoom = useCallback(async (roomIdx: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/dungeons/${encodeURIComponent(dungeonId)}/enter/${roomIdx}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const j = await r.json();
      if (j?.ok) {
        setCurrentRoomIdx(roomIdx);
        setCurrentLoot(j.loot || []);
      }
    } finally { setBusy(false); }
  }, [dungeonId, busy]);

  const claimLoot = useCallback(async (lootId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/dungeons/loot/${encodeURIComponent(lootId)}/claim`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const j = await r.json();
      if (j?.ok) {
        // Refresh current room loot to update claimed_by.
        if (currentRoomIdx != null) void enterRoom(currentRoomIdx);
        // Notify rest of the UI.
        window.dispatchEvent(new CustomEvent('concordia:loot-claimed', { detail: { lootId } }));
      }
    } finally { setBusy(false); }
  }, [busy, currentRoomIdx, enterRoom]);

  const clearDungeon = useCallback(async () => {
    if (busy || !dungeon) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/dungeons/${encodeURIComponent(dungeonId)}/clear`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (r.ok) {
        await refresh();
      }
    } finally { setBusy(false); }
  }, [busy, dungeon, dungeonId, refresh]);

  // Wave F follow-up — toggle 3D interior. Dispatches
  // `concordia:dungeon-interior-enter` / `…-exit` events the world
  // page listens for to teleport the player avatar into the
  // procedural interior at Y = -100.
  const toggleInterior = useCallback(() => {
    if (!dungeon) return;
    if (insideInterior) {
      window.dispatchEvent(new CustomEvent('concordia:dungeon-interior-exit', { detail: { dungeonId } }));
      setInsideInterior(false);
    } else {
      const entrance = dungeon.rooms.find((r) => r.room_idx === 0);
      window.dispatchEvent(new CustomEvent('concordia:dungeon-interior-enter', {
        detail: {
          dungeonId,
          anchorX: dungeon.anchor_x,
          anchorZ: dungeon.anchor_z,
          entranceX: entrance ? entrance.x : dungeon.anchor_x,
          entranceZ: entrance ? entrance.z : dungeon.anchor_z,
        },
      }));
      setInsideInterior(true);
    }
  }, [dungeon, dungeonId, insideInterior]);

  // If the panel unmounts, make sure we exit interior mode.
  useEffect(() => {
    return () => {
      if (insideInterior) {
        try {
          window.dispatchEvent(new CustomEvent('concordia:dungeon-interior-exit', { detail: { dungeonId } }));
        } catch { /* ok */ }
      }
    };
  }, [insideInterior, dungeonId]);

  const layout = useMemo(() => {
    if (!dungeon?.rooms?.length) return null;
    // Compute bounds.
    const xs = dungeon.rooms.map((r) => r.x);
    const zs = dungeon.rooms.map((r) => r.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const padX = 40, padZ = 40;
    const w = Math.max(60, maxX - minX);
    const h = Math.max(60, maxZ - minZ);
    return {
      viewBox: `${minX - padX} ${minZ - padZ} ${w + padX * 2} ${h + padZ * 2}`,
      rooms: dungeon.rooms,
    };
  }, [dungeon]);

  const theme = dungeon ? TEMPLATE_THEME[dungeon.template_kind] || TEMPLATE_THEME.generic_ruin : null;
  const currentRoom = dungeon?.rooms.find((r) => r.room_idx === currentRoomIdx);
  const bossRoom = dungeon?.rooms.find((r) => r.is_boss === 1);
  const isCleared = dungeon?.status === 'cleared';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-slate-950/95 border border-cyan-500/30 rounded-lg p-4 backdrop-blur w-[820px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold uppercase tracking-wider" style={{ color: theme?.accent ?? '#22d3ee' }}>
              {dungeon?.name ?? 'Loading…'}
            </h2>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {dungeon ? (
                <>
                  Depth {dungeon.depth_level} · {dungeon.rooms.length} rooms · {dungeon.world_id}
                  {isCleared && <span className="ml-2 text-emerald-300 font-bold">CLEARED</span>}
                </>
              ) : '…'}
            </div>
            {theme && <div className="text-[10px] text-slate-500 italic mt-0.5">{theme.mood}</div>}
          </div>
          <div className="flex items-center gap-2">
            {dungeon && (
              <button
                onClick={toggleInterior}
                className={`text-[10px] uppercase tracking-wider px-3 py-1.5 rounded transition-colors ${
                  insideInterior
                    ? 'bg-rose-500/30 text-rose-200 hover:bg-rose-500/40'
                    : 'bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30'
                }`}
                title={insideInterior ? 'Return to overworld' : 'Walk inside in 3D'}
              >
                {insideInterior ? 'Exit Interior' : 'Enter Interior'}
              </button>
            )}
            {onClose && <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">✕  Esc</button>}
          </div>
        </div>

        {error && <div className="text-xs text-red-300 mb-2">{error}</div>}
        {loading && <div className="text-xs text-slate-400 text-center py-10">Loading…</div>}

        {!loading && layout && dungeon && (
          <div className="flex gap-4 flex-1 min-h-0">
            {/* Room graph */}
            <div className="flex-1 bg-slate-900/60 border border-white/5 rounded-md p-2 overflow-hidden">
              <svg viewBox={layout.viewBox} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                {/* Connections */}
                {layout.rooms.map((r) =>
                  r.connections.map((c) => {
                    const other = layout.rooms[c];
                    if (!other) return null;
                    return (
                      <line
                        key={`${r.room_idx}-${c}`}
                        x1={r.x} y1={r.z} x2={other.x} y2={other.z}
                        stroke={theme?.accent ?? '#22d3ee'}
                        strokeOpacity={0.35}
                        strokeWidth={1.6}
                      />
                    );
                  }),
                )}
                {/* Rooms */}
                {layout.rooms.map((r) => {
                  const isCurrent = r.room_idx === currentRoomIdx;
                  const isBoss = r.is_boss === 1;
                  const fill = isBoss
                    ? '#7f1d1d'
                    : r.cleared ? '#1f2937'
                    : (theme?.accent ?? '#22d3ee') + '33';
                  const stroke = isCurrent
                    ? '#22d3ee'
                    : isBoss
                    ? '#f87171'
                    : (theme?.accent ?? '#22d3ee');
                  return (
                    <g key={r.room_idx} onClick={() => enterRoom(r.room_idx)} style={{ cursor: 'pointer' }}>
                      <rect
                        x={r.x - r.width / 2} y={r.z - r.depth / 2}
                        width={r.width} height={r.depth}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isCurrent ? 2 : 1}
                      />
                      <text
                        x={r.x} y={r.z}
                        fill="#fff" fontSize={3} textAnchor="middle"
                        dominantBaseline="central"
                        style={{ pointerEvents: 'none' }}
                      >
                        {r.room_idx === 0 ? 'IN' : isBoss ? '★' : r.kind.split('_')[0].slice(0, 4)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Current room detail */}
            <div className="w-[300px] flex flex-col gap-2 min-h-0">
              {!currentRoom && (
                <div className="text-xs text-slate-400 text-center py-6 border border-white/5 bg-slate-900/40 rounded">
                  Click a room to enter.
                </div>
              )}
              {currentRoom && (
                <>
                  <div className="border border-cyan-500/30 bg-slate-900/60 rounded p-2">
                    <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold">
                      Room {currentRoom.room_idx} · {currentRoom.kind.replace(/_/g, ' ')}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      ({Math.round(currentRoom.x)}, {Math.round(currentRoom.z)}) · {currentRoom.width}×{currentRoom.depth}m
                    </div>
                    {currentRoom.is_boss === 1 && (
                      <div className="text-xs text-rose-300 font-bold mt-1">★ BOSS</div>
                    )}
                    {currentRoom.hazards.length > 0 && (
                      <div className="text-[10px] text-amber-300 mt-1">
                        Hazards: {currentRoom.hazards.join(', ')}
                      </div>
                    )}
                    {currentRoom.creature_count > 0 && (
                      <div className="text-[10px] text-orange-300 mt-1">
                        {currentRoom.creature_count} creature{currentRoom.creature_count === 1 ? '' : 's'} stir.
                      </div>
                    )}
                  </div>
                  {/* Loot */}
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                    {currentLoot.length === 0 && (
                      <div className="text-[10px] text-slate-500 italic text-center py-3">No loot in this room.</div>
                    )}
                    {currentLoot.map((l) => {
                      const claimed = !!l.claimedBy;
                      const rColor = (l.item.rarity && RARITY_COLOR[l.item.rarity]) || '#9ca3af';
                      return (
                        <button
                          key={l.id}
                          onClick={() => !claimed && claimLoot(l.id)}
                          disabled={claimed}
                          className={`w-full text-left border rounded px-2 py-1.5 transition-colors ${
                            claimed ? 'border-white/5 bg-slate-900/40 opacity-50' : 'border-cyan-500/20 bg-slate-900/60 hover:bg-cyan-500/10'
                          }`}
                          style={{ borderLeftWidth: 3, borderLeftColor: rColor }}
                        >
                          <div className="text-xs font-semibold truncate" style={{ color: rColor }}>
                            {l.item.item_name}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {l.item.weapon_class || l.item.item_type} · Lv {l.item.gear_level}
                            {claimed ? ' · claimed' : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {bossRoom && currentRoomIdx === bossRoom.room_idx && !isCleared && (
                <button
                  onClick={clearDungeon}
                  disabled={busy}
                  className="px-3 py-2 rounded bg-rose-500/30 text-rose-200 hover:bg-rose-500/40 text-xs uppercase tracking-wider disabled:opacity-50"
                >
                  Mark Boss Defeated
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-slate-500 leading-relaxed">
          Click rooms to enter. Loot rolls only the first time anyone enters a room.
          Boss room marked ★ — defeat to mark the dungeon cleared.
        </div>
      </div>
    </div>
  );
}
