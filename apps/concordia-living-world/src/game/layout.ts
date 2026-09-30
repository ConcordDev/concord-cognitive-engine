import { ARENA, RING_RADIUS, WALL_RADIUS } from "./content";

export type Building = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  variant: number;
};

export type Collider = { x: number; z: number; r: number };

export type HubLayout = {
  buildings: Building[];
  trees: { x: number; z: number; s: number }[];
  lamps: { x: number; z: number }[];
  stalls: { x: number; z: number; rot: number }[];
  colliders: Collider[];
};

export function buildHubLayout(): HubLayout {
  const buildings: Building[] = [];
  const trees: { x: number; z: number; s: number }[] = [];
  const lamps: { x: number; z: number }[] = [];
  const stalls: { x: number; z: number; rot: number }[] = [];
  const colliders: Collider[] = [];

  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + 0.05;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    if (dz > 0.62) continue;
    if (dx > 0.68 && Math.abs(dz) < 0.28) continue;
    const rad = 34 + (i % 5) * 1.5 + (i % 3) * 0.35;
    const x = dx * rad;
    const z = dz * rad;
    const w = 3.4 + (i % 4) * 0.6;
    const d = 3.1 + ((i * 3) % 4) * 0.5;
    const h = 4.6 + (i % 7) * 0.95;
    const rot = a + Math.PI / 2;
    buildings.push({ x, z, w, d, h, rot, variant: i % 5 });
    colliders.push({ x, z, r: Math.hypot(w, d) * 0.52 });
  }

  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.38;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    if (dz > 0.55 && Math.abs(dx) < 0.48) continue;
    if (dx > 0.55 && Math.abs(dz) < 0.22) continue;
    const rad = 26.5 + (i % 2) * 2.2;
    trees.push({ x: dx * rad, z: dz * rad, s: 0.85 + (i % 3) * 0.18 });
    colliders.push({ x: dx * rad, z: dz * rad, r: 0.85 });
  }

  for (let i = 0; i < 8; i++) {
    lamps.push({ x: 12 + i * 1.7, z: ((i % 2) - 0.5) * 2.15 });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lamps.push({ x: Math.cos(a) * (RING_RADIUS + 3.2), z: Math.sin(a) * (RING_RADIUS + 3.2) });
  }

  stalls.push({ x: 8.5, z: 6.2, rot: -0.4 });
  stalls.push({ x: 9.2, z: -5.6, rot: 0.5 });
  stalls.push({ x: -7.4, z: 5.8, rot: 2.4 });
  for (const s of stalls) colliders.push({ x: s.x, z: s.z, r: 1.35 });

  colliders.push({ x: ARENA.x, z: ARENA.z + 9.2, r: 1.6 });
  return { buildings, trees, lamps, stalls, colliders };
}

export const HUB_LAYOUT = buildHubLayout();

export function resolveCollision(
  x: number,
  z: number,
  radius: number,
  colliders: Collider[],
  bound = WALL_RADIUS,
): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const c of colliders) {
    const dx = px - c.x;
    const dz = pz - c.z;
    const min = radius + c.r;
    const d = Math.hypot(dx, dz);
    if (d < min && d > 1e-4) {
      const s = (min - d) / d;
      px += dx * s;
      pz += dz * s;
    }
  }
  const dist = Math.hypot(px, pz);
  const max = bound - 2.2;
  if (dist > max && max > 4) {
    px *= max / dist;
    pz *= max / dist;
  }
  return { x: px, z: pz };
}

export function resolveBoxes(
  x: number,
  z: number,
  radius: number,
  boxes: { x: number; z: number; w: number; d: number; rot: number }[],
): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const b of boxes) {
    const dx = px - b.x;
    const dz = pz - b.z;
    const c = Math.cos(-b.rot);
    const s = Math.sin(-b.rot);
    let lx = dx * c - dz * s;
    let lz = dx * s + dz * c;
    const hw = b.w * 0.5 + radius;
    const hd = b.d * 0.5 + radius;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) continue;
    const pxen = hw - Math.abs(lx);
    const pzen = hd - Math.abs(lz);
    if (pxen < pzen) lx += Math.sign(lx || 1) * pxen;
    else lz += Math.sign(lz || 1) * pzen;
    px = b.x + lx * c + lz * s;
    pz = b.z - lx * s + lz * c;
  }
  return { x: px, z: pz };
}
