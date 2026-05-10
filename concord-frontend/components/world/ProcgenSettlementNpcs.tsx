'use client';

/**
 * ProcgenSettlementNpcs — Sprint B.5 mount-up
 *
 * Surfaces procgen settlement NPCs (Phase 11.4 substrate:
 * server/lib/procgen-settlements.js + procgen-settlement-cycle
 * heartbeat) into the live world by synthesizing NPCData entries that
 * pipe through AvatarSystem3D's procedural-creature mesh pipeline.
 *
 * Same pattern as WalkerNpcInjector: subscribes to a refresh trigger,
 * fetches via the procgen.npcs_for_world macro, derives appearance
 * deterministically from the NPC id, and yields NPCData entries to
 * the parent via callback.
 *
 * Refresh on:
 *   - mount
 *   - every 5 minutes (poll fallback — settlement TTL is multi-hour)
 *   - on `world:region-spawned` socket events (immediate refresh)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import type {
  AppearanceConfig,
  NPCData,
  NPCOccupationAnimation,
} from '@/components/world-lens/AvatarSystem3D';

// Palettes used to materialize the deterministic numeric variants
// produced from an npc-id hash into the structured AvatarSystem3D
// AppearanceConfig (string colors + structured clothing).
const SKIN_COLORS = ['#f5d0b0', '#e6b894', '#d49a7a', '#b87a55', '#8c5a3a', '#5e3a23'];
const HAIR_COLORS = ['#1a1a1a', '#2a2018', '#5a3a1a', '#8b5a2b', '#c19a6b', '#d4af37', '#e8d5a8', '#a05a2d', '#888888', '#f5e6c8'];
const HAIR_STYLES: AppearanceConfig['hairStyle'][] = [
  'short', 'medium', 'long', 'bald', 'ponytail', 'bun',
];
const OUTFITS: AppearanceConfig['clothing'][] = [
  { top: { color: '#5b6b8c', type: 'shirt' }, bottom: { color: '#3d3d3d', type: 'pants' } },
  { top: { color: '#7d4a2d', type: 'vest' }, bottom: { color: '#2a2a2a', type: 'pants' } },
  { top: { color: '#3a3a4a', type: 'coat' }, bottom: { color: '#1a1a1a', type: 'pants' } },
  { top: { color: '#8b6a3a', type: 'apron' }, bottom: { color: '#5a4a2a', type: 'pants' } },
  { top: { color: '#4a5a3a', type: 'shirt' }, bottom: { color: '#2a3a2a', type: 'shorts' } },
  { top: { color: '#6b4a8c', type: 'robe' }, bottom: { color: '#3a2a4a', type: 'robe' } },
  { top: { color: '#2a4a6a', type: 'coat' }, bottom: { color: '#1a2a3a', type: 'pants' } },
  { top: { color: '#8c4a4a', type: 'shirt' }, bottom: { color: '#5a2a2a', type: 'pants' } },
  { top: { color: '#3a6a4a', type: 'vest' }, bottom: { color: '#2a4a3a', type: 'pants' } },
  { top: { color: '#a08a5a', type: 'shirt' }, bottom: { color: '#6a5a3a', type: 'skirt' } },
  { top: { color: '#5a4a3a', type: 'coat' }, bottom: { color: '#3a2a1a', type: 'pants' } },
  { top: { color: '#7a8c5a', type: 'apron' }, bottom: { color: '#5a6a3a', type: 'pants' } },
  { top: { color: '#4a3a5a', type: 'robe' }, bottom: { color: '#2a1a3a', type: 'robe' } },
  { top: { color: '#8c8c4a', type: 'shirt' }, bottom: { color: '#5a5a2a', type: 'pants' } },
  { top: { color: '#3a4a5a', type: 'vest' }, bottom: { color: '#2a3a4a', type: 'shorts' } },
  { top: { color: '#6a3a4a', type: 'coat' }, bottom: { color: '#4a2a3a', type: 'pants' } },
];

interface SettlementRow {
  id: string;
  region_id: string;
  world_id: string;
  name: string;
  archetype: string;
  faction_id: string | null;
  level: number;
  x: number;
  z: number;
  spawned_at: number;
}

interface Props {
  worldId: string;
  /** Called whenever the active settlement NPC list changes. Parent
      merges into worldNPCs so the existing render pipeline picks
      them up. */
  onSettlementNpcs: (npcs: NPCData[]) => void;
  pollIntervalMs?: number;
}

