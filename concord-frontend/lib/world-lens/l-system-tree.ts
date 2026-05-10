/**
 * L-system tree generator — Sprint D / W1
 *
 * Stochastic L-system over a small alphabet (`F`=trunk segment, `+/-`=
 * yaw, `&/^`=pitch, `[/]`=push/pop, `L`=leaf cluster). Per-species
 * grammars produce trunks + branches + leaf placement deterministically
 * from a seed. Caller asks for `generateTree(species, seed)` and gets
 * back trunk segment positions / branch positions / leaf-cluster
 * positions; the renderer (InstancedTrees) instantiates geometries.
 *
 * Pure module — no Three.js dependency. Runs in workers if needed.
 */

export type TreeBiome =
  | 'temperate_forest' | 'boreal' | 'desert' | 'wetland'
  | 'tropical' | 'alpine' | 'coastal' | 'volcanic';

export type TreeSpeciesId =
  // temperate_forest
  | 'oak' | 'maple' | 'birch' | 'pine'
  // boreal
  | 'spruce' | 'fir' | 'larch' | 'dead_snag'
  // desert
  | 'saguaro' | 'mesquite' | 'creosote'
  // wetland
  | 'cypress' | 'mangrove'
  // tropical
  | 'palm' | 'banyan'
  // alpine
  | 'stunted_pine' | 'lichen_rock'
  // coastal
  | 'sea_oat' | 'scrub_pine' | 'driftwood'
  // volcanic
  | 'ash_pioneer';

export interface TreeSpeciesConfig {
  id:                TreeSpeciesId;
  axiom:             string;
  rules:             Record<string, string[]>;  // stochastic productions
  iterations:        number;
  segmentLength:     number;   // metres
  segmentRadius:     number;   // metres at base
  taper:             number;   // 0..1 — how quickly radius drops per iter
  branchAngleDeg:    number;
  trunkColor:        string;
  leafColor:         string;
  leafKind:          'broad' | 'needle' | 'spike' | 'frond' | 'cluster' | 'none';
  bareChance?:       number;   // for dead_snag, larch in winter
}

