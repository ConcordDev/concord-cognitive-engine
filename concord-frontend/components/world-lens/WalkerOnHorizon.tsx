'use client';

/**
 * WalkerOnHorizon — Sprint B Phase 11.3
 *
 * Renders Concord-Link walkers traveling between worlds as visible
 * figures on the horizon. Concord-Link walker journeys exist
 * server-side (server/lib/concord-link-walkers.js + migration sets)
 * but were invisible to the player until now.
 *
 * Subscribes to `walker:dispatched` socket events. Each new walker is
 * added to a local map; we render one tall stick-figure per walker
 * traveling along the route's anchor positions. The walker advances
 * over time using the route + estimated journey duration; on the
 * matching `concord-link:delivered` event we remove the walker.
 *
 * Player can intercept by walking near a horizon walker — emits a
 * `concord-link:walker-intercept` CustomEvent that the world page can
 * consume to open an interaction modal. Substrate-side intercept logic
 * runs separately in advanceJourneyTick (probabilistic, not
 * player-initiated); this is purely the visual + interaction surface.
 *
 * Mounted in app/lenses/world/page.tsx alongside the other Three.js
 * scene contents. Filter by current world: only render walkers whose
 * source or destination matches the active world.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { subscribe } from '@/lib/realtime/socket';

interface WalkerJourney {
  walkerId: string;
  fromWorld: string;
  toWorld: string;
  contractId: string | null;
  route: string[]; // anchor names
  dispatchedAt: number; // unix ms or s — we normalize on receive
  // Estimated total duration in ms — computed client-side from
  // route length × MS_PER_HOP.
  estimatedTotalMs: number;
}

interface AnchorPos {
  x: number;
  z: number;
}

interface Props {
  worldId: string;
  /** Per-anchor world-space positions for THIS world. The world page
      knows where each anchor sits on the terrain mesh; pass the
      lookup table here. */
  anchorPositions?: Record<string, AnchorPos>;
}

/**
 * Walkers travel one anchor per `MS_PER_HOP` of wall time. The
 * substrate's advanceJourneyTick fires roughly every 15s (heartbeat
 * cadence), but the visual progression should feel smoother — we
 * interpolate between anchors at 30s/hop so a 4-anchor route takes
 * ~2 minutes on screen, matching the substrate cadence loosely
 * without depending on per-tick position emits.
 */
const MS_PER_HOP = 30_000;

const STICK_BODY_GEO = new THREE.BoxGeometry(0.3, 1.6, 0.3);
const STICK_HEAD_GEO = new THREE.SphereGeometry(0.25, 8, 6);
const WALKER_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#6b6258',
  roughness: 0.85,
  metalness: 0.05,
});

export default function WalkerOnHorizon({ worldId, anchorPositions }: Props) {
  const [journeys, setJourneys] = useState<Map<string, WalkerJourney>>(new Map());
  const journeysRef = useRef(journeys);
  journeysRef.current = journeys;

  // Subscribe to walker:dispatched on mount; remove on
  // concord-link:delivered. We keep the journey state in a Map keyed
  // by walkerId for O(1) updates.
  useEffect(() => {
    const offDispatch = subscribe('walker:dispatched' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as Partial<WalkerJourney>;
      if (!ev?.walkerId || !ev.fromWorld || !ev.toWorld) return;
      // Filter to this world: render only if source OR destination
      // matches the active world.
      if (ev.fromWorld !== worldId && ev.toWorld !== worldId) return;
      const route = Array.isArray(ev.route) ? (ev.route as string[]) : [];
      if (route.length < 2) return;

      // dispatchedAt may arrive as unix-seconds (server) or unix-ms.
      // Normalize to ms.
      const rawTs = Number(ev.dispatchedAt) || Date.now();
      const ts = rawTs < 1e12 ? rawTs * 1000 : rawTs;

      setJourneys((prev) => {
        const next = new Map(prev);
        next.set(ev.walkerId as string, {
          walkerId: ev.walkerId as string,
          fromWorld: ev.fromWorld as string,
          toWorld: ev.toWorld as string,
          contractId: (ev.contractId as string | null) ?? null,
          route,
          dispatchedAt: ts,
          estimatedTotalMs: Math.max(MS_PER_HOP, route.length * MS_PER_HOP),
        });
        return next;
      });
    });

    const offDelivered = subscribe('concord-link:delivered' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { walkerId?: string; messageId?: string };
      const walkerId = ev?.walkerId;
      if (!walkerId) return;
      setJourneys((prev) => {
        if (!prev.has(walkerId)) return prev;
        const next = new Map(prev);
        next.delete(walkerId);
        return next;
      });
    });

    return () => {
      offDispatch?.();
      offDelivered?.();
    };
  }, [worldId]);

  // Garbage collect: walkers whose estimated journey time has elapsed
  // by 2× (so any missed `delivered` event still cleans up). Runs once
  // per minute so it doesn't dominate render budget.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setJourneys((prev) => {
        let removed = 0;
        const next = new Map(prev);
        for (const [id, j] of prev) {
          const elapsed = now - j.dispatchedAt;
          if (elapsed > j.estimatedTotalMs * 2) {
            next.delete(id);
            removed += 1;
          }
        }
        return removed > 0 ? next : prev;
      });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Walker count
  const visibleCount = journeys.size;

  // Render the walker meshes — one per active journey. Position is
  // interpolated each frame from the route + elapsed time.
  return (
    <>
      {Array.from(journeys.values()).map((j) => (
        <WalkerMesh key={j.walkerId} journey={j} anchorPositions={anchorPositions} />
      ))}
      {visibleCount > 0 && <WalkerHorizonHud count={visibleCount} />}
    </>
  );
}

