import type { WorldId } from "./content";
import { beastDef, type BeastDef } from "./creatures";
import { mulberry32, pick, xmur3 } from "./rng";
import { REALM_FAUNA } from "./realms";
import type { BeastKind } from "./worlds";

const PREFIX = ["Ash", "Dust", "Null", "Grove", "Dawn", "Invoice", "Lattice", "Scrub", "Quiet", "Census", "Unburied", "Pollen"];
const SUFFIX = ["-kin", " walker", " uncounted", " remnant", " drift", " choir", " ward", " born"];

export type EvoTraits = {
  wings?: boolean;
  horns?: boolean;
  glow?: boolean;
  plates?: boolean;
};

export type EvoSpec = {
  id: string;
  kind: BeastKind;
  name: string;
  color: string;
  accent: string;
  scale: number;
  x: number;
  z: number;
  fly: boolean;
  parentA: BeastKind;
  parentB: BeastKind;
  traits: EvoTraits;
};

function lerpHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (s: number) => {
    const va = (pa >> s) & 255;
    const vb = (pb >> s) & 255;
    return Math.round(va + (vb - va) * t);
  };
  const n = (mix(16) << 16) + (mix(8) << 8) + mix(0);
  return `#${n.toString(16).padStart(6, "0")}`;
}

const FLYERS: BeastKind[] = ["dragon", "wyrm", "griffin", "harpy", "drone", "sentinel", "drift"];
const HORNED: BeastKind[] = ["dragon", "wyrm", "basilisk", "golem", "sealie"];
const GLOW: BeastKind[] = ["drone", "sentinel", "drift", "wraith"];
const PLATES: BeastKind[] = ["golem", "construct", "basilisk", "sentinel"];

export function birthCreature(world: WorldId, day: number, n: number, around: { x: number; z: number }): EvoSpec | null {
  const fauna = REALM_FAUNA[world];
  if (!fauna.length) return null;
  const rng = mulberry32(xmur3(`${world}:evo:${day}:${n}`)());
  const parentA = pick(rng, fauna);
  const parentB = pick(rng, fauna);
  const kind = rng() < 0.55 ? parentA : parentB;
  const da = beastDef(parentA);
  const db = beastDef(parentB);
  const t = 0.25 + rng() * 0.5;
  const ang = rng() * Math.PI * 2;
  const rad = 70 + rng() * 160;
  const fly = FLYERS.includes(parentA) || FLYERS.includes(parentB);
  return {
    id: `evo-${world}-${day}-${n}`,
    kind,
    name: `${pick(rng, PREFIX)}${pick(rng, SUFFIX)}`,
    color: lerpHex(da.color, db.color, t),
    accent: lerpHex(da.accent, db.accent, 1 - t),
    scale: 0.85 + rng() * 0.55,
    x: around.x + Math.cos(ang) * rad,
    z: around.z + Math.sin(ang) * rad,
    fly,
    parentA,
    parentB,
    traits: {
      wings: fly && !FLYERS.includes(kind),
      horns: HORNED.includes(parentA) || HORNED.includes(parentB),
      glow: GLOW.includes(parentA) || GLOW.includes(parentB),
      plates: PLATES.includes(parentA) || PLATES.includes(parentB),
    },
  };
}

export function evoTint(def: BeastDef, spec: EvoSpec): BeastDef {
  return { ...def, color: spec.color, accent: spec.accent, scale: def.scale * spec.scale };
}
