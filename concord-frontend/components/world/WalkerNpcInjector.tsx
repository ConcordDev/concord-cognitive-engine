'use client';

/**
 * WalkerNpcInjector — Sprint B.5 mount-up
 *
 * Replaces the placeholder stick-figure WalkerOnHorizon (which violated
 * the polished-Skyrim art direction). Instead of rendering 3D meshes
 * directly, this component subscribes to `walker:dispatched` events
 * and synthesizes NPCData entries that pipe through the existing
 * AvatarSystem3D mesh pipeline — so walkers travel between worlds
 * with proper body types, occupation animations, and appearance.
 *
 * Authored walker NPCs (walker_tully_vex, walker_sona_karth in
 * content/world/npcs.json) are the canonical names; the substrate's
 * walker-id map decides which authored persona is on a journey.
 *
 * The world page subscribes via the `onWalkers` callback prop. When
 * walkers update, the parent merges them into its worldNPCs state and
 * the existing render pipeline draws them with the proper character
 * mesh, body type, and animation rig.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { subscribe } from '@/lib/realtime/socket';

// Match the existing AvatarSystem3D NPCData shape so the parent can
// pass injected walkers straight through.
interface AppearanceConfig {
  bodyType: 'slim' | 'average' | 'stocky' | 'tall';
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
  occupationAnimation: string; // matches NPCOccupationAnimation union
  patrolPath?: { x: number; y: number; z: number }[];
  timestamp: number;
}

interface WalkerJourney {
  walkerId: string;
  fromWorld: string;
  toWorld: string;
  contractId: string | null;
  route: string[];
  dispatchedAt: number;
  estimatedTotalMs: number;
}

interface AnchorPos { x: number; y?: number; z: number }

interface Props {
  worldId: string;
  /** Anchor-name → world-space coordinate lookup. World page provides
      this from the active world's `meta.json` anchors[] array. */
  anchorPositions?: Record<string, AnchorPos>;
  /** Called whenever the active walker NPCData list changes. Parent
      merges into worldNPCs so the existing render pipeline picks
      them up. Returns synthesized NPCData entries. */
  onWalkers: (walkers: NPCData[]) => void;
}

const MS_PER_HOP = 30_000;

// Authored walker NPCs from content/world/npcs.json. The substrate's
// hireWalker uses these as the canonical pool. Each gets a deterministic
// appearance so the same walker_id always looks the same.
const AUTHORED_WALKERS: Record<string, { name: string; appearance: AppearanceConfig }> = {
  walker_tully_vex: {
    name: 'Tully Vex',
    appearance: {
      bodyType: 'tall', skinTone: 2, hairStyle: 1, hairColor: 5, outfit: 8, faceShape: 3,
    },
  },
  walker_sona_karth: {
    name: 'Sona Karth',
    appearance: {
      bodyType: 'slim', skinTone: 4, hairStyle: 6, hairColor: 8, outfit: 11, faceShape: 2,
    },
  },
};

/** Fallback appearance for walker IDs we don't have authored details for —
 *  derived from a sha-like hash of the walkerId so the same id is stable. */
function fallbackAppearance(walkerId: string): { name: string; appearance: AppearanceConfig } {
  let h = 0;
  for (let i = 0; i < walkerId.length; i++) h = ((h << 5) - h + walkerId.charCodeAt(i)) | 0;
  const abs = Math.abs(h);
  const bodies: AppearanceConfig['bodyType'][] = ['slim', 'average', 'stocky', 'tall'];
  return {
    name: `Walker ${walkerId.slice(-4).toUpperCase()}`,
    appearance: {
      bodyType: bodies[abs % bodies.length],
      skinTone: abs % 6,
      hairStyle: (abs >> 3) % 12,
      hairColor: (abs >> 5) % 10,
      outfit: (abs >> 7) % 16,
      faceShape: (abs >> 9) % 8,
    },
  };
}

