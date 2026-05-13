/**
 * Enhanced avatar builder — composes the four already-shipped facial /
 * material systems (hair-cards, eye-parallax, skin-SSS, facial-blend-
 * shapes) into a single mesh group keyed by RichAppearanceConfig.
 *
 * The existing AvatarSystem3D.createAvatarMesh path is left in place
 * for backwards-compat (it produces sphere-and-cylinder primitives).
 * This builder is the "Tier 1" path — callers that want better
 * fidelity (hero NPCs, named characters, the local player) call this
 * instead.
 *
 * Output:
 *   {
 *     group:     THREE.Group       // head + eyes + hair + body limbs
 *     facial:    FacialController  // call .setEmotion / .setViseme
 *     tickEyes:  (dt) => void      // call per-frame for wetness sheen
 *     dispose:   () => void
 *   }
 *
 * Visual upgrades over the legacy builder:
 *   - Hair-cards (instead of a single sphere). 18-30 cards per head,
 *     with a length scalar and per-style template.
 *   - Eye-parallax shader. Real pupil + iris with depth illusion.
 *   - Skin-SSS shader. Subsurface scattering so faces don't read
 *     plastic under the directional sun.
 *   - Facial blend-shape controller. Caller drives .setEmotion('joy')
 *     or .setViseme('A') for lip-sync; this builder constructs the
 *     hook so AnimationManager + lip-sync.ts work out of the box.
 *
 * Where this gets called:
 *   - AvatarSystem3D when an authored NPC has hero_mesh:true OR is
 *     the local player.
 *   - hero-mesh-registry's procedural fallback path (when no GLB).
 *
 * Note: this builder consumes BodyProportions explicitly so all the
 * limb geometry comes from anatomical-reference math rather than the
 * narrower BODY_DIMENSIONS table. Heroic characters (legend body type)
 * still look correctly oversized.
 */

import * as THREE from 'three';
import { createHair, type HairAppearance } from '@/lib/concordia/hair-cards';
import { createEyePair, type EyeAppearance } from '@/lib/concordia/eye-parallax-shader';
import { createSkinSSS } from '@/lib/world-lens/skin-sss-shader';
import { FacialController } from '@/lib/concordia/facial-blend-shapes';
import type { RichAppearanceConfig, HairStyle as RichHairStyle } from '@/lib/world-lens/character-schema';
import { PBR_REFERENCE } from '@/lib/world-lens/character-schema';

export interface EnhancedAvatarResult {
  group:    THREE.Group;
  facial:   FacialController;
  tickEyes: (dt: number) => void;
  dispose:  () => void;
}

// Map RichAppearanceConfig HairStyle -> hair-cards HairStyle (narrower set).
function hairCardStyle(s: RichHairStyle): import('@/lib/concordia/hair-cards').HairStyle {
  switch (s) {
    case 'bald':
    case 'shaved':    return 'shaved';
    case 'short':
    case 'undercut':
    case 'mohawk':
    case 'topknot':   return 'short';
    case 'medium':
    case 'bun':       return 'medium';
    case 'long':
    case 'locs':
    case 'dreads':
    case 'braids':    return 'long';
    case 'ponytail':  return 'tied';
    default:          return 'medium';
  }
}

/** Heuristic — does this body archetype carry "hero" tier hair quality. */
function hairTierFor(arch: RichAppearanceConfig['bodyArchetype'], heroMesh: boolean):
  import('@/lib/concordia/hair-cards').HairTier {
  if (heroMesh || arch === 'legend') return 'hero';
  return 'mid';
}

