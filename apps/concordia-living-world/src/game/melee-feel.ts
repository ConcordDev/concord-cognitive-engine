import type { Actor } from "./sim";
import { applyImpulse, type Motion } from "./locomotion";

const STRIKE_RANGE = 4.2;
const MAGNET_RANGE = 5.6;
const MAGNET_STOP = 1.45;
const CONE = 0.72;

function dist(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

function facingDot(yaw: number, fromX: number, fromZ: number, toX: number, toZ: number) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const m = Math.hypot(dx, dz) || 1;
  return (fx * dx + fz * dz) / m;
}

/** Hostiles in the strike cone, nearest first. */
export function pickStrikeTargets(
  px: number,
  pz: number,
  yaw: number,
  actors: Actor[],
  lockId: string | null,
): Actor[] {
  const hits: { a: Actor; d: number; prefer: number }[] = [];
  for (const a of actors) {
    if (!a.alive || !a.hostile) continue;
    const d = dist(px, pz, a.body.x, a.body.z);
    if (d > STRIKE_RANGE + (a.species === "dragon" || a.species === "wyrm" ? 1.4 : 0)) continue;
    const cone = facingDot(yaw, px, pz, a.body.x, a.body.z);
    if (cone < CONE && a.id !== lockId) continue;
    hits.push({ a, d, prefer: a.id === lockId ? -1 : d });
  }
  hits.sort((x, y) => x.prefer - y.prefer);
  return hits.map((h) => h.a);
}

export function pickMagnetTarget(
  px: number,
  pz: number,
  yaw: number,
  actors: Actor[],
  lockId: string | null,
): Actor | null {
  let best: Actor | null = null;
  let bestScore = 1e9;
  for (const a of actors) {
    if (!a.alive || !a.hostile) continue;
    const d = dist(px, pz, a.body.x, a.body.z);
    if (d > MAGNET_RANGE) continue;
    const cone = facingDot(yaw, px, pz, a.body.x, a.body.z);
    if (cone < 0.35 && a.id !== lockId) continue;
    const score = (a.id === lockId ? -2 : 0) + d - cone * 1.4;
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** Close the last meters so a click actually connects. DMC/Souls lunge, not teleport. */
export function lungeToward(motion: Motion, px: number, pz: number, target: Actor) {
  const dx = target.body.x - px;
  const dz = target.body.z - pz;
  const d = Math.hypot(dx, dz) || 1;
  const step = Math.max(0, Math.min(2.6, d - MAGNET_STOP));
  applyImpulse(motion, (dx / d) * step * 3.4, (dz / d) * step * 3.4);
  return Math.atan2(-dx, -dz);
}

export const ATTACK_BUFFER_MS = 280;