export const SPECIES: Record<TreeSpeciesId, TreeSpeciesConfig> = {
  oak: {
    id: 'oak',
    axiom: 'F[&+L][^-L]F[&-L][^+L]F',
    rules: { F: ['F[&+F]F[^-F]F', 'F[&-F]F'] },
    iterations: 3, segmentLength: 1.6, segmentRadius: 0.32, taper: 0.55,
    branchAngleDeg: 28, trunkColor: '#5a4030', leafColor: '#3a8030', leafKind: 'broad',
  },
  maple: {
    id: 'maple',
    axiom: 'F[&+F][^-F]F[&-F][^+F]F',
    rules: { F: ['F[&+L]F[^-L]', 'F[+F][-F]F'] },
    iterations: 3, segmentLength: 1.4, segmentRadius: 0.28, taper: 0.50,
    branchAngleDeg: 32, trunkColor: '#4a3520', leafColor: '#a04020', leafKind: 'broad',
  },
  birch: {
    id: 'birch',
    axiom: 'FF[&+L]F[^-L]FF',
    rules: { F: ['F[+L]F[-L]F'] },
    iterations: 3, segmentLength: 1.7, segmentRadius: 0.22, taper: 0.40,
    branchAngleDeg: 22, trunkColor: '#e0d8c0', leafColor: '#90a830', leafKind: 'broad',
  },
  pine: {
    id: 'pine',
    axiom: 'F[&L][^L][&+L][&-L]F[&L][&+L][&-L]F',
    rules: { F: ['F[&L][&+L][&-L]F'] },
    iterations: 3, segmentLength: 1.8, segmentRadius: 0.30, taper: 0.45,
    branchAngleDeg: 42, trunkColor: '#3a2820', leafColor: '#205020', leafKind: 'needle',
  },
  spruce: {
    id: 'spruce',
    axiom: 'F[&L][&+L][&-L][^L][^+L][^-L]F',
    rules: { F: ['F[&L][&+L][&-L]F'] },
    iterations: 4, segmentLength: 1.5, segmentRadius: 0.28, taper: 0.50,
    branchAngleDeg: 52, trunkColor: '#2a2018', leafColor: '#103a18', leafKind: 'needle',
  },
  fir: {
    id: 'fir', axiom: 'F[&L][&+L][&-L]F',
    rules: { F: ['F[&L][&+L][&-L]F'] },
    iterations: 4, segmentLength: 1.6, segmentRadius: 0.24, taper: 0.55,
    branchAngleDeg: 50, trunkColor: '#2c2218', leafColor: '#1a4828', leafKind: 'needle',
  },
  larch: {
    id: 'larch', axiom: 'F[&+L][^-L]F',
    rules: { F: ['F[+L]F[-L]F'] },
    iterations: 3, segmentLength: 1.5, segmentRadius: 0.22, taper: 0.50,
    branchAngleDeg: 30, trunkColor: '#5a4528', leafColor: '#c08030', leafKind: 'needle',
    bareChance: 0.4,
  },
  dead_snag: {
    id: 'dead_snag', axiom: 'F[&+F][^-F]F',
    rules: { F: ['F[+F][-F]'] },
    iterations: 2, segmentLength: 1.2, segmentRadius: 0.20, taper: 0.65,
    branchAngleDeg: 38, trunkColor: '#4a3a2c', leafColor: '#000000', leafKind: 'none',
    bareChance: 1.0,
  },
  saguaro: {
    id: 'saguaro', axiom: 'F[&+F][^-F]FF',
    rules: { F: ['FF[&+F]F[^-F]F'] },
    iterations: 2, segmentLength: 1.5, segmentRadius: 0.55, taper: 0.10,
    branchAngleDeg: 90, trunkColor: '#487038', leafColor: '#487038', leafKind: 'spike',
  },
  mesquite: {
    id: 'mesquite', axiom: 'F[+L][-L]F[+L][-L]F',
    rules: { F: ['F[&+L][^-L]F'] },
    iterations: 3, segmentLength: 1.0, segmentRadius: 0.20, taper: 0.50,
    branchAngleDeg: 38, trunkColor: '#604030', leafColor: '#608048', leafKind: 'cluster',
  },
  creosote: {
    id: 'creosote', axiom: 'F[+L][-L]F',
    rules: { F: ['F[+L][-L]'] },
    iterations: 2, segmentLength: 0.7, segmentRadius: 0.10, taper: 0.40,
    branchAngleDeg: 35, trunkColor: '#705038', leafColor: '#789850', leafKind: 'cluster',
  },
  cypress: {
    id: 'cypress', axiom: 'FF[&L][&+L][&-L]FF',
    rules: { F: ['F[&+L]F[&-L]F'] },
    iterations: 3, segmentLength: 1.6, segmentRadius: 0.30, taper: 0.55,
    branchAngleDeg: 28, trunkColor: '#3c3020', leafColor: '#385830', leafKind: 'frond',
  },
  mangrove: {
    id: 'mangrove', axiom: 'F[&+F][^-F][&-F][^+F]F',
    rules: { F: ['F[+L][-L]F'] },
    iterations: 3, segmentLength: 1.3, segmentRadius: 0.26, taper: 0.45,
    branchAngleDeg: 35, trunkColor: '#352818', leafColor: '#284830', leafKind: 'broad',
  },
  palm: {
    id: 'palm', axiom: 'FFFFF[&+L][&-L][^+L][^-L][&L][^L]',
    rules: { F: ['F'] },
    iterations: 1, segmentLength: 1.8, segmentRadius: 0.20, taper: 0.10,
    branchAngleDeg: 80, trunkColor: '#604530', leafColor: '#3a8040', leafKind: 'frond',
  },
  banyan: {
    id: 'banyan', axiom: 'F[&+F][^-F]F[&-F][^+F]F[&+F][^-F]F',
    rules: { F: ['F[+L][-L][&L][^L]F'] },
    iterations: 4, segmentLength: 1.5, segmentRadius: 0.45, taper: 0.30,
    branchAngleDeg: 30, trunkColor: '#4a3525', leafColor: '#286830', leafKind: 'broad',
  },
  stunted_pine: {
    id: 'stunted_pine', axiom: 'F[&+L][^-L]F',
    rules: { F: ['F[&+L][^-L]'] },
    iterations: 2, segmentLength: 0.8, segmentRadius: 0.18, taper: 0.45,
    branchAngleDeg: 40, trunkColor: '#3a2c20', leafColor: '#2a4828', leafKind: 'needle',
  },
  lichen_rock: {
    id: 'lichen_rock', axiom: 'L',
    rules: { L: ['L'] },
    iterations: 1, segmentLength: 0.3, segmentRadius: 0.15, taper: 0.30,
    branchAngleDeg: 0, trunkColor: '#7a7060', leafColor: '#9a9870', leafKind: 'cluster',
  },
  sea_oat: {
    id: 'sea_oat', axiom: 'FFFL',
    rules: { F: ['F'] },
    iterations: 1, segmentLength: 0.45, segmentRadius: 0.05, taper: 0.10,
    branchAngleDeg: 0, trunkColor: '#a89b6a', leafColor: '#cab875', leafKind: 'cluster',
  },
  scrub_pine: {
    id: 'scrub_pine', axiom: 'F[&+L][^-L]F[&-L][^+L]F',
    rules: { F: ['F[&L][^L]F'] },
    iterations: 2, segmentLength: 1.0, segmentRadius: 0.18, taper: 0.45,
    branchAngleDeg: 38, trunkColor: '#3e2c20', leafColor: '#385828', leafKind: 'needle',
  },
  driftwood: {
    id: 'driftwood', axiom: 'F[&+F][^-F]F',
    rules: { F: ['F'] },
    iterations: 1, segmentLength: 1.0, segmentRadius: 0.18, taper: 0.40,
    branchAngleDeg: 50, trunkColor: '#9a8a70', leafColor: '#000000', leafKind: 'none',
    bareChance: 1.0,
  },
  ash_pioneer: {
    id: 'ash_pioneer', axiom: 'F[+L][-L]F',
    rules: { F: ['F[+L][-L]'] },
    iterations: 2, segmentLength: 0.6, segmentRadius: 0.10, taper: 0.45,
    branchAngleDeg: 35, trunkColor: '#605040', leafColor: '#909078', leafKind: 'cluster',
  },
};

