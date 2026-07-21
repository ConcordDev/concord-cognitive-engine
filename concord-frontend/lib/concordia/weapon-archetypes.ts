/**
 * Weapon archetypes — Sprint D / Y1
 *
 * 12 parametric weapon archetypes built as THREE.Group of primitives
 * (same pattern as procedural-buildings.ts — proven at production
 * scale). Each archetype supports parametric variation: blade length /
 * width / curvature, hilt style, guard, pommel, tier 1-5 ornamentation,
 * faction sigil engraving via material accent colour.
 *
 * TextureForge metal recipe is wired for blade albedo/normal/roughness;
 * caller passes a faction.visual.accent_color to tint metallic accents.
 *
 * Stability audit (2026-07-21) — added 4 real-asset-first archetypes
 * (`firearm_pistol`, `firearm_rifle`, `staff`, `wand`; CC0-sourced GLBs at
 * `/public/models/weapon/{id}.glb` — see `public/models/CREDITS.md`),
 * same real-asset-first / graceful-procedural-fallback pattern
 * `creature-renderer.ts` uses. `createWeapon()` stays fully synchronous
 * (its 2 existing call sites in `enhanced-avatar-builder.ts` build the
 * avatar mesh inline, not inside a React effect) — real assets are warmed
 * into a module-level cache by a lazily-triggered, memoized, fire-and-
 * forget `warmRealWeaponAssets()`, and `createWeapon()` clones from that
 * cache when it's already resolved by the time it's called, falling back
 * to the procedural builder (which every archetype still has, including
 * the 4 new ones) otherwise. First avatar built after a fresh page load
 * gets the procedural silhouette; subsequent avatars (and re-renders) get
 * the real mesh once warming resolves — same eventual-consistency
 * tradeoff already accepted for creatures/buildings/trees.
 */

import * as THREE from 'three';
import { loadAsset, resolveAssetReference, getCachedSceneSync } from '@/lib/world-lens/asset-loader';

export type WeaponArchetype =
  | 'shortsword' | 'longsword' | 'axe' | 'mace' | 'dagger' | 'club'
  | 'scimitar' | 'greatsword' | 'halberd' | 'spear' | 'bow' | 'crossbow'
  | 'firearm_pistol' | 'firearm_rifle' | 'staff' | 'wand';

/**
 * Archetypes with a real CC0-sourced GLB at /public/models/weapon/{id}.glb.
 * `shortsword` and `longsword` intentionally share the same source file
 * (KayKit's `sword_1handed`) at two different `REAL_ASSET_NORMALIZATION`
 * target sizes — the pack has one one-handed sword model, not two, and
 * scaling one asset for a "short" vs. "long" sub-tier is the same
 * technique real game art pipelines use rather than a shortcut; see
 * `public/models/CREDITS.md`. `mace`/`club`/`scimitar`/`spear`/`bow`
 * have no sourced real asset yet and stay on the procedural builder.
 */
const REAL_ASSET_ARCHETYPES: WeaponArchetype[] = [
  'firearm_pistol', 'firearm_rifle', 'staff', 'wand',
  'shortsword', 'longsword', 'greatsword', 'axe', 'halberd', 'crossbow', 'dagger',
];

const realWeaponCache = new Map<WeaponArchetype, string>(); // archetype -> resolved URL, ready to instanceFromCache
let warmed = false;
let warmingPromise: Promise<void> | null = null;

/** Idempotent, memoized, fire-and-forget. Populates realWeaponCache with
 *  resolved URLs for every archetype whose GLB actually loads; archetypes
 *  with no real asset (or a load failure) are silently left for the
 *  procedural builder — loadAsset() never throws. */
export function warmRealWeaponAssets(): Promise<void> {
  if (warmed) return Promise.resolve();
  if (warmingPromise) return warmingPromise;
  warmingPromise = (async () => {
    for (const id of REAL_ASSET_ARCHETYPES) {
      try {
        const loaded = await loadAsset({ kind: 'weapon', id }, THREE);
        if (loaded) {
          const url = await resolveAssetReference({ kind: 'weapon', id });
          if (url) realWeaponCache.set(id, url);
        }
      } catch { /* this archetype's real asset unavailable — procedural fallback covers it */ }
    }
    warmed = true;
  })();
  return warmingPromise;
}

