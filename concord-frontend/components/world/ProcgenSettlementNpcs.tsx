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

interface AppearanceConfig {
  bodyType: 'slim' | 'average' | 'stocky' | 'tall' | 'legend';
  skinTone: number;
  hairStyle: number;
  hairColor: number;
  outfit: number;
  faceShape: number;
}

interface NPCData {
  id: string;
  name: string;
  appearance: AppearanceConfig;
  position: { x: number; y: number; z: number };
  rotation: number;
  occupation: string;
  occupationAnimation: string;
  patrolPath?: { x: number; y: number; z: number }[];
  timestamp: number;
}

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

const ARCHETYPE_OCCUPATION: Record<string, { occupation: string; anim: string }> = {
  scholar: { occupation: 'scholar', anim: 'reading' },
  guard:   { occupation: 'guard',   anim: 'patrolling' },
  trader:  { occupation: 'trader',  anim: 'tending_stall' },
  hunter:  { occupation: 'hunter',  anim: 'walking' },
  mystic:  { occupation: 'mystic',  anim: 'meditating' },
  warrior: { occupation: 'warrior', anim: 'training' },
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
    skinTone: abs % 6,
    hairStyle: (abs >> 3) % 12,
    hairColor: (abs >> 5) % 10,
    outfit: (abs >> 7) % 16,
    faceShape: (abs >> 9) % 8,
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
