/**
 * Rock generator — Sprint D / W3
 *
 * Cuboid → Simplex noise displacement → cellular-automata erosion (10
 * iterations) → moss layer → ground-blend skirt. 30+ unique rocks per
 * biome from one generator. Hero-rock seeds saved to authored content.
 *
 * Pure module — no Three.js dependency in the math; only the mesh
 * builder needs a THREE handle.
 */

import { createSimplexNoise2D } from './simplex-noise';

export type RockBiome = 'temperate' | 'desert' | 'alpine' | 'volcanic' | 'coastal' | 'wetland';

export interface RockGenOptions {
  seed:           string;
  biome:          RockBiome;
  /** Approximate boulder radius in metres. Default 1.0. */
  size?:          number;
  /** Erosion iterations. Default 10. */
  erosionPasses?: number;
  /** Moss density 0..1. Default depends on biome. */
  mossDensity?:   number;
}

export interface RockMeshData {
  positions:    Float32Array;     // flat xyz, 3 per vertex
  normals:      Float32Array;
  colors:       Float32Array;     // flat rgb, 3 per vertex (per-vertex moss colour)
  indices:      Uint32Array;
  bounds:       { x: number; y: number; z: number };
}

const BIOME_BASE_COLOR: Record<RockBiome, [number, number, number]> = {
  temperate:  [0.45, 0.42, 0.40],
  desert:     [0.78, 0.65, 0.45],
  alpine:     [0.55, 0.55, 0.58],
  volcanic:   [0.18, 0.16, 0.18],
  coastal:    [0.60, 0.58, 0.55],
  wetland:    [0.40, 0.38, 0.36],
};

const BIOME_MOSS_COLOR: Record<RockBiome, [number, number, number]> = {
  temperate:  [0.20, 0.50, 0.25],
  desert:     [0.55, 0.65, 0.35],   // dry lichen
  alpine:     [0.35, 0.55, 0.30],
  volcanic:   [0.25, 0.20, 0.18],   // ash crust
  coastal:    [0.30, 0.45, 0.40],   // salt-stained
  wetland:    [0.15, 0.35, 0.20],
};

const BIOME_DEFAULT_MOSS_DENSITY: Record<RockBiome, number> = {
  temperate: 0.45,
  desert:    0.05,
  alpine:    0.30,
  volcanic:  0.15,
  coastal:   0.20,
  wetland:   0.55,
};

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

/**
 * Generate a procedural rock mesh. Steps:
 *  1. Spawn 12 vertices on a unit cube + radial jitter.
 *  2. Simplex noise displacement (offset each vertex by noise(p)*amp).
 *  3. Cellular-automata erosion: each pass averages each vertex with
 *     its neighbours, smoothing high-curvature points.
 *  4. Moss layer: per-vertex chance based on tilt-from-up and moss
 *     density, blended into the vertex colour.
 *  5. Ground-blend skirt: bottom verts pulled down + outwards so the
 *     rock sits without floating.
 */
