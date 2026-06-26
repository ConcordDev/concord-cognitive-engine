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

/**
 * Sprint D / V1+V3+V4 — faction styling override.
 *
 * When provided, primary/secondary/accent override archetype palette
 * walls/roof/trim. architecture_style biases silhouette params (wall
 * height multiplier, roof pitch, window size, parapet/columns chance).
 */
export type ArchitectureStyle = "fortified" | "gracile" | "crystalline" | "organic" | "industrial";

export interface FactionVisualOverride {
  primary_color?:        string;
  secondary_color?:      string;
  accent_color?:         string;
  architecture_style?:   ArchitectureStyle;
}

export interface BuildingOptions {
  archetype:     BuildingArchetype;
  seed:          string;     // stable string id (e.g., building.id)
  scale?:        number;     // 1.0 = default ~10m tall
  factionStyle?: FactionVisualOverride;
  /**
   * Visual-polish wave 10 — opt-in interior decoration. When `true`,
   * the returned group has a child Group (initially set visible=false)
   * holding archetype-appropriate interior props (fireplace + table in
   * taverns, scrolls in archives, etc). Toggle visibility when zoom
   * level transitions to 'interior'.
   *
   * Pass `'lazy'` to attach the decor as a userData reference that's
   * built on first show via attachInteriorDecor() rather than at
   * createBuilding() time — useful for cold-spawning thousands of
   * buildings without paying the decor cost upfront.
   */
  withInterior?: boolean | 'lazy';
  /**
   * V5 — iconic silhouette feature appended on top of the base archetype, so a
   * building reads as a specific landmark at a glance (the silhouette-readability
   * principle). Mapped from building_type in lib/world-lens/building-silhouette.ts.
   */
  feature?: IconicFeature;
}

/** Landmark silhouette caps — the shape that makes a building instantly legible. */
export type IconicFeature = 'dome' | 'spire' | 'colonnade' | 'belfry';

/**
 * Sprint D / V4 — silhouette bias by architecture style. Returned values
 * are multipliers / chances applied during building construction.
 */
export const SILHOUETTE_BIAS: Record<ArchitectureStyle, {
  wallHeightMult:   number;
  roofPitchMult:    number;
  windowSizeMult:   number;
  parapetChance:    number;
  columnChance:     number;
  ornamentDensity:  number;
}> = {
  fortified:   { wallHeightMult: 1.20, roofPitchMult: 1.15, windowSizeMult: 0.55, parapetChance: 0.85, columnChance: 0.20, ornamentDensity: 0.6 },
  gracile:     { wallHeightMult: 1.05, roofPitchMult: 0.85, windowSizeMult: 1.30, parapetChance: 0.10, columnChance: 0.65, ornamentDensity: 0.4 },
  crystalline: { wallHeightMult: 1.30, roofPitchMult: 0.65, windowSizeMult: 1.45, parapetChance: 0.20, columnChance: 0.05, ornamentDensity: 0.3 },
  organic:     { wallHeightMult: 0.90, roofPitchMult: 0.95, windowSizeMult: 1.10, parapetChance: 0.05, columnChance: 0.10, ornamentDensity: 0.7 },
  industrial:  { wallHeightMult: 1.10, roofPitchMult: 0.40, windowSizeMult: 0.80, parapetChance: 0.40, columnChance: 0.05, ornamentDensity: 0.2 },
};

const materialCache = new Map<string, THREE_NS.MeshStandardMaterial>();

/**
 * Per-slot PBR texture overlay — 3-tier resolution wired through the
 * procedural-hand-authored content engine:
 *
 *   tier 1  art-lens DTU (canonical, royalty-tracked, marketplace canon)
 *           via /api/evo-asset/resolve?source=authored&sourceId=material:<kind>:<seed>
 *   tier 2  CC0 fetched pack at public/textures/<kind>/ (one-shot bootstrap)
 *   tier 3  procedural canvas fallback (always available, deterministic)
 *
 * Synchronous path: we bind procedural textures immediately so the
 * mesh has *some* PBR maps from frame 1. Asynchronous tier-1 / tier-2
 * lookups via pbr-loader run in the background and swap in over the
 * existing channels as they resolve — the substrate gets richer over
 * time as the lens engine produces authored DTUs without any code
 * change here. See lib/world-lens/pbr-loader.ts for the resolution
 * order + caching.
 */