export default function WalkerNpcInjector({ worldId, anchorPositions, onWalkers }: Props) {
  const journeysRef = useRef<Map<string, WalkerJourney>>(new Map());

  // Synthesize NPCData entries from active journeys. Called every frame
  // by an interval (we don't have access to useFrame outside Canvas);
  // 100ms cadence is enough for cross-horizon movement to look smooth.
  const computeNpcs = useCallback((): NPCData[] => {
    const now = Date.now();
    const out: NPCData[] = [];
    for (const j of journeysRef.current.values()) {
      const positions = j.route.map((anchor, idx) => {
        const lookup = anchorPositions?.[anchor];
        if (lookup) return { x: lookup.x, y: lookup.y ?? 0, z: lookup.z };
        // Fallback ring so walkers always have somewhere to be.
        const angle = (idx / Math.max(1, j.route.length)) * Math.PI * 2;
        const r = 250 + idx * 80;
        return { x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r };
      });
      if (positions.length < 2) continue;
      const elapsed = now - j.dispatchedAt;
      const totalHops = positions.length - 1;
      const hopsCompleted = elapsed / MS_PER_HOP;
      if (hopsCompleted < 0) continue;
      const segIdx = Math.min(totalHops - 1, Math.floor(hopsCompleted));
      const segT = Math.min(1, hopsCompleted - segIdx);
      const a = positions[segIdx];
      const b = positions[segIdx + 1];
      const x = a.x + (b.x - a.x) * segT;
      const y = a.y + (b.y - a.y) * segT;
      const z = a.z + (b.z - a.z) * segT;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const rotation = (Math.abs(dx) + Math.abs(dz) > 0.001) ? Math.atan2(dx, dz) : 0;

      const meta = AUTHORED_WALKERS[j.walkerId] || fallbackAppearance(j.walkerId);
      out.push({
        id: `walker_journey_${j.walkerId}`,
        name: meta.name,
        appearance: meta.appearance,
        position: { x, y, z },
        rotation,
        occupation: 'walker',
        occupationAnimation: 'walking',
        timestamp: now,
      });
    }
    return out;
  }, [anchorPositions]);

  // Subscribe to walker dispatch + delivery.
  useEffect(() => {
    if (!worldId) return;
    const offDispatch = subscribe('walker:dispatched' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as Partial<WalkerJourney>;
      if (!ev?.walkerId || !ev.fromWorld || !ev.toWorld) return;
      if (ev.fromWorld !== worldId && ev.toWorld !== worldId) return;
      const route = Array.isArray(ev.route) ? (ev.route as string[]) : [];
      if (route.length < 2) return;
      const rawTs = Number(ev.dispatchedAt) || Date.now();
      const ts = rawTs < 1e12 ? rawTs * 1000 : rawTs;
      journeysRef.current.set(ev.walkerId as string, {
        walkerId: ev.walkerId as string,
        fromWorld: ev.fromWorld as string,
        toWorld: ev.toWorld as string,
        contractId: (ev.contractId as string | null) ?? null,
        route,
        dispatchedAt: ts,
        estimatedTotalMs: Math.max(MS_PER_HOP, route.length * MS_PER_HOP),
      });
    });
    const offDelivered = subscribe('concord-link:delivered' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { walkerId?: string };
      if (ev?.walkerId) journeysRef.current.delete(ev.walkerId);
    });
    return () => { offDispatch?.(); offDelivered?.(); };
  }, [worldId]);

  // Tick: every 100ms, recompute walker NPCData entries and push to parent.
  // Auto-GC any journey past 2× its estimated duration (insurance vs.
  // missed delivered events).
  useEffect(() => {
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const now = Date.now();
      // GC stale.
      for (const [id, j] of journeysRef.current) {
        if (now - j.dispatchedAt > j.estimatedTotalMs * 2) {
          journeysRef.current.delete(id);
        }
      }
      const npcs = computeNpcs();
      onWalkers(npcs);
    };
    const interval = window.setInterval(tick, 100);
    tick();
    return () => { mounted = false; window.clearInterval(interval); onWalkers([]); };
  }, [computeNpcs, onWalkers]);

  // Tiny HUD chip — visual hint for the player that walkers are en route.
  const count = journeysRef.current.size;
  const memoCount = useMemo(() => count, [count]);
  useEffect(() => {
    if (memoCount === 0) return;
    const el = document.createElement('div');
    el.id = 'concord-walker-hud';
    el.style.cssText = `
      position: fixed; top: 80px; right: 16px; z-index: 50;
      background: rgba(12,12,12,0.85); color: #ddd;
      border: 1px solid #2a2a2a; border-radius: 4px;
      padding: 6px 12px; font: 12px/1.4 -apple-system, system-ui;
      pointer-events: none; backdrop-filter: blur(4px);
    `;
    el.textContent = `${memoCount} walker${memoCount === 1 ? '' : 's'} in transit`;
    document.body.appendChild(el);
    return () => { try { document.body.removeChild(el); } catch { /* noop */ } };
  }, [memoCount]);

  return null;
}