export function buildEnhancedAvatar(rich: RichAppearanceConfig, opts: { isLocalPlayer?: boolean } = {}): EnhancedAvatarResult {
  const { proportions: p, skinColor, hairColor, eyeColor, clothing, bodyArchetype } = rich;
  const isHero = !!(rich.heroMesh || opts.isLocalPlayer || bodyArchetype === 'legend');

  const group = new THREE.Group();
  group.name = `avatar_${rich.worldId}_${rich.factionId ?? 'civ'}`;

  /* ── Skin material (subsurface scattering for faces) ─────────── */
  const skinSSS = createSkinSSS({
    skinColor:        new THREE.Color(skinColor),
    subsurfColor:     new THREE.Color('#bf6d54'),
    subsurfStrength:  PBR_REFERENCE.skin.sss,
    roughness:        PBR_REFERENCE.skin.roughness,
    metalness:        PBR_REFERENCE.skin.metalness,
  });
  // Limb skin uses standard PBR for cheapness — SSS is reserved for the face
  // where it pays. Real skin tone, real roughness.
  const skinPBR = new THREE.MeshStandardMaterial({
    color: new THREE.Color(skinColor),
    roughness: PBR_REFERENCE.skin.roughness,
    metalness: 0,
  });

  /* ── Cloth materials ─────────────────────────────────────────── */
  const topMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(clothing.top.color),
    roughness: PBR_REFERENCE.cotton.roughness,
    metalness: 0,
  });
  const bottomMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(clothing.bottom.color),
    roughness: PBR_REFERENCE.cotton.roughness,
    metalness: 0,
  });

  /* ── Head ─────────────────────────────────────────────────────── */
  const headGeom = new THREE.SphereGeometry(p.headWidth / 2, 24, 18);
  const head = new THREE.Mesh(headGeom, skinSSS);
  head.position.y = p.legLength + p.torsoLength + p.neckLength + p.headHeight / 2;
  head.scale.set(1, p.headHeight / p.headWidth, p.headDepth / p.headWidth);
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  /* ── Eyes (parallax shader) ─────────────────────────────────── */
  const eyeApp: EyeAppearance = { irisColor: eyeColor };
  const eyePair = createEyePair(eyeApp, p.headWidth * 0.06);
  // Position the eye pair at head's eye-line (~upper third of head).
  eyePair.group.position.copy(head.position);
  eyePair.group.position.y += p.headHeight * 0.15;
  eyePair.group.position.z += p.headDepth * 0.45;
  group.add(eyePair.group);

  /* ── Hair (cards) ───────────────────────────────────────────── */
  if (rich.hairStyle !== 'bald') {
    const hairApp: HairAppearance = {
      tier:   hairTierFor(bodyArchetype, isHero),
      style:  hairCardStyle(rich.hairStyle),
      color:  hairColor,
      seed:   rich.worldId + ':' + (rich.factionId ?? '') + ':' + bodyArchetype,
      length: rich.hairStyle === 'long' || rich.hairStyle === 'locs' || rich.hairStyle === 'dreads' ? 1.5 : 1.0,
    };
    const hair = createHair(hairApp);
    hair.position.copy(head.position);
    hair.position.y += p.headHeight * 0.2;
    group.add(hair);
  }

  /* ── Torso ───────────────────────────────────────────────────── */
  const torsoGeom = new THREE.BoxGeometry(p.shoulderWidth, p.torsoLength, p.headDepth * 0.7);
  const torso = new THREE.Mesh(torsoGeom, topMat);
  torso.position.y = p.legLength + p.torsoLength / 2;
  torso.castShadow = true;
  group.add(torso);

  /* ── Arms ────────────────────────────────────────────────────── */
  for (const sign of [-1, 1] as const) {
    const upperArmGeom = new THREE.CylinderGeometry(p.headWidth * 0.18, p.headWidth * 0.18, p.armLength * 0.5, 10);
    const upperArm = new THREE.Mesh(upperArmGeom, sign === -1 ? topMat : topMat);
    upperArm.position.set(sign * (p.shoulderWidth / 2 + p.headWidth * 0.12), p.legLength + p.torsoLength - p.armLength * 0.25, 0);
    upperArm.castShadow = true;
    group.add(upperArm);

    const lowerArmGeom = new THREE.CylinderGeometry(p.headWidth * 0.16, p.headWidth * 0.16, p.armLength * 0.5, 10);
    const lowerArm = new THREE.Mesh(lowerArmGeom, skinPBR);
    lowerArm.position.set(sign * (p.shoulderWidth / 2 + p.headWidth * 0.12), p.legLength + p.torsoLength - p.armLength * 0.75, 0);
    lowerArm.castShadow = true;
    group.add(lowerArm);

    // Hand
    const handGeom = new THREE.SphereGeometry(p.handLength * 0.35, 10, 8);
    const hand = new THREE.Mesh(handGeom, skinPBR);
    hand.position.set(sign * (p.shoulderWidth / 2 + p.headWidth * 0.12), p.legLength + p.torsoLength - p.armLength, 0);
    group.add(hand);
  }

  /* ── Legs ────────────────────────────────────────────────────── */
  for (const sign of [-1, 1] as const) {
    const legGeom = new THREE.CylinderGeometry(p.headWidth * 0.22, p.headWidth * 0.22, p.legLength, 12);
    const leg = new THREE.Mesh(legGeom, bottomMat);
    leg.position.set(sign * (p.hipWidth / 4), p.legLength / 2, 0);
    leg.castShadow = true;
    group.add(leg);

    // Foot
    const footGeom = new THREE.BoxGeometry(p.headWidth * 0.4, p.headWidth * 0.2, p.footLength);
    const footMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(clothing.boots?.color ?? '#3a2820'),
      roughness: PBR_REFERENCE.leather.roughness,
      metalness: 0,
    });
    const foot = new THREE.Mesh(footGeom, footMat);
    foot.position.set(sign * (p.hipWidth / 4), p.headWidth * 0.1, p.footLength * 0.3);
    foot.castShadow = true;
    group.add(foot);
  }

  /* ── Cape (if present — secondary-physics will animate it later) ── */
  if (clothing.cape) {
    const capeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(clothing.cape.color),
      roughness: PBR_REFERENCE.wool.roughness,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const capeGeom = new THREE.PlaneGeometry(p.shoulderWidth * 1.2, p.torsoLength * 1.6, 6, 12);
    const cape = new THREE.Mesh(capeGeom, capeMat);
    cape.position.set(0, p.legLength + p.torsoLength * 0.6, -p.headDepth * 0.35);
    cape.rotation.x = -0.1;
    cape.name = 'cape';
    cape.userData.isCape = true;  // cape-and-tack.ts looks for this
    group.add(cape);
  }

  /* ── Visible carry items ────────────────────────────────────── */
  if (rich.accessories.carry?.includes('sword')) {
    const swordGeom = new THREE.BoxGeometry(p.headWidth * 0.05, p.headWidth * 1.4, p.headWidth * 0.15);
    const swordMat = new THREE.MeshStandardMaterial({
      color: 0x8a8e92,
      roughness: PBR_REFERENCE.steel.roughness,
      metalness: PBR_REFERENCE.steel.metalness,
    });
    const sword = new THREE.Mesh(swordGeom, swordMat);
    sword.position.set(p.shoulderWidth * 0.6, p.legLength + p.torsoLength * 0.3, -p.headDepth * 0.2);
    sword.rotation.z = 0.15;
    group.add(sword);
  }
  if (rich.accessories.carry?.includes('staff')) {
    const staffGeom = new THREE.CylinderGeometry(p.headWidth * 0.04, p.headWidth * 0.04, p.totalHeight * 0.9, 8);
    const staffMat = new THREE.MeshStandardMaterial({
      color: 0x6a4828,
      roughness: PBR_REFERENCE.wood.roughness,
      metalness: 0,
    });
    const staff = new THREE.Mesh(staffGeom, staffMat);
    staff.position.set(p.shoulderWidth * 0.6, p.totalHeight * 0.45, 0);
    group.add(staff);
  }
  if (rich.accessories.carry?.includes('bow')) {
    const bowGeom = new THREE.TorusGeometry(p.headWidth * 0.9, 0.012, 8, 24, Math.PI);
    const bowMat = new THREE.MeshStandardMaterial({
      color: 0x4a3018,
      roughness: PBR_REFERENCE.wood.roughness,
      metalness: 0,
    });
    const bow = new THREE.Mesh(bowGeom, bowMat);
    bow.position.set(-p.shoulderWidth * 0.6, p.legLength + p.torsoLength * 0.4, -p.headDepth * 0.2);
    bow.rotation.z = Math.PI / 2;
    group.add(bow);
  }

  /* ── Augments (cyber/superhero — chrome arm, etc.) ──────────── */
  for (const aug of rich.accessories.augments ?? []) {
    const augColor = aug.material === 'chrome' ? 0xc8c8d0 :
                     aug.material === 'gold'   ? 0xc8a040 : 0x202028;
    const augMat = new THREE.MeshStandardMaterial({
      color: augColor,
      roughness: aug.material === 'chrome' ? PBR_REFERENCE.chrome.roughness : 0.4,
      metalness: 1.0,
    });
    if (aug.region.includes('arm')) {
      const sign = aug.region === 'left-arm' ? -1 : 1;
      const augGeom = new THREE.CylinderGeometry(p.headWidth * 0.18, p.headWidth * 0.18, p.armLength * 0.5, 12);
      const augMesh = new THREE.Mesh(augGeom, augMat);
      augMesh.position.set(sign * (p.shoulderWidth / 2 + p.headWidth * 0.12), p.legLength + p.torsoLength - p.armLength * 0.75, 0);
      group.add(augMesh);
    }
  }

  /* ── Markings — single decal sphere over the chosen region ─── */
  // (Full decal projection is a future iteration; right now we just
  // tint a thin shell over the region so the marking is visible.)
  for (const mark of rich.accessories.markings ?? []) {
    if (mark.region === 'face') {
      // No-op for now — facial blend shapes handle most face-marking dynamics.
      continue;
    }
    // Procedural mark = small additive plane on the torso/arm.
    const markMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(mark.color),
      transparent: true,
      opacity: 0.7,
    });
    const markGeom = new THREE.PlaneGeometry(p.headWidth * 0.3, p.headWidth * 0.4);
    const markMesh = new THREE.Mesh(markGeom, markMat);
    markMesh.position.set(0, p.legLength + p.torsoLength * 0.4, p.headDepth * 0.36);
    if (mark.region === 'arms') {
      markMesh.position.set(p.shoulderWidth / 2, p.legLength + p.torsoLength - p.armLength * 0.4, 0);
      markMesh.rotation.y = Math.PI / 2;
    }
    if (mark.region === 'back') {
      markMesh.position.set(0, p.legLength + p.torsoLength * 0.5, -p.headDepth * 0.36);
      markMesh.rotation.y = Math.PI;
    }
    group.add(markMesh);
  }

  /* ── Facial controller ─────────────────────────────────────── */
  // FacialController binds to the head mesh; when a GLB with morph
  // targets loads later it applies them. For procedural avatars the
  // morphTargetInfluences map is empty so setEmotion / setViseme
  // becomes a no-op (graceful — won't crash).
  const facial = new FacialController(head);

  /* ── Disposal ──────────────────────────────────────────────── */
  function dispose() {
    group.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose?.());
        else mat?.dispose?.();
      }
    });
  }

  return {
    group,
    facial,
    tickEyes: eyePair.tick,
    dispose,
  };
}
