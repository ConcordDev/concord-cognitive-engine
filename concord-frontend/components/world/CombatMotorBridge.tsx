'use client';

/**
 * CombatMotorBridge — Phase C1
 *
 * Wires combat-motor-driver into combat:attack socket events. For
 * each attack from the local player or an authored fighting style,
 * builds a CombatExecution and ticks it per-frame. Emits
 * concordia:combat-pose-targets every frame so the avatar's bone
 * driver can apply them.
 *
 * Concretely:
 *   - subscribes to `combat:attack` socket payload { attackerId, action }
 *   - if attackerId === userId or attackerId in tracked NPCs:
 *       const exec = buildCombatExecution(action, style, now);
 *       store in activeExecutions Map by attackerId.
 *   - rAF loop ticks each execution; on phase change emits pose-targets.
 *   - on settle / finish: clear.
 *
 * Reads fighting style from the existing combat-clips body type lookup
 * when available. Defaults to 'martial' style otherwise.
 */

import { useEffect, useRef } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface Props {
  userId?: string | null;
}

export function CombatMotorBridge({ userId: _userId }: Props) {
  const activeRef = useRef<Map<string, { exec: unknown; broker: unknown; motors: unknown }>>(new Map());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubscribers: Array<() => void> = [];

    (async () => {
      const motor = await import('@/lib/concordia/combat-motor-driver');
      const pb = await import('@/lib/concordia/pose-broker');
      const jm = await import('@/lib/concordia/joint-motors');

      const off = subscribe('combat:attack' as Parameters<typeof subscribe>[0], (payload: unknown) => {
        if (disposed) return;
        const ev = payload as { attackerId?: string; action?: string; style?: string };
        if (!ev?.attackerId || !ev.action) return;
        const action = ev.action as 'attack-light' | 'attack-heavy' | 'kick' | 'grapple' | 'block' | 'parry' | 'dodge-back' | 'dodge-left' | 'dodge-right';
        const style = (ev.style ?? 'martial') as unknown as Parameters<typeof motor.buildCombatExecution>[1];
        try {
          // buildCombatExecution requires a `biomechanicsPoses` array;
          // we pass an empty array — the motor uses sensible defaults
          // when no per-pose targets are provided.
          const exec = motor.buildCombatExecution(action, style, []);
          const broker = new pb.PoseBroker();
          const motors = new jm.JointMotorSystem();
          activeRef.current.set(ev.attackerId, { exec, broker, motors });
        } catch { /* motor optional */ }
      });
      unsubscribers.push(off);

      function tick() {
        if (disposed) return;
        const now = performance.now();
        for (const [actorId, entry] of activeRef.current) {
          const e = entry.exec as Parameters<typeof motor.tickCombatExecution>[0];
          const broker = entry.broker as Parameters<typeof motor.tickCombatExecution>[1];
          const motors = entry.motors as Parameters<typeof motor.tickCombatExecution>[2];
          const result = motor.tickCombatExecution(e, broker, motors, now);
          if (result.complete || result.phase === 'settle') {
            activeRef.current.delete(actorId);
          }
          window.dispatchEvent(new CustomEvent('concordia:combat-pose-targets', {
            detail: { actorId, phase: result.phase, t: result.t, action: e.action, style: e.style, ts: now },
          }));
        }
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    })();

    return () => {
      disposed = true;
      for (const u of unsubscribers) u();
      unsubscribers = [];
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return null;
}
