/**
 * Armor slot system — Sprint D / Y2
 *
 * 4 slots (head / torso / arms / legs) × parametric geometry per faction
 * silhouette type. Procedural variation: dye via faction palette, trim,
 * sigil placement, wear/damage. Renders as separate THREE.Group of
 * primitives that overlays the body mesh.
 *
 * Caller (AvatarSystem3D / hero-mesh-registry) attaches the resulting
 * Group to torso/head/limb bones so it follows the rig.
 */

import * as THREE from 'three';

export type ArmorSlot = 'head' | 'torso' | 'arms' | 'legs';
export type ArmorSilhouette = 'heavy_plate' | 'robed' | 'leather' | 'exposed';

export interface ArmorAppearance {
  silhouette:    ArmorSilhouette;
  primaryColor:  string;
  secondaryColor: string;
  accentColor:   string;
  /** 1..5 — drives ornamentation density and trim. */
  tier:          number;
  /** 0..1 — 0 = pristine, 1 = battered. */
  wear?:         number;
  /** Optional sigil shape applied as a chest decal. */
  sigilPath?:    string;
  /** Random seed for parametric jitter. */
  seed?:         string;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

function darken(hex: string, amount: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.floor(amount * 255));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.floor(amount * 255));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.floor(amount * 255));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function buildMaterials(appearance: ArmorAppearance): { primary: THREE.MeshStandardMaterial; secondary: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial } {
  const wear = appearance.wear ?? 0;
  const wearAmount = wear * 0.25;
  const isMetal = appearance.silhouette === 'heavy_plate';
  const primary = new THREE.MeshStandardMaterial({
    color: darken(appearance.primaryColor, wearAmount),
    roughness: isMetal ? 0.35 + wear * 0.4 : 0.85,
    metalness: isMetal ? 0.7 : 0.05,
  });
  const secondary = new THREE.MeshStandardMaterial({
    color: darken(appearance.secondaryColor, wearAmount * 0.5),
    roughness: 0.7, metalness: isMetal ? 0.4 : 0.05,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: appearance.accentColor,
    roughness: 0.4, metalness: isMetal ? 0.85 : 0.2,
  });
  return { primary, secondary, accent };
}

/**
 * Build all 4 armor slots in one call. Returns a Map<slot, Group> the
 * caller attaches to the corresponding bones. Crowd NPCs may pick a
 * subset; hero NPCs always get all 4.
 */
export function createArmorSet(appearance: ArmorAppearance): Map<ArmorSlot, THREE.Group> {
  const out = new Map<ArmorSlot, THREE.Group>();
  out.set('head',  createArmorPiece('head',  appearance));
  out.set('torso', createArmorPiece('torso', appearance));
  out.set('arms',  createArmorPiece('arms',  appearance));
  out.set('legs',  createArmorPiece('legs',  appearance));
  return out;
}

export function createArmorPiece(slot: ArmorSlot, appearance: ArmorAppearance): THREE.Group {
  const group = new THREE.Group();
  group.name = `armor_${slot}_${appearance.silhouette}`;
  const seed = hashSeed(appearance.seed ?? `${slot}-${appearance.silhouette}`);
  const rng = mulberry32(seed);
  const mats = buildMaterials(appearance);
  const tier = Math.max(1, Math.min(5, appearance.tier ?? 1));

  switch (slot) {
    case 'head':  buildHelm(group, mats, appearance, tier, rng); break;
    case 'torso': buildTorso(group, mats, appearance, tier, rng); break;
    case 'arms':  buildArms(group, mats, appearance, tier, rng); break;
    case 'legs':  buildLegs(group, mats, appearance, tier, rng); break;
  }

  group.userData = {
    isArmor: true,
    slot,
    silhouette: appearance.silhouette,
    tier,
  };
  return group;
}

interface MatsBundle { primary: THREE.MeshStandardMaterial; secondary: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial; }

