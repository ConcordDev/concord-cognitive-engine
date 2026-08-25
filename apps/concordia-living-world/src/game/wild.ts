import type { WorldId } from "./content";
import { beastDef } from "./creatures";
import { birthCreature, type EvoSpec } from "./evo";
import { REALM_FAUNA, PLAZA_RADIUS, REALM_RADIUS } from "./realms";
import { mulberry32, pick, xmur3 } from "./rng";
import type { BeastKind } from "./worlds";

export const WILD_CAP = 24;
export const WILD_RANGE = 260;

export type WildSpec = {
  id: string;
  kind: BeastKind;
  x: number;
  z: number;
  packId: string;
  evo?: EvoSpec;
};

function packSize(kind: BeastKind) {
  if (kind === "wolf" || kind === "hound" || kind === "drone") return 3;
  if (kind === "wraith" || kind === "sealie") return 2;
  return 1;
}

export function streamWild(
  world: WorldId,
  day: number,
  px: number,
  pz: number,
  liveWild: number,
  seen: Set<string>,
  ecology: number,
): WildSpec[] {
  if (world === "concordia-hub") return [];
  const fauna = REALM_FAUNA[world];
  if (!fauna.length) return [];
  const r = Math.hypot(px, pz);
  if (r < PLAZA_RADIUS + 8) return [];
  if (r > REALM_RADIUS - 80) return [];
  if (liveWild >= WILD_CAP) return [];
  const gx = Math.floor(px / 70);
  const gz = Math.floor(pz / 70);
  const key = `${world}:${gx}:${gz}`;
  if (seen.has(key) && ecology < 0.55) return [];
  seen.add(key);
  const rng = mulberry32(xmur3(`${key}:${day}`)());
  if (rng() > 0.92 + ecology * 0.08) return [];
  const kind = pick(rng, fauna);
  const n = packSize(kind);
  const pack = `pack-${key}`;
  const ang0 = rng() * Math.PI * 2;
  const rad = 28 + rng() * 40;
  const spawned: WildSpec[] = [];
  for (let i = 0; i < n; i++) {
    const a = ang0 + (i / n) * Math.PI * 2;
    spawned.push({
      id: `wild-${key}-${i}`,
      kind,
      x: px + Math.cos(a) * rad,
      z: pz + Math.sin(a) * rad,
      packId: pack,
    });
  }
  if (ecology > 0.7 && rng() > 0.55) {
    const spec = birthCreature(world, day, seen.size, { x: px, z: pz });
    if (spec) {
      spawned.push({
        id: spec.id,
        kind: spec.kind,
        x: spec.x,
        z: spec.z,
        packId: pack,
        evo: spec,
      });
    }
  }
  return spawned;
}

export function cullWildIds(ids: { id: string; x: number; z: number }[], px: number, pz: number): Set<string> {
  const keep = new Set<string>();
  for (const a of ids) {
    if (!a.id.startsWith("wild-")) continue;
    if (Math.hypot(a.x - px, a.z - pz) > WILD_RANGE + 80) keep.add(a.id);
  }
  return keep;
}

export function wildDef(kind: BeastKind) {
  return beastDef(kind);
}
