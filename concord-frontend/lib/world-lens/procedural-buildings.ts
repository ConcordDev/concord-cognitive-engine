/**
 * Procedural building archetypes for Concordia.
 *
 * Until GLB assets ship, every building was a primitive cube. This module
 * generates 5 archetypes from procedural geometry that are recognizable as
 * tavern / archive / forge / market / tower without textures. Each archetype
 * accepts a deterministic seed so the same building stays stable across
 * sessions, which prevents the world from looking different every reload.
 *
 * All meshes use shared materials per archetype to keep draw-call count low.
 * The renderer should call disposeBuildingArchetype() on world unmount.
 */

import type * as THREE_NS from "three";

export type BuildingArchetype = "tavern" | "archive" | "forge" | "market" | "tower";

interface ArchetypePalette {
  wall:     string;
  roof:     string;
  trim:     string;
  window:   string;
  emissive: string;
  emissiveIntensity: number;
}

const PALETTES: Record<BuildingArchetype, ArchetypePalette> = {
  tavern:  { wall: "#5a3a2a", roof: "#3a1f10", trim: "#c08040", window: "#ffd060", emissive: "#ff8030", emissiveIntensity: 0.15 },
  archive: { wall: "#d5d0c0", roof: "#403030", trim: "#806030", window: "#80c0ff", emissive: "#a0c0ff", emissiveIntensity: 0.05 },
  forge:   { wall: "#3a3a3a", roof: "#1a1a1a", trim: "#a04020", window: "#ff6020", emissive: "#ff4010", emissiveIntensity: 0.5  },
  market:  { wall: "#c0a070", roof: "#206030", trim: "#80a040", window: "#fff0a0", emissive: "#ffd040", emissiveIntensity: 0.1  },
  tower:   { wall: "#606570", roof: "#2a2a30", trim: "#c0c0d0", window: "#80a0ff", emissive: "#a0a0ff", emissiveIntensity: 0.15 },
};

interface SeededRng { (): number; }

function mulberry32(seed: number): SeededRng {
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

export interface BuildingOptions {
  archetype: BuildingArchetype;
  seed:      string;     // stable string id (e.g., building.id)
  scale?:    number;     // 1.0 = default ~10m tall
}

const materialCache = new Map<string, THREE_NS.MeshStandardMaterial>();

function getMaterial(THREE: typeof THREE_NS, key: string, color: string, opts?: { emissive?: string; emissiveIntensity?: number; roughness?: number; metalness?: number }) {
  const cacheKey = `${key}:${color}:${opts?.emissive ?? ""}`;
  let m = materialCache.get(cacheKey);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness:         opts?.roughness ?? 0.85,
      metalness:         opts?.metalness ?? 0.05,
      emissive:          opts?.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts?.emissiveIntensity ?? 0,
    });
    materialCache.set(cacheKey, m);
  }
  return m;
}

/**
 * Build a procedural building Group. Caller adds it to the scene and sets
 * its position / rotation. Disposal is the caller's responsibility.
 */
export function createBuilding(THREE: typeof THREE_NS, opts: BuildingOptions): THREE_NS.Group {
  const group = new THREE.Group();
  const palette = PALETTES[opts.archetype];
  const rng = mulberry32(hashSeed(`${opts.archetype}:${opts.seed}`));
  const scale = opts.scale ?? 1.0;

  const wallMat   = getMaterial(THREE, "wall",   palette.wall);
  const roofMat   = getMaterial(THREE, "roof",   palette.roof);
  const trimMat   = getMaterial(THREE, "trim",   palette.trim);
  const windowMat = getMaterial(THREE, "window", palette.window, {
    emissive: palette.emissive,
    emissiveIntensity: palette.emissiveIntensity,
    roughness: 0.4,
  });

  switch (opts.archetype) {
    case "tavern":  buildTavern(THREE, group, rng, scale, { wallMat, roofMat, trimMat, windowMat }); break;
    case "archive": buildArchive(THREE, group, rng, scale, { wallMat, roofMat, trimMat, windowMat }); break;
    case "forge":   buildForge(THREE, group, rng, scale, { wallMat, roofMat, trimMat, windowMat }); break;
    case "market":  buildMarket(THREE, group, rng, scale, { wallMat, roofMat, trimMat, windowMat }); break;
    case "tower":   buildTower(THREE, group, rng, scale, { wallMat, roofMat, trimMat, windowMat }); break;
  }

  group.userData = {
    isBuilding: true,
    archetype:  opts.archetype,
    seed:       opts.seed,
  };

  return group;
}

