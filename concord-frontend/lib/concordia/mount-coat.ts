/**
 * Mount coat textures + horns/antlers — Sprint D / BB4
 *
 * Procedural coat patterns: solid / spotted / brindled / striped / mottled.
 * Generated as small DataTexture, applied to mount body materials.
 *
 * Horns/antlers as separate procedural mesh swappable per `aestheticTags`
 * field on the mount DTU.
 */

import * as THREE from 'three';

export type CoatPattern = 'solid' | 'spotted' | 'brindled' | 'striped' | 'mottled' | 'piebald';

export interface MountCoatAppearance {
  baseColor:    string;   // hex
  patternColor: string;   // hex
  pattern:      CoatPattern;
  /** 0..1 — how dense the pattern is. */
  density?:     number;
  /** Random seed for parametric placement. */
  seed:         string;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace(/^#/, '');
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

/**
 * Generate a procedural coat texture. Uses a small (128×128) DataTexture
 * with seeded RNG. Applied as the body material's albedo map.
 */
export function generateCoatTexture(appearance: MountCoatAppearance, size = 128): THREE.DataTexture {
  const rng = mulberry32(hashSeed(appearance.seed));
  const [br, bg, bb] = hexToRgb(appearance.baseColor);
  const [pr, pg, pb] = hexToRgb(appearance.patternColor);
  const density = appearance.density ?? 0.5;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size, v = y / size;
      const t = patternValue(appearance.pattern, u, v, rng, density);
      const r = br * (1 - t) + pr * t;
      const g = bg * (1 - t) + pg * t;
      const b = bb * (1 - t) + pb * t;
      data[i + 0] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function patternValue(pattern: CoatPattern, u: number, v: number, rng: () => number, density: number): number {
  switch (pattern) {
    case 'solid':
      return 0;
    case 'spotted': {
      // Worley-ish — distance to nearest random point.
      const cells = 6;
      const cu = Math.floor(u * cells), cv = Math.floor(v * cells);
      const px = (cu + rng() * 0.5 + 0.25) / cells;
      const py = (cv + rng() * 0.5 + 0.25) / cells;
      const d = Math.hypot(u - px, v - py);
      return d < density * 0.06 ? 1 : 0;
    }
    case 'striped': {
      const stripe = Math.sin(v * 30) > 1 - density ? 1 : 0;
      return stripe;
    }
    case 'brindled': {
      const noise = Math.sin(u * 18) * Math.cos(v * 22) + Math.sin(u * 32 + v * 11) * 0.5;
      return noise > 1 - density * 1.5 ? 1 : 0;
    }
    case 'mottled': {
      // Multi-octave value noise.
      const n = (Math.sin(u * 14 + v * 18) + Math.sin(u * 6 + v * 9 + 1.7) + Math.sin(u * 33 + v * 27 + 4.1)) / 3;
      return Math.max(0, Math.min(1, (n + 0.3) * density));
    }
    case 'piebald': {
      const big = Math.sin(u * 4) + Math.cos(v * 3 + 1.2);
      return big > 1.4 - density ? 1 : 0;
    }
  }
}

export type HornStyle = 'none' | 'goat' | 'bull' | 'antlers' | 'spike' | 'spiral';

export interface HornAppearance {
  style: HornStyle;
  color: string;
  size:  number;        // metres (scale of the horn)
}

/**
 * Build a horn / antler mesh ready to attach to the mount's head. Returns
 * a Group containing one or two horn meshes positioned for symmetric
 * placement.
 */
export function createHorns(appearance: HornAppearance): THREE.Group {
  const g = new THREE.Group();
  g.name = `horns_${appearance.style}`;
  if (appearance.style === 'none') return g;

  const colorHex = parseInt(appearance.color.replace(/^#/, ''), 16);
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.75, metalness: 0,
  });

  const size = appearance.size;
  const sides = appearance.style === 'spike' ? [0] : [-1, 1];
  for (const sx of sides) {
    let mesh: THREE.Mesh;
    switch (appearance.style) {
      case 'goat': {
        // Curved cone — TorusGeometry segment.
        mesh = new THREE.Mesh(new THREE.TorusGeometry(size * 0.25, size * 0.04, 6, 12, Math.PI * 0.6), mat);
        mesh.position.set(sx * size * 0.18, size * 0.1, -size * 0.05);
        mesh.rotation.set(0.5, sx > 0 ? -0.4 : 0.4, sx > 0 ? -0.3 : 0.3);
        break;
      }
      case 'bull': {
        mesh = new THREE.Mesh(new THREE.ConeGeometry(size * 0.045, size * 0.4, 8), mat);
        mesh.position.set(sx * size * 0.2, size * 0.15, 0);
        mesh.rotation.z = sx > 0 ? -0.7 : 0.7;
        break;
      }
      case 'antlers': {
        // Branching antlers — main beam + 3 tines.
        const subg = new THREE.Group();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.025, size * 0.030, size * 0.45, 6), mat);
        beam.position.y = size * 0.22;
        subg.add(beam);
        for (let t = 0; t < 3; t++) {
          const tine = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.012, size * 0.018, size * 0.18, 6), mat);
          tine.position.set(0, size * (0.18 + t * 0.10), size * 0.04);
          tine.rotation.x = -0.6;
          subg.add(tine);
        }
        subg.position.set(sx * size * 0.2, size * 0.05, -size * 0.05);
        subg.rotation.set(0, sx > 0 ? -0.35 : 0.35, sx > 0 ? -0.15 : 0.15);
        g.add(subg);
        continue;
      }
      case 'spike': {
        mesh = new THREE.Mesh(new THREE.ConeGeometry(size * 0.04, size * 0.5, 8), mat);
        mesh.position.set(0, size * 0.2, 0);
        break;
      }
      case 'spiral': {
        // Spiral approximated by stretched torus + extra stack.
        mesh = new THREE.Mesh(new THREE.TorusGeometry(size * 0.18, size * 0.035, 8, 16, Math.PI * 1.2), mat);
        mesh.position.set(sx * size * 0.18, size * 0.12, 0);
        mesh.rotation.set(0.4, sx > 0 ? -0.3 : 0.3, sx > 0 ? -0.4 : 0.4);
        break;
      }
      default:
        continue;
    }
    g.add(mesh);
  }
  return g;
}

export const MOUNT_COAT_CONSTANTS = Object.freeze({
  PATTERNS: ['solid', 'spotted', 'brindled', 'striped', 'mottled', 'piebald'] as CoatPattern[],
  HORN_STYLES: ['none', 'goat', 'bull', 'antlers', 'spike', 'spiral'] as HornStyle[],
});