/** Best-effort synchronous clone of an already-warmed real asset. Returns
 *  null (never throws) if warming hasn't resolved yet or this archetype
 *  has no real asset — caller falls back to the procedural builder. Also
 *  kicks off warming for next time if it hasn't started yet (idempotent).
 *  `getCachedSceneSync` is a synchronous accessor into asset-loader's
 *  scene cache — by the time a URL is in realWeaponCache, `loadGLTF`
 *  already ran (inside warmRealWeaponAssets's `loadAsset()` call), so the
 *  parsed scene is guaranteed already resident; no network/parse work
 *  happens here, only a Map lookup + a synchronous `Object3D.clone()`. */
function tryRealWeaponMesh(archetype: WeaponArchetype): THREE.Group | null {
  void warmRealWeaponAssets(); // idempotent — starts warming on first call, no-op after
  const url = realWeaponCache.get(archetype);
  if (!url) return null;
  const scene = getCachedSceneSync(url);
  if (!scene) return null;
  const inst = (scene as { clone: (recursive: boolean) => THREE.Object3D }).clone(true);
  const group = new THREE.Group();
  group.name = `weapon_${archetype}`;
  group.add(inst as THREE.Object3D);
  return group;
}

export interface WeaponAppearance {
  archetype:    WeaponArchetype;
  tier:         number;            // 1..5
  /** Faction accent color for sigil/tint. Hex. */
  accentColor?: string;
  /** Base blade/shaft material color. Hex. */
  baseColor?:   string;
  /** Hilt/grip color. Hex. */
  gripColor?:   string;
  /** Optional enchantment glow. */
  enchantment?: 'frost' | 'fire' | 'lightning' | 'arcane' | null;
  /** Random seed for parametric jitter. */
  seed?:        string;
}

const DEFAULT_BASE_COLOR = '#a0a8b0';
const DEFAULT_GRIP_COLOR = '#5a3a2a';
const DEFAULT_ACCENT_COLOR = '#c8a050';

const ENCHANTMENT_GLOW: Record<string, number> = {
  frost:     0x80c0ff,
  fire:      0xff8030,
  lightning: 0xfff060,
  arcane:    0xb070ff,
};

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

/** Target longest-dimension (metres) + pivot convention each real-asset
 *  archetype is normalized to. The source GLBs come in whatever native
 *  scale/pivot their creator authored them at, not this codebase's own
 *  convention — `'bottom'` matches the procedural grip-at-one-end tools
 *  (`buildStaff`: shaft pivots at its base, tip extends away from the
 *  hand), `'center'` approximates a fist-gripped tool held near its
 *  center of mass (`buildFirearm`'s body roughly straddles its origin). */
const REAL_ASSET_NORMALIZATION: Partial<Record<WeaponArchetype, { size: number; pivot: 'bottom' | 'center' }>> = {
  firearm_pistol: { size: 0.28, pivot: 'center' },
  firearm_rifle:  { size: 0.75, pivot: 'center' },
  staff:          { size: 1.3,  pivot: 'bottom' },
  wand:           { size: 0.35, pivot: 'bottom' },
  // shortsword/longsword/greatsword/axe/halberd/dagger are Y-dominant in
  // their source file (grip near the origin, blade/head extends toward
  // +Y — confirmed via gltf-transform inspect bounding boxes before
  // wiring, not assumed), matching the grip-at-base convention already
  // established for staff/wand and the procedural buildBladeWeapon/
  // buildAxe functions, hence 'bottom' pivot. crossbow's source geometry
  // is instead Z-dominant (a held-level stock+bow shape, not a swung
  // blade — same reasoning as the firearms below), so it gets 'center'
  // like them rather than 'bottom'. Target sizes mirror each archetype's
  // existing procedural dimensions (see the switch cases below) so
  // swapping real for procedural (or back) doesn't visibly change scale.
  shortsword:     { size: 0.67, pivot: 'bottom' },
  longsword:      { size: 1.05, pivot: 'bottom' },
  greatsword:     { size: 1.5,  pivot: 'bottom' },
  axe:            { size: 0.83, pivot: 'bottom' },
  halberd:        { size: 1.85, pivot: 'bottom' },
  crossbow:       { size: 0.85, pivot: 'center' },
  dagger:         { size: 0.42, pivot: 'bottom' },
};