interface MaterialBundle {
  wallMat: THREE_NS.MeshStandardMaterial;
  roofMat: THREE_NS.MeshStandardMaterial;
  trimMat: THREE_NS.MeshStandardMaterial;
  windowMat: THREE_NS.MeshStandardMaterial;
}

function buildTavern(THREE: typeof THREE_NS, g: THREE_NS.Group, rng: SeededRng, s: number, m: MaterialBundle) {
  const w = (8 + rng() * 2) * s;
  const d = (10 + rng() * 2) * s;
  const h = (5 + rng()) * s;

  // Walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m.wallMat);
  walls.position.y = h / 2;
  walls.castShadow = true; walls.receiveShadow = true;
  g.add(walls);

  // Pitched roof — two angled slabs
  const roofGeom = new THREE.ConeGeometry(Math.max(w, d) * 0.75, h * 0.6, 4);
  const roof = new THREE.Mesh(roofGeom, m.roofMat);
  roof.position.y = h + h * 0.3;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 2.5 * s, 0.2 * s), m.trimMat);
  door.position.set(0, 1.25 * s, d / 2 + 0.05);
  g.add(door);

  // Windows (lit at night via emissive)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.2 * s, 1.2 * s, 0.1 * s), m.windowMat);
      win.position.set((side * w) / 3, 2 * s, d / 2 + 0.06);
      win.position.x += (i - 0.5) * 1.5 * s;
      g.add(win);
    }
  }

  // Hanging tavern sign
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2 * s, 0.6 * s, 0.1 * s), m.trimMat);
  sign.position.set(0, 3.5 * s, d / 2 + 0.5 * s);
  g.add(sign);
}

function buildArchive(THREE: typeof THREE_NS, g: THREE_NS.Group, rng: SeededRng, s: number, m: MaterialBundle) {
  // Stately columned facade
  const w = (12 + rng() * 2) * s;
  const d = (8 + rng()) * s;
  const h = (8 + rng()) * s;

  const base = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m.wallMat);
  base.position.y = h / 2;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);

  // Pediment
  const ped = new THREE.Mesh(new THREE.ConeGeometry(w * 0.55, h * 0.3, 3), m.roofMat);
  ped.position.y = h + h * 0.15;
  ped.rotation.y = Math.PI / 6;
  ped.scale.z = 0.6;
  g.add(ped);

  // Columns across the front
  const cols = 6;
  for (let i = 0; i < cols; i++) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4 * s, 0.4 * s, h * 0.95, 12),
      m.trimMat
    );
    const x = -w / 2 + (i + 0.5) * (w / cols);
    col.position.set(x, h * 0.475, d / 2 + 0.5);
    col.castShadow = true;
    g.add(col);
  }

  // Tall narrow windows
  for (let i = 0; i < 4; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.8 * s, 3 * s, 0.1 * s), m.windowMat);
    win.position.set(-w / 3 + i * (w / 4), h / 2, -d / 2 - 0.05);
    g.add(win);
  }
}

