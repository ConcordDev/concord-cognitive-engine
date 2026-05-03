'use client';

import { useEffect, useRef } from 'react';

/**
 * NPCBehaviorHooks — drives the polish-pass NPC liveliness behaviors:
 *   - Look-at-player: NPCs within 5m smoothly rotate to face the player
 *     (dispatches concordia:npc-look-at; AvatarSystem3D updates the
 *     existing per-NPC targetRot which the frame loop already smooth-
 *     interpolates).
 *   - Greeting wave: when the player crosses < 5m to an NPC and it's been
 *     ≥ 60s since their last greeting, dispatch a wave anim.
 *   - Idle micro-anims: every 8–15s per NPC, dispatch a small idle anim
 *     (look-around / inspect / occasional wave / celebrate). 70% no-op
 *     keeps the world from feeling like everyone is fidgeting at once.
 *
 * All driven via window events so the consumer (AvatarSystem3D) doesn't
 * need a prop interface change.
 */

interface NPCInfo {
  id: string;
  position: { x: number; y: number; z: number };
}

interface Props {
  playerPos: { x: number; y: number; z: number };
  npcs: NPCInfo[];
  enabled?: boolean;
}

const LOOK_AT_RADIUS = 5;        // metres
const GREET_RADIUS = 5;          // metres
const GREET_COOLDOWN_MS = 60_000;
const LOOK_AT_INTERVAL_MS = 250;
const IDLE_MICRO_MIN_MS = 8_000;
const IDLE_MICRO_MAX_MS = 15_000;

const IDLE_MICRO_POOL: Array<{ anim: string; weight: number }> = [
  { anim: '__idle__',  weight: 70 }, // no-op (kept as a clear sentinel)
  { anim: 'inspect',   weight: 12 }, // glance around / inspect surroundings
  { anim: 'wave',      weight: 8 },  // a stray wave to nobody
  { anim: 'celebrate', weight: 5 },  // small triumph (NPC remembered something)
  { anim: 'craft',     weight: 5 },  // brief miming
];

function pickIdleAnim(): string {
  const total = IDLE_MICRO_POOL.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of IDLE_MICRO_POOL) {
    r -= e.weight;
    if (r <= 0) return e.anim;
  }
  return '__idle__';
}

export default function NPCBehaviorHooks({ playerPos, npcs, enabled = true }: Props) {
  const greetedAtRef = useRef<Map<string, number>>(new Map());
  const insideRef = useRef<Set<string>>(new Set());
  const idleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const playerPosRef = useRef(playerPos);
  const npcsRef = useRef<NPCInfo[]>(npcs);

  // Keep refs current so the interval/timer callbacks see fresh data.
  useEffect(() => { playerPosRef.current = playerPos; }, [playerPos.x, playerPos.y, playerPos.z]);
  useEffect(() => { npcsRef.current = npcs; }, [npcs]);

  // ── Periodic look-at + greet detection ──────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const p = playerPosRef.current;
      const nowInside: Set<string> = new Set();
      for (const npc of npcsRef.current) {
        const dx = p.x - npc.position.x;
        const dz = p.z - npc.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= LOOK_AT_RADIUS && dist > 0.05) {
          // Yaw the NPC should rotate to so that they face the player.
          // Avatar mesh "forward" maps to (-sin(yaw), -cos(yaw)) in +Z facing
          // model — keep consistent with player rotation convention used
          // elsewhere in the world page (yaw = atan2(dx, dz) gets us close).
          const targetRot = Math.atan2(dx, dz);
          window.dispatchEvent(new CustomEvent('concordia:npc-look-at', {
            detail: { npcId: npc.id, targetRot },
          }));
          if (dist <= GREET_RADIUS) nowInside.add(npc.id);
        }
      }
      // Greet on enter (not present last tick, present now)
      const prevInside = insideRef.current;
      const now = performance.now();
      for (const id of nowInside) {
        if (prevInside.has(id)) continue;
        const lastGreet = greetedAtRef.current.get(id) ?? 0;
        if (now - lastGreet < GREET_COOLDOWN_MS) continue;
        greetedAtRef.current.set(id, now);
        window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
          detail: { entityId: id, animation: 'wave' },
        }));
      }
      insideRef.current = nowInside;
    }, LOOK_AT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  // ── Per-NPC idle micro-animation timers ─────────────────────────────────────
  // Schedule a random anim at a randomized interval per NPC. Re-schedule from
  // the timer callback so each NPC has its own cadence — avoids a thundering
  // herd of all NPCs animating on the same tick.
  useEffect(() => {
    if (!enabled) return;
    const timers = idleTimersRef.current;

    function scheduleNext(npcId: string) {
      const delay = IDLE_MICRO_MIN_MS + Math.random() * (IDLE_MICRO_MAX_MS - IDLE_MICRO_MIN_MS);
      const t = setTimeout(() => {
        const anim = pickIdleAnim();
        if (anim !== '__idle__') {
          window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
            detail: { entityId: npcId, animation: anim },
          }));
        }
        scheduleNext(npcId);
      }, delay);
      timers.set(npcId, t);
    }

    // Start a timer for each NPC (and clean up when they disappear)
    const seenIds = new Set<string>();
    for (const npc of npcs) {
      seenIds.add(npc.id);
      if (!timers.has(npc.id)) scheduleNext(npc.id);
    }
    for (const [id, t] of timers) {
      if (!seenIds.has(id)) {
        clearTimeout(t);
        timers.delete(id);
      }
    }

    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [enabled, npcs]);

  return null;
}