/** Uniformly rescales `obj` so its longest bounding-box dimension equals
 *  `targetLongestDim`, then re-centers its local origin per `pivot`. Real
 *  assets have no guaranteed native scale or pivot; this makes any
 *  sourced GLB behave like the procedural weapon it stands in for
 *  (holdable at a sensible point, sized consistently). */
export function normalizeRealAssetScale(obj: THREE.Object3D, targetLongestDim: number, pivot: 'bottom' | 'center'): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  obj.scale.setScalar(targetLongestDim / longest);
  const scaledBox = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  if (pivot === 'center') {
    obj.position.sub(center);
  } else {
    // 'bottom' — keep x/z centered, drop the origin to the lowest y so the
    // object extends from y=0 upward, matching buildStaff's shaft/tip layout.
    obj.position.x -= center.x;
    obj.position.z -= center.z;
    obj.position.y -= scaledBox.min.y;
  }
}

/**
 * Archetypes that can "discharge" (fire a shot / release a cast) — the
 * ones a muzzle-flash / spell-spark VFX should anchor to. Every other
 * archetype (blades, axes, bows, etc.) swings instead — they still get a
 * `tipLocal` (see below, used by the weapon-swing trail), just no
 * `dischargeLocal`. Exported so AvatarSystem3D.tsx's discharge-flash
 * trigger reads this list instead of hardcoding a second copy.
 */
export const DISCHARGE_ARCHETYPES: WeaponArchetype[] = ['firearm_pistol', 'firearm_rifle', 'staff', 'wand'];

/** Local-space point on `obj`'s bounding box surface along `axis`'s max
 *  extent (the other two axes centered) — used post-normalization, so it
 *  reflects the group's final held-in-hand geometry. This is a best-
 *  effort approximation for the real-asset firearms/crossbow specifically
 *  (their native forward axis was inferred from bounding-box asymmetry —
 *  see `REAL_ASSET_NORMALIZATION`'s comment — not confirmed by a visual
 *  render, since this environment can't do one headlessly); it's exact
 *  for every 'bottom'-pivoted archetype (bottom-pivot normalization
 *  already guarantees the tip sits at local (0, targetSize, 0), computed
 *  directly from `norm.size` rather than a bbox query — see
 *  `realAssetTipLocal` below). */
function computeBboxTipLocal(obj: THREE.Object3D, axis: 'x' | 'y' | 'z'): { x: number; y: number; z: number } {
  const box = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const point = center.clone();
  point[axis] = box.max[axis];
  return { x: point.x, y: point.y, z: point.z };
}

/** The "business end" of a normalized real-asset weapon — 'bottom' pivot
 *  (every blade/haft archetype + staff/wand) has an exact closed-form
 *  answer; 'center' pivot (firearms + crossbow) falls back to a
 *  bounding-box read along the inferred forward axis (+Z — see
 *  `REAL_ASSET_NORMALIZATION`'s comment). */
function realAssetTipLocal(obj: THREE.Object3D, norm: { size: number; pivot: 'bottom' | 'center' }): { x: number; y: number; z: number } {
  return norm.pivot === 'bottom' ? { x: 0, y: norm.size, z: 0 } : computeBboxTipLocal(obj, 'z');
}

/**
 * Reads a named local-space point (`field` — 'tipLocal' or
 * 'dischargeLocal') from a weapon group's userData and transforms it to
 * world space. Returns null when the group has no such point (e.g.
 * `dischargeLocal` on a non-discharging archetype). Caller supplies the
 * group as it currently sits in the live scene graph (already parented
 * under the avatar) so the world-matrix transform reflects any
 * in-progress swing/cast animation, not just the weapon's rest pose.
 */
function getWeaponPointWorldPosition(weaponGroup: THREE.Object3D, field: 'tipLocal' | 'dischargeLocal'): THREE.Vector3 | null {
  const local = weaponGroup.userData?.[field] as { x: number; y: number; z: number } | undefined;
  if (!local) return null;
  const v = new THREE.Vector3(local.x, local.y, local.z);
  weaponGroup.updateWorldMatrix(true, false);
  return weaponGroup.localToWorld(v);
}

/**
 * Reads the discharge point (world-space) a muzzle-flash / spell-spark
 * VFX should spawn at, for a weapon group `createWeapon()` returned.
 * Returns null for archetypes that don't discharge (swords, bows, etc.).
 */
export function getDischargeWorldPosition(weaponGroup: THREE.Object3D): THREE.Vector3 | null {
  return getWeaponPointWorldPosition(weaponGroup, 'dischargeLocal');
}

