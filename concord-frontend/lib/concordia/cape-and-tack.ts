/**
 * Cape / cloak + mount tack — Sprint D / Y3
 *
 * Capes are Verlet chains (existing secondary-physics.ts buildCapeChain)
 * attached to character shoulders. Tinted via faction visual.
 * Mount tack is parametric saddle / bridle / barding mesh layered on
 * the existing MountAvatar3D.
 */

import * as THREE from 'three';

export interface CapeAppearance {
  primaryColor:   string;
  trimColor:      string;
  /** Optional sigil shape painted on the cape back. */
  sigilPath?:     string;
  /** Length in metres (default 0.85). */
  length?:        number;
}

/**
 * Build a cape mesh as a long thin plane attached to the character's
 * shoulder bone. Animation is handled separately by the existing Verlet
 * chain system — this module just builds the geometry + material.
 */
export function createCape(appearance: CapeAppearance): THREE.Mesh {
  const length = appearance.length ?? 0.85;
  const width = 0.42;
  const segments = 8;

  const geom = new THREE.PlaneGeometry(width, length, 4, segments);
  // Shift down so the top of the cape sits at the shoulder origin.
  geom.translate(0, -length / 2, 0);

  const mat = new THREE.MeshStandardMaterial({
    color: appearance.primaryColor,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'cape';
  mesh.userData = { isCape: true, segments };
  return mesh;
}

export interface MountTackAppearance {
  saddleColor:  string;
  bridleColor:  string;
  bardingColor?: string;   // optional armor blanket
  /** 1..5. */
  tier:         number;
  /** Faction sigil-decal colour for the saddle blanket. */
  accentColor?: string;
}

/**
 * Mount tack — saddle + bridle + optional barding. Attaches to MountAvatar3D
 * at the spine + head bones. Procedural parametric primitives (same pattern
 * as procedural-buildings).
 */
export function createMountTack(appearance: MountTackAppearance): THREE.Group {
  const g = new THREE.Group();
  g.name = 'mount_tack';
  const tier = Math.max(1, Math.min(5, appearance.tier ?? 1));

  const saddleMat = new THREE.MeshStandardMaterial({
    color: appearance.saddleColor, roughness: 0.85, metalness: 0,
  });
  const bridleMat = new THREE.MeshStandardMaterial({
    color: appearance.bridleColor, roughness: 0.85, metalness: 0,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: appearance.accentColor ?? '#c8a050', roughness: 0.4, metalness: 0.6,
  });

  // Saddle — sits on the mount's mid-back.
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.10, 0.55), saddleMat);
  saddle.position.set(0, 0.10, 0);
  g.add(saddle);

  // Saddle blanket (visible at tier ≥ 2).
  if (tier >= 2) {
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.65), accentMat);
    blanket.position.set(0, 0.05, 0);
    g.add(blanket);
  }

  // Stirrups.
  for (const sx of [-1, 1]) {
    const stirrup = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12), accentMat);
    stirrup.position.set(sx * 0.22, -0.02, 0);
    stirrup.rotation.x = Math.PI / 2;
    g.add(stirrup);
  }

  // Bridle — horse-style strap geometry on the mount's head.
  const bridle = new THREE.Group();
  bridle.name = 'mount_bridle';
  bridle.position.set(0, 0.55, 0.85);   // approximate mount head position
  const browband = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.05), bridleMat);
  bridle.add(browband);
  // Cheek straps.
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.04), bridleMat);
    cheek.position.set(sx * 0.085, -0.10, 0);
    bridle.add(cheek);
  }
  g.add(bridle);

  // Reins (visible at tier ≥ 1, leather strap).
  const reins = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.50), bridleMat);
  reins.position.set(0, 0.45, 0.55);
  g.add(reins);

  // Barding (armor blanket) for tier ≥ 4.
  if (tier >= 4 && appearance.bardingColor) {
    const bardingMat = new THREE.MeshStandardMaterial({
      color: appearance.bardingColor, roughness: 0.4, metalness: 0.6,
    });
    const barding = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.30, 0.85), bardingMat);
    barding.position.set(0, 0, 0);
    g.add(barding);
    // Forequarter armor.
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.40, 0.20), bardingMat);
    fore.position.set(0, 0.25, 0.40);
    g.add(fore);
  }

  g.userData = { isMountTack: true, tier };
  return g;
}

export const TACK_CONSTANTS = Object.freeze({
  DEFAULT_CAPE_LENGTH_M: 0.85,
});
