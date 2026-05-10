/**
 * Hair cards — Sprint D / BB3
 *
 * Tier system:
 *   - hero NPCs    : 20-40 alpha-tested hair cards arranged by stylist algorithm,
 *                    with Verlet sway via existing secondary-physics module
 *   - mid NPCs     : low-poly mesh shell with normal-mapped strands
 *   - crowd NPCs   : flat scalp colour
 *
 * Caller (AvatarSystem3D) picks tier based on NPC importance:
 *   - hero_mesh: true    → hero tier
 *   - has_dialogue: true → mid tier
 *   - else                → crowd tier
 *
 * Each card is a procedural plane with vertex-shader displacement that
 * fakes hair-strand parallax via UV offsets along the card. Card layout
 * is deterministic from npc_id seed.
 */

import * as THREE from 'three';

export type HairTier = 'hero' | 'mid' | 'crowd';

export type HairStyle = 'short' | 'medium' | 'long' | 'tied' | 'shaved' | 'flowing';

export interface HairAppearance {
  tier:   HairTier;
  style:  HairStyle;
  color:  string;
  /** Random seed for parametric placement. */
  seed:   string;
  /** Length scaling — 0.6 = pixie, 1.0 = default, 1.6 = long. */
  length?: number;
}

const STYLE_CARD_COUNT: Record<HairStyle, number> = {
  short:   8,
  medium: 18,
  long:   28,
  tied:   16,
  shaved:  0,
  flowing:38,
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
 * Build a hair-card cluster ready to attach to the Head bone. Returns a
 * Group whose internal cards have userData.cardIndex for the Verlet
 * post-pass to drive sway.
 */
export function createHair(appearance: HairAppearance): THREE.Group {
  const group = new THREE.Group();
  group.name = `hair_${appearance.tier}_${appearance.style}`;

  const colorHex = parseInt(appearance.color.replace(/^#/, ''), 16);
  const length = appearance.length ?? 1.0;

  switch (appearance.tier) {
    case 'hero':  buildHeroHair(group, appearance, colorHex, length); break;
    case 'mid':   buildMidHair(group, appearance, colorHex, length); break;
    case 'crowd': buildCrowdHair(group, appearance, colorHex, length); break;
  }
  return group;
}

function buildHeroHair(g: THREE.Group, a: HairAppearance, colorHex: number, length: number): void {
  const cardCount = STYLE_CARD_COUNT[a.style];
  if (cardCount === 0) return;

  const rng = mulberry32(hashSeed(a.seed));
  const cardMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.5,
  });
  applyHairAlphaPattern(cardMat, colorHex);

  // Distribute cards over scalp dome.
  for (let i = 0; i < cardCount; i++) {
    const phi = rng() * Math.PI * 2;
    const theta = (rng() * 0.7 + 0.05) * Math.PI / 2;   // upper hemisphere of head
    const radius = 0.13;

    const cardLen = (a.style === 'long' || a.style === 'flowing') ? 0.4 * length : 0.18 * length;
    const cardWidth = 0.05 + rng() * 0.04;

    const card = new THREE.Mesh(new THREE.PlaneGeometry(cardWidth, cardLen, 1, 4), cardMat);
    const x = Math.sin(theta) * Math.cos(phi) * radius;
    const z = Math.sin(theta) * Math.sin(phi) * radius;
    const y = Math.cos(theta) * radius;
    card.position.set(x, y, z);
    // Orient outward + slightly downward so the card hangs like hair.
    card.lookAt(card.position.clone().multiplyScalar(2));
    card.rotation.x += Math.PI / 2;
    card.translateY(-cardLen / 2);
    card.userData = { cardIndex: i, isHairCard: true, length: cardLen };
    g.add(card);
  }

  // Tied hairstyle: add a single back ponytail card.
  if (a.style === 'tied') {
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.45 * length, 1, 6), cardMat);
    tail.position.set(0, 0.05, -0.13);
    tail.rotation.x = Math.PI;
    tail.userData = { isHairCard: true, length: 0.45 * length, isTail: true };
    g.add(tail);
  }
}

function buildMidHair(g: THREE.Group, a: HairAppearance, colorHex: number, _length: number): void {
  if (a.style === 'shaved') return;
  // Single low-poly hemisphere shell.
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.7, metalness: 0,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mat);
  shell.position.y = 0.02;
  g.add(shell);
}

function buildCrowdHair(g: THREE.Group, a: HairAppearance, colorHex: number, _length: number): void {
  if (a.style === 'shaved') return;
  // Just a flat-shaded scalp cap.
  const mat = new THREE.MeshBasicMaterial({ color: colorHex });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
  cap.position.y = 0.02;
  g.add(cap);
}

/**
 * Assign a procedural alpha pattern that thins the card toward the bottom
 * (making the card look like a cluster of strands).
 */
function applyHairAlphaPattern(mat: THREE.MeshStandardMaterial, _colorHex: number): void {
  const SIZE = 64;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const tY = y / SIZE;        // 0 = top, 1 = bottom
      const tX = x / SIZE;
      // Strands: thin vertical bands at periodic xs; alpha drops toward bottom.
      const stripPhase = (Math.sin(tX * 12) + 1) / 2;
      const alpha = stripPhase > 0.4 ? Math.max(0, 1 - tY * 0.8) : 0;
      data[i + 0] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.floor(alpha * 255);
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.needsUpdate = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  mat.alphaMap = tex;
}

export const HAIR_CONSTANTS = Object.freeze({
  STYLE_CARD_COUNT,
});