/**
 * Reads the "tip" point (world-space) — the blade tip / axe head / bow
 * limb / muzzle / staff crystal, whichever applies — for ANY weapon
 * archetype `createWeapon()` returned, discharge-capable or not. This is
 * what the weapon-swing trail (`weapon-trail.ts`, sampled per-frame in
 * `AvatarSystem3D.tsx`) anchors to; unlike `getDischargeWorldPosition`
 * this is set for all 16 archetypes, real-asset and procedural alike.
 */
export function getWeaponTipWorldPosition(weaponGroup: THREE.Object3D): THREE.Vector3 | null {
  return getWeaponPointWorldPosition(weaponGroup, 'tipLocal');
}

/**
 * Build a weapon mesh. Returns a THREE.Group; caller adds to
 * character's right-hand bone.
 */
export function createWeapon(appearance: WeaponAppearance): THREE.Group {
  if (REAL_ASSET_ARCHETYPES.includes(appearance.archetype)) {
    const real = tryRealWeaponMesh(appearance.archetype);
    if (real) {
      const norm = REAL_ASSET_NORMALIZATION[appearance.archetype];
      if (norm) normalizeRealAssetScale(real.children[0], norm.size, norm.pivot);
      const tipLocal = norm ? realAssetTipLocal(real.children[0], norm) : undefined;
      const dischargeLocal = DISCHARGE_ARCHETYPES.includes(appearance.archetype) ? tipLocal : undefined;
      const tier = Math.max(1, Math.min(5, appearance.tier ?? 1));
      real.userData = {
        isWeapon: true,
        archetype: appearance.archetype,
        tier,
        seed: appearance.seed,
        enchantment: appearance.enchantment ?? null,
        realAsset: true,
        tipLocal,
        dischargeLocal,
      };
      return real;
    }
    // Falls through to the procedural builder below when the real asset
    // hasn't warmed yet (or has no source for this archetype) — every
    // real-asset archetype also has a procedural case in the switch.
  }

  const group = new THREE.Group();
  group.name = `weapon_${appearance.archetype}`;
  const tier = Math.max(1, Math.min(5, appearance.tier ?? 1));
  const seed = hashSeed(appearance.seed ?? appearance.archetype);
  const rng = mulberry32(seed);

  const baseColor = appearance.baseColor ?? DEFAULT_BASE_COLOR;
  const gripColor = appearance.gripColor ?? DEFAULT_GRIP_COLOR;
  const accentColor = appearance.accentColor ?? DEFAULT_ACCENT_COLOR;
  const enchantHex = appearance.enchantment ? ENCHANTMENT_GLOW[appearance.enchantment] : 0x000000;

  const bladeMat = new THREE.MeshStandardMaterial({
    color: baseColor, roughness: 0.25, metalness: 0.85,
    emissive: enchantHex, emissiveIntensity: appearance.enchantment ? 0.4 : 0,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor, roughness: 0.35, metalness: 0.7,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: gripColor, roughness: 0.85, metalness: 0.0,
  });

  // Every case below sets tipLocal — the exact local "business end" point
  // for the procedural geometry that builder lays out (blade tip / axe
  // head / bow limb / muzzle / staff crystal), read by
  // getWeaponTipWorldPosition() for the weapon-swing trail. Stability
  // audit (2026-07-21) — this used to be set only for firearm/staff/wand
  // (as `dischargeLocal`, muzzle-flash-only); widened to every archetype
  // so the trail (which anchors to WHATEVER weapon is equipped, not just
  // the 4 discharge-capable ones) has a real point to sample instead of
  // relying on `AvatarSystem3D.tsx`'s bone-map lookup, which silently
  // never resolves for the enhanced-avatar path real players use (see
  // that file's own comment on the trail-sampling block for the full
  // story — a genuine, now-fixed bug, not the fabricated one this file
  // originally, incorrectly, reported here).
  let tipLocal: { x: number; y: number; z: number };

  switch (appearance.archetype) {
    case 'shortsword': {
      const opts = { bladeLen: 0.55 + rng() * 0.1, bladeWidth: 0.06, hiltLen: 0.12, tier };
      buildBladeWeapon(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.bladeLen, z: 0 };
      break;
    }
    case 'longsword': {
      const opts = { bladeLen: 0.85 + rng() * 0.1, bladeWidth: 0.07, hiltLen: 0.18, tier };
      buildBladeWeapon(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.bladeLen, z: 0 };
      break;
    }
    case 'greatsword': {
      const opts = { bladeLen: 1.20 + rng() * 0.15, bladeWidth: 0.10, hiltLen: 0.30, tier };
      buildBladeWeapon(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.bladeLen, z: 0 };
      break;
    }
    case 'dagger': {
      const opts = { bladeLen: 0.30 + rng() * 0.05, bladeWidth: 0.05, hiltLen: 0.10, tier };
      buildBladeWeapon(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.bladeLen, z: 0 };
      break;
    }
    case 'scimitar': {
      const opts = { bladeLen: 0.75 + rng() * 0.08, bladeWidth: 0.07, hiltLen: 0.14, tier, curvature: 0.4 };
      buildBladeWeapon(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.bladeLen, z: 0 };
      break;
    }
    case 'axe': {
      const opts = { headSize: 0.18, shaftLen: 0.65, tier };
      buildAxe(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.shaftLen, z: 0 };
      break;
    }
    case 'mace': {
      const opts = { headSize: 0.10, shaftLen: 0.55, tier };
      buildMace(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.shaftLen + opts.headSize * 0.6, z: 0 };
      break;
    }
    case 'club': {
      const opts = { headSize: 0.09, shaftLen: 0.50, tier };
      buildClub(group, gripMat, opts);
      tipLocal = { x: 0, y: opts.shaftLen, z: 0 };
      break;
    }
    case 'halberd': {
      const opts = { headSize: 0.20, shaftLen: 1.65, tier, hasBlade: true };
      buildAxe(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.hasBlade ? opts.shaftLen + 0.18 + 0.4 : opts.shaftLen, z: 0 };
      break;
    }
    case 'spear': {
      const opts = { tipLen: 0.35, shaftLen: 1.85, tier };
      buildSpear(group, bladeMat, accentMat, gripMat, opts);
      tipLocal = { x: 0, y: opts.shaftLen + opts.tipLen, z: 0 };
      break;
    }
    case 'bow': {
      const opts = { armLen: 0.95, tier };
      buildBow(group, gripMat, accentMat, opts);
      // The bow's limb spans +/- armLen/2 around the grip — "tip" here is
      // one limb end, a reasonable single anchor for a trail/flash.
      tipLocal = { x: 0, y: opts.armLen / 2, z: 0 };
      break;
    }
    case 'crossbow': {
      const opts = { armSpan: 0.85, stockLen: 0.50, tier };
      buildCrossbow(group, gripMat, accentMat, bladeMat, opts);
      tipLocal = { x: opts.stockLen, y: 0, z: 0 };
      break;
    }
    case 'firearm_pistol': {
      const opts = { bodyLen: 0.16, barrelLen: 0.10, gripLen: 0.11, tier };
      buildFirearm(group, bladeMat, gripMat, opts);
      tipLocal = { x: opts.bodyLen + opts.barrelLen, y: 0, z: 0 };
      break;
    }
    case 'firearm_rifle': {
      const opts = { bodyLen: 0.28, barrelLen: 0.32, gripLen: 0.13, hasStock: true, tier };
      buildFirearm(group, bladeMat, gripMat, opts);
      tipLocal = { x: opts.bodyLen + opts.barrelLen, y: 0, z: 0 };
      break;
    }
    // Tip uses bladeMat (not accentMat) so enchantment glow — baked into
    // bladeMat's emissive, same as every bladed archetype above — actually
    // shows on the tip, matching a glowing staff/wand crystal.
    case 'staff': {
      const opts = { shaftLen: 1.1, tipSize: 0.05, tier };
      buildStaff(group, gripMat, bladeMat, opts);
      tipLocal = { x: 0, y: opts.shaftLen, z: 0 };
      break;
    }
    case 'wand': {
      const opts = { shaftLen: 0.30, tipSize: 0.025, tier };
      buildStaff(group, gripMat, bladeMat, opts);
      tipLocal = { x: 0, y: opts.shaftLen, z: 0 };
      break;
    }
  }

  const dischargeLocal = DISCHARGE_ARCHETYPES.includes(appearance.archetype) ? tipLocal : undefined;

  group.userData = {
    isWeapon: true,
    archetype: appearance.archetype,
    tier,
    seed: appearance.seed,
    enchantment: appearance.enchantment ?? null,
    tipLocal,
    dischargeLocal,
  };
  return group;
}