export function generateRock(opts: RockGenOptions): RockMeshData {
  const {
    seed,
    biome,
    size = 1.0,
    erosionPasses = 10,
    mossDensity = BIOME_DEFAULT_MOSS_DENSITY[biome],
  } = opts;

  const rng = mulberry32(hashSeed(seed));
  const noise = createSimplexNoise2D(hashSeed(`${seed}:noise`));

  // Subdivided cube — 4 quads per face, 6 faces → 96 triangles, 50ish unique verts.
  const SUB = 3;
  const verts: number[][] = [];
  const idx: number[] = [];

  const idxOf = (x: number, y: number, z: number, face: number) => {
    const key = `${face}|${x}|${y}|${z}`;
    return key;
  };

  // Build 6 faces of a subdivided cube manually so we can keep neighbour
  // info for erosion.
  const vertMap = new Map<string, number>();
  function addVert(x: number, y: number, z: number, face: number): number {
    const k = idxOf(x, y, z, face);
    let v = vertMap.get(k);
    if (v !== undefined) return v;
    v = verts.length;
    verts.push([x, y, z]);
    vertMap.set(k, v);
    return v;
  }

  function pushFace(p1: [number, number, number], p2: [number, number, number], p3: [number, number, number], p4: [number, number, number], face: number) {
    const a = addVert(p1[0], p1[1], p1[2], face);
    const b = addVert(p2[0], p2[1], p2[2], face);
    const c = addVert(p3[0], p3[1], p3[2], face);
    const d = addVert(p4[0], p4[1], p4[2], face);
    idx.push(a, b, c, a, c, d);
  }

  // Generate cube faces.
  const step = 2 / SUB;
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < SUB; i++) {
      for (let j = 0; j < SUB; j++) {
        const u0 = -1 + i * step, u1 = u0 + step;
        const v0 = -1 + j * step, v1 = v0 + step;
        let p1: [number, number, number], p2: [number, number, number], p3: [number, number, number], p4: [number, number, number];
        switch (f) {
          case 0: p1 = [u0, v0, 1];  p2 = [u1, v0, 1];  p3 = [u1, v1, 1];  p4 = [u0, v1, 1];  break; // +Z
          case 1: p1 = [u1, v0, -1]; p2 = [u0, v0, -1]; p3 = [u0, v1, -1]; p4 = [u1, v1, -1]; break; // -Z
          case 2: p1 = [1, v0, -u0]; p2 = [1, v0, -u1]; p3 = [1, v1, -u1]; p4 = [1, v1, -u0]; break; // +X
          case 3: p1 = [-1, v0, u0]; p2 = [-1, v0, u1]; p3 = [-1, v1, u1]; p4 = [-1, v1, u0]; break; // -X
          case 4: p1 = [u0, 1, -v0]; p2 = [u1, 1, -v0]; p3 = [u1, 1, -v1]; p4 = [u0, 1, -v1]; break; // +Y
          case 5: p1 = [u0, -1, v0]; p2 = [u1, -1, v0]; p3 = [u1, -1, v1]; p4 = [u0, -1, v1]; break; // -Y
          default: continue;
        }
        pushFace(p1, p2, p3, p4, f);
      }
    }
  }

  // 1+2. Project to a sphere then displace by simplex noise.
  for (let i = 0; i < verts.length; i++) {
    const [x, y, z] = verts[i];
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const nx = x / len, ny = y / len, nz = z / len;
    const n = noise(nx * 1.5, nz * 1.5) * 0.18 + noise(nx * 4 + 7, ny * 4) * 0.06;
    const r = (1 + n) * size * (0.85 + rng() * 0.3);
    verts[i] = [nx * r, ny * r, nz * r];
  }

  // 3. CA erosion — average each vertex with its triangle-mesh neighbours.
  const adj = buildAdjacency(verts.length, idx);
  for (let pass = 0; pass < erosionPasses; pass++) {
    const next = verts.map(v => [v[0], v[1], v[2]]);
    for (let i = 0; i < verts.length; i++) {
      const nbrs = adj[i];
      if (!nbrs || nbrs.length === 0) continue;
      let sx = verts[i][0], sy = verts[i][1], sz = verts[i][2];
      for (const j of nbrs) {
        sx += verts[j][0];
        sy += verts[j][1];
        sz += verts[j][2];
      }
      const k = nbrs.length + 1;
      next[i] = [sx / k, sy / k, sz / k];
    }
    for (let i = 0; i < verts.length; i++) {
      verts[i][0] = verts[i][0] * 0.4 + next[i][0] * 0.6;
      verts[i][1] = verts[i][1] * 0.4 + next[i][1] * 0.6;
      verts[i][2] = verts[i][2] * 0.4 + next[i][2] * 0.6;
    }
  }

  // 5. Skirt: lower the bottom verts (y < -size*0.4) further into the ground.
  for (const v of verts) {
    if (v[1] < -size * 0.4) {
      v[1] -= size * 0.15;
    }
  }

  // Build flat arrays.
  const positions = new Float32Array(verts.length * 3);
  const normals = new Float32Array(verts.length * 3);
  const colors = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3 + 0] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
  }
  // 4. Moss colour per vertex.
  const baseRGB = BIOME_BASE_COLOR[biome];
  const mossRGB = BIOME_MOSS_COLOR[biome];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const upDot = v[1] / (Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1);
    const tilt = Math.max(0, upDot);
    const mossT = Math.min(1, tilt * mossDensity * 1.6 * (0.7 + rng() * 0.6));
    colors[i * 3 + 0] = baseRGB[0] * (1 - mossT) + mossRGB[0] * mossT;
    colors[i * 3 + 1] = baseRGB[1] * (1 - mossT) + mossRGB[1] * mossT;
    colors[i * 3 + 2] = baseRGB[2] * (1 - mossT) + mossRGB[2] * mossT;
  }

  computeNormals(positions, idx, normals);

  // Bounds.
  let bx = 0, by = 0, bz = 0;
  for (const v of verts) {
    bx = Math.max(bx, Math.abs(v[0]));
    by = Math.max(by, Math.abs(v[1]));
    bz = Math.max(bz, Math.abs(v[2]));
  }

  return {
    positions, normals, colors,
    indices: new Uint32Array(idx),
    bounds: { x: bx, y: by, z: bz },
  };
}

function buildAdjacency(numVerts: number, idx: number[]): number[][] {
  const adj: Set<number>[] = Array.from({ length: numVerts }, () => new Set<number>());
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  return adj.map(s => Array.from(s));
}

function computeNormals(positions: Float32Array, indices: number[], out: Float32Array) {
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    out[ia * 3] += nx; out[ia * 3 + 1] += ny; out[ia * 3 + 2] += nz;
    out[ib * 3] += nx; out[ib * 3 + 1] += ny; out[ib * 3 + 2] += nz;
    out[ic * 3] += nx; out[ic * 3 + 1] += ny; out[ic * 3 + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.sqrt(out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]) || 1;
    out[i] /= len; out[i + 1] /= len; out[i + 2] /= len;
  }
}

export const ROCK_CONSTANTS = Object.freeze({ BIOME_BASE_COLOR, BIOME_MOSS_COLOR });