// Map archetype → AvatarSystem3D NPCOccupationAnimation. The
// procgen substrate uses richer animation names (reading, patrolling,
// tending_stall, etc.) but the renderer only knows the canonical 8
// clip set; pick the closest match.
const ARCHETYPE_OCCUPATION: Record<
  string,
  { occupation: string; anim: NPCOccupationAnimation }
> = {
  scholar: { occupation: 'scholar', anim: 'read' },
  guard:   { occupation: 'guard',   anim: 'patrol' },
  trader:  { occupation: 'trader',  anim: 'count-coins' },
  hunter:  { occupation: 'hunter',  anim: 'patrol' },
  mystic:  { occupation: 'mystic',  anim: 'read' },
  warrior: { occupation: 'warrior', anim: 'patrol' },
};

/** Deterministic appearance from NPC id — same id always renders the
 *  same way, even after re-fetch / re-mount. */
function appearanceFromId(npcId: string): AppearanceConfig {
  let h = 0;
  for (let i = 0; i < npcId.length; i++) h = ((h << 5) - h + npcId.charCodeAt(i)) | 0;
  const abs = Math.abs(h);
  // Procgen settlers are mortals — `legend` is reserved for the
  // authored immortal class only.
  const bodies: AppearanceConfig['bodyType'][] = ['slim', 'average', 'stocky', 'tall'];
  return {
    bodyType: bodies[abs % bodies.length],
    skinColor: SKIN_COLORS[(abs % 6) % SKIN_COLORS.length],
    hairStyle: HAIR_STYLES[((abs >> 3) % 12) % HAIR_STYLES.length],
    hairColor: HAIR_COLORS[((abs >> 5) % 10) % HAIR_COLORS.length],
    clothing: OUTFITS[((abs >> 7) % 16) % OUTFITS.length],
  };
}

export default function ProcgenSettlementNpcs({
  worldId,
  onSettlementNpcs,
  pollIntervalMs = 5 * 60_000,
}: Props) {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const lastFetchRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    const now = Date.now();
    if (now - lastFetchRef.current < 5_000) return; // dedupe rapid refreshes
    lastFetchRef.current = now;
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procgen',
          name: 'npcs_for_world',
          input: { worldId, limit: 200 },
        }),
      });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data?.npcs)) setRows(data.npcs);
    } catch { /* anonymous browsers / network blips: silent */ }
  }, [worldId]);

  // Initial + poll refresh.
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [refresh, pollIntervalMs]);

  // Refresh when a new region spawns.
  useEffect(() => {
    const off = subscribe('world:region-spawned' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { worldId?: string };
      if (ev?.worldId === worldId) void refresh();
    });
    return () => off?.();
  }, [worldId, refresh]);

  // Convert rows → NPCData and propagate to parent.
  useEffect(() => {
    const npcs: NPCData[] = rows.map((r) => {
      const occ = ARCHETYPE_OCCUPATION[r.archetype] || { occupation: r.archetype, anim: 'idle' };
      return {
        id: r.id,
        name: r.name,
        appearance: appearanceFromId(r.id),
        position: { x: r.x, y: 0, z: r.z },
        rotation: 0,
        occupation: occ.occupation,
        occupationAnimation: occ.anim,
        timestamp: r.spawned_at * 1000,
      };
    });
    onSettlementNpcs(npcs);
  }, [rows, onSettlementNpcs]);

  return null;
}