function WalkerMesh({
  journey,
  anchorPositions,
}: {
  journey: WalkerJourney;
  anchorPositions?: Record<string, AnchorPos>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const startTimeRef = useRef(journey.dispatchedAt);

  // Resolve route anchors to world positions. If a position is missing,
  // fall back to a default ring spread out by route index so the
  // walker still has somewhere to be (better than vanishing).
  const positions = useMemo<AnchorPos[]>(() => {
    return journey.route.map((anchor, idx) => {
      const lookup = anchorPositions?.[anchor];
      if (lookup) return lookup;
      // Fallback: deterministic position derived from anchor name +
      // route-index angle. Player won't see this in production
      // because anchor positions will be wired; but the component
      // never crashes if positions are absent.
      const angle = (idx / Math.max(1, journey.route.length)) * Math.PI * 2;
      const r = 250 + idx * 80;
      return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    });
  }, [journey.route, anchorPositions]);

  useFrame(() => {
    const root = groupRef.current;
    if (!root || positions.length < 2) return;

    const elapsed = Date.now() - startTimeRef.current;
    const totalHops = positions.length - 1;
    const hopsCompleted = elapsed / MS_PER_HOP;
    if (hopsCompleted < 0) return;

    const segIdx = Math.min(totalHops - 1, Math.floor(hopsCompleted));
    const segT = Math.min(1, hopsCompleted - segIdx);
    const a = positions[segIdx];
    const b = positions[segIdx + 1];

    const x = a.x + (b.x - a.x) * segT;
    const z = a.z + (b.z - a.z) * segT;
    root.position.set(x, 0.8, z);

    // Face the next anchor.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.001) {
      root.rotation.y = Math.atan2(dx, dz);
    }
  });

  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('concord-link:walker-intercept', {
      detail: {
        walkerId: journey.walkerId,
        contractId: journey.contractId,
        fromWorld: journey.fromWorld,
        toWorld: journey.toWorld,
      },
    }));
  }, [journey.walkerId, journey.contractId, journey.fromWorld, journey.toWorld]);

  return (
    <group
      ref={groupRef}
      onClick={onClick}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = ''; }}
      scale={hovered ? [1.1, 1.1, 1.1] : [1, 1, 1]}
    >
      {/* Body */}
      <mesh geometry={STICK_BODY_GEO} material={WALKER_MATERIAL} position={[0, 0, 0]} />
      {/* Head */}
      <mesh geometry={STICK_HEAD_GEO} material={WALKER_MATERIAL} position={[0, 1.0, 0]} />
    </group>
  );
}

/**
 * Tiny HUD chip showing N walkers currently traveling. Anchored to the
 * world page's existing HUD layer via a CSS fixed-position div.
 */
function WalkerHorizonHud({ count }: { count: number }) {
  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'concord-walker-hud';
    el.style.cssText = `
      position: fixed; top: 80px; right: 16px; z-index: 50;
      background: rgba(12,12,12,0.85); color: #ddd;
      border: 1px solid #2a2a2a; border-radius: 4px;
      padding: 6px 12px; font: 12px/1.4 -apple-system, system-ui;
      pointer-events: none; backdrop-filter: blur(4px);
    `;
    el.textContent = `${count} walker${count === 1 ? '' : 's'} on horizon`;
    document.body.appendChild(el);
    return () => { try { document.body.removeChild(el); } catch { /* noop */ } };
  }, [count]);
  return null;
}