function getMaterial(
  THREE: typeof THREE_NS,
  key: string,
  color: string,
  opts?: {
    emissive?: string;
    emissiveIntensity?: number;
    roughness?: number;
    metalness?: number;
    pbrKind?: 'stone' | 'wood' | 'brick' | 'cloth' | 'metal' | 'leather' | 'thatch' | 'dirt';
    pbrSeed?: number;
  },
) {
  const cacheKey = `${key}:${color}:${opts?.emissive ?? ""}:${opts?.pbrKind ?? ""}:${opts?.pbrSeed ?? ""}`;
  let m = materialCache.get(cacheKey);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness:         opts?.roughness ?? 0.85,
      metalness:         opts?.metalness ?? 0.05,
      emissive:          opts?.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts?.emissiveIntensity ?? 0,
    });
    if (opts?.pbrKind) {
      // ── Tier 3 (synchronous): bind procedural so we have maps now ──
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { makePBR } = require('./procedural-texture') as typeof import('./procedural-texture');
        const set = makePBR(THREE, { kind: opts.pbrKind, seed: opts.pbrSeed ?? 1 });
        m.map = set.albedo;
        m.normalMap = set.normal;
        m.roughnessMap = set.roughness;
        m.aoMap = set.ao;
      } catch { /* procedural texture optional */ }

      // ── Tier 1/2 (async): swap in lens-DTU / CC0 channels as they
      // resolve. We don't await — the material is usable immediately,
      // and the better-quality channels arrive in a later frame. The
      // pbr-loader caches per (kind, seed) so spawning N buildings of
      // the same archetype incurs one resolve, not N.
      const upgradeMat = m;
      const matchedKind = opts.pbrKind;
      const matchedSeed = opts.pbrSeed ?? 1;
      Promise.resolve()
        .then(async () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { loadPBR } = require('./pbr-loader') as typeof import('./pbr-loader');
          const set = await loadPBR(THREE, matchedKind, { seed: matchedSeed });
          // Only swap channels whose identity changed — procedural
          // tier-3 textures are reused as a fallback floor.
          if (upgradeMat.map        !== set.albedo)    upgradeMat.map        = set.albedo;
          if (upgradeMat.normalMap  !== set.normal)    upgradeMat.normalMap  = set.normal;
          if (upgradeMat.roughnessMap !== set.roughness) upgradeMat.roughnessMap = set.roughness;
          if (upgradeMat.aoMap      !== set.ao)        upgradeMat.aoMap      = set.ao;
          upgradeMat.needsUpdate = true;
        })
        .catch(() => { /* keep procedural — substrate floor never fails */ });
    }
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
  const archetypePalette = PALETTES[opts.archetype];

  // Sprint D / V3 — faction palette override: faction primary→wall,
  // secondary→roof, accent→trim, while window emissive stays per-archetype.
  const palette: ArchetypePalette = {
    wall:              opts.factionStyle?.primary_color   ?? archetypePalette.wall,
    roof:              opts.factionStyle?.secondary_color ?? archetypePalette.roof,
    trim:              opts.factionStyle?.accent_color    ?? archetypePalette.trim,
    window:            archetypePalette.window,
    emissive:          archetypePalette.emissive,
    emissiveIntensity: archetypePalette.emissiveIntensity,
  };

  const rng = mulberry32(hashSeed(`${opts.archetype}:${opts.seed}`));
  const baseScale = opts.scale ?? 1.0;
  // Sprint D / V4 — silhouette bias from architecture style.
  const bias = opts.factionStyle?.architecture_style
    ? SILHOUETTE_BIAS[opts.factionStyle.architecture_style]
    : null;
  const scale = baseScale * (bias?.wallHeightMult ?? 1.0);

  // Map each archetype to a PBR material kind for the wall + roof slots.
  // Trim is left flat because procedural-texture brick / metal would
  // visually clash with the per-faction accent palette.
  const PBR_BY_ARCHETYPE: Record<BuildingArchetype, { wall: 'stone' | 'wood' | 'brick' | 'cloth' | 'metal' | 'leather' | 'thatch' | 'dirt'; roof: 'stone' | 'wood' | 'brick' | 'cloth' | 'metal' | 'leather' | 'thatch' | 'dirt' }> = {
    tavern:  { wall: 'wood',  roof: 'thatch' },
    archive: { wall: 'stone', roof: 'stone'  },
    forge:   { wall: 'stone', roof: 'metal'  },
    market:  { wall: 'brick', roof: 'wood'   },
    tower:   { wall: 'stone', roof: 'stone'  },
  };
  const pbr = PBR_BY_ARCHETYPE[opts.archetype];
  const pbrSeed = hashSeed(`pbr:${opts.seed}`);
  const wallMat   = getMaterial(THREE, "wall",   palette.wall,   { pbrKind: pbr.wall, pbrSeed });
  const roofMat   = getMaterial(THREE, "roof",   palette.roof,   { pbrKind: pbr.roof, pbrSeed });
  const trimMat   = getMaterial(THREE, "trim",   palette.trim);
  const windowMat = getMaterial(THREE, "window", palette.window, {
    emissive: palette.emissive,
    emissiveIntensity: palette.emissiveIntensity,
    roughness: 0.4,
  });

  const bundle = { wallMat, roofMat, trimMat, windowMat };
  switch (opts.archetype) {
    case "tavern":  buildTavern(THREE, group, rng, scale, bundle); break;
    case "archive": buildArchive(THREE, group, rng, scale, bundle); break;
    case "forge":   buildForge(THREE, group, rng, scale, bundle); break;
    case "market":  buildMarket(THREE, group, rng, scale, bundle); break;
    case "tower":   buildTower(THREE, group, rng, scale, bundle); break;
  }

  // V4 — parapet on fortified, columns on gracile. Cheap silhouette adds
  // applied as a post-pass on top of the base archetype.
  if (bias) {
    if (rng() < bias.parapetChance) addParapet(THREE, group, scale, trimMat);
    if (rng() < bias.columnChance) addColumns(THREE, group, scale, trimMat);
  }

  // V5 — iconic landmark cap (dome / spire / colonnade / belfry) so a building
  // reads as a specific place at a glance.
  if (opts.feature) addIconicFeature(THREE, group, opts.feature, scale, roofMat, trimMat);

  group.userData = {
    isBuilding:   true,
    archetype:    opts.archetype,
    seed:         opts.seed,
    factionStyle: opts.factionStyle ?? null,
    _interiorMode: opts.withInterior ?? false,
  };

  if (opts.withInterior === true) {
    attachInteriorDecor(THREE, group, opts.archetype);
  }

  return group;
}

