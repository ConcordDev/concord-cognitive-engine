import type { WorldId } from "./content";
import { fbm, hash2 } from "./rng";
import { PLAZA_RADIUS, REALM_RADIUS } from "./realms";

export function heightAt(world: WorldId, x: number, z: number): number {
  if (world === "concordia-hub") return 0;
  const r = Math.hypot(x, z);
  if (r < PLAZA_RADIUS) return 0;
  const flatten = Math.min(1, (r - PLAZA_RADIUS) / 40);
  const freq = world === "concord-link-frontier" ? 0.0042 : world === "tunya" ? 0.006 : 0.0052;
  const amp =
    world === "tunya" || world === "concord-link-frontier" ? 9.5 : world === "lattice-crucible" ? 6.2 : 7.4;
  let h = fbm(x * freq, z * freq, world.length) * amp;
  if (world === "cyber") h *= 0.35;
  if (world === "crime") h *= 0.45;
  return h * flatten;
}

export type FloraKind = "tree" | "rock" | "grass" | "spire" | "bone";

export function floraKind(world: WorldId, x: number, z: number): FloraKind | null {
  if (Math.hypot(x, z) < PLAZA_RADIUS + 4) return null;
  const h = hash2(Math.floor(x / 14), Math.floor(z / 14), world.length + 3);
  if (world === "cyber") return h > 0.72 ? "spire" : h > 0.45 ? "rock" : null;
  if (world === "sovereign-ruins") return h > 0.78 ? "bone" : h > 0.5 ? "rock" : h > 0.32 ? "tree" : h > 0.14 ? "grass" : null;
  if (world === "crime") return h > 0.7 ? "rock" : h > 0.55 ? "spire" : null;
  if (world === "lattice-crucible") return h > 0.62 ? "spire" : h > 0.4 ? "rock" : null;
  if (h > 0.58) return "tree";
  if (h > 0.4) return "rock";
  if (h > 0.18) return "grass";
  return null;
}

export function gatherFlora(
  world: WorldId,
  px: number,
  pz: number,
  radius = 220,
): { kind: FloraKind; x: number; z: number; s: number; rot: number }[] {
  const out: { kind: FloraKind; x: number; z: number; s: number; rot: number }[] = [];
  const step = 12;
  const x0 = Math.floor((px - radius) / step);
  const z0 = Math.floor((pz - radius) / step);
  const x1 = Math.ceil((px + radius) / step);
  const z1 = Math.ceil((pz + radius) / step);
  for (let gx = x0; gx <= x1; gx++) {
    for (let gz = z0; gz <= z1; gz++) {
      const x = gx * step + (hash2(gx, gz, 9) - 0.5) * 10;
      const z = gz * step + (hash2(gx, gz, 11) - 0.5) * 10;
      if (Math.hypot(x - px, z - pz) > radius) continue;
      if (Math.hypot(x, z) > REALM_RADIUS - 30) continue;
      const kind = floraKind(world, x, z);
      if (!kind) continue;
      out.push({
        kind,
        x,
        z,
        s: 0.7 + hash2(gx, gz, 13) * 1.1,
        rot: hash2(gx, gz, 17) * Math.PI * 2,
      });
    }
  }
  return out;
}

export function farHills(world: WorldId): { x: number; z: number; s: number }[] {
  const out: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + 0.21;
    const r = 380 + hash2(i, 2, world.length) * 1180;
    out.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      s: 4 + hash2(i, 4, world.length) * 10,
    });
  }
  return out;
}
