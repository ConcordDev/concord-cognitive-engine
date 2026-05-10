'use client';

/**
 * NpcPerceptionBridge — Sprint B Phase 9
 *
 * Subscribes to `npc:perception-update` socket events emitted by the
 * server's npc-perception-snapshot heartbeat (every ~2 minutes) and
 * dispatches the `concordia:npc-look-at` CustomEvent that
 * AvatarSystem3D's existing per-NPC head-rotation handler consumes
 * (AvatarSystem3D.tsx:1044). Also dispatches a new
 * `concordia:npc-mood` CustomEvent that gait-synthesis + facial-blend
 * consumers can read for posture / expression bias.
 *
 * Filtering rules (mirror the server-side heartbeat invariants):
 *   - `shouldLookAtPlayer` matches the local userId → fire look-at.
 *     A grudge against another player should NOT make THIS player's
 *     view rotate the NPC; only the targeted player's view does.
 *   - `shouldMirrorPosture` is broadcast — any nearby player can
 *     observe the body-language mirror. We dispatch the mood event
 *     for all NPCs in scope, so the gait synthesis applies the same
 *     posture across all viewers.
 *
 * Computes the NPC's target yaw client-side (atan2 toward the local
 * player position read from globalThis.__CONCORD_PLAYER_POS__, set
 * by AvatarSystem3D every frame). The substrate doesn't need to know
 * world-space coordinates — this is pure presentation glue.
 */

import { useEffect, useRef } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface PerceptionPayload {
  npcId: string;
  worldId: string;
  shouldLookAtPlayer?: string | null;
  activeGrudgeSeverity?: number;
  shouldMirrorPosture?: { allyNpcId: string; intensity: number } | null;
  shouldAvoidEyeContact?: boolean;
  preoccupationKind?: string | null;
  factionPhase?: string | null;
  moodBias: 'hostile' | 'wary' | 'neutral' | 'friendly';
}

interface PlayerPos { x: number; z: number }

interface NpcPos { x: number; z: number }

interface Props {
  /** The local player's user id. Required to gate look-at events. */
  userId: string | null;
}

export default function NpcPerceptionBridge({ userId }: Props) {
  const lastEmitTsRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!userId) return;
    const off = subscribe('npc:perception-update' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as PerceptionPayload;
      if (!ev?.npcId) return;

      // Coalesce — at most one head-look dispatch per NPC every 1.5s.
      // The substrate emits at ~2-minute cadence, but a player whose
      // grudge target switches between local and remote observers
      // could see two emits in the same tick window.
      const lastTs = lastEmitTsRef.current.get(ev.npcId) ?? 0;
      const now = performance.now();
      if (now - lastTs < 1500) return;
      lastEmitTsRef.current.set(ev.npcId, now);

      // Look-at: only fire if THIS player is the perceived target.
      if (ev.shouldLookAtPlayer && ev.shouldLookAtPlayer === userId) {
        const playerPos = (globalThis as { __CONCORD_PLAYER_POS__?: PlayerPos }).__CONCORD_PLAYER_POS__;
        const npcRegistry = (globalThis as { __CONCORD_NPC_POSITIONS__?: Record<string, NpcPos> }).__CONCORD_NPC_POSITIONS__;
        const npcPos = npcRegistry?.[ev.npcId];

        if (playerPos && npcPos) {
          const dx = playerPos.x - npcPos.x;
          const dz = playerPos.z - npcPos.z;
          const targetRot = Math.atan2(dx, dz);
          window.dispatchEvent(new CustomEvent('concordia:npc-look-at', {
            detail: {
              npcId: ev.npcId,
              targetRot,
              reason: 'grudge',
              severity: ev.activeGrudgeSeverity ?? 0,
            },
          }));
        }
      }

      // Mood / posture — broadcast to all observers. The gait + facial
      // consumers in AvatarSystem3D / AnimationManager / facial-blend-
      // shapes look this up when picking the next posture frame.
      window.dispatchEvent(new CustomEvent('concordia:npc-mood', {
        detail: {
          npcId: ev.npcId,
          worldId: ev.worldId,
          mood: ev.moodBias,
          preoccupationKind: ev.preoccupationKind ?? null,
          factionPhase: ev.factionPhase ?? null,
          mirrorAllyId: ev.shouldMirrorPosture?.allyNpcId ?? null,
          mirrorIntensity: ev.shouldMirrorPosture?.intensity ?? 0,
          avoidEyeContact: !!ev.shouldAvoidEyeContact,
        },
      }));
    });

    return () => off?.();
  }, [userId]);

  return null;
}