function buildBladeWeapon(
  g: THREE.Group, bladeMat: THREE.Material, accentMat: THREE.Material, gripMat: THREE.Material,
  opts: { bladeLen: number; bladeWidth: number; hiltLen: number; tier: number; curvature?: number },
): void {
  const { bladeLen, bladeWidth, hiltLen, tier, curvature = 0 } = opts;
  // Blade.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(bladeWidth, bladeLen, 0.012), bladeMat);
  blade.position.y = bladeLen / 2;
  if (curvature > 0) blade.rotation.z = curvature * 0.15;
  g.add(blade);
  // Crossguard.
  const guard = new THREE.Mesh(new THREE.BoxGeometry(bladeWidth * 3.5, 0.025, 0.04), accentMat);
  guard.position.y = -0.005;
  g.add(guard);
  // Grip.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.020, hiltLen, 8), gripMat);
  grip.position.y = -hiltLen / 2 - 0.01;
  g.add(grip);
  // Pommel — tier-scaled.
  const pommelSize = 0.025 + tier * 0.005;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(pommelSize, 8, 6), accentMat);
  pommel.position.y = -hiltLen - 0.01;
  g.add(pommel);
  // Tier ≥ 4 — fuller groove (visual ornament).
  if (tier >= 4) {
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(bladeWidth * 0.3, bladeLen * 0.7, 0.005), accentMat);
    fuller.position.y = bladeLen * 0.4;
    fuller.position.z = 0.008;
    g.add(fuller);
  }
}