/**
 * Visual-polish wave 10 — build + attach the interior decor child Group.
 * Idempotent: returns early if already attached. Safe to call lazily
 * the first time the building's zoom level transitions to 'interior'.
 */
export function attachInteriorDecor(
  THREE: typeof THREE_NS,
  buildingGroup: THREE_NS.Group,
  archetype: BuildingArchetype,
): THREE_NS.Group | null {
  if ((buildingGroup.userData as { _interiorGroup?: THREE_NS.Group })._interiorGroup) {
    return (buildingGroup.userData as { _interiorGroup?: THREE_NS.Group })._interiorGroup ?? null;
  }
  try {
    // Lazy import so the SSR bundle and cold-start path don't pull in
    // the full decor module unless an interior is actually being
    // populated.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { decorateInterior } = require('./interior-decor') as typeof import('./interior-decor');
    const decor = decorateInterior(THREE, { archetype });
    decor.group.visible = false; // Caller toggles when zoom transitions to interior.
    buildingGroup.add(decor.group);
    (buildingGroup.userData as { _interiorGroup?: THREE_NS.Group; _interiorDispose?: () => void })._interiorGroup = decor.group;
    (buildingGroup.userData as { _interiorGroup?: THREE_NS.Group; _interiorDispose?: () => void })._interiorDispose = decor.dispose;

    // Wave 12: try to layer a whiteboard-lens blueprint DTU on top.
    // The query runs async and modifies decor.group in-place when a
    // blueprint is found — fallback procedural decor stays as the
    // floor. This is the "marketplace canon wins" wire-up.
    (async () => {
      try {
        await applyBlueprintOverlayIfAny(THREE, decor.group, archetype);
      } catch {
        /* blueprint overlay is optional; procedural stays */
      }
    })();

    return decor.group;
  } catch {
    return null;
  }
}

interface BlueprintDecorElement {
  kind: string;
  x: number; y: number; w: number; h: number;
  rotation?: number;
  color?: string | null;
  label?: string | null;
}

