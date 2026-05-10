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
import type { AppearanceConfig, NPCData } from '@/components/world-lens/AvatarSystem3D';

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
      bodyType: 'tall',
      skinColor: '#b07f5f',
      hairColor: '#3b2415',
      hairStyle: 'short',
      clothing: {
        top: { color: '#3e2a4f', type: 'coat' },
        bottom: { color: '#2e2820', type: 'pants' },
      },
    },
  },
  walker_sona_karth: {
    name: 'Sona Karth',
    appearance: {
      bodyType: 'slim',
      skinColor: '#8a5a3e',
      hairColor: '#a35a2d',
      hairStyle: 'ponytail',
      clothing: {
        top: { color: '#1a4a4a', type: 'vest' },
        bottom: { color: '#3a3128', type: 'pants' },
      },
    },
  },
};

const SKIN_HEX = ['#f1c4a0', '#d9a17e', '#b07f5f', '#8a5a3e', '#5e3826', '#3a2014'];
const HAIR_HEX = ['#1a1410', '#3b2415', '#6e3a1d', '#a35a2d', '#c08850', '#d8b078', '#e8d2a6', '#f0e2c8', '#7a7a7a', '#cccccc'];
const HAIR_STYLE: AppearanceConfig['hairStyle'][] = ['short', 'medium', 'long', 'bald', 'ponytail', 'bun'];
const TOP_HEX = ['#2b3a5a', '#4f6b3e', '#7a3a2e', '#3e2a4f', '#5a4a2e', '#1a4a4a', '#6a4a3e', '#3e5a3e'];
const BOTTOM_HEX = ['#2a2018', '#3e2e22', '#4a3a2c', '#1c1a18', '#3a3128', '#2e2820'];
const TOP_TYPE: AppearanceConfig['clothing']['top']['type'][] = ['shirt', 'vest', 'coat', 'robe', 'apron'];
const BOTTOM_TYPE: AppearanceConfig['clothing']['bottom']['type'][] = ['pants', 'skirt', 'shorts', 'robe'];
const BODIES: AppearanceConfig['bodyType'][] = ['slim', 'average', 'stocky', 'tall'];

/** Fallback appearance for walker IDs we don't have authored details for —
 *  derived from a sha-like hash of the walkerId so the same id is stable. */
function fallbackAppearance(walkerId: string): { name: string; appearance: AppearanceConfig } {
  let h = 0;
  for (let i = 0; i < walkerId.length; i++) h = ((h << 5) - h + walkerId.charCodeAt(i)) | 0;
  const abs = Math.abs(h);
  // Walkers are mortals — legend reserved for the immortal NPC class.
  return {
    name: `Walker ${walkerId.slice(-4).toUpperCase()}`,
    appearance: {
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
        occupationAnimation: 'patrol',
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