export const BIOME_SPECIES: Record<TreeBiome, TreeSpeciesId[]> = {
  temperate_forest: ['oak', 'maple', 'birch', 'pine'],
  boreal:           ['spruce', 'fir', 'larch', 'dead_snag'],
  desert:           ['saguaro', 'mesquite', 'creosote'],
  wetland:          ['cypress', 'mangrove'],
  tropical:         ['palm', 'banyan'],
  alpine:           ['stunted_pine', 'lichen_rock'],
  coastal:          ['sea_oat', 'scrub_pine', 'driftwood'],
  volcanic:         ['ash_pioneer'],
};

export interface TreeSegment {
  start: [number, number, number];
  end:   [number, number, number];
  radiusStart: number;
  radiusEnd:   number;
}

export interface TreeLeaf {
  position: [number, number, number];
  size:     number;
}

export interface GeneratedTree {
  species:  TreeSpeciesId;
  segments: TreeSegment[];
  leaves:   TreeLeaf[];
  trunkColor: string;
  leafColor:  string;
  bare:      boolean;
  /** Total height in metres. */
  height:    number;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expandLSystem(species: TreeSpeciesConfig, rng: () => number): string {
  let cur = species.axiom;
  for (let i = 0; i < species.iterations; i++) {
    let next = '';
    for (const ch of cur) {
      const productions = species.rules[ch];
      if (productions) {
        next += productions[Math.floor(rng() * productions.length)];
      } else {
        next += ch;
      }
    }
    cur = next;
  }
  return cur;
}

interface TurtleState {
  pos: [number, number, number];
  /** Heading direction (unit vector). */
  hd:  [number, number, number];
  /** Up direction (unit vector). */
  up:  [number, number, number];
  radius: number;
  depth: number;
}

function rotateAroundAxis(v: [number, number, number], axis: [number, number, number], rad: number): [number, number, number] {
  const [vx, vy, vz] = v;
  const [ax, ay, az] = axis;
  const c = Math.cos(rad), s = Math.sin(rad), oc = 1 - c;
  return [
    (oc * ax * ax + c) * vx +     (oc * ax * ay - az * s) * vy + (oc * ax * az + ay * s) * vz,
    (oc * ax * ay + az * s) * vx + (oc * ay * ay + c) * vy +     (oc * ay * az - ax * s) * vz,
    (oc * ax * az - ay * s) * vx + (oc * ay * az + ax * s) * vy + (oc * az * az + c) * vz,
  ];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function generateTree(speciesId: TreeSpeciesId, seedStr: string | number): GeneratedTree {
  const species = SPECIES[speciesId];
  if (!species) throw new Error(`Unknown tree species: ${speciesId}`);
  const seedNum = typeof seedStr === 'number' ? seedStr : hashSeed(String(seedStr));
  const rng = mulberry32(seedNum);
  const string = expandLSystem(species, rng);

  const segments: TreeSegment[] = [];
  const leaves: TreeLeaf[] = [];
  const stack: TurtleState[] = [];
  const branchAngle = (species.branchAngleDeg * Math.PI) / 180;

  let state: TurtleState = {
    pos: [0, 0, 0],
    hd: [0, 1, 0],
    up: [0, 0, 1],
    radius: species.segmentRadius,
    depth: 0,
  };

  const bare = species.bareChance ? rng() < species.bareChance : false;

  for (const ch of string) {
    switch (ch) {
      case 'F': {
        const len = species.segmentLength * (0.85 + rng() * 0.3);
        const next: [number, number, number] = [
          state.pos[0] + state.hd[0] * len,
          state.pos[1] + state.hd[1] * len,
          state.pos[2] + state.hd[2] * len,
        ];
        const r0 = state.radius;
        const r1 = state.radius * (1 - species.taper);
        segments.push({ start: [...state.pos] as [number, number, number], end: next, radiusStart: r0, radiusEnd: r1 });
        state = { ...state, pos: next, radius: r1 };
        break;
      }
      case '+': state = { ...state, hd: rotateAroundAxis(state.hd, state.up, branchAngle) }; break;
      case '-': state = { ...state, hd: rotateAroundAxis(state.hd, state.up, -branchAngle) }; break;
      case '&': {
        const right = cross(state.hd, state.up);
        state = { ...state, hd: rotateAroundAxis(state.hd, right, branchAngle) };
        break;
      }
      case '^': {
        const right = cross(state.hd, state.up);
        state = { ...state, hd: rotateAroundAxis(state.hd, right, -branchAngle) };
        break;
      }
      case '[': stack.push({ ...state }); break;
      case ']': { const popped = stack.pop(); if (popped) state = popped; break; }
      case 'L': {
        if (!bare && species.leafKind !== 'none') {
          leaves.push({ position: [...state.pos] as [number, number, number], size: 0.55 + rng() * 0.4 });
        }
        break;
      }
    }
  }

  let height = 0;
  for (const s of segments) {
    if (s.end[1] > height) height = s.end[1];
  }

  return {
    species: species.id,
    segments,
    leaves,
    trunkColor: species.trunkColor,
    leafColor:  species.leafColor,
    bare,
    height,
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pick a species deterministically for a (biome, position) pair. */
export function pickSpeciesForBiome(biome: TreeBiome, seed: string): TreeSpeciesId {
  const list = BIOME_SPECIES[biome];
  if (!list || list.length === 0) return 'oak';
  const h = hashSeed(seed);
  return list[h % list.length];
}

export const TREE_CONSTANTS = Object.freeze({ SPECIES, BIOME_SPECIES });