/**
 * If the evo-asset registry has a blueprint DTU for this archetype,
 * fetch it + spawn a thin overlay group of player-authored marks on
 * top of the procedural floor. The floor decor stays intact so any
 * gaps in the blueprint don't leave the room empty.
 */
async function applyBlueprintOverlayIfAny(
  THREE: typeof THREE_NS,
  parentGroup: THREE_NS.Group,
  archetype: BuildingArchetype,
): Promise<void> {
  if (typeof fetch === 'undefined') return;
  // Find any authored blueprint for this archetype — the evo-asset
  // registry's resolve endpoint is keyed on (source, sourceId) but
  // there's no per-archetype lookup yet. Fall back to a tag query.
  // We rely on category='interior:<archetype>' indexed in the registry.
  let resp: Response;
  try {
    resp = await fetch(`/api/evo-asset/by-category?category=interior:${archetype}&kind=blueprint`, {
      credentials: 'include',
    });
  } catch {
    return;
  }
  if (!resp.ok) return;
  let listed: { ok?: boolean; assets?: Array<{ id: string; sourceId: string; localPath?: string; evolutionScore: number }> };
  try { listed = await resp.json(); } catch { return; }
  if (!listed?.ok || !Array.isArray(listed.assets) || listed.assets.length === 0) return;
  // Newest / highest-score asset wins
  const winning = listed.assets[0];
  let blueprintResp: Response;
  try {
    blueprintResp = await fetch(`/api/evo-asset/file/${winning.id}`, { credentials: 'include' });
  } catch { return; }
  if (!blueprintResp.ok) return;
  let blueprint: { decor: BlueprintDecorElement[]; themeOverrides?: Record<string, unknown> | null };
  try { blueprint = await blueprintResp.json(); } catch { return; }
  if (!Array.isArray(blueprint?.decor)) return;

  // Build a child group of authored marks. Position each element in
  // the building's interior box; scale x/y from whiteboard space
  // (assumed 1000×600) to interior box (12m × 12m default).
  const overlay = new THREE.Group();
  overlay.name = 'blueprint-overlay';
  const SCALE_X = 12 / 1000;
  const SCALE_Z = 12 / 600;
  const OFFSET_X = -6;
  const OFFSET_Z = -6;
  for (const el of blueprint.decor) {
    const px = (el.x ?? 0) * SCALE_X + OFFSET_X;
    const pz = (el.y ?? 0) * SCALE_Z + OFFSET_Z;
    const pw = Math.max(0.1, (el.w ?? 60) * SCALE_X);
    const ph = Math.max(0.1, (el.h ?? 60) * SCALE_Z);
    const colorHex = typeof el.color === 'string' && /^#[0-9a-f]{6}$/i.test(el.color)
      ? el.color : '#a78bfa';
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      roughness: 0.7,
      metalness: 0.1,
    });
    const geom = new THREE.BoxGeometry(pw, 0.3, ph);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(px + pw / 2, 0.15, pz + ph / 2);
    if (typeof el.rotation === 'number') {
      mesh.rotation.y = el.rotation * Math.PI / 180;
    }
    overlay.add(mesh);
  }
  parentGroup.add(overlay);
}

/**
 * Toggle a building's interior visibility. Call this from the zoom
 * handler when the player crosses the entrance threshold.
 */
export function setInteriorVisible(
  THREE: typeof THREE_NS,
  buildingGroup: THREE_NS.Group,
  visible: boolean,
): void {
  const ud = buildingGroup.userData as {
    archetype?: BuildingArchetype;
    _interiorGroup?: THREE_NS.Group;
    _interiorMode?: boolean | 'lazy';
  };
  if (!ud._interiorGroup && ud._interiorMode === 'lazy' && ud.archetype) {
    attachInteriorDecor(THREE, buildingGroup, ud.archetype);
  }
  if (ud._interiorGroup) ud._interiorGroup.visible = visible;
}

/**
 * V4 silhouette adds — applied to any building when its faction style biases
 * toward parapets / columns.
 */
function addParapet(THREE: typeof THREE_NS, g: THREE_NS.Group, scale: number, trimMat: THREE_NS.MeshStandardMaterial) {
  const w = 8 * scale, d = 10 * scale, h = 0.6 * scale;
  // Five crenellation blocks along front edge.
  for (let i = 0; i < 5; i++) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, h, 0.4 * scale), trimMat);
    block.position.set((i / 4 - 0.5) * w * 0.85, 5 * scale + h / 2, d / 2 + 0.2);
    block.castShadow = true;
    g.add(block);
  }
}

