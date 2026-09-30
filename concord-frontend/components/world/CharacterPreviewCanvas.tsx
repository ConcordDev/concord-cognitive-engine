'use client';

/**
 * CharacterPreviewCanvas — real Three.js live preview for CharacterCustomizer.
 *
 * Replaces the old two-<div> CSS-circle "3D Preview" placeholder with an
 * actual `@react-three/fiber` `<Canvas>` that renders the SAME procedural
 * avatar mesh builder (`buildEnhancedAvatar`) used for the local player and
 * hero NPCs in `AvatarSystem3D.tsx`. Follows the exact scene-setup pattern
 * of `components/concordia/mounts/MountPreviewCanvas.tsx` (camera, two
 * lights, a ground plane, a slow turntable) — the precedent for a small
 * standalone preview canvas in this codebase.
 *
 * The customizer collects a flat `slot -> assetId` map (see
 * `appearance.options` in `server/domains/appearance.js`), which is a
 * narrower, UI-friendly projection of the full `RichAppearanceConfig` the
 * renderer actually consumes. `appearanceFromSelections` below re-projects
 * it back onto a `RichAppearanceConfig` by layering the live selections
 * over a deterministic `generateAppearance()` base — the same "explicit
 * fields win, the hash-seeded generator fills the rest" pattern
 * `generateAppearance` itself uses for authored-vs-procedural NPCs — so an
 * unselected slot still renders something coherent instead of a broken mesh.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type * as THREE from 'three';

import { buildEnhancedAvatar } from '@/lib/world-lens/enhanced-avatar-builder';
import {
  generateAppearance,
  proportionsFor,
  type RichAppearanceConfig,
  type FacialFeatures,
  type ClothingKit,
  type Accessories,
  type ClothingTopKind,
  type ClothingBottomKind,
  type ClothingHatKind,
} from '@/lib/world-lens/character-schema';

interface Props {
  /** The customizer's live slot -> assetId selections. */
  selections: Record<string, string>;
  /** The customizer's live skin-tone hex, or '' to use the generated default. */
  skinColor: string;
}

const PREVIEW_ID = 'character-customizer-preview';

/**
 * Project the customizer's flat selections onto a full RichAppearanceConfig.
 * Pure — same inputs always produce the same appearance (generateAppearance
 * is itself deterministic on `PREVIEW_ID`).
 */