function buildHelm(g: THREE.Group, m: MatsBundle, a: ArmorAppearance, tier: number, _rng: () => number): void {
  if (a.silhouette === 'exposed') return;
  // Skull cap.
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), m.primary);
  helm.position.y = 0.06;
  g.add(helm);

  switch (a.silhouette) {
    case 'heavy_plate': {
      // Brow ridge + nose guard.
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.05), m.accent);
      brow.position.set(0, 0.08, 0.13);
      g.add(brow);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.10, 0.04), m.primary);
      nose.position.set(0, 0.0, 0.16);
      g.add(nose);
      if (tier >= 4) {
        // Horns / plume.
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16, 6), m.accent);
        horn.position.set(0, 0.22, 0);
        g.add(horn);
      }
      break;
    }
    case 'robed': {
      // Hood — extruded cylinder.
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.20, 12, 1, true), m.secondary);
      hood.position.y = 0.0;
      g.add(hood);
      break;
    }
    case 'leather': {
      // Leather cap + chin strap.
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.20, 0.04), m.secondary);
      strap.position.set(0.16, -0.05, 0);
      g.add(strap);
      break;
    }
  }
}

function buildTorso(g: THREE.Group, m: MatsBundle, a: ArmorAppearance, tier: number, _rng: () => number): void {
  switch (a.silhouette) {
    case 'heavy_plate': {
      // Chestplate.
      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.45, 0.30), m.primary);
      chest.position.y = 0.15;
      g.add(chest);
      // Pauldrons.
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), m.accent);
        p.position.set(sx * 0.30, 0.30, 0);
        p.scale.y = 0.7;
        g.add(p);
      }
      if (tier >= 3) {
        // Sigil decal — circular accent disc.
        const sig = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), m.accent);
        sig.position.set(0, 0.20, 0.16);
        g.add(sig);
      }
      break;
    }
    case 'robed': {
      // Long robe.
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.40, 1.10, 16, 1, true), m.primary);
      robe.position.y = -0.10;
      g.add(robe);
      // Sash.
      const sash = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.10, 0.32), m.accent);
      sash.position.y = 0.05;
      g.add(sash);
      break;
    }
    case 'leather': {
      // Vest.
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.40, 0.28), m.primary);
      vest.position.y = 0.15;
      g.add(vest);
      if (tier >= 2) {
        const buckle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 8), m.accent);
        buckle.rotation.x = Math.PI / 2;
        buckle.position.set(0, 0.0, 0.15);
        g.add(buckle);
      }
      break;
    }
    case 'exposed': {
      // Just a chest harness.
      const harness = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.30), m.accent);
      harness.position.y = 0.20;
      g.add(harness);
      break;
    }
  }
}

function buildArms(g: THREE.Group, m: MatsBundle, a: ArmorAppearance, tier: number, _rng: () => number): void {
  if (a.silhouette === 'exposed') return;
  const armLen = 0.55;
  for (const sx of [-1, 1]) {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, armLen, 8), a.silhouette === 'robed' ? m.primary : m.secondary);
    sleeve.position.set(sx * 0.22, -0.10, 0);
    g.add(sleeve);
    if (a.silhouette === 'heavy_plate' && tier >= 3) {
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.20, 0.10), m.accent);
      guard.position.set(sx * 0.22, -0.30, 0);
      g.add(guard);
    }
  }
}

function buildLegs(g: THREE.Group, m: MatsBundle, a: ArmorAppearance, _tier: number, _rng: () => number): void {
  if (a.silhouette === 'exposed') return;
  if (a.silhouette === 'robed') {
    // Robe already covers legs — just add boots.
    for (const sx of [-1, 1]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.18), m.secondary);
      boot.position.set(sx * 0.10, -0.85, 0.04);
      g.add(boot);
    }
    return;
  }
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.65, 8), m.primary);
    leg.position.set(sx * 0.10, -0.50, 0);
    g.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.20), m.secondary);
    boot.position.set(sx * 0.10, -0.85, 0.04);
    g.add(boot);
  }
}

export const ARMOR_CONSTANTS = Object.freeze({
  SLOTS: ['head', 'torso', 'arms', 'legs'] as const,
});