function addColumns(THREE: typeof THREE_NS, g: THREE_NS.Group, scale: number, trimMat: THREE_NS.MeshStandardMaterial) {
  const colHeight = 4.5 * scale;
  for (const xSign of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * scale, 0.30 * scale, colHeight, 12), trimMat);
    col.position.set(xSign * 4 * scale, colHeight / 2, 5.2 * scale);
    col.castShadow = true; col.receiveShadow = true;
    g.add(col);
  }
}

/**
 * V5 — append an iconic landmark feature on top of / in front of the base
 * archetype. Pure geometry, deterministic, low-poly (silhouette-readability:
 * the cap is what makes the building legible from afar). `roofTop` ≈ the base
 * wall height in archetype units (~8·scale), so caps sit at the roofline.
 */
export function addIconicFeature(
  THREE: typeof THREE_NS,
  g: THREE_NS.Group,
  feature: IconicFeature,
  scale: number,
  roofMat: THREE_NS.MeshStandardMaterial,
  trimMat: THREE_NS.MeshStandardMaterial,
) {
  const s = scale;
  const roofTop = 8 * s; // base archetypes top out ~8·scale
  switch (feature) {
    case 'dome': {
      // Hemisphere drum + cap, the observatory / sanctuary read.
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(3.4 * s, 3.6 * s, 1.2 * s, 20), trimMat);
      drum.position.y = roofTop + 0.6 * s;
      drum.castShadow = true;
      g.add(drum);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(3.4 * s, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        roofMat,
      );
      dome.position.y = roofTop + 1.2 * s;
      dome.castShadow = true;
      g.add(dome);
      const finial = new THREE.Mesh(new THREE.ConeGeometry(0.4 * s, 1.4 * s, 8), trimMat);
      finial.position.y = roofTop + 1.2 * s + 3.4 * s;
      g.add(finial);
      break;
    }
    case 'spire': {
      // Turret + tall thin spire, the cartographer / watch read.
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(2.2 * s, 2.4 * s, 3 * s, 8), roofMat);
      turret.position.y = roofTop + 1.5 * s;
      turret.castShadow = true;
      g.add(turret);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(2.2 * s, 7 * s, 8), roofMat);
      spire.position.y = roofTop + 3 * s + 3.5 * s;
      spire.castShadow = true;
      g.add(spire);
      break;
    }
    case 'colonnade': {
      // A grand portico across the front — civic / court / academy read.
      const cols = 6;
      const w = 12 * s;
      const colH = 6 * s;
      for (let i = 0; i < cols; i++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * s, 0.5 * s, colH, 12), trimMat);
        col.position.set(-w / 2 + (i + 0.5) * (w / cols), colH / 2, 6 * s);
        col.castShadow = true; col.receiveShadow = true;
        g.add(col);
      }
      // Architrave + pediment over the columns.
      const architrave = new THREE.Mesh(new THREE.BoxGeometry(w + 1 * s, 1 * s, 2 * s), trimMat);
      architrave.position.set(0, colH + 0.5 * s, 6 * s);
      architrave.castShadow = true;
      g.add(architrave);
      const pediment = new THREE.Mesh(new THREE.ConeGeometry(w * 0.55, 2 * s, 3), roofMat);
      pediment.position.set(0, colH + 1.5 * s, 6 * s);
      pediment.rotation.y = Math.PI / 6;
      pediment.scale.z = 0.5;
      g.add(pediment);
      break;
    }
    case 'belfry': {
      // An open bell-tower on the roof — schoolhouse / watch-house read.
      const baseBox = new THREE.Mesh(new THREE.BoxGeometry(3 * s, 3 * s, 3 * s), roofMat);
      baseBox.position.y = roofTop + 1.5 * s;
      baseBox.castShadow = true;
      g.add(baseBox);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.4 * s, 2.4 * s, 4), roofMat);
      cap.position.y = roofTop + 3 * s + 1.2 * s;
      cap.rotation.y = Math.PI / 4;
      g.add(cap);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.7 * s, 10, 8), trimMat);
      bell.position.y = roofTop + 1.6 * s;
      g.add(bell);
      break;
    }
  }
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
