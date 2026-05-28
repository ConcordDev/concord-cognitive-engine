'use client';

/**
 * ImpactMomentumBridge — T1.4b/T3.1b.
 *
 * Subscribes the socket `combat:hit` (PvP path) and runs the live client
 * momentum model (resolveImpact → computeImpactMomentum) to drive feel, using
 * the element/skillId/weapon/tier the server now ships on that event (BUG B).
 * Re-dispatches the SAME window events the avatar loop already honours —
 * `concordia:hit-pause`, `concordia:knockback`, `concordia:hit-reaction` — so
 * nothing downstream changes shape.
 *
 * NPC hits ship a server-authoritative `feel` block on `combat:impact`
 * (CombatImpactFeelBridge); this bridge handles the PvP socket path where no
 * server feel block is sent, computing the SAME physics locally. A 120ms
 * per-target de-dupe guards against double-firing if a `combat:polish` rocked
 * event arrives for the same target in the same window.
 */

import { useEffect, useRef } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { resolveImpact } from '@/lib/concordia/impact-resolver';

export function ImpactMomentumBridge() {
  const lastFiredRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const off = subscribe('combat:hit' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as {
        targetId?: string;
        attackerId?: string;
        weapon?: string;
        skillId?: string;
        tier?: number;
        isCrit?: boolean;
        targetKilled?: boolean;
        targetPosition?: { x: number; y?: number; z: number };
        attackerPosition?: { x: number; y?: number; z: number };
      };
      if (!ev?.targetId) return;

      // 120ms per-target de-dupe (the combat:polish rocked path may also fire).
      const now = Date.now();
      const last = lastFiredRef.current.get(ev.targetId) ?? 0;
      if (now - last < 120) return;
      lastFiredRef.current.set(ev.targetId, now);

      const feel = resolveImpact({
        weapon: ev.weapon ?? ev.skillId ?? null,
        tier: ev.tier,
        isCrit: ev.isCrit,
        isKill: ev.targetKilled,
      });

      // 1) Hitstop on the target (+ a short attacker freeze on big hits).
      if (feel.hitPauseMs > 0) {
        window.dispatchEvent(new CustomEvent('concordia:hit-pause', {
          detail: { entityId: ev.targetId, durationMs: feel.hitPauseMs },
        }));
        if (feel.severity === 'crit' || feel.severity === 'kill') {
          if (ev.attackerId) {
            window.dispatchEvent(new CustomEvent('concordia:hit-pause', {
              detail: { entityId: ev.attackerId, durationMs: Math.round(feel.hitPauseMs * 0.3) },
            }));
          }
        }
      }

      // 2) Knockback away from the attacker (needs both positions).
      if (feel.knockback > 0 && ev.targetPosition && ev.attackerPosition) {
        const dx = ev.targetPosition.x - ev.attackerPosition.x;
        const dz = ev.targetPosition.z - ev.attackerPosition.z;
        const mag = Math.hypot(dx, dz) || 1;
        window.dispatchEvent(new CustomEvent('concordia:knockback', {
          detail: {
            entityId: ev.targetId,
            direction: { x: dx / mag, z: dz / mag },
            magnitude: feel.knockback,
            durationMs: feel.severity === 'kill' ? 320 : 220,
          },
        }));
      }

      // 3) Reflex wince graded by momentum severity.
      const winceSeverity = feel.severity === 'kill' || feel.severity === 'crit'
        ? 'crit' : feel.severity === 'heavy' ? 'heavy' : 'light';
      window.dispatchEvent(new CustomEvent('concordia:hit-reaction', {
        detail: { targetId: ev.targetId, severity: winceSeverity, reflexIntensity: feel.reflexIntensity },
      }));
    });
    const map = lastFiredRef.current;
    return () => { off?.(); map.clear(); };
  }, []);

  return null;
}

export default ImpactMomentumBridge;
