/** Presentation adapter for combat.ts. Does not change hit math. */

import type { Stagger } from "./combat";
import { addHitstop, addTrauma, type Juice } from "./juice";

export type Impact = {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  mag: number;
  born: number;
  life: number;
  hot: boolean;
};

export function emptyImpacts(): Impact[] {
  return [];
}

export function spawnImpact(list: Impact[], im: Impact) {
  list.push(im);
  if (list.length > 28) list.splice(0, list.length - 28);
}

export function pruneImpacts(list: Impact[], now: number) {
  for (let i = list.length - 1; i >= 0; i--) {
    const im = list[i]!;
    if (now - im.born > im.life) list.splice(i, 1);
  }
}

export function presentHit(opts: {
  juice: Juice;
  impacts: Impact[];
  now: number;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  stagger: Stagger;
  trauma: number;
  hitPauseMs: number;
  landed: boolean;
  parried: boolean;
  iframed: boolean;
}): void {
  const n = Math.hypot(opts.dirX, opts.dirZ) || 1;
  const dx = opts.dirX / n;
  const dz = opts.dirZ / n;
  if (opts.iframed) return;
  if (opts.parried) {
    addTrauma(opts.juice, 0.16);
    opts.juice.punch = Math.min(1, opts.juice.punch + 0.18);
    burst(opts.impacts, opts.now, opts.x, opts.y, opts.z, dx, dz, 0.7, 6, true);
    return;
  }
  if (!opts.landed) return;
  const weight =
    opts.stagger === "knockdown" ? 1 : opts.stagger === "rocked" ? 0.72 : opts.stagger === "flinch" ? 0.48 : 0.28;
  addTrauma(opts.juice, opts.trauma * 0.9);
  addHitstop(opts.juice, Math.min(opts.hitPauseMs, opts.stagger === "knockdown" ? 42 : 28));
  opts.juice.flash = Math.min(1, (opts.juice.flash ?? 0) + 0.55 + weight * 0.4);
  opts.juice.punch = Math.min(1, opts.juice.punch + 0.22 + weight * 0.45);
  opts.juice.kickX = (opts.juice.kickX ?? 0) + -dx * (0.08 + weight * 0.16);
  opts.juice.kickZ = (opts.juice.kickZ ?? 0) + -dz * (0.08 + weight * 0.16);
  burst(opts.impacts, opts.now, opts.x, opts.y, opts.z, dx, dz, 0.55 + weight, 5 + Math.floor(weight * 8), true);
  burst(opts.impacts, opts.now, opts.x, opts.y - 0.2, opts.z, dx * 0.2, dz * 0.2, 0.35, 4, false);
}

function burst(
  list: Impact[],
  now: number,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  mag: number,
  n: number,
  hot: boolean,
) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + now * 0.001;
    spawnImpact(list, {
      x,
      y,
      z,
      dx: dx * 0.6 + Math.cos(a) * 0.55,
      dz: dz * 0.6 + Math.sin(a) * 0.55,
      mag: mag * (0.65 + (i % 3) * 0.12),
      born: now,
      life: hot ? 280 : 420,
      hot,
    });
  }
}

export function reactMs(stagger: Stagger): number {
  if (stagger === "knockdown") return 900;
  if (stagger === "rocked") return 520;
  if (stagger === "flinch") return 220;
  return 0;
}