function buildForge(THREE: typeof THREE_NS, g: THREE_NS.Group, rng: SeededRng, s: number, m: MaterialBundle) {
  const w = (7 + rng()) * s;
  const d = (9 + rng() * 2) * s;
  const h = (4 + rng() * 0.5) * s;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m.wallMat);
  walls.position.y = h / 2;
  walls.castShadow = true; walls.receiveShadow = true;
  g.add(walls);

  // Flat slag-stone roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3 * s, d + 0.4), m.roofMat);
  roof.position.y = h + 0.15;
  g.add(roof);

  // Tall smokestack — defining feature
  const stackH = h * 1.8;
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6 * s, 0.7 * s, stackH, 10),
    m.wallMat
  );
  stack.position.set(w / 3, h + stackH / 2, -d / 4);
  stack.castShadow = true;
  g.add(stack);

  // Glowing forge mouth (open archway)
  const fire = new THREE.Mesh(new THREE.BoxGeometry(2.5 * s, 2.5 * s, 0.3 * s), m.windowMat);
  fire.position.set(0, 1.25 * s, d / 2 + 0.05);
  g.add(fire);

  // Anvil out front
  const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.6 * s, 0.6 * s, 1.2 * s), m.trimMat);
  anvil.position.set(0, 0.3 * s, d / 2 + 1 * s);
  g.add(anvil);
}

function buildMarket(THREE: typeof THREE_NS, g: THREE_NS.Group, rng: SeededRng, s: number, m: MaterialBundle) {
  // Open canopy on posts, no walls
  const w = (10 + rng()) * s;
  const d = (10 + rng()) * s;
  const postH = 3.5 * s;

  // Four corner posts
  const positions = [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
  ];
  for (const [x, z] of positions) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25 * s, 0.25 * s, postH, 8),
      m.trimMat
    );
    post.position.set(x, postH / 2, z);
    post.castShadow = true;
    g.add(post);
  }

  // Striped awning (canopy)
  const awn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.2 * s, d + 0.5), m.roofMat);
  awn.position.y = postH;
  g.add(awn);

  // Stalls inside
  const stalls = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < stalls; i++) {
    const stall = new THREE.Mesh(new THREE.BoxGeometry(2 * s, 1 * s, 1.5 * s), m.wallMat);
    const angle = (i / stalls) * Math.PI * 2;
    stall.position.set(Math.cos(angle) * 2 * s, 0.5 * s, Math.sin(angle) * 2 * s);
    stall.rotation.y = -angle;
    g.add(stall);

    // Lantern over each stall
    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.25 * s, 8, 6),
      m.windowMat
    );
    lantern.position.set(stall.position.x, 2.8 * s, stall.position.z);
    g.add(lantern);
  }
}

function buildTower(THREE: typeof THREE_NS, g: THREE_NS.Group, rng: SeededRng, s: number, m: MaterialBundle) {
  // Tall narrow tower, spire on top
  const r = (2.5 + rng() * 0.5) * s;
  const h = (16 + rng() * 4) * s;

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.15, h, 8),
    m.wallMat
  );
  shaft.position.y = h / 2;
  shaft.castShadow = true; shaft.receiveShadow = true;
  g.add(shaft);

  // Crenellated parapet ring
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.8 * s, 8),
    m.trimMat
  );
  ring.position.y = h;
  g.add(ring);

  // Spire
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(r * 0.95, h * 0.35, 8),
    m.roofMat
  );
  spire.position.y = h + h * 0.175;
  spire.castShadow = true;
  g.add(spire);

  // Vertical slit windows up the shaft
  const slits = Math.floor(h / (2 * s));
  for (let i = 0; i < slits; i++) {
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 * s, 1.2 * s, 0.1 * s),
      m.windowMat
    );
    const angle = (i % 4) * (Math.PI / 2);
    slit.position.set(
      Math.cos(angle) * (r + 0.05),
      (i + 0.5) * 2 * s,
      Math.sin(angle) * (r + 0.05),
    );
    slit.lookAt(0, slit.position.y, 0);
    g.add(slit);
  }

  // Pennant on top
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.05 * s, 1.2 * s, 0.6 * s), m.windowMat);
  flag.position.y = h + h * 0.4;
  flag.position.x = 0.3 * s;
  g.add(flag);
}

/** Free archetype materials (call on world unmount). */
export function disposeBuildingArchetype(): void {
  for (const m of materialCache.values()) {
    try { m.dispose(); } catch { /* best-effort */ }
  }
  materialCache.clear();
}
