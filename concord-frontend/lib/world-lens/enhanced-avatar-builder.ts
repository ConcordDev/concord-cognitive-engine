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
 *     hook so the AvatarSystem3D mixer + lip-sync.ts work out of the box.
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
import { createWeapon } from '@/lib/concordia/weapon-archetypes';
import { createArmorSet } from '@/lib/concordia/armor-system';

/** armor-system.ts's parametric geometry (chestplate 0.50m, leg length
 *  0.65m, etc) is dimensioned for the 'average' body archetype's 1.75m
 *  reference height (character-schema.ts's heightBand table). Scaling
 *  uniformly by totalHeight/REFERENCE keeps armor proportionate on
 *  every archetype (petite through legend) without needing armor-
 *  system.ts itself to take per-limb proportions as an input — an
 *  approximation (it doesn't correct for width/depth ratio differences
 *  between archetypes), but a close one, and far simpler than threading
 *  BodyProportions through the armor builder's own geometry.
 */
const ARMOR_REFERENCE_HEIGHT_M = 1.75;

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

  /* ── Neck ─────────────────────────────────────────────────────── */
  // The head is offset above the torso by exactly p.neckLength (see head
  // position above and headY/headTopY elsewhere in this file) but nothing
  // ever filled that gap — every character rendered with its head visibly
  // floating clear of its shoulders. A simple cylinder spanning the same
  // gap, same skin material as the limbs.
  const neckGeom = new THREE.CylinderGeometry(p.headWidth * 0.32, p.headWidth * 0.38, p.neckLength, 12);
  const neck = new THREE.Mesh(neckGeom, skinPBR);
  neck.position.y = p.legLength + p.torsoLength + p.neckLength / 2;
  neck.castShadow = true;
  group.add(neck);

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

  /* ── Armor (real-material-detail, deterministic per-character) ──
   * See character-schema.ts's generateAppearance armor block — every
   * character gets a unique (silhouette, tier, wear, dye, seed)
   * combination, so no two NPCs read as recolored clones. Anchor
   * points below match armor-system.ts's own internal coordinate
   * convention for each slot (verified against buildHelm/buildTorso/
   * buildArms/buildLegs's own internal offsets): head centers on the
   * head mesh; torso + legs share the waist line (chest offsets up
   * from it, robes/legs hang down from it); arms anchor the shoulder
   * line. */
  const armorScale = p.totalHeight / ARMOR_REFERENCE_HEIGHT_M;
  const armorSet = createArmorSet(rich.armor);
  const waistY = p.legLength;
  const shoulderY = p.legLength + p.torsoLength;
  const headY = p.legLength + p.torsoLength + p.neckLength + p.headHeight / 2;
  const armorAnchorY: Record<'head' | 'torso' | 'arms' | 'legs', number> = {
    head: headY, torso: waistY, arms: shoulderY, legs: waistY,
  };
  for (const [slot, piece] of armorSet) {
    piece.scale.setScalar(armorScale);
    piece.position.y = armorAnchorY[slot];
    piece.traverse((obj) => { (obj as THREE.Mesh).castShadow = true; });
    group.add(piece);
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

  /* ── Visible carry items — proper weapon-archetypes meshes ─── */
  // Phase C3: pull weapon meshes from lib/concordia/weapon-archetypes
  // instead of inline procedural primitives. Faction-tinted, tier-3,
  // optional enchantment glow.
  //
  // Stability audit (2026-07-21) — the previous per-branch dynamic
  // `require('@/lib/concordia/weapon-archetypes')` was silently swallowed
  // by its own `try/catch` in any environment whose module loader doesn't
  // resolve `@/...` path aliases through a raw runtime `require()` call
  // (confirmed broken under plain Node and under this repo's own Vitest
  // suite — `require()` only worked for Next.js's webpack build, which
  // rewrites literal-string `require()` calls the same as `import`; there
  // was no test coverage on this file to have ever caught it failing
  // elsewhere). Replaced with a plain static top-level `import` — no
  // circular-dependency risk (`weapon-archetypes.ts` and its own import,
  // `asset-loader.ts`, don't import this file, directly or transitively)
  // — which also means the per-branch try/catch was pure defensive
  // clutter around a call that can't throw for any of these archetypes;
  // removed along with it. Also added 2 new carry values this pass:
  // `pistol`/`rifle` were already declared in `Accessories['carry']`
  // (used as `carryDefault` by 5 real body-archetype presets — cyber /
  // crime NPCs) but had no branch here at all, so those NPCs' equipped
  // firearms rendered nothing.
  if (rich.accessories.carry?.includes('sword')) {
    const sword = createWeapon({
      archetype: rich.bodyArchetype === 'legend' ? 'greatsword' : 'longsword',
      tier: 3,
      accentColor: rich.clothing.cape?.color ?? rich.clothing.top.color,
      seed: rich.worldId + ':' + (rich.factionId ?? ''),
    });
    sword.position.set(p.shoulderWidth * 0.6, p.legLength + p.torsoLength * 0.3, -p.headDepth * 0.2);
    sword.rotation.z = 0.15;
    group.add(sword);
  }
  if (rich.accessories.carry?.includes('staff')) {
    const staff = createWeapon({
      archetype: 'staff',
      tier: 3,
      accentColor: rich.clothing.cape?.color ?? rich.clothing.top.color,
      seed: rich.worldId + ':staff:' + (rich.factionId ?? ''),
    });
    // Grip-at-base pivot (both the real asset and the procedural
    // fallback normalize/build to this convention) — position at hand
    // height so the shaft/tip extend upward from the grip.
    staff.position.set(p.shoulderWidth * 0.6, p.legLength + p.torsoLength * 0.3, 0);
    group.add(staff);
  }
  if (rich.accessories.carry?.includes('wand')) {
    const wand = createWeapon({
      archetype: 'wand',
      tier: 3,
      accentColor: rich.clothing.top.color,
      seed: rich.worldId + ':wand:' + (rich.factionId ?? ''),
    });
    wand.position.set(p.shoulderWidth * 0.55, p.legLength + p.torsoLength * 0.35, -p.headDepth * 0.15);
    group.add(wand);
  }
  if (rich.accessories.carry?.includes('bow')) {
    const bow = createWeapon({
      archetype: 'bow',
      tier: 3,
      accentColor: rich.clothing.top.color,
      seed: rich.worldId + ':bow:' + (rich.factionId ?? ''),
    });
    bow.position.set(-p.shoulderWidth * 0.6, p.legLength + p.torsoLength * 0.4, -p.headDepth * 0.2);
    group.add(bow);
  }
  if (rich.accessories.carry?.includes('pistol')) {
    const pistol = createWeapon({
      archetype: 'firearm_pistol',
      tier: 3,
      accentColor: rich.clothing.top.color,
      seed: rich.worldId + ':pistol:' + (rich.factionId ?? ''),
    });
    // Holstered at the hip, not held mid-air — pistols read as carried
    // gear rather than a permanently-drawn weapon.
    pistol.position.set(-p.hipWidth * 0.55, p.legLength * 0.55, p.headDepth * 0.3);
    pistol.rotation.z = -Math.PI / 2;
    group.add(pistol);
  }
  if (rich.accessories.carry?.includes('rifle')) {
    const rifle = createWeapon({
      archetype: 'firearm_rifle',
      tier: 3,
      accentColor: rich.clothing.top.color,
      seed: rich.worldId + ':rifle:' + (rich.factionId ?? ''),
    });
    // Slung across the back, matching the bow's shoulder placement.
    rifle.position.set(-p.shoulderWidth * 0.5, p.legLength + p.torsoLength * 0.55, -p.headDepth * 0.35);
    rifle.rotation.z = Math.PI / 2.4;
    rifle.rotation.y = Math.PI / 2;
    group.add(rifle);
  }
  if (rich.accessories.carry?.includes('axe')) {
    // Gathering axe — reuses the real 'axe' weapon archetype (real GLB,
    // see weapon-archetypes.ts/CREDITS.md) rather than a second axe
    // asset; a lumberjack's axe and a combat axe are the same object in
    // this world. Holstered at the hip (matching the pistol treatment)
    // rather than held mid-air — this is carried gear, not a drawn
    // weapon, and it's what the click-to-gather swing animation reaches
    // for on a tree node.
    const axe = createWeapon({
      archetype: 'axe',
      tier: 2,
      accentColor: rich.clothing.top.color,
      seed: rich.worldId + ':axe:' + (rich.factionId ?? ''),
    });
    axe.position.set(p.hipWidth * 0.6, p.legLength * 0.6, -p.headDepth * 0.25);
    axe.rotation.z = Math.PI / 2.6;
    group.add(axe);
  }

  // Non-weapon carry gear — satchel/tome/tool-belt/pouch previously had no
  // branch here at all (unlike every weapon `carry` value above), despite
  // being real `carryDefault` kit on several archetype presets
  // (scholar/scavenger/mechanic/etc. — character-schema.ts). Simple
  // procedural props, same leather/cotton PBR reference the boots above
  // already use — not routed through weapon-archetypes.ts, since these
  // aren't combat weapons and don't need a tip/discharge point.
  const beltColor = new THREE.Color(rich.clothing.belt?.color ?? '#5c3a21');
  const beltMat = new THREE.MeshStandardMaterial({
    color: beltColor,
    roughness: PBR_REFERENCE.leather.roughness,
    metalness: 0,
  });
  if (rich.accessories.carry?.includes('satchel')) {
    const satchel = new THREE.Mesh(
      new THREE.BoxGeometry(p.headWidth * 0.7, p.headWidth * 0.9, p.headWidth * 0.4),
      beltMat.clone(),
    );
    // Hangs at the right hip, opposite the pistol holster.
    satchel.position.set(p.hipWidth * 0.6, p.legLength * 0.55, p.headDepth * 0.15);
    satchel.rotation.z = 0.08;
    satchel.castShadow = true;
    satchel.name = 'carry_satchel';
    group.add(satchel);
  }
  if (rich.accessories.carry?.includes('pouch')) {
    const pouch = new THREE.Mesh(
      new THREE.BoxGeometry(p.headWidth * 0.4, p.headWidth * 0.45, p.headWidth * 0.3),
      beltMat.clone(),
    );
    // Small, front-center on the belt line — distinct from the larger satchel.
    pouch.position.set(0, p.legLength * 0.55, p.headDepth * 0.4);
    pouch.castShadow = true;
    pouch.name = 'carry_pouch';
    group.add(pouch);
  }
  if (rich.accessories.carry?.includes('tool-belt')) {
    const beltBand = new THREE.Mesh(
      new THREE.TorusGeometry(p.hipWidth * 0.62, p.headWidth * 0.1, 6, 16),
      beltMat.clone(),
    );
    beltBand.rotation.x = Math.PI / 2;
    beltBand.position.set(0, p.legLength * 0.58, 0);
    beltBand.castShadow = true;
    beltBand.name = 'carry_tool_belt';
    group.add(beltBand);
    // A few small tool cylinders around the band so it reads as equipped
    // gear, not just a plain ring — deterministic angles, not random, so
    // the mesh is stable across re-renders of the same character.
    const toolMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8a8a8a'),
      roughness: PBR_REFERENCE.iron.roughness,
      metalness: PBR_REFERENCE.iron.metalness,
    });
    const toolAngles = [0.4, 1.6, -1.2];
    for (const angle of toolAngles) {
      const tool = new THREE.Mesh(
        new THREE.CylinderGeometry(p.headWidth * 0.06, p.headWidth * 0.06, p.headWidth * 0.35, 6),
        toolMat,
      );
      tool.position.set(
        Math.sin(angle) * p.hipWidth * 0.62,
        p.legLength * 0.5,
        Math.cos(angle) * p.hipWidth * 0.62,
      );
      tool.rotation.x = Math.PI / 2;
      tool.castShadow = true;
      group.add(tool);
    }
  }
  if (rich.accessories.carry?.includes('tome')) {
    const tomeGroup = new THREE.Group();
    tomeGroup.name = 'carry_tome';
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(p.headWidth * 0.55, p.headWidth * 0.7, p.headWidth * 0.18),
      beltMat.clone(),
    );
    tomeGroup.add(cover);
    // A lighter "pages" sliver on the spine edge so it reads as a book,
    // not a plain box — same two-tone trick real book props use.
    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(p.headWidth * 0.55, p.headWidth * 0.62, p.headWidth * 0.05),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#e8dcc0'),
        roughness: PBR_REFERENCE.cotton.roughness,
        metalness: 0,
      }),
    );
    pages.position.z = p.headWidth * 0.1;
    tomeGroup.add(pages);
    // Strapped to the lower back, opposite the satchel.
    tomeGroup.position.set(-p.hipWidth * 0.3, p.legLength + p.torsoLength * 0.25, -p.headDepth * 0.4);
    tomeGroup.rotation.y = Math.PI;
    group.add(tomeGroup);
  }

  // Gathering tools (pickaxe/hoe/sickle) — no real GLB exists for these
  // (only 'axe' has one, handled above via weapon-archetypes.ts), so
  // they're simple, honest procedural props: a wooden shaft + a metal
  // head shaped for the tool, in the same style already established for
  // tool-belt's cylinders and the tome's cover+pages. Strapped
  // diagonally across the back, matching the rifle/bow shoulder-carry
  // treatment, so it reads as equipped kit rather than mid-swing.
  const toolHandleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6b4a2b'),
    roughness: PBR_REFERENCE.wood.roughness,
    metalness: 0,
  });
  const toolHeadMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#9a9a9a'),
    roughness: PBR_REFERENCE.iron.roughness,
    metalness: PBR_REFERENCE.iron.metalness,
  });
  if (rich.accessories.carry?.includes('pickaxe')) {
    const toolGroup = new THREE.Group();
    toolGroup.name = 'carry_pickaxe';
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.7, 6), toolHandleMat);
    toolGroup.add(shaft);
    // Two angled head-spikes meeting at the shaft top, reading as a pick.
    for (const sign of [-1, 1] as const) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 5), toolHeadMat);
      spike.position.set(sign * 0.15, 0.35, 0);
      spike.rotation.z = sign * (Math.PI / 2.3);
      toolGroup.add(spike);
    }
    toolGroup.position.set(-p.shoulderWidth * 0.5, p.legLength + p.torsoLength * 0.55, -p.headDepth * 0.35);
    toolGroup.rotation.z = Math.PI / 2.4;
    toolGroup.rotation.y = Math.PI / 2;
    group.add(toolGroup);
  }
  if (rich.accessories.carry?.includes('hoe')) {
    const toolGroup = new THREE.Group();
    toolGroup.name = 'carry_hoe';
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.75, 6), toolHandleMat);
    toolGroup.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.02), toolHeadMat);
    blade.position.y = 0.37;
    blade.rotation.z = Math.PI / 2;
    toolGroup.add(blade);
    toolGroup.position.set(-p.shoulderWidth * 0.5, p.legLength + p.torsoLength * 0.55, -p.headDepth * 0.35);
    toolGroup.rotation.z = Math.PI / 2.4;
    toolGroup.rotation.y = Math.PI / 2;
    group.add(toolGroup);
  }
  if (rich.accessories.carry?.includes('sickle')) {
    const toolGroup = new THREE.Group();
    toolGroup.name = 'carry_sickle';
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.35, 6), toolHandleMat);
    toolGroup.add(shaft);
    // A curved blade — a partial torus arc reads as a sickle's hook far
    // better than a flat box (same technique the tool-belt band above
    // already uses for a full ring, just a shorter arc).
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 12, Math.PI * 1.1), toolHeadMat);
    blade.position.y = 0.2;
    blade.rotation.y = Math.PI / 2;
    toolGroup.add(blade);
    // Strapped lower on the back than the pick/hoe (a shorter tool),
    // opposite the tome's placement.
    toolGroup.position.set(p.hipWidth * 0.55, p.legLength * 0.6, -p.headDepth * 0.2);
    toolGroup.rotation.z = Math.PI / 2.6;
    group.add(toolGroup);
  }

  /* ── Augments (cyber/superhero — chrome arm, etc.) ──────────── */
  for (const aug of rich.accessories.augments ?? []) {
    const augColor = aug.material === 'chrome' ? 0xc8c8d0 :
                     aug.material === 'gold'   ? 0xc8a040 : 0x202028;
    const augMat = new THREE.MeshStandardMaterial({
      color: augColor,
      roughness: aug.material === 'chrome' ? PBR_REFERENCE.chrome.roughness : 0.4,
      metalness: 1.0,
      // Wave 5a polish — augments read as lit (a faint inner glow on chrome/gold),
      // so an authored "chrome left arm" / "gold eye" looks powered, not painted.
      emissive: new THREE.Color(augColor),
      emissiveIntensity: aug.material === 'chrome' ? 0.18 : 0.28,
    });
    if (aug.region.includes('arm')) {
      const sign = aug.region === 'left-arm' ? -1 : 1;
      const augGeom = new THREE.CylinderGeometry(p.headWidth * 0.18, p.headWidth * 0.18, p.armLength * 0.5, 12);
      const augMesh = new THREE.Mesh(augGeom, augMat);
      augMesh.position.set(sign * (p.shoulderWidth / 2 + p.headWidth * 0.12), p.legLength + p.torsoLength - p.armLength * 0.75, 0);
      group.add(augMesh);
    }
  }

  /* ── Markings — a tinted plane over the chosen region ───────── */
  // Wave 5a polish — face markings now render (were a no-op), and glyph
  // markings glow (emissive) so an authored "memory-glyph on the brow" reads
  // as lit. headTopY is the head centre for face/scar placement.
  const headTopY = p.legLength + p.torsoLength + p.neckLength + p.headHeight * 0.5;
  function addMark(region: string, color: string, glow: boolean) {
    const markMat = glow
      ? new THREE.MeshStandardMaterial({
          color: new THREE.Color(color),
          emissive: new THREE.Color(color),
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.85,
        })
      : new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.7 });
    const isFace = region === 'face';
    const markGeom = new THREE.PlaneGeometry(
      p.headWidth * (isFace ? 0.22 : 0.3),
      p.headWidth * (isFace ? 0.3 : 0.4),
    );
    const markMesh = new THREE.Mesh(markGeom, markMat);
    if (isFace) {
      // On the front of the head, beside the eye-line (cheek/brow).
      markMesh.position.set(p.headWidth * 0.18, headTopY + p.headHeight * 0.08, p.headDepth * 0.46);
    } else if (region === 'arms') {
      markMesh.position.set(p.shoulderWidth / 2, p.legLength + p.torsoLength - p.armLength * 0.4, 0);
      markMesh.rotation.y = Math.PI / 2;
    } else if (region === 'back') {
      markMesh.position.set(0, p.legLength + p.torsoLength * 0.5, -p.headDepth * 0.36);
      markMesh.rotation.y = Math.PI;
    } else {
      markMesh.position.set(0, p.legLength + p.torsoLength * 0.4, p.headDepth * 0.36);
    }
    group.add(markMesh);
  }

  for (const mark of rich.accessories.markings ?? []) {
    addMark(mark.region, mark.color, mark.kind === 'glyph');
  }
  // Wave 5a — read facial.scars (previously ignored): a desaturated scar mark on
  // the named body region, so an authored scar actually shows on the body.
  for (const scar of rich.facial?.scars ?? []) {
    const scarColor = scar.kind === 'glyph' ? '#7ad0ff' : '#5a3b34';
    const region = scar.region === 'arm' ? 'arms' : scar.region; // facial uses 'arm', markings use 'arms'
    addMark(region, scarColor, scar.kind === 'glyph');
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