function buildAxe(
  g: THREE.Group, bladeMat: THREE.Material, accentMat: THREE.Material, gripMat: THREE.Material,
  opts: { headSize: number; shaftLen: number; tier: number; hasBlade?: boolean },
): void {
  const { headSize, shaftLen, tier, hasBlade } = opts;
  // Shaft.
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, shaftLen, 8), gripMat);
  shaft.position.y = shaftLen / 2;
  g.add(shaft);
  // Axe head.
  const headGeom = new THREE.BoxGeometry(headSize * 1.5, headSize, 0.03);
  const head = new THREE.Mesh(headGeom, bladeMat);
  head.position.set(headSize / 2, shaftLen - 0.05, 0);
  g.add(head);
  // Tier ornament.
  if (tier >= 3) {
    const accent = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.030, 8), accentMat);
    accent.rotation.x = Math.PI / 2;
    accent.position.y = shaftLen - 0.10;
    g.add(accent);
  }
  // Halberd extra blade.
  if (hasBlade) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.015), bladeMat);
    blade.position.y = shaftLen + 0.18;
    g.add(blade);
  }
}

function buildMace(
  g: THREE.Group, headMat: THREE.Material, accentMat: THREE.Material, gripMat: THREE.Material,
  opts: { headSize: number; shaftLen: number; tier: number },
): void {
  const { headSize, shaftLen, tier } = opts;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, shaftLen, 8), gripMat);
  shaft.position.y = shaftLen / 2;
  g.add(shaft);
  const head = new THREE.Mesh(new THREE.SphereGeometry(headSize, 12, 8), headMat);
  head.position.y = shaftLen + headSize * 0.6;
  g.add(head);
  // Tier-scaled flanges.
  const flanges = 4 + tier;
  for (let i = 0; i < flanges; i++) {
    const angle = (i / flanges) * Math.PI * 2;
    const flange = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.4, headSize * 0.8, 0.04), accentMat);
    flange.position.set(
      Math.cos(angle) * headSize * 0.7,
      shaftLen + headSize * 0.6,
      Math.sin(angle) * headSize * 0.7,
    );
    flange.rotation.y = angle;
    g.add(flange);
  }
}

function buildClub(g: THREE.Group, gripMat: THREE.Material, opts: { headSize: number; shaftLen: number; tier: number }): void {
  const { headSize, shaftLen } = opts;
  const club = new THREE.Mesh(new THREE.CylinderGeometry(0.018, headSize, shaftLen, 8), gripMat);
  club.position.y = shaftLen / 2;
  g.add(club);
}

