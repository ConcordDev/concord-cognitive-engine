'use client';

/**
 * ReflexBridge — Phase C4
 *
 * Drives ReflexLayer for the local player. Per frame, builds a
 * ReflexSensorState from the existing player_position + physicsWorld
 * isAirborne + recent hit events, then calls reflex.update(state).
 * Emits `concordia:reflex-trigger` per active reflex so the avatar's
 * AnimationManager (or pose broker if wired) can overlay a brief
 * brace / wince / step-recovery / grab-rail / stagger-yaw clip.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { subscribe } from '@/lib/realtime/socket';

export function ReflexBridge() {
  const rafRef = useRef<number | null>(null);
  const lastHitRef = useRef<{ direction: THREE.Vector3; magnitude: number; timestamp: number } | null>(null);
  const rockedRef = useRef<number>(0);

  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];

    (async () => {
      const { ReflexLayer } = await import('@/lib/concordia/reflex-layer');
      const layer = new ReflexLayer();

      offs.push(subscribe('combat:hit' as Parameters<typeof subscribe>[0], (payload: unknown) => {
        const ev = payload as { targetId?: string; attackerPosition?: { x: number; y: number; z: number }; targetPosition?: { x: number; y: number; z: number }; finalDamage?: number };
        if (!ev) return;
        // Direction = attacker -> target (assume target is local player).
        const a = ev.attackerPosition;
        const t = ev.targetPosition;
        if (!a || !t) return;
        const dir = new THREE.Vector3(t.x - a.x, 0, t.z - a.z).normalize();
        const mag = Math.min(1, (ev.finalDamage ?? 10) / 100);
        lastHitRef.current = { direction: dir, magnitude: mag, timestamp: performance.now() };
      }));

      offs.push(subscribe('combat:stagger' as Parameters<typeof subscribe>[0], (payload: unknown) => {
        const ev = payload as { magnitude?: number };
        rockedRef.current = Math.max(rockedRef.current, ev?.magnitude ?? 0.3);
      }));

      function tick() {
        if (disposed) return;
        const playerPos = (globalThis as { __CONCORD_PLAYER_POS__?: { x: number; y: number; z: number } }).__CONCORD_PLAYER_POS__ ?? { x: 0, y: 0, z: 0 };
        const com = new THREE.Vector3(playerPos.x, playerPos.y + 1.0, playerPos.z);
        const support = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);
        const state: import('@/lib/concordia/reflex-layer').ReflexSensorState = {
          com,
          supportCentre: support,
          supportRadius: 0.45,
          incomingHit: lastHitRef.current,
          slipDetected: false,
          falling: false,
          rockedMagnitude: rockedRef.current,
        };
        layer.update(state, performance.now());
        // Decay rocked + clear hit after one tick
        rockedRef.current = Math.max(0, rockedRef.current - 0.05);
        if (lastHitRef.current && performance.now() - lastHitRef.current.timestamp > 200) {
          lastHitRef.current = null;
        }
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    })();

    return () => {
      disposed = true;
      for (const off of offs) off();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return null;
}
