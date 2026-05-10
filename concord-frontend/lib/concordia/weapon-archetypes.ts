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
 */

import * as THREE from 'three';

export type WeaponArchetype =
  | 'shortsword' | 'longsword' | 'axe' | 'mace' | 'dagger' | 'club'
  | 'scimitar' | 'greatsword' | 'halberd' | 'spear' | 'bow' | 'crossbow';

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

/**
 * Build a weapon mesh. Returns a THREE.Group; caller adds to
 * character's right-hand bone.
 */
export function createWeapon(appearance: WeaponAppearance): THREE.Group {
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

  switch (appearance.archetype) {
    case 'shortsword': buildBladeWeapon(group, bladeMat, accentMat, gripMat, { bladeLen: 0.55 + rng() * 0.1, bladeWidth: 0.06, hiltLen: 0.12, tier }); break;
    case 'longsword':  buildBladeWeapon(group, bladeMat, accentMat, gripMat, { bladeLen: 0.85 + rng() * 0.1, bladeWidth: 0.07, hiltLen: 0.18, tier }); break;
    case 'greatsword': buildBladeWeapon(group, bladeMat, accentMat, gripMat, { bladeLen: 1.20 + rng() * 0.15, bladeWidth: 0.10, hiltLen: 0.30, tier }); break;
    case 'dagger':     buildBladeWeapon(group, bladeMat, accentMat, gripMat, { bladeLen: 0.30 + rng() * 0.05, bladeWidth: 0.05, hiltLen: 0.10, tier }); break;
    case 'scimitar':   buildBladeWeapon(group, bladeMat, accentMat, gripMat, { bladeLen: 0.75 + rng() * 0.08, bladeWidth: 0.07, hiltLen: 0.14, tier, curvature: 0.4 }); break;
    case 'axe':        buildAxe(group, bladeMat, accentMat, gripMat, { headSize: 0.18, shaftLen: 0.65, tier }); break;
    case 'mace':       buildMace(group, bladeMat, accentMat, gripMat, { headSize: 0.10, shaftLen: 0.55, tier }); break;
    case 'club':       buildClub(group, gripMat, { headSize: 0.09, shaftLen: 0.50, tier }); break;
    case 'halberd':    buildAxe(group, bladeMat, accentMat, gripMat, { headSize: 0.20, shaftLen: 1.65, tier, hasBlade: true }); break;
    case 'spear':      buildSpear(group, bladeMat, accentMat, gripMat, { tipLen: 0.35, shaftLen: 1.85, tier }); break;
    case 'bow':        buildBow(group, gripMat, accentMat, { armLen: 0.95, tier }); break;
    case 'crossbow':   buildCrossbow(group, gripMat, accentMat, bladeMat, { armSpan: 0.85, stockLen: 0.50, tier }); break;
  }

  group.userData = {
    isWeapon: true,
    archetype: appearance.archetype,
    tier,
    seed: appearance.seed,
    enchantment: appearance.enchantment ?? null,
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

export const WEAPON_CONSTANTS = Object.freeze({
  ENCHANTMENT_GLOW,
  DEFAULT_BASE_COLOR,
  DEFAULT_GRIP_COLOR,
  DEFAULT_ACCENT_COLOR,
});
