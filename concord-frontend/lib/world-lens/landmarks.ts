// concord-frontend/lib/world-lens/landmarks.ts
//
// I3 — procedural per-world landmark meshes. Real CC0 GLB/PBR asset drops
// would mount through the same group this returns; until those binaries are
// dropped in, the procedural landmarks ARE the deliberate stylized identity
// (Phase H: procedural/stylized substitutes count as identity, not placeholder).
//
// Each world gets 2-3 distinctive silhouettes built from primitive geometry,
// coloured from the world's toon palette so they read as canon, not filler.
// The spec table is pure + unit-tested; the THREE assembly is thin.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LandmarkKind = 'spire' | 'arch' | 'ring' | 'monolith' | 'dome';

export interface LandmarkSpec {
  kind: LandmarkKind;
  /** World-space position (terrain origin is 0,0). */
  x: number;
  z: number;
  /** Overall height/scale in metres. */
  scale: number;
  /** Palette index into the world's toonGradient (0 dark … 2 light). */
  paletteIdx: 0 | 1 | 2;
}

// Per-world landmark layouts. Distinctive silhouettes that match each world's
// authored identity (tunya's resonance choir spire + arrival ark arch, etc.).
const WORLD_LANDMARKS: Record<string, LandmarkSpec[]> = {
  tunya: [
    { kind: 'spire',    x: 0,    z: -120, scale: 64, paletteIdx: 2 }, // the Resonance Choir spire
    { kind: 'arch',     x: -90,  z: 40,   scale: 30, paletteIdx: 1 }, // Hold of First Arrival ark-gate
    { kind: 'ring',     x: 110,  z: 60,   scale: 22, paletteIdx: 2 }, // the Bloc ring of the Twelve
  ],
  'concordia-hub': [
    { kind: 'monolith', x: 0,    z: -100, scale: 50, paletteIdx: 2 }, // the First Breath stele
    { kind: 'dome',     x: 80,   z: 50,   scale: 34, paletteIdx: 1 }, // the dome-stabilisation anchor
  ],
  'sovereign-ruins': [
    { kind: 'monolith', x: 0,    z: -110, scale: 58, paletteIdx: 0 }, // the broken Sovereign pillar
    { kind: 'arch',     x: 70,   z: 30,   scale: 26, paletteIdx: 1 },
  ],
  cyber: [
    { kind: 'spire',    x: 0,    z: -130, scale: 80, paletteIdx: 2 }, // the megacorp arcology spire
    { kind: 'ring',     x: -100, z: 70,   scale: 24, paletteIdx: 2 },
  ],
  fantasy: [
    { kind: 'spire',    x: 0,    z: -110, scale: 56, paletteIdx: 1 }, // the mage tower
    { kind: 'arch',     x: 90,   z: 50,   scale: 28, paletteIdx: 2 },
  ],
};

// Generic fallback for any world without an authored layout: a single
// monument so no world is featureless.
const DEFAULT_LANDMARKS: LandmarkSpec[] = [
  { kind: 'monolith', x: 0, z: -100, scale: 44, paletteIdx: 2 },
];

/** Landmark layout for a world (pure). Falls back to a single monument. */
export function landmarkSpecsForWorld(worldId: string | null | undefined): LandmarkSpec[] {
  if (!worldId) return DEFAULT_LANDMARKS;
  return WORLD_LANDMARKS[worldId] ?? DEFAULT_LANDMARKS;
}

function buildOne(THREE: any, spec: LandmarkSpec, color: any): any {
  const grp = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color });
  const s = spec.scale;
  switch (spec.kind) {
    case 'spire': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(s * 0.18, s, 6), mat);
      cone.position.y = s / 2;
      grp.add(cone);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.22, s * 0.3, s * 0.2, 6), mat);
      base.position.y = s * 0.1;
      grp.add(base);
      break;
    }
    case 'arch': {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(s * 0.5, s * 0.08, 8, 24, Math.PI), mat);
      torus.position.y = s * 0.5;
      grp.add(torus);
      for (const sx of [-s * 0.5, s * 0.5]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.08, s * 0.08, s * 0.5, 8), mat);
        leg.position.set(sx, s * 0.25, 0);
        grp.add(leg);
      }
      break;
    }
    case 'ring': {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(s * 0.5, s * 0.06, 8, 28), mat);
      torus.position.y = s * 0.6;
      torus.rotation.x = Math.PI / 2.4;
      grp.add(torus);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.06, s * 0.1, s * 0.6, 8), mat);
      post.position.y = s * 0.3;
      grp.add(post);
      break;
    }
    case 'dome': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(s * 0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      dome.position.y = 0;
      grp.add(dome);
      break;
    }
    case 'monolith':
    default: {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(s * 0.22, s, s * 0.12), mat);
      slab.position.y = s / 2;
      grp.add(slab);
      break;
    }
  }
  grp.position.set(spec.x, 0, spec.z);
  grp.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

/**
 * Build a group of the world's landmark meshes, coloured from the theme's
 * toon palette. Mount once in the scene; returns the group for disposal.
 */
export function createWorldLandmarks(THREE: any, worldId: string | null | undefined, theme: any): any {
  const root = new THREE.Group();
  root.name = 'world-landmarks';
  const palette: string[] = theme?.toonGradient || ['#888888', '#bbbbbb', '#eeeeee'];
  for (const spec of landmarkSpecsForWorld(worldId)) {
    const hex = palette[spec.paletteIdx] || palette[palette.length - 1];
    root.add(buildOne(THREE, spec, new THREE.Color(hex)));
  }
  return root;
}