function buildSpear(
  g: THREE.Group, bladeMat: THREE.Material, accentMat: THREE.Material, gripMat: THREE.Material,
  opts: { tipLen: number; shaftLen: number; tier: number },
): void {
  const { tipLen, shaftLen, tier } = opts;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, shaftLen, 8), gripMat);
  shaft.position.y = shaftLen / 2;
  g.add(shaft);
  // Tip cone.
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, tipLen, 8), bladeMat);
  tip.position.y = shaftLen + tipLen / 2;
  g.add(tip);
  if (tier >= 3) {
    const collar = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.028, 12), accentMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = shaftLen;
    g.add(collar);
  }
}

function buildBow(g: THREE.Group, gripMat: THREE.Material, accentMat: THREE.Material, opts: { armLen: number; tier: number }): void {
  const { armLen, tier } = opts;
  const arm = new THREE.Mesh(new THREE.TorusGeometry(armLen / 2, 0.018, 8, 12, Math.PI * 0.85), gripMat);
  arm.rotation.z = Math.PI;
  g.add(arm);
  // String.
  const string = new THREE.Mesh(new THREE.BoxGeometry(0.005, armLen, 0.005), accentMat);
  string.position.x = -armLen / 2 + 0.01;
  g.add(string);
  if (tier >= 4) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.15, 8), accentMat);
    grip.rotation.z = Math.PI / 2;
    g.add(grip);
  }
}

function buildCrossbow(
  g: THREE.Group, stockMat: THREE.Material, accentMat: THREE.Material, bladeMat: THREE.Material,
  opts: { armSpan: number; stockLen: number; tier: number },
): void {
  const { armSpan, stockLen, tier } = opts;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(stockLen, 0.04, 0.05), stockMat);
  stock.position.x = stockLen / 2;
  g.add(stock);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.015, armSpan, 0.015), bladeMat);
  arm.position.x = stockLen * 0.7;
  arm.rotation.z = Math.PI / 2;
  g.add(arm);
  if (tier >= 3) {
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.02), accentMat);
    trigger.position.set(stockLen * 0.4, -0.03, 0);
    g.add(trigger);
  }
}

/** Procedural fallback for firearm_pistol/firearm_rifle — used only while
 *  the real GLB (public/models/weapon/firearm_{pistol,rifle}.glb) hasn't
 *  warmed yet. Simple boxy silhouette: grip + body + barrel, optional
 *  shoulder stock for the rifle variant. */
function buildFirearm(
  g: THREE.Group, bodyMat: THREE.Material, gripMat: THREE.Material,
  opts: { bodyLen: number; barrelLen: number; gripLen: number; hasStock?: boolean; tier: number },
): void {
  const { bodyLen, barrelLen, gripLen, hasStock, tier } = opts;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyLen, 0.045, 0.03), bodyMat);
  body.position.x = bodyLen / 2;
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, barrelLen, 8), bodyMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.x = bodyLen + barrelLen / 2;
  g.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.030, gripLen, 0.025), gripMat);
  grip.position.set(bodyLen * 0.15, -gripLen / 2, 0);
  grip.rotation.z = 0.25;
  g.add(grip);
  if (hasStock) {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.04, 0.025), gripMat);
    stock.position.x = -0.10;
    g.add(stock);
  }
  if (tier >= 4) {
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.015), gripMat);
    sight.position.set(bodyLen * 0.6, 0.03, 0);
    g.add(sight);
  }
}

/** Procedural fallback for staff/wand — used only while the real GLB
 *  (public/models/weapon/{staff,wand}.glb) hasn't warmed yet. A shaft +
 *  spherical tip, with tier-scaled tip size and an optional enchantment
 *  glow already applied via accentMat's emissive (set by the caller). */
function buildStaff(
  g: THREE.Group, shaftMat: THREE.Material, tipMat: THREE.Material,
  opts: { shaftLen: number; tipSize: number; tier: number },
): void {
  const { shaftLen, tipSize, tier } = opts;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftLen * 0.02, shaftLen * 0.022, shaftLen, 8), shaftMat);
  shaft.position.y = shaftLen / 2;
  g.add(shaft);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(tipSize + tier * 0.004, 10, 8), tipMat);
  tip.position.y = shaftLen;
  g.add(tip);
}

export const WEAPON_CONSTANTS = Object.freeze({
  ENCHANTMENT_GLOW,
  DEFAULT_BASE_COLOR,
  DEFAULT_GRIP_COLOR,
  DEFAULT_ACCENT_COLOR,
});
