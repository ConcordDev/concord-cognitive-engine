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
import type { AppearanceConfig, NPCData, NPCOccupationAnimation } from '@/components/world-lens/AvatarSystem3D';

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

// Map each procgen archetype onto one of the AvatarSystem3D NPC occupation
// animations.  These strings are typed as `NPCOccupationAnimation` upstream,
// so any new archetype that doesn't fit here falls back to 'patrol' below.
const ARCHETYPE_OCCUPATION: Record<string, { occupation: string; anim: NPCOccupationAnimation }> = {
  scholar: { occupation: 'scholar', anim: 'read' },
  guard:   { occupation: 'guard',   anim: 'patrol' },
  trader:  { occupation: 'trader',  anim: 'count-coins' },
  hunter:  { occupation: 'hunter',  anim: 'patrol' },
  mystic:  { occupation: 'mystic',  anim: 'lecture' },
  warrior: { occupation: 'warrior', anim: 'hammer' },
  builder: { occupation: 'builder', anim: 'construct' },
  farmer:  { occupation: 'farmer',  anim: 'tend-crops' },
};

// Palettes for deterministic appearance generation. Procgen settlers are
// mortals — `legend` body type is reserved for the authored immortal class.
const SKIN_HEX = ['#f1c4a0', '#d9a17e', '#b07f5f', '#8a5a3e', '#5e3826', '#3a2014'];
const HAIR_HEX = ['#1a1410', '#3b2415', '#6e3a1d', '#a35a2d', '#c08850', '#d8b078', '#e8d2a6', '#f0e2c8', '#7a7a7a', '#cccccc'];
const HAIR_STYLE: AppearanceConfig['hairStyle'][] = ['short', 'medium', 'long', 'bald', 'ponytail', 'bun'];
const TOP_HEX = ['#2b3a5a', '#4f6b3e', '#7a3a2e', '#3e2a4f', '#5a4a2e', '#1a4a4a', '#6a4a3e', '#3e5a3e'];
const BOTTOM_HEX = ['#2a2018', '#3e2e22', '#4a3a2c', '#1c1a18', '#3a3128', '#2e2820'];
const TOP_TYPE: AppearanceConfig['clothing']['top']['type'][] = ['shirt', 'vest', 'coat', 'robe', 'apron'];
const BOTTOM_TYPE: AppearanceConfig['clothing']['bottom']['type'][] = ['pants', 'skirt', 'shorts', 'robe'];
const BODIES: AppearanceConfig['bodyType'][] = ['slim', 'average', 'stocky', 'tall'];

/** Deterministic appearance from NPC id — same id always renders the
 *  same way, even after re-fetch / re-mount. */
function appearanceFromId(npcId: string): AppearanceConfig {
  let h = 0;
  for (let i = 0; i < npcId.length; i++) h = ((h << 5) - h + npcId.charCodeAt(i)) | 0;
  const abs = Math.abs(h);
  return {
    bodyType: BODIES[abs % BODIES.length],
    skinColor: SKIN_HEX[abs % SKIN_HEX.length],
    hairColor: HAIR_HEX[(abs >> 5) % HAIR_HEX.length],
    hairStyle: HAIR_STYLE[(abs >> 3) % HAIR_STYLE.length],
    clothing: {
      top: {
        color: TOP_HEX[(abs >> 7) % TOP_HEX.length],
        type: TOP_TYPE[(abs >> 9) % TOP_TYPE.length],
      },
      bottom: {
        color: BOTTOM_HEX[(abs >> 11) % BOTTOM_HEX.length],
        type: BOTTOM_TYPE[(abs >> 13) % BOTTOM_TYPE.length],
      },
    },
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
      const occ = ARCHETYPE_OCCUPATION[r.archetype] || { occupation: r.archetype, anim: 'patrol' as NPCOccupationAnimation };
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