function appearanceFromSelections(
  selections: Record<string, string>,
  skinColor: string,
): RichAppearanceConfig {
  const base = generateAppearance({
    id: PREVIEW_ID,
    worldId: 'concordia-hub',
    factionId: null,
    archetype: null,
    themeId: 'concordia-hub',
  });

  const bodyArchetype = (selections.body as RichAppearanceConfig['bodyArchetype']) || base.bodyArchetype;
  const proportions = selections.body ? proportionsFor(bodyArchetype, base.totalHeight) : base.proportions;
  const hairStyle = (selections.hair as RichAppearanceConfig['hairStyle']) || base.hairStyle;

  const facial: FacialFeatures = {
    ...base.facial,
    jawShape: (selections.face as FacialFeatures['jawShape']) || base.facial.jawShape,
  };

  const clothing: ClothingKit = {
    ...base.clothing,
    top: { ...base.clothing.top, kind: (selections.top as ClothingTopKind) || base.clothing.top.kind },
    bottom: { ...base.clothing.bottom, kind: (selections.bottom as ClothingBottomKind) || base.clothing.bottom.kind },
    boots: {
      color: base.clothing.boots?.color ?? '#3a2820',
      kind: (selections.shoes as NonNullable<ClothingKit['boots']>['kind']) || base.clothing.boots?.kind || 'boot',
    },
  };

  const augments: NonNullable<Accessories['augments']> = [...(base.accessories.augments ?? [])];

  // "Glasses" is dual-purpose in the appearance.options catalog: visor/goggle
  // are real ClothingHatKind values (worn over the eyes); the eye-* options
  // are an eye-region augment material. An explicit "Hat" pick (below) wins
  // if the player also chose one, since it's the more direct signal.
  if (selections.glasses === 'visor' || selections.glasses === 'goggle') {
    clothing.hat = {
      color: base.clothing.hat?.color ?? base.clothing.top.color,
      kind: selections.glasses as ClothingHatKind,
    };
  } else if (selections.glasses?.startsWith('eye-')) {
    augments.push({ region: 'eye', material: selections.glasses.slice(4) as 'chrome' | 'matte-black' | 'gold' });
  }

  if (selections.hat) {
    clothing.hat = { color: base.clothing.hat?.color ?? base.clothing.top.color, kind: selections.hat as ClothingHatKind };
  }

  if (selections.back?.startsWith('cape-')) {
    clothing.cape = {
      color: base.clothing.cape?.color ?? base.clothing.top.color,
      pattern: selections.back.slice(5) as 'plain' | 'striped' | 'glyph',
    };
  }

  // Unlike `markings`/`augments` (below), `carry` is NOT seeded from
  // `base.accessories.carry` here — generateAppearance() can attach a
  // default item (e.g. a satchel) that reads as flavor at gameplay camera
  // distance, but has no strap/anchor geometry connecting it to the body
  // (enhanced-avatar-builder.ts positions it purely by hip offset), so up
  // close in this preview it renders as an unexplained floating box for a
  // slot ("Hand") the player hasn't touched yet. Only an explicit pick
  // populates it here — same reasoning as the armor override below.
  const carry: NonNullable<Accessories['carry']> = [];
  if (selections.hand?.startsWith('arm-')) {
    augments.push({ region: 'left-arm', material: selections.hand.slice(4) as 'chrome' | 'matte-black' | 'gold' });
  } else if (selections.hand) {
    const item = selections.hand as NonNullable<Accessories['carry']>[number];
    if (!carry.includes(item)) carry.unshift(item);
  }

  const markings: Accessories['markings'] = [...base.accessories.markings];
  if (selections.particle) {
    markings.push({
      kind: selections.particle as Accessories['markings'][number]['kind'],
      region: 'face',
      color: base.clothing.top.color,
    });
  }

  return {
    ...base,
    bodyArchetype,
    proportions,
    hairStyle,
    skinColor: skinColor || base.skinColor,
    facial,
    clothing,
    accessories: { ...base.accessories, augments, carry, markings },
    // The customizer has no "Armor" slot (its tabs are Body/Hair/Face/Top/
    // Bottom/Shoes/Hat/Glasses/Back/Hand/Particle) — generateAppearance()
    // still assigns every character a deterministic procedural armor kit
    // (armor-system.ts's createArmorSet), which would render gear the
    // player never chose and can't see reflected in any control here.
    // Worse, that kit's per-slot anchor points (armorAnchorY in
    // enhanced-avatar-builder.ts) are tuned for in-world viewing distance,
    // not this canvas's tight close-up framing — at this range the vest/
    // sleeve/boot pieces visibly float clear of the body they're meant to
    // sit on. 'exposed' is the one silhouette every build* function in
    // armor-system.ts treats as "render nothing" (or, for torso, a single
    // thin harness strap) — the closest this schema has to "no armor
    // layer," so the preview shows exactly the body the player is
    // actually customizing.
    armor: { ...base.armor, silhouette: 'exposed' },
  };
}

/** Builds the enhanced-avatar group for the given appearance, rebuilding
 *  (and disposing the previous group) whenever the appearance changes; ticks
 *  the eye-parallax shader and slowly turntables so the preview reads as a
 *  living render, not a static snapshot. */
function AnimatedAvatar({ appearance }: { appearance: RichAppearanceConfig }) {
  const groupRef = useRef<THREE.Group>(null);
  const avatar = useMemo(
    () => buildEnhancedAvatar(appearance, { isLocalPlayer: true }),
    [appearance],
  );

  useEffect(() => {
    return () => avatar.dispose();
  }, [avatar]);

  useFrame((_, dt) => {
    avatar.tickEyes(dt);
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.4;
  });

  return <primitive ref={groupRef} object={avatar.group} position={[0, -1.2, 0]} dispose={null} />;
}

export default function CharacterPreviewCanvas({ selections, skinColor }: Props) {
  const appearance = useMemo(
    () => appearanceFromSelections(selections, skinColor),
    [selections, skinColor],
  );

  return (
    <Canvas
      camera={{ position: [0, 0.2, 2.9], fov: 34 }}
      shadows={false}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Ambient + a single keylight; this is preview-grade, not in-game. */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 4]} intensity={0.9} />
      {/* Ground plane so the character has something to stand on. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#141414" roughness={0.95} />
      </mesh>
      <gridHelper args={[6, 6, '#262626', '#1c1c1c']} position={[0, -1.19, 0]} />

      <AnimatedAvatar appearance={appearance} />
    </Canvas>
  );
}
