'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  maybeUpdateMode,
  buildContext,
  type NearbyEntity,
  type ZoneType,
} from '@/lib/concordia/context-detection';
import {
  type CharacterPhysicsProfile,
  defaultProfile,
  computeMoveSpeed,
  computeMomentumOvershoot,
  drainStamina,
  recoverStamina,
  isExhausted,
} from '@/lib/concordia/character-physics';
import {
  type MovementStyle,
  MOVEMENT_STYLE_CONFIGS,
  lerpStyleConfigs,
  resolveNPCStyle,
} from '@/lib/concordia/movement-styles';
import {
  synthesizeGait,
  synthesizeIdle,
  advanceGaitPhase,
  applyGaitPose,
  breathingChestScaleY,
  breathPhaseFromId,
  type GaitParams,
  type BodyType,
} from '@/lib/concordia/gait-synthesis';
import {
  buildLeftLegChain,
  buildRightLegChain,
  solveFABRIK,
  applyFABRIKToSkeleton,
} from '@/lib/concordia/fabrik-ik';
import {
  computeCenterOfMass,
  computeBalanceAdjustment,
  getFootPositions,
  applyBalanceAdjustment,
} from '@/lib/concordia/com-balance';
import { SecondaryPhysicsManager, buildHairChain } from '@/lib/concordia/secondary-physics';
import { cameraLookState } from '@/lib/world-lens/camera-look-state';
import { FacialController, resolveNPCEmotion } from '@/lib/concordia/facial-blend-shapes';
import { installMoodListener, emotionFor, biasFor } from '@/lib/concordia/mood-registry';
import { getClientConfigSync } from '@/hooks/useClientConfig';
import { physicsWorld } from '@/lib/world-lens/physics-world';
import { sampleGroundY, outOfBounds } from '@/lib/world-lens/coord-frame';
import { accelToward } from '@/lib/world-lens/jump-forgiveness';
import { applyCelShade } from '@/lib/world-lens/cel-shade';
import { ART_STYLE } from '@/lib/world-lens/concordia-theme';
import { getTimeScale, getPlayerTimeScale } from '@/lib/concordia/use-time-scale';
// Phase AA2 — gait synthesis off-thread via Web Worker. Falls back to
// inline synthesizeGait when the worker isn't ready (boot warmup) or
// has failed (e.g. SSR / locked-down browser).
import { useAvatarAnimator } from '@/hooks/useAvatarAnimator';
import { useAvatarScars } from '@/hooks/useAvatarScars';
import { serializableToGaitPose } from '@/lib/concordia/animator-protocol';

// ── Types ──────────────────────────────────────────────────────────

export interface AppearanceConfig {
  skinColor: string; // hex color
  hairColor: string;
  hairStyle: 'short' | 'medium' | 'long' | 'bald' | 'ponytail' | 'bun';
  bodyType: 'slim' | 'average' | 'stocky' | 'tall' | 'legend';
  clothing: {
    top: { color: string; type: 'shirt' | 'vest' | 'coat' | 'robe' | 'apron' };
    bottom: { color: string; type: 'pants' | 'skirt' | 'shorts' | 'robe' };
    hat?: { color: string; type: 'cap' | 'tophat' | 'beret' | 'hood' | 'helmet' };
  };
}

export type AnimationClip =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sit'
  | 'build'
  | 'inspect'
  | 'wave'
  | 'clap'
  // Hit-reaction clips (Phase 4) — short, crossfade in over 80ms,
  // crossfade back to prior clip after their fixed duration.
  | 'flinch_chest'
  | 'flinch_head'
  | 'stagger_left'
  | 'stagger_right'
  | 'block_impact'
  | 'crit_recoil'
  // Death (Phase 5) — 1.5s buckle + fall-forward, then settle prone.
  // Followed externally by 6.5s opacity fade and mesh disposal.
  | 'death_collapse'
  | 'point'
  | 'celebrate'
  | 'craft';

export type NPCOccupationAnimation =
  | 'hammer'
  | 'read'
  | 'tend-crops'
  | 'patrol'
  | 'count-coins'
  | 'construct'
  | 'sweep'
  | 'lecture';

export interface PlayerAvatarConfig {
  id: string;
  name: string;
  appearance: AppearanceConfig;
  position: { x: number; y: number; z: number };
  rotation: number; // Y-axis rotation in radians
  currentAnimation: AnimationClip;
  profession?: string;
  firmEmblem?: string;
}

export interface OtherPlayerData {
  id: string;
  name: string;
  appearance: AppearanceConfig;
  position: { x: number; y: number; z: number };
  rotation: number;
  currentAnimation: AnimationClip;
  profession?: string;
  firmEmblem?: string;
  /** Server timestamp for interpolation */
  timestamp: number;
}

export interface NPCData {
  id: string;
  name: string;
  appearance: AppearanceConfig;
  position: { x: number; y: number; z: number };
  rotation: number;
  occupation: string;
  occupationAnimation: NPCOccupationAnimation;
  patrolPath?: { x: number; y: number; z: number }[];
  /** Server timestamp */
  timestamp: number;
}

interface AvatarSystem3DProps {
  playerAvatar: PlayerAvatarConfig;
  otherPlayers: OtherPlayerData[];
  npcs: NPCData[];
  movementStyle?: MovementStyle;
  physicsProfile?: Partial<CharacterPhysicsProfile>;
  onMove?: (position: { x: number; y: number; z: number }, rotation: number) => void;
  onEmote?: (emote: AnimationClip) => void;
  onStaminaChange?: (stamina: number, max: number) => void;
  weatherModifiers?: import('@/lib/world-lens/world-deformation').WeatherPhysicsModifiers;
  quality?: import('@/components/world-lens/ConcordiaScene').QualityPreset;
  /** When 'first-person', hide the local player's mesh so the camera doesn't render the back of their own head. */
  cameraMode?: 'isometric' | 'follow' | 'first-person' | 'free' | 'interior' | 'cinematic';
}

// ── Constants ─────────────────────────────────────────────────────

const MAX_FULLY_ANIMATED = 50;
const MOVE_SPEED = 5.0; // m/s walking
const RUN_SPEED = 12.0; // m/s running
const ROTATION_SPEED = 8.0; // rad/s smooth rotation
const INTERPOLATION_RATE = 10; // Other players update at 10Hz
const NPC_UPDATE_RATE = 2; // NPCs update at 2Hz
const SLOPE_MAX_ANGLE = 45; // Maximum climbable slope in degrees
const STAIR_STEP_HEIGHT = 0.5; // Max step-up height in meters

/** Bone hierarchy for procedural avatar skeleton */
const BONE_HIERARCHY = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftForearm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightForearm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
] as const;

// ── Body dimension presets ───────────────────────────────────────

const BODY_DIMENSIONS: Record<
  AppearanceConfig['bodyType'],
  {
    torsoWidth: number;
    torsoHeight: number;
    torsoDepth: number;
    limbRadius: number;
    headRadius: number;
    legLength: number;
    armLength: number;
    totalHeight: number;
  }
> = {
  slim: {
    torsoWidth: 0.35,
    torsoHeight: 0.55,
    torsoDepth: 0.2,
    limbRadius: 0.06,
    headRadius: 0.14,
    legLength: 0.8,
    armLength: 0.6,
    totalHeight: 1.75,
  },
  average: {
    torsoWidth: 0.4,
    torsoHeight: 0.55,
    torsoDepth: 0.25,
    limbRadius: 0.07,
    headRadius: 0.15,
    legLength: 0.8,
    armLength: 0.6,
    totalHeight: 1.75,
  },
  stocky: {
    torsoWidth: 0.5,
    torsoHeight: 0.5,
    torsoDepth: 0.3,
    limbRadius: 0.09,
    headRadius: 0.15,
    legLength: 0.75,
    armLength: 0.55,
    totalHeight: 1.65,
  },
  tall: {
    torsoWidth: 0.4,
    torsoHeight: 0.6,
    torsoDepth: 0.25,
    limbRadius: 0.07,
    headRadius: 0.15,
    legLength: 0.9,
    armLength: 0.7,
    totalHeight: 1.9,
  },
  // Sprint B.6 — `legend` body type for the immortal NPCs
  // (concordia_first_breath, sovereign_first_refusal, concord_first_thought,
  // weaver_of_echoes). 1.5× scale of `tall`. Paired with emissive
  // material in createAvatarMesh below so legends visibly stand out
  // without breaking the polished-Skyrim art direction. Authored
  // NPCs with archetype === 'legend' are mapped to this body type
  // via _mapNPCToAvatarData in app/lenses/world/page.tsx.
  legend: {
    torsoWidth: 0.6,    // 1.5× of tall
    torsoHeight: 0.9,   // 1.5×
    torsoDepth: 0.375,  // 1.5×
    limbRadius: 0.105,  // 1.5×
    headRadius: 0.225,  // 1.5×
    legLength: 1.35,    // 1.5×
    armLength: 1.05,    // 1.5×
    totalHeight: 2.85,  // 1.5×
  },
};

// ── Suppress unused constant warnings ────────────────────────────
void SLOPE_MAX_ANGLE;
void STAIR_STEP_HEIGHT;

// ── Component ────────────────────────────────────────────────────

export default function AvatarSystem3D({
  playerAvatar,
  otherPlayers,
  npcs,
  movementStyle = 'warrior',
  physicsProfile: physicsPropOverride,
  onMove,
  onEmote,
  onStaminaChange,
  weatherModifiers,
  quality = 'medium',
  cameraMode = 'follow',
}: AvatarSystem3DProps) {
  const avatarGroupRef = useRef<unknown>(null);
  const playerMeshRef = useRef<unknown>(null);
  // I2 — player weapon-trail ribbon (lazily created in the frame loop) +
  // reusable tip vector to avoid per-frame allocation.
  const weaponTrailRef = useRef<import('@/lib/world-lens/weapon-trail').WeaponTrailAPI | null>(null);
  const weaponTipVecRef = useRef<unknown>(null);
  // Phase A1 sidecars for enhanced-avatar-builder. Re-using the
  // existing facialControllersRef declared further down (line ~324).
  // These two are new — per-frame eye tickers and enhanced-disposers.
  const eyeTickersRef = useRef<Map<string, (dt: number) => void>>(new Map());
  const enhancedDisposeRef = useRef<Map<string, () => void>>(new Map());

  // Phase AA2 — Web Worker for gait synthesis. The hook spawns one
  // worker for the lifetime of this component; per-frame requestGait
  // posts params and reads back the latest-resolved pose. Fallback to
  // inline synthesizeGait happens automatically when the worker isn't
  // ready or has failed (the hook returns null).
  const avatarAnimator = useAvatarAnimator();
  // Phase BA5 — scars + drift feed the avatar renderer. `scars` maps
  // onto bone regions via THREE.DecalGeometry; `drift` modulates the
  // `u_wear` uniform on the avatar material (0 = pristine, 1 = grimy).
  // The decal application lives in the per-frame render block; here we
  // surface the values via a ref so deeper render code can read them
  // without making them React-stateful.
  const { scars: avatarScars, drift: avatarDrift } = useAvatarScars(playerAvatar?.id);
  const wearUniformRef = useRef<{ u_wear: number; scars: typeof avatarScars }>({ u_wear: 0, scars: [] });
  useEffect(() => {
    wearUniformRef.current = { u_wear: avatarDrift, scars: avatarScars };
  }, [avatarDrift, avatarScars]);
  // Phase B3 — flight-physics shadow state. Initialised when player
  // enters glide; ticked per frame; emitted as `concordia:flight-state`
  // so HUD / camera systems can read it.
  const flightStateRef = useRef<{ airspeed: number; heading: number; rollRad: number; pitchRad: number; vy: number; stalled: boolean; stallTimerMs: number } | null>(null);

  // Hide own avatar mesh in first-person so the camera doesn't see the
  // back of its own head. Effect runs whenever cameraMode flips.
  useEffect(() => {
    const m = playerMeshRef.current as { visible: boolean } | null;
    if (m) m.visible = cameraMode !== 'first-person';
  }, [cameraMode]);
  const mixersRef = useRef<Map<string, unknown>>(new Map());
  // Phase 5: tick fn for the per-frame opacity fade on dying meshes;
  // hoisted to a ref so the existing game-loop block can invoke it.
  const deathFadeTickRef = useRef<(() => void) | null>(null);
  // Tier 2 deferral 10: per-frame tick for all active ragdolls.
  const ragdollTickRef = useRef<(() => void) | null>(null);
  // Theme 5 (game-feel pass): hit-pause window per entity. While
  // performance.now() < entry, the entity's mixer freezes (delta=0).
  const hitPauseUntilRef = useRef<Map<string, number>>(new Map());
  const keysRef = useRef<Set<string>>(new Set());
  // B2 — smoothed planar input (accel/decel curve), so direction changes ease.
  const planarMoveRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const playerPositionRef = useRef({ ...playerAvatar.position });
  // Last known-good standing position — the snapback target when the player
  // goes out of bounds / falls through / hits a NaN (G1/G2). Seeded to spawn.
  const lastGroundedPosRef = useRef({ ...playerAvatar.position });
  const playerRotationRef = useRef(playerAvatar.rotation);
  // B1b — double-tap dash memory (traversal dodge).
  const dashTapRef = useRef<{ key: string; t: number }>({ key: '', t: 0 });
  // B4 — action chaining queue (lazy-constructed).
  const actionQueueRef = useRef<import('@/lib/concordia/action-queue').ActionQueue | null>(null);
  const [activeAnimation, setActiveAnimation] = useState<AnimationClip>(
    playerAvatar.currentAnimation
  );

  // Character physics + movement style refs (updated each prop change)
  const physicsRef = useRef<CharacterPhysicsProfile>({
    ...defaultProfile(),
    ...physicsPropOverride,
  });
  const styleRef = useRef<MovementStyle>(movementStyle);
  const styleBlendRef = useRef({ current: movementStyle, target: movementStyle, t: 1.0 });
  // Tracks stride phase in [0,1) — advances by distance covered, not elapsed time.
  // This prevents leg sliding: at any speed the feet track real ground displacement.
  const stridePhaseRef = useRef(0);
  // Terrain elevation sampler — set when concordia:terrain-ready fires
  const elevationRef = useRef<((x: number, z: number) => number) | null>(null);

  // Secondary physics + facial controllers
  const secondaryPhysicsRef = useRef<SecondaryPhysicsManager | null>(null);
  const facialControllersRef = useRef<Map<string, FacialController>>(new Map());

  // Phase L — NPC appearance hydration. On world change, fetch
  // appearance.for_world and cache per-NPC hints (faction visual +
  // appearance prose + heroMesh flag) so createAvatarMeshSmart picks
  // them up. Stored in a window-level cache because the NPC mesh
  // creation happens inside an async loop the React state doesn't
  // own directly.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const worldId = (window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub');
    fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'appearance', name: 'for_world', input: { worldId, limit: 300 } }),
    }).then((r) => r.json()).then((j) => {
      if (cancelled) return;
      const list = j?.result?.npcs;
      if (!Array.isArray(list)) return;
      const cache = (window as { __CONCORD_NPC_APPEARANCE_CACHE__?: Map<string, unknown> }).__CONCORD_NPC_APPEARANCE_CACHE__ || new Map();
      for (const hint of list) {
        const h = hint as { npcId: string };
        cache.set(h.npcId, hint);
      }
      (window as { __CONCORD_NPC_APPEARANCE_CACHE__?: Map<string, unknown> }).__CONCORD_NPC_APPEARANCE_CACHE__ = cache;
    }).catch(() => { /* hydration optional */ });
    return () => { cancelled = true; };
  }, []);

  // Phase B4 — lip-sync listener. DialoguePanel emits
  // `concordia:lip-sync` { npcId, text, wpm } when an NPC speaks; this
  // hook builds the phoneme schedule and drives the matching
  // FacialController.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stops = new Map<string, () => void>();
    async function onLipSync(e: Event) {
      const detail = (e as CustomEvent).detail as { npcId?: string; text?: string; wpm?: number } | undefined;
      if (!detail?.npcId || !detail.text) return;
      const ctrl = facialControllersRef.current.get(detail.npcId);
      if (!ctrl) return;
      try {
        const m = await import('@/lib/concordia/lip-sync');
        const sched = m.buildLipSyncSchedule(detail.text, { wpm: detail.wpm ?? 180 });
        // Stop prior driver for this npc.
        stops.get(detail.npcId)?.();
        // Cast: lip-sync uses a structural FacialController shape with
        // an optional setMorphTarget; facial-blend-shapes class is
        // assignable structurally even though the nominal types differ.
        const stop = m.drivePhonemes(ctrl as unknown as Parameters<typeof m.drivePhonemes>[0], sched);
        stops.set(detail.npcId, stop);
      } catch { /* lip-sync optional */ }
    }
    window.addEventListener('concordia:lip-sync', onLipSync);
    return () => {
      window.removeEventListener('concordia:lip-sync', onLipSync);
      for (const stop of stops.values()) {
        try { stop(); } catch { /* noop */ }
      }
    };
  }, []);

  // Keep weather modifiers ref in sync so the game loop closure sees latest value
  const weatherModifiersRef = useRef(weatherModifiers);
  useEffect(() => {
    weatherModifiersRef.current = weatherModifiers;
  }, [weatherModifiers]);

  // Keep refs in sync with props
  useEffect(() => {
    physicsRef.current = { ...defaultProfile(), ...physicsPropOverride };
  }, [physicsPropOverride]);
  useEffect(() => {
    const sb = styleBlendRef.current;
    if (movementStyle !== sb.target) {
      sb.current = sb.target;
      sb.target = movementStyle;
      sb.t = 0;
    }
    styleRef.current = movementStyle;
  }, [movementStyle]);

  // Listen for terrain elevation function
  useEffect(() => {
    function onTerrainReady(e: Event) {
      const { getElevationAt } = (e as CustomEvent).detail ?? {};
      if (typeof getElevationAt === 'function') elevationRef.current = getElevationAt;
    }
    window.addEventListener('concordia:terrain-ready', onTerrainReady);
    return () => window.removeEventListener('concordia:terrain-ready', onTerrainReady);
  }, []);

  // Fast-travel: WorldAdventureKitPanel resolves a marker server-side and
  // dispatches world:fast-travel with the destination { x, y, z }. Teleport the
  // player avatar there — physics body + logical position + mesh, all in sync —
  // so the marker's "Travel" button actually moves the player (was an orphaned
  // event that did nothing).
  useEffect(() => {
    function onFastTravel(e: Event) {
      const d = (e as CustomEvent).detail as { x?: number; y?: number; z?: number } | undefined;
      if (!d || typeof d.x !== 'number' || typeof d.z !== 'number') return;
      const y = typeof d.y === 'number' ? d.y : playerPositionRef.current.y;
      physicsWorld.teleportCharacter('player', { x: d.x, y, z: d.z });
      playerPositionRef.current.x = d.x;
      playerPositionRef.current.y = y;
      playerPositionRef.current.z = d.z;
      const mesh = playerMeshRef.current as { position?: { set: (x: number, y: number, z: number) => void } } | null;
      mesh?.position?.set(d.x, y, d.z);
    }
    window.addEventListener('world:fast-travel', onFastTravel);
    return () => window.removeEventListener('world:fast-travel', onFastTravel);
  }, []);

  // Suppress unused warning for onEmote
  void onEmote;

  // ── Procedural avatar mesh generation ─────────────────────────

  const createAvatarMesh = useCallback(
    async (appearance: AppearanceConfig, THREE: typeof import('three')) => {
      const group = new THREE.Group();
      const dims = BODY_DIMENSIONS[appearance.bodyType];
      const skinColor = new THREE.Color(appearance.skinColor);
      const hairColor = new THREE.Color(appearance.hairColor);
      const topColor = new THREE.Color(appearance.clothing.top.color);
      const bottomColor = new THREE.Color(appearance.clothing.bottom.color);

      // ── Skeleton (bone hierarchy) ─────────────────────────────
      const bones: InstanceType<typeof import('three').Bone>[] = [];
      const boneMap = new Map<string, InstanceType<typeof import('three').Bone>>();

      for (const boneName of BONE_HIERARCHY) {
        const bone = new THREE.Bone();
        bone.name = boneName;
        bones.push(bone);
        boneMap.set(boneName, bone);
      }

      // Set up parent-child relationships
      const parentMap: Record<string, string> = {
        spine: 'hips',
        chest: 'spine',
        neck: 'chest',
        head: 'neck',
        leftShoulder: 'chest',
        leftUpperArm: 'leftShoulder',
        leftForearm: 'leftUpperArm',
        leftHand: 'leftForearm',
        rightShoulder: 'chest',
        rightUpperArm: 'rightShoulder',
        rightForearm: 'rightUpperArm',
        rightHand: 'rightForearm',
        leftUpperLeg: 'hips',
        leftLowerLeg: 'leftUpperLeg',
        leftFoot: 'leftLowerLeg',
        rightUpperLeg: 'hips',
        rightLowerLeg: 'rightUpperLeg',
        rightFoot: 'rightLowerLeg',
      };

      for (const [child, parent] of Object.entries(parentMap)) {
        const parentBone = boneMap.get(parent);
        const childBone = boneMap.get(child);
        if (parentBone && childBone) parentBone.add(childBone);
      }

      // Position bones
      const hipsBone = boneMap.get('hips')!;
      hipsBone.position.y = dims.legLength;
      boneMap.get('spine')!.position.y = 0.15;
      boneMap.get('chest')!.position.y = 0.2;
      boneMap.get('neck')!.position.y = dims.torsoHeight * 0.4;
      boneMap.get('head')!.position.y = 0.1;
      boneMap.get('leftShoulder')!.position.set(-dims.torsoWidth / 2, dims.torsoHeight * 0.3, 0);
      boneMap.get('rightShoulder')!.position.set(dims.torsoWidth / 2, dims.torsoHeight * 0.3, 0);
      boneMap.get('leftUpperArm')!.position.set(-0.05, 0, 0);
      boneMap.get('rightUpperArm')!.position.set(0.05, 0, 0);
      boneMap.get('leftForearm')!.position.y = -dims.armLength * 0.5;
      boneMap.get('rightForearm')!.position.y = -dims.armLength * 0.5;
      boneMap.get('leftHand')!.position.y = -dims.armLength * 0.5;
      boneMap.get('rightHand')!.position.y = -dims.armLength * 0.5;
      boneMap.get('leftUpperLeg')!.position.set(-0.1, 0, 0);
      boneMap.get('rightUpperLeg')!.position.set(0.1, 0, 0);
      boneMap.get('leftLowerLeg')!.position.y = -dims.legLength * 0.5;
      boneMap.get('rightLowerLeg')!.position.y = -dims.legLength * 0.5;
      boneMap.get('leftFoot')!.position.y = -dims.legLength * 0.5;
      boneMap.get('rightFoot')!.position.y = -dims.legLength * 0.5;

      const skeleton = new THREE.Skeleton(bones);

      // ── Body parts (simple geometry) ─────────────────────────
      // Sprint B.6 — `legend` body type gets emissive material so
      // immortal NPCs (the goddess Concordia, the Sovereign, the
      // first Concord, the Weaver of Echoes) read as numinous at a
      // glance. The base color is unchanged (skin/cloth still come
      // from the AppearanceConfig); we add an emissive component +
      // halve roughness so they catch reflection. Keeps the unified
      // mesh pipeline — no special legend-only renderer.
      const isLegend = appearance.bodyType === 'legend';
      const skinMat = new THREE.MeshStandardMaterial({
        color: skinColor,
        roughness: isLegend ? 0.4 : 0.8,
        emissive: isLegend ? new THREE.Color(skinColor) : new THREE.Color(0x000000),
        emissiveIntensity: isLegend ? 0.25 : 0,
      });
      const clothTopMat = new THREE.MeshStandardMaterial({
        color: topColor,
        roughness: isLegend ? 0.35 : 0.7,
        emissive: isLegend ? new THREE.Color(topColor) : new THREE.Color(0x000000),
        emissiveIntensity: isLegend ? 0.35 : 0,
      });
      const clothBottomMat = new THREE.MeshStandardMaterial({
        color: bottomColor,
        roughness: isLegend ? 0.35 : 0.7,
        emissive: isLegend ? new THREE.Color(bottomColor) : new THREE.Color(0x000000),
        emissiveIntensity: isLegend ? 0.35 : 0,
      });

      // Head
      const headGeom = new THREE.SphereGeometry(dims.headRadius, 16, 12);
      const head = new THREE.Mesh(headGeom, skinMat);
      head.position.y = dims.legLength + dims.torsoHeight + 0.1 + dims.headRadius;
      head.castShadow = true;
      group.add(head);

      // Hair
      if (appearance.hairStyle !== 'bald') {
        const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9 });
        let hairGeom: InstanceType<typeof import('three').BufferGeometry>;
        switch (appearance.hairStyle) {
          case 'short':
            hairGeom = new THREE.SphereGeometry(
              dims.headRadius * 1.05,
              16,
              8,
              0,
              Math.PI * 2,
              0,
              Math.PI * 0.6
            );
            break;
          case 'medium':
            hairGeom = new THREE.SphereGeometry(
              dims.headRadius * 1.1,
              16,
              12,
              0,
              Math.PI * 2,
              0,
              Math.PI * 0.7
            );
            break;
          case 'long':
            hairGeom = new THREE.CylinderGeometry(
              dims.headRadius * 0.5,
              dims.headRadius * 0.3,
              0.4,
              12
            );
            break;
          case 'ponytail':
            hairGeom = new THREE.CylinderGeometry(0.03, 0.02, 0.3, 8);
            break;
          case 'bun':
            hairGeom = new THREE.SphereGeometry(dims.headRadius * 0.4, 12, 8);
            break;
          default:
            hairGeom = new THREE.SphereGeometry(dims.headRadius * 1.05, 16, 8);
        }
        const hair = new THREE.Mesh(hairGeom as THREE.BufferGeometry, hairMat);
        hair.position.copy(head.position);
        hair.position.y += dims.headRadius * 0.3;
        if (appearance.hairStyle === 'ponytail') {
          hair.position.z = -dims.headRadius * 0.8;
          hair.position.y -= dims.headRadius * 0.2;
        } else if (appearance.hairStyle === 'bun') {
          hair.position.z = -dims.headRadius * 0.7;
          hair.position.y += dims.headRadius * 0.1;
        }
        group.add(hair);
      }

      // Torso
      const torsoGeom = new THREE.BoxGeometry(dims.torsoWidth, dims.torsoHeight, dims.torsoDepth);
      const torso = new THREE.Mesh(torsoGeom, clothTopMat);
      torso.position.y = dims.legLength + dims.torsoHeight / 2;
      torso.castShadow = true;
      group.add(torso);

      // Arms
      const armGeom = new THREE.CylinderGeometry(
        dims.limbRadius,
        dims.limbRadius * 0.8,
        dims.armLength,
        8
      );
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(armGeom, skinMat);
        arm.position.set(
          side * (dims.torsoWidth / 2 + dims.limbRadius),
          dims.legLength + dims.torsoHeight - dims.armLength / 2,
          0
        );
        arm.castShadow = true;
        group.add(arm);
      }

      // Legs
      const legGeom = new THREE.CylinderGeometry(
        dims.limbRadius * 1.1,
        dims.limbRadius * 0.9,
        dims.legLength,
        8
      );
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(legGeom, clothBottomMat);
        leg.position.set(side * 0.1, dims.legLength / 2, 0);
        leg.castShadow = true;
        group.add(leg);
      }

      // Hat (optional)
      if (appearance.clothing.hat) {
        const hatColor = new THREE.Color(appearance.clothing.hat.color);
        const hatMat = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.6 });
        let hatMesh: InstanceType<typeof import('three').Mesh>;
        switch (appearance.clothing.hat.type) {
          case 'tophat': {
            const hatGeom = new THREE.CylinderGeometry(
              dims.headRadius * 0.7,
              dims.headRadius * 0.7,
              0.3,
              12
            );
            hatMesh = new THREE.Mesh(hatGeom, hatMat);
            hatMesh.position.y = head.position.y + dims.headRadius + 0.15;
            break;
          }
          case 'beret': {
            const hatGeom = new THREE.SphereGeometry(
              dims.headRadius * 0.8,
              12,
              6,
              0,
              Math.PI * 2,
              0,
              Math.PI * 0.4
            );
            hatMesh = new THREE.Mesh(hatGeom, hatMat);
            hatMesh.position.y = head.position.y + dims.headRadius * 0.8;
            break;
          }
          case 'helmet': {
            const hatGeom = new THREE.SphereGeometry(
              dims.headRadius * 1.15,
              16,
              10,
              0,
              Math.PI * 2,
              0,
              Math.PI * 0.6
            );
            hatMesh = new THREE.Mesh(hatGeom, hatMat);
            hatMesh.position.y = head.position.y + dims.headRadius * 0.2;
            break;
          }
          case 'hood': {
            const hatGeom = new THREE.ConeGeometry(dims.headRadius * 1.0, 0.25, 12);
            hatMesh = new THREE.Mesh(hatGeom, hatMat);
            hatMesh.position.y = head.position.y + dims.headRadius + 0.1;
            break;
          }
          default: {
            const hatGeom = new THREE.CylinderGeometry(
              dims.headRadius * 0.9,
              dims.headRadius * 1.1,
              0.1,
              16
            );
            hatMesh = new THREE.Mesh(hatGeom, hatMat);
            hatMesh.position.y = head.position.y + dims.headRadius;
          }
        }
        hatMesh.castShadow = true;
        group.add(hatMesh);
      }

      // Store skeleton reference for animation
      group.userData.skeleton = skeleton;
      group.userData.boneMap = boneMap;

      // I1 — cel-shade + ink-outline the crowd primitive so it reads as
      // illustrated, matching the buildings' toon gradient. Opt-out via
      // window.__CONCORD_CEL_SHADE__ = false.
      try {
        if ((window as unknown as { __CONCORD_CEL_SHADE__?: boolean }).__CONCORD_CEL_SHADE__ !== false) {
          // Share the global outline weight so crowd + hero silhouettes read alike.
          applyCelShade(group, THREE, { outlineScale: 1 + ART_STYLE.OUTLINE_WIDTH_M * 3 });
        }
      } catch { /* cel-shade best-effort — never block mesh creation */ }

      return group;
    },
    []
  );

  // Phase A1: smart wrapper — enhanced builder for local player + hero
  // NPCs, legacy primitive path for crowd. Stores FacialController +
  // tickEyes + dispose in sidecar refs so the per-frame loop + dispose
  // path can find them by avatar id.
  const createAvatarMeshSmart = useCallback(
    async (
      avatarId: string,
      appearance: AppearanceConfig,
      THREE: typeof import('three'),
      opts: {
        isLocalPlayer?: boolean;
        isHero?: boolean;
        worldId?: string;
        factionId?: string | null;
        archetype?: string | null;
      } = {},
    ): Promise<InstanceType<typeof import('three').Group>> => {
      // Phase A5 — Three Above All get the imperative GoddessGroup
      // factory which mirrors the R3F GoddessAvatar3D look (robe +
      // head + halo + mood-tinted point light + bob + drift) inside
      // the imperative scene. Drives per-frame tick from the eye
      // ticker registry so existing frame loop already calls it.
      const GODDESS_IDS = new Set(['sovereign_first_refusal', 'concord_first_thought', 'concordia_first_breath']);
      if (GODDESS_IDS.has(avatarId)) {
        try {
          const { createGoddessGroup } = await import('@/components/concordia/GoddessAvatar3D');
          const goddess = createGoddessGroup(THREE, { ecosystemScore: 0.5 });
          // Re-use the eye-ticker registry to drive per-frame tick.
          eyeTickersRef.current.set(avatarId, (dt) => goddess.tick(dt));
          enhancedDisposeRef.current.set(avatarId, goddess.dispose);
          goddess.group.userData = { ...goddess.group.userData, isGoddess: true, npcId: avatarId, setEcosystemScore: goddess.setEcosystemScore, setTargetYaw: goddess.setTargetYaw };
          return goddess.group as InstanceType<typeof import('three').Group>;
        } catch (err) {
          if (typeof console !== 'undefined') console.warn('[AvatarSystem3D] goddess group build failed, falling back', err);
        }
      }

      const wantEnhanced =
        opts.isLocalPlayer || opts.isHero || appearance.bodyType === 'legend';
      if (wantEnhanced) {
        // Phase S — try the baked GLB path first for hero NPCs. The
        // home-world archetype carries an NPC's visual identity
        // across cross-world travel (Phase T): a courier from
        // concord-link-frontier still looks like a concord-link
        // courier when visiting concordia-hub.
        if (opts.isHero && !opts.isLocalPlayer) {
          try {
            const heroMod = await import('@/lib/concordia/hero-mesh-registry');
            const cache = (typeof window !== 'undefined' ? (window as { __CONCORD_NPC_APPEARANCE_CACHE__?: Map<string, unknown> }).__CONCORD_NPC_APPEARANCE_CACHE__ : null);
            const heroHint = cache?.get(avatarId) as { homeWorldId?: string; archetype?: string } | undefined;
            const archetype = opts.archetype ?? heroHint?.archetype ?? 'warrior';
            const homeWorld = heroHint?.homeWorldId ?? opts.worldId;
            const loaded = await heroMod.loadHeroMesh(avatarId, archetype, homeWorld);
            if (loaded?.group) {
              return loaded.group as InstanceType<typeof import('three').Group>;
            }
          } catch (err) {
            if (typeof console !== 'undefined') {
              console.warn('[AvatarSystem3D] hero GLB load failed, falling back to procedural', err);
            }
          }
        }
        try {
          const [{ buildEnhancedAvatar }, schemaMod] = await Promise.all([
            import('@/lib/world-lens/enhanced-avatar-builder'),
            import('@/lib/world-lens/character-schema'),
          ]);
          // Phase L — pull hydrated hints from the world-load cache.
          const cache = (typeof window !== 'undefined' ? (window as { __CONCORD_NPC_APPEARANCE_CACHE__?: Map<string, unknown> }).__CONCORD_NPC_APPEARANCE_CACHE__ : null);
          const hint = cache?.get(avatarId) as {
            factionVisual?: { primary_color?: string; secondary_color?: string; accent_color?: string };
            appearanceText?: string;
            heroMesh?: boolean;
            factionId?: string;
            archetype?: string;
          } | undefined;
          const rich = schemaMod.generateAppearance({
            id: avatarId,
            worldId: opts.worldId || 'concordia-hub',
            factionId: opts.factionId ?? hint?.factionId ?? null,
            archetype: opts.archetype ?? hint?.archetype ?? null,
            themeId: 'concordia-hub',
            heroMesh: opts.isHero || !!hint?.heroMesh,
            factionVisual: hint?.factionVisual ?? null,
            npcAppearanceText: hint?.appearanceText ?? null,
            override: {
              skinColor: appearance.skinColor,
              hairColor: appearance.hairColor,
            },
          });
          const result = buildEnhancedAvatar(rich, { isLocalPlayer: opts.isLocalPlayer });
          // Track 2 — full-toon coherence: the crowd primitive is already cel-shaded
          // (above); enhanced hero/player avatars stay PBR by default to keep their
          // SSS skin + wear detail. Opt INTO matching toon (so heroes share the
          // world's outline weight + ramp) via window.__CONCORD_HERO_CEL_SHADE__ =
          // true — the chair A/Bs full-toon before it becomes the default. Reads the
          // global ART_STYLE outline weight so it can't drift from the crowd.
          try {
            if ((window as unknown as { __CONCORD_HERO_CEL_SHADE__?: boolean }).__CONCORD_HERO_CEL_SHADE__ === true) {
              applyCelShade(result.group as unknown as Parameters<typeof applyCelShade>[0], THREE, {
                outlineScale: 1 + ART_STYLE.OUTLINE_WIDTH_M * 3,
              });
            }
          } catch { /* cel-shade best-effort — never block the hero build */ }
          facialControllersRef.current.set(avatarId, result.facial);
          eyeTickersRef.current.set(avatarId, result.tickEyes);
          enhancedDisposeRef.current.set(avatarId, result.dispose);
          result.group.userData = result.group.userData || {};
          (result.group.userData as Record<string, unknown>).facial = result.facial;
          (result.group.userData as Record<string, unknown>).tickEyes = result.tickEyes;
          return result.group as InstanceType<typeof import('three').Group>;
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.warn('[AvatarSystem3D] enhanced avatar build failed, falling back to legacy', err);
          }
        }
      }
      return await createAvatarMesh(appearance, THREE);
    },
    [createAvatarMesh],
  );

  // ── Create procedural animation clips ─────────────────────────

  const createAnimationClips = useCallback(
    (
      THREE: typeof import('three')
    ): Map<string, InstanceType<typeof import('three').AnimationClip>> => {
      const clips = new Map<string, InstanceType<typeof import('three').AnimationClip>>();
      const dur = 1.0;

      // Player animations
      clips.set(
        'idle',
        new THREE.AnimationClip('idle', dur, [
          new THREE.NumberKeyframeTrack('.position[y]', [0, 0.5, 1], [0, 0.01, 0]),
        ])
      );

      clips.set(
        'walk',
        new THREE.AnimationClip('walk', dur, [
          new THREE.NumberKeyframeTrack(
            '.position[y]',
            [0, 0.25, 0.5, 0.75, 1],
            [0, 0.03, 0, 0.03, 0]
          ),
        ])
      );

      clips.set(
        'run',
        new THREE.AnimationClip('run', 0.6, [
          new THREE.NumberKeyframeTrack(
            '.position[y]',
            [0, 0.15, 0.3, 0.45, 0.6],
            [0, 0.05, 0, 0.05, 0]
          ),
        ])
      );

      clips.set(
        'sit',
        new THREE.AnimationClip('sit', dur, [
          new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [-0.4, -0.4]),
        ])
      );

      clips.set(
        'build',
        new THREE.AnimationClip('build', dur, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.5, 1], [0, -0.5, 0]),
        ])
      );

      clips.set(
        'inspect',
        new THREE.AnimationClip('inspect', 1.5, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.75, 1.5], [0, 0.2, 0]),
        ])
      );

      clips.set(
        'wave',
        new THREE.AnimationClip('wave', 1.2, [
          new THREE.NumberKeyframeTrack(
            '.rotation[z]',
            [0, 0.3, 0.6, 0.9, 1.2],
            [0, 0.5, -0.3, 0.5, 0]
          ),
        ])
      );

      clips.set(
        'clap',
        new THREE.AnimationClip('clap', 0.8, [
          new THREE.NumberKeyframeTrack(
            '.scale[x]',
            [0, 0.2, 0.4, 0.6, 0.8],
            [1, 0.95, 1, 0.95, 1]
          ),
        ])
      );

      clips.set(
        'point',
        new THREE.AnimationClip('point', 1.0, [
          new THREE.NumberKeyframeTrack('.rotation[z]', [0, 0.3, 1.0], [0, -0.8, 0]),
        ])
      );

      clips.set(
        'celebrate',
        new THREE.AnimationClip('celebrate', 1.5, [
          new THREE.NumberKeyframeTrack(
            '.position[y]',
            [0, 0.3, 0.6, 0.9, 1.2, 1.5],
            [0, 0.1, 0, 0.1, 0, 0]
          ),
        ])
      );

      clips.set(
        'craft',
        new THREE.AnimationClip('craft', 2.0, [
          new THREE.NumberKeyframeTrack(
            '.rotation[x]',
            [0, 0.5, 1.0, 1.5, 2.0],
            [0, -0.3, 0, -0.3, 0]
          ),
        ])
      );

      // NPC occupation animations
      clips.set(
        'hammer',
        new THREE.AnimationClip('hammer', 0.6, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.3, 0.6], [0, -0.8, 0]),
        ])
      );

      clips.set(
        'read',
        new THREE.AnimationClip('read', 3.0, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 3.0], [0.15, 0.15]),
        ])
      );

      clips.set(
        'tend-crops',
        new THREE.AnimationClip('tend-crops', 2.0, [
          new THREE.NumberKeyframeTrack('.position[y]', [0, 1.0, 2.0], [0, -0.2, 0]),
        ])
      );

      clips.set(
        'patrol',
        new THREE.AnimationClip('patrol', 1.0, [
          new THREE.NumberKeyframeTrack('.position[y]', [0, 0.5, 1.0], [0, 0.02, 0]),
        ])
      );

      clips.set(
        'count-coins',
        new THREE.AnimationClip('count-coins', 1.5, [
          new THREE.NumberKeyframeTrack('.rotation[y]', [0, 0.75, 1.5], [0, 0.1, 0]),
        ])
      );

      clips.set(
        'construct',
        new THREE.AnimationClip('construct', 1.0, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.5, 1.0], [0, -0.5, 0]),
        ])
      );

      clips.set(
        'sweep',
        new THREE.AnimationClip('sweep', 1.2, [
          new THREE.NumberKeyframeTrack('.rotation[y]', [0, 0.6, 1.2], [-0.3, 0.3, -0.3]),
        ])
      );

      clips.set(
        'lecture',
        new THREE.AnimationClip('lecture', 2.0, [
          new THREE.NumberKeyframeTrack(
            '.rotation[z]',
            [0, 0.5, 1.0, 1.5, 2.0],
            [0, 0.2, 0, -0.2, 0]
          ),
        ])
      );

      // Hit-reaction clips (Phase 4). Procedural keyframes on the avatar root
      // group — affect position/rotation, not individual bones, so they
      // compose with whatever occupation/walk animation was previously
      // playing once the reaction fades out.
      clips.set(
        'flinch_chest',
        new THREE.AnimationClip('flinch_chest', 0.35, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.1, 0.35], [0, 0.25, 0]),
          new THREE.NumberKeyframeTrack('.position[z]', [0, 0.1, 0.35], [0, -0.08, 0]),
        ])
      );

      clips.set(
        'flinch_head',
        new THREE.AnimationClip('flinch_head', 0.40, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.08, 0.40], [0, -0.30, 0]),
          new THREE.NumberKeyframeTrack('.rotation[y]', [0, 0.08, 0.40], [0, 0.10, 0]),
        ])
      );

      clips.set(
        'stagger_left',
        new THREE.AnimationClip('stagger_left', 0.55, [
          new THREE.NumberKeyframeTrack('.rotation[z]', [0, 0.15, 0.55], [0, 0.30, 0]),
          new THREE.NumberKeyframeTrack('.position[x]', [0, 0.20, 0.55], [0, -0.15, 0]),
        ])
      );

      clips.set(
        'stagger_right',
        new THREE.AnimationClip('stagger_right', 0.55, [
          new THREE.NumberKeyframeTrack('.rotation[z]', [0, 0.15, 0.55], [0, -0.30, 0]),
          new THREE.NumberKeyframeTrack('.position[x]', [0, 0.20, 0.55], [0, 0.15, 0]),
        ])
      );

      clips.set(
        'block_impact',
        new THREE.AnimationClip('block_impact', 0.25, [
          new THREE.NumberKeyframeTrack('.position[z]', [0, 0.10, 0.25], [0, -0.05, 0]),
          new THREE.NumberKeyframeTrack('.scale[y]', [0, 0.05, 0.25], [1, 0.97, 1]),
        ])
      );

      clips.set(
        'crit_recoil',
        new THREE.AnimationClip('crit_recoil', 0.85, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.10, 0.40, 0.85], [0, 0.45, 0.20, 0]),
          new THREE.NumberKeyframeTrack('.position[y]', [0, 0.20, 0.50, 0.85], [0, 0.05, -0.05, 0]),
          new THREE.NumberKeyframeTrack('.position[z]', [0, 0.15, 0.85], [0, -0.20, 0]),
        ])
      );

      // Death collapse — knees buckle (slight Y dip), forward face-plant
      // pitch over 1.0s, settle prone for the remaining 0.5s. Holds the
      // pose at the end (no return to baseline) so the mesh stays down
      // until the externally-driven opacity fade runs to completion.
      clips.set(
        'death_collapse',
        new THREE.AnimationClip('death_collapse', 1.5, [
          new THREE.NumberKeyframeTrack(
            '.position[y]',
            [0, 0.30, 0.80, 1.10, 1.50],
            [0, -0.20, -0.50, -0.85, -0.85],
          ),
          new THREE.NumberKeyframeTrack(
            '.rotation[x]',
            [0, 0.30, 0.80, 1.10, 1.50],
            [0, 0.30, 1.20, 1.55, 1.55],
          ),
          new THREE.NumberKeyframeTrack(
            '.position[z]',
            [0, 0.50, 1.10, 1.50],
            [0, -0.10, -0.30, -0.30],
          ),
          new THREE.NumberKeyframeTrack(
            '.scale[y]',
            [0, 0.30, 1.10, 1.50],
            [1, 0.95, 0.92, 0.92],
          ),
        ])
      );

      return clips;
    },
    []
  );

  // ── Main initialization ────────────────────────────────────────

  useEffect(() => {
    let disposed = false;

    async function init() {
      const THREE = await import('three');
      if (disposed) return;
      // I2 — preload the weapon-trail factory so the (sync) frame loop can
      // create the ribbon without an await.
      const { createWeaponTrail: _createWeaponTrail } = await import('@/lib/world-lens/weapon-trail');
      if (disposed) return;

      const avatarGroup = new THREE.Group();
      avatarGroup.name = 'avatar_system';

      const animClips = createAnimationClips(THREE);

      // ── Helper: set up animation mixer for a mesh ─────────
      // Crossfade-aware: keeps a per-mixer reference to the active action so
      // playClipOnAvatar(id, name, fadeMs) can blend between clips without
      // popping. Used by the window-event hit-reaction listener below.
      type MixerType = InstanceType<typeof import('three').AnimationMixer>;
      type ActionType = ReturnType<MixerType['clipAction']>;
      const currentActions = new Map<MixerType, ActionType>();
      const baselineClips = new Map<MixerType, string>();

      function playClip(mixer: MixerType, clipName: string, fadeMs: number): void {
        const clip = animClips.get(clipName);
        if (!clip) return;
        const next = mixer.clipAction(clip);
        const prev = currentActions.get(mixer);
        const fadeSec = Math.max(0.01, fadeMs / 1000);
        if (prev && prev !== next) {
          next.reset();
          next.setEffectiveWeight(1);
          next.crossFadeFrom(prev, fadeSec, false);
          next.play();
        } else {
          next.reset();
          next.play();
        }
        currentActions.set(mixer, next);
      }

      function setupMixer(
        mesh: InstanceType<typeof import('three').Group>,
        clipName: string
      ): MixerType {
        const mixer = new THREE.AnimationMixer(mesh);
        baselineClips.set(mixer, clipName);
        playClip(mixer, clipName, 0);
        return mixer;
      }

      // Hit-reaction window event handler — installed once.
      // Detail: { targetId: string, severity: 'light' | 'heavy' | 'crit', location?: 'chest' | 'head' }
      const reactionDurationMs: Record<string, number> = {
        flinch_chest: 350,
        flinch_head:  400,
        stagger_left: 550,
        stagger_right: 550,
        block_impact: 250,
        crit_recoil:  850,
      };
      const hitReactionTimers = new Map<string, ReturnType<typeof setTimeout>>();
      // Phase 6: knockback offsets on heavy/crit reactions. Tweens the
      // mesh's world position by ~0.4m for heavy and ~0.7m for crit over
      // 300ms in the supplied direction. Re-enters the same step pattern
      // as the death-collapse impulse but smaller magnitude and shorter.
      const knockbackTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

      function handleHitReaction(e: Event) {
        const detail = (e as CustomEvent).detail as
          | {
              targetId?: string;
              severity?: 'light' | 'heavy' | 'crit';
              location?: string;
              clipName?: string;
              hitDirection?: { x: number; z: number };
            }
          | undefined;
        if (!detail?.targetId) return;
        const mixer = mixersRef.current.get(detail.targetId) as MixerType | undefined;
        if (!mixer) return;

        let clipName = detail.clipName;
        if (!clipName) {
          if (detail.severity === 'crit') clipName = 'crit_recoil';
          else if (detail.severity === 'heavy') clipName = detail.location === 'head' ? 'flinch_head' : 'stagger_left';
          else clipName = 'flinch_chest';
        }

        playClip(mixer, clipName, 80);
        const dur = reactionDurationMs[clipName] ?? 400;
        const prevTimer = hitReactionTimers.get(detail.targetId);
        if (prevTimer) clearTimeout(prevTimer);
        const t = setTimeout(() => {
          const baseline = baselineClips.get(mixer) ?? 'idle';
          // Only revert if hit-reaction clip is still active (avoid clobbering
          // a clip change from elsewhere, e.g. NPC switched to walking).
          const cur = currentActions.get(mixer);
          const curName = (cur as unknown as { getClip?: () => { name: string } } | undefined)?.getClip?.().name;
          if (curName === clipName) {
            playClip(mixer, baseline, 200);
          }
          hitReactionTimers.delete(detail.targetId!);
        }, dur);
        hitReactionTimers.set(detail.targetId, t);

        // Knockback offset for heavy/crit hits if direction supplied.
        if (detail.hitDirection && (detail.severity === 'heavy' || detail.severity === 'crit')) {
          const id = detail.targetId;
          const meshEntry =
            (id === playerAvatar.id && playerMeshRef.current)
              ? { mesh: playerMeshRef.current as InstanceType<typeof import('three').Group> }
              : (npcMeshes.get(id) as { mesh: InstanceType<typeof import('three').Group>; targetPos?: InstanceType<typeof import('three').Vector3> } | undefined);
          const mesh = meshEntry?.mesh;
          if (mesh) {
            const dir = detail.hitDirection;
            const len = Math.hypot(dir.x, dir.z) || 1;
            const magnitude = detail.severity === 'crit' ? 0.7 : 0.4;
            const dx = (dir.x / len) * magnitude;
            const dz = (dir.z / len) * magnitude;
            const steps = 6;
            const stepMs = 50;
            // Cancel any in-flight knockback for this target.
            const prev = knockbackTimers.get(id);
            if (prev) for (const tt of prev) clearTimeout(tt);
            const arr: ReturnType<typeof setTimeout>[] = [];
            for (let i = 1; i <= steps; i++) {
              const tt = setTimeout(() => {
                if (mesh) {
                  mesh.position.x += dx / steps;
                  mesh.position.z += dz / steps;
                }
                // Also nudge targetPos for NPCs so their lerp doesn't yank
                // them straight back the next 2Hz update.
                const npcEntry = npcMeshes.get(id) as { targetPos?: InstanceType<typeof import('three').Vector3> } | undefined;
                if (npcEntry?.targetPos) {
                  npcEntry.targetPos.x += dx / steps;
                  npcEntry.targetPos.z += dz / steps;
                }
              }, i * stepMs);
              arr.push(tt);
            }
            knockbackTimers.set(id, arr);

            // Wave 1 deferral 4: dust puff on heavy/crit knockback. Reads as
            // "the impact kicked up debris" — fires once at the start of the
            // knockback rather than on detected wall collision (which would
            // need scene-private layers ref or full Rapier contact queries).
            // Visually equivalent for the player.
            try {
              window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
                detail: { type: 'dust', position: { x: 50, y: 50 }, count: 14 },
              }));
            } catch { /* particle dispatch is best-effort */ }
          }
        }
      }
      window.addEventListener('concordia:hit-reaction', handleHitReaction);

      // Theme 5 (game-feel pass): hit-pause + knockback. GameJuice fires
      // these on combat-hit-heavy / combat-crit / combat-kill so the
      // impact reads as weight (animation freezes) and the target
      // recoils through the kinematic capsule.
      function handleHitPause(e: Event) {
        const detail = (e as CustomEvent).detail as { entityId?: string; durationMs?: number } | undefined;
        if (!detail?.entityId || !Number.isFinite(Number(detail.durationMs))) return;
        const dur = Math.max(0, Math.min(400, Number(detail.durationMs)));
        if (dur === 0) return;
        hitPauseUntilRef.current.set(detail.entityId, performance.now() + dur);
      }
      window.addEventListener('concordia:hit-pause', handleHitPause);

      function handleKnockback(e: Event) {
        const detail = (e as CustomEvent).detail as
          | { entityId?: string; direction?: { x?: number; z?: number }; magnitude?: number; durationMs?: number }
          | undefined;
        if (!detail?.entityId || !detail.direction) return;
        const dx = Number(detail.direction.x) || 0;
        const dz = Number(detail.direction.z) || 0;
        const m  = Number(detail.magnitude) || 0;
        const ms = Number(detail.durationMs) || 220;
        if (m <= 0 || (dx === 0 && dz === 0)) return;
        try {
          physicsWorld.knockbackKinematic?.(detail.entityId, { x: dx, z: dz }, m, ms);
        } catch { /* physics-world load race; best-effort */ }
      }
      window.addEventListener('concordia:knockback', handleKnockback);

      // Polish: NPCs face the player when within 5m. NPCBehaviorHooks ticks
      // every 250ms and dispatches `concordia:npc-look-at` with the desired
      // yaw — we update the existing per-NPC targetRot which the frame loop
      // already smooth-interpolates, so the head turn happens for free.
      function handleNPCLookAt(e: Event) {
        const detail = (e as CustomEvent).detail as
          | { npcId?: string; targetRot?: number }
          | undefined;
        if (!detail?.npcId || typeof detail.targetRot !== 'number') return;
        const npcEntry = npcMeshes.get(detail.npcId) as
          | { targetRot: number }
          | undefined;
        if (!npcEntry) return;
        npcEntry.targetRot = detail.targetRot;
      }
      window.addEventListener('concordia:npc-look-at', handleNPCLookAt);

      // Procedural combat clips: build a per-skeleton clip map on first hit
      // and crossfade in for attack-light / heavy / block / parry / dodge /
      // hit-flinch / death animation events.
      // Two-tier strategy:
      //   1. If the event carries a tier (1-5), pick the matching tier-scaled
      //      biomechanics clip (combat-biomechanics.ts) — wind-up + hip drive
      //      + off-hand counter + follow-through scale with mastery so a
      //      tier-5 evolved combo's punch *looks* genuinely heavier than a
      //      tier-1 first-attempt.
      //   2. Fall back to the baseline combat-clips.ts pose table when no
      //      tier is supplied (block / parry / dodge / hit-flinch / death
      //      stay on the baseline path — they're not combo-tier-scaled).
      const combatClipMaps      = new WeakMap<object, Record<string, import('three').AnimationClip>>();
      const biomechClipMaps     = new WeakMap<object, Record<string, import('three').AnimationClip>>();
      async function handleCombatAnim(e: Event) {
        const detail = (e as CustomEvent).detail as
          | { entityId?: string; animation?: string; tier?: number; body?: 'slim' | 'average' | 'stocky' | 'tall' }
          | undefined;
        if (!detail?.entityId || !detail?.animation) return;
        // I2 — light up the player's weapon trail on an attack swing. The trail
        // auto-fades after the swing (fadeOutSec), so we only flip it active.
        if (detail.entityId === playerAvatar.id && weaponTrailRef.current &&
            (detail.animation.startsWith('attack') || detail.animation === 'kick')) {
          weaponTrailRef.current.setActive(true);
        }
        const mixer = mixersRef.current.get(detail.entityId) as MixerType | undefined;
        if (!mixer) return;
        try {
          const root = (mixer as unknown as { getRoot?: () => unknown }).getRoot?.();
          const skeleton = (root as { skeleton?: import('three').Skeleton } | undefined)?.skeleton;
          if (!skeleton) return;

          // Tier-scaled biomechanics path. attack-light / heavy / kick /
          // grapple all support 5 mastery tiers. block / parry / dodge /
          // hit-flinch / death don't (they're reactive, not mastered).
          const TIERED_ACTIONS = new Set(['attack-light', 'attack-heavy', 'kick', 'grapple']);
          if (typeof detail.tier === 'number' && TIERED_ACTIONS.has(detail.animation)) {
            const tier = Math.max(1, Math.min(5, Math.floor(detail.tier)));
            let bMap = biomechClipMaps.get(skeleton as unknown as object);
            if (!bMap) {
              const bmod = await import('@/lib/concordia/combat-biomechanics');
              bMap = bmod.buildBiomechClipMap(
                skeleton,
                detail.body ?? 'average',
                ['attack-light', 'attack-heavy', 'kick', 'grapple'],
                [1, 2, 3, 4, 5],
              );
              biomechClipMaps.set(skeleton as unknown as object, bMap);
            }
            const clipKey = `${detail.animation}-t${tier}`;
            const clip = bMap[clipKey];
            if (clip) {
              const action = (mixer as unknown as import('three').AnimationMixer).clipAction(clip);
              action.reset();
              // Higher tiers crossfade slightly faster (sharper commitment)
              const fadeMs = Math.max(40, 100 - tier * 8);
              action.setLoop(2200 /* THREE.LoopOnce */, 1);
              action.fadeIn(fadeMs / 1000);
              action.setEffectiveWeight(1);
              action.play();
              return;
            }
          }

          // Baseline fallback
          let clipMap = combatClipMaps.get(skeleton as unknown as object);
          if (!clipMap) {
            const mod = await import('@/lib/concordia/combat-clips');
            clipMap = mod.buildCombatClipMap(skeleton);
            combatClipMaps.set(skeleton as unknown as object, clipMap);
          }
          const mod2 = await import('@/lib/concordia/combat-clips');
          mod2.playCombatClip(
            mixer as unknown as import('three').AnimationMixer,
            detail.animation as Parameters<typeof mod2.playCombatClip>[1],
            clipMap as Record<Parameters<typeof mod2.playCombatClip>[1], import('three').AnimationClip>,
            { fadeMs: 80, loop: detail.animation === 'block' },
          );
        } catch { /* clip generation/playback silent */ }
      }
      window.addEventListener('concordia:combat-anim', handleCombatAnim);

      // ── Living Society — general ACTION animation (every non-combat verb) ──
      // Mirrors handleCombatAnim: builds a procedural clip from the verb's
      // descriptor (action-biomechanics.ts) + plays it through the same mixer,
      // then fires juice / sfx / particle feedback. Nothing is ever silent
      // (resolveActionDescriptor falls back by category).
      const actionClipMaps = new Map<string, import('three').AnimationClip>();
      async function handleActionAnim(e: Event) {
        const detail = (e as CustomEvent).detail as
          | { entityId?: string; verb?: string; tier?: number; loop?: boolean; element?: string;
              pos?: { x: number; y?: number; z: number };
              // MS-P1 — a CREATED move carries its stamped motion descriptor
              // (meta_json.motion) + skill identity, so it can resolve to its own
              // animation/VFX/SFX instead of the generic 'cast'.
              motion?: Record<string, unknown> | null; skillKind?: string; skillLevel?: number;
              descriptor?: { juiceId?: string; sfxId?: string; vfx?: string } }
          | undefined;
        const verb = detail?.verb;
        if (!verb) return;
        // MS-P1 — resolve a created move to the canonical motion family + tier +
        // VFX/SFX. Precedence: the stamped motion wins, else skill_kind defaults,
        // else a safe generic — but NEVER the bare 'cast'/'arcane' silent fallback.
        let resolvedMove: import('@/lib/concordia/move-catalog/move-types').ResolvedMove | null = null;
        if (detail?.motion || detail?.skillKind || detail?.skillLevel != null) {
          try {
            const rmod = await import('@/lib/concordia/move-resolver');
            resolvedMove = rmod.resolveMove({
              motion: (detail.motion as never) ?? null,
              skillKind: detail.skillKind ?? null,
              element: detail.element ?? null,
              skillLevel: detail.skillLevel ?? null,
              tier: detail.tier ?? null,
            });
          } catch { /* resolver optional — fall through to the verb path */ }
        }
        const entityId = detail?.entityId || playerAvatar.id;
        const mixer = mixersRef.current.get(entityId) as MixerType | undefined;
        if (!mixer) return;
        try {
          // B4 — action chaining: protect the current action's core window
          // (windup+action) so a rapid second verb queues + flushes after,
          // instead of hard-cutting the first. Only gate the LOCAL player; NPC
          // activity clips and looped actions play immediately. Replayed flushes
          // carry __chained so they don't re-queue.
          const isPlayer = entityId === playerAvatar.id;
          const replayed = (detail as { __chained?: boolean })?.__chained === true;
          if (isPlayer && !detail?.loop && !replayed) {
            const aqmod = await import('@/lib/concordia/action-queue');
            if (!actionQueueRef.current) actionQueueRef.current = new aqmod.ActionQueue({ maxQueue: 1 });
            const amod0 = await import('@/lib/concordia/action-biomechanics');
            const d0 = amod0.resolveActionDescriptor(verb);
            const protectMs = (d0.phases?.[0] ?? 150) + (d0.phases?.[1] ?? 100);
            if (!actionQueueRef.current.request(detail, performance.now(), protectMs)) {
              return; // queued; the per-frame flush will replay it
            }
          }
          // B3 — skill-modulated motion: the element biases the effective tier so
          // a fire slash arcs bigger, ice strikes sharp/small, lightning snaps.
          const sm = await import('@/lib/concordia/skill-motion');
          // MS-P1 — a resolved created move carries its own (Pillar-1 level-gated)
          // tier + motion archetype; use them so the clip + scale match the move.
          const tier = resolvedMove?.tier ?? sm.effectiveTier(detail?.tier ?? 3, detail?.element);
          const clipVerb = resolvedMove?.motionArchetype || verb;
          const clipKey = `${clipVerb}-t${tier}`;
          let clip = actionClipMaps.get(clipKey);
          if (!clip) {
            const amod = await import('@/lib/concordia/action-biomechanics');
            clip = amod.buildActionClip(clipVerb, tier);
            actionClipMaps.set(clipKey, clip);
          }
          const action = (mixer as unknown as import('three').AnimationMixer).clipAction(clip);
          action.reset();
          action.setLoop(detail?.loop ? 2201 /* LoopRepeat */ : 2200 /* LoopOnce */, detail?.loop ? Infinity : 1);
          action.fadeIn(0.08);
          action.setEffectiveWeight(1);
          action.play();

          // Feedback: resolve the descriptor (carried on the event, else re-resolve).
          let d = detail?.descriptor;
          if (!d) { const amod = await import('@/lib/concordia/action-biomechanics'); d = amod.resolveActionDescriptor(verb); }
          const pa = await import('@/lib/concordia/play-action');
          const ju = await import('@/lib/concordia/juice');
          try { ju.juice(pa.juiceTriggerFor(d?.juiceId)); } catch { /* juice optional */ }
          // B3 — element overrides the descriptor's default sfx/vfx so fire/ice/
          // lightning READ different, not just recolour.
          // MS-P1 — a resolved created move brings its own VFX/SFX (never the bare
          // generic): prefer them, else the descriptor's element-modulated voices.
          const sfxId = resolvedMove?.sfxId ?? sm.modulatedSfx(d?.sfxId, detail?.element);
          const vfxId = resolvedMove?.vfx ?? sm.modulatedVfx(d?.vfx, detail?.element);
          if (sfxId) { try { ju.sfx(sfxId); } catch { /* sfx optional */ } }
          if (vfxId) {
            const pos = detail?.pos;
            window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
              detail: { type: vfxId, position: pos ?? { x: 0, y: 1, z: 0 }, duration: 600, intensity: 1 },
            }));
          }
        } catch { /* action clip generation/playback silent */ }
      }
      window.addEventListener('concordia:action-anim', handleActionAnim);

      // ── WS4.5: NPC activity → action clip (the "fluid movement" combine) ──
      // The server's needs-driven routine cycle emits npc:activity-batch when an
      // NPC moves to a new activity (WS4). Map each activity_kind to a WS1 verb
      // and dispatch concordia:action-anim on that NPC, so it plays the verb's
      // clip (forge/commune/harvest…) through the same bridge above — combined
      // with the per-NPC gait already driven below. Visible NPCs animate; far
      // ones no-op (no mixer). Returns an unsubscribe for cleanup.
      let offNpcActivity: (() => void) | null = null;
      (async () => {
        try {
          const [{ subscribe }, { activityToActionVerb }] = await Promise.all([
            import('@/lib/realtime/socket'),
            import('@/lib/concordia/npc-activity-anim'),
          ]);
          offNpcActivity = subscribe('npc:activity-batch' as Parameters<typeof subscribe>[0],
            (payload: unknown) => {
              const list = (payload as { transitions?: Array<{ npcId?: string; activity?: string }> })?.transitions || [];
              for (const t of list) {
                const verb = activityToActionVerb(t?.activity);
                if (verb && t?.npcId) {
                  window.dispatchEvent(new CustomEvent('concordia:action-anim', {
                    detail: { entityId: t.npcId, verb },
                  }));
                }
              }
            });
        } catch { /* socket/bridge optional */ }
      })();

      // ── Death collapse (Phase 5) ─────────────────────────────
      // Detail: { targetId: string, hitDirection?: { x: number; z: number } }
      // Procedural collapse + opacity fade. Avoids the 16-bone Rapier
      // ragdoll because the visual win is ~80% achievable with this
      // simpler approach and the Rapier-bone version is a much larger
      // body of work for marginal gameplay benefit.
      const dyingTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
      const fadingMeshes = new Map<string, { mesh: InstanceType<typeof import('three').Group>; startedAt: number; durationMs: number }>();

      function handleDeathCollapse(e: Event) {
        const detail = (e as CustomEvent).detail as
          | { targetId?: string; hitDirection?: { x: number; z: number } }
          | undefined;
        if (!detail?.targetId) return;
        const id = detail.targetId;
        const mixer = mixersRef.current.get(id) as MixerType | undefined;
        if (!mixer) return;

        // Cancel any in-flight reaction return so it doesn't clobber the
        // collapse 200ms after the kill landed.
        const reactionTimer = hitReactionTimers.get(id);
        if (reactionTimer) {
          clearTimeout(reactionTimer);
          hitReactionTimers.delete(id);
        }

        // Always start the procedural collapse synchronously — cheap, plays
        // for 1.5s then holds the prone pose. If the bone-physics ragdoll
        // (Tier 2 deferral 10) is available and instantiates successfully,
        // it preempts the mixer mid-clip and takes over the bones.
        playClip(mixer, 'death_collapse', 80);

        // Tier 2 deferral 10: fire-and-forget ragdoll attempt. If Rapier is
        // ready and the skeleton exposes all expected bones, the ragdoll
        // takes over and stops the animation mixer for this avatar so
        // physics drives the pose.
        let ragdollHandle: { tickFrame: () => void; dispose: () => void } | null = null;
        const meshForRagdoll =
          (id === playerAvatar.id && playerMeshRef.current)
            ? playerMeshRef.current as InstanceType<typeof import('three').Group>
            : (npcMeshes.get(id) as { mesh: InstanceType<typeof import('three').Group> } | undefined)?.mesh;
        const physicsAny = physicsWorld as unknown as { RAPIER?: unknown; world?: unknown };
        if (meshForRagdoll && physicsAny.RAPIER && physicsAny.world) {
          import('@/lib/combat/ragdoll').then((mod) => {
            try {
              const handle = mod.instantiateRagdoll(
                meshForRagdoll as unknown as { getObjectByName: (n: string) => { name: string; getWorldPosition: (t: { x: number; y: number; z: number }) => void; position: { x: number; y: number; z: number; set?: (x: number, y: number, z: number) => void }; quaternion: { x: number; y: number; z: number; w: number; set?: (x: number, y: number, z: number, w: number) => void } } | undefined },
                {
                  RAPIER: physicsAny.RAPIER as Parameters<typeof mod.instantiateRagdoll>[1]['RAPIER'],
                  world:  physicsAny.world  as Parameters<typeof mod.instantiateRagdoll>[1]['world'],
                },
                { hitDirection: detail.hitDirection, impactForce: 6 },
              );
              if (handle) {
                ragdollHandle = handle;
                mod.registerActiveRagdoll(handle);
                if (!ragdollTickRef.current) ragdollTickRef.current = mod.tickAllActiveRagdolls;
                // Stop the procedural clip — physics is driving now.
                try { (mixer as { stopAllAction?: () => void }).stopAllAction?.(); } catch { /* ok */ }
              }
            } catch { /* fall back to procedural collapse already running */ }
          }).catch(() => { /* import failure is non-fatal */ });
        }

        // Phase 14: spatial death audio at the NPC's world position so the
        // kill-blow comes from the right direction (HRTF + reverb).
        try {
          const meshForAudio =
            (id === playerAvatar.id && playerMeshRef.current)
              ? playerMeshRef.current as InstanceType<typeof import('three').Group>
              : (npcMeshes.get(id) as { mesh: InstanceType<typeof import('three').Group> } | undefined)?.mesh;
          if (meshForAudio) {
            const p = meshForAudio.position;
            window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
              detail: { action: 'playSpatialSFX', sfxId: 'kill-blow', position: { x: p.x, y: p.y, z: p.z } },
            }));
          }
        } catch { /* spatial audio is best-effort */ }

        // Apply optional hit-direction impulse offset over the first 600ms
        // by translating the mesh's parent group slightly. The clip itself
        // moves the avatar group on its local axes; this offsets in world.
        const meshEntry =
          (id === playerAvatar.id && playerMeshRef.current)
            ? { mesh: playerMeshRef.current as InstanceType<typeof import('three').Group> }
            : (npcMeshes.get(id) as { mesh: InstanceType<typeof import('three').Group> } | undefined);
        const mesh = meshEntry?.mesh;
        if (!mesh) return;

        if (detail.hitDirection) {
          const dir = detail.hitDirection;
          const len = Math.hypot(dir.x, dir.z) || 1;
          const dx = (dir.x / len) * 0.6;
          const dz = (dir.z / len) * 0.6;
          // Tween over 600ms by stepping mesh.position via setTimeout chain.
          // Using small steps to avoid coupling to the game-loop tick rate.
          const steps = 12;
          const stepMs = 50;
          for (let i = 1; i <= steps; i++) {
            const t = setTimeout(() => {
              if (mesh) {
                mesh.position.x += dx / steps;
                mesh.position.z += dz / steps;
              }
            }, i * stepMs);
            const arr = dyingTimers.get(id) ?? [];
            arr.push(t);
            dyingTimers.set(id, arr);
          }
        }

        // Schedule opacity fade-out after the collapse settles.
        const fadeStart = setTimeout(() => {
          fadingMeshes.set(id, { mesh, startedAt: Date.now(), durationMs: 6500 });
        }, 1500);

        // Schedule mesh disposal at 8s total.
        const cleanup = setTimeout(() => {
          try {
            mesh.parent?.remove(mesh);
            mesh.traverse((child) => {
              const c = child as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } | { dispose?: () => void }[] };
              c.geometry?.dispose?.();
              const m = c.material;
              if (Array.isArray(m)) m.forEach((mat) => mat?.dispose?.());
              else m?.dispose?.();
            });
          } catch {
            /* defensive cleanup */
          }
          // Tier 2 deferral 10: dispose the ragdoll's bodies + joints
          // alongside the mesh disposal. Best-effort; module may not be loaded.
          if (ragdollHandle) {
            try {
              ragdollHandle.dispose();
              import('@/lib/combat/ragdoll').then((mod) => mod.unregisterActiveRagdoll(ragdollHandle!)).catch(() => { /* ok */ });
            } catch { /* ok */ }
          }
          mixersRef.current.delete(id);
          npcMeshes.delete(id);
          fadingMeshes.delete(id);
          dyingTimers.delete(id);
        }, 8000);

        const arr = dyingTimers.get(id) ?? [];
        arr.push(fadeStart, cleanup);
        dyingTimers.set(id, arr);
      }
      window.addEventListener('concordia:death-collapse', handleDeathCollapse);

      // ── Opacity tween for fading-out dead bodies ─────────────
      // Wired into the existing game loop tick further down via this ref.
      function tickDeathFades() {
        if (fadingMeshes.size === 0) return;
        const now = Date.now();
        for (const [id, entry] of fadingMeshes) {
          const elapsed = now - entry.startedAt;
          const t = Math.min(1, elapsed / entry.durationMs);
          const opacity = 1 - t;
          entry.mesh.traverse((child) => {
            const m = (child as { material?: unknown }).material;
            const apply = (mat: { transparent?: boolean; opacity?: number; needsUpdate?: boolean } | undefined) => {
              if (!mat) return;
              mat.transparent = true;
              mat.opacity = opacity;
              mat.needsUpdate = true;
            };
            if (Array.isArray(m)) (m as unknown[]).forEach((mat) => apply(mat as { transparent?: boolean; opacity?: number; needsUpdate?: boolean }));
            else apply(m as { transparent?: boolean; opacity?: number; needsUpdate?: boolean } | undefined);
          });
          if (t >= 1) fadingMeshes.delete(id);
        }
      }
      // Hoist tickDeathFades onto a ref so the existing game loop can call
      // it without us re-finding the existing requestAnimationFrame block.
      deathFadeTickRef.current = tickDeathFades;

      // ── Create name tag sprite using canvas texture ────────
      function createNameTag(
        name: string,
        profession?: string,
        firmEmblem?: string
      ): InstanceType<typeof import('three').Sprite> {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.roundRect(0, 0, 256, 64, 8);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(name, 128, 24);

        if (profession) {
          ctx.fillStyle = '#aaccff';
          ctx.font = '14px sans-serif';
          ctx.fillText(profession, 128, 44);
        }

        if (firmEmblem) {
          ctx.fillStyle = '#ffcc88';
          ctx.font = '12px sans-serif';
          ctx.fillText(firmEmblem, 128, 58);
        }

        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthTest: false,
        });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(2, 0.5, 1);
        return sprite;
      }

      // ── Player avatar ──────────────────────────────────────
      const playerMesh = await createAvatarMeshSmart(playerAvatar.id, playerAvatar.appearance, THREE, {
        isLocalPlayer: true,
        worldId: (typeof window !== 'undefined' ? (window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub') : 'concordia-hub'),
      });
      if (disposed) return;

      playerMesh.position.set(
        playerAvatar.position.x,
        playerAvatar.position.y,
        playerAvatar.position.z
      );
      playerMesh.rotation.y = playerAvatar.rotation;
      playerMesh.userData = {
        avatarId: playerAvatar.id,
        isPlayer: true,
        name: playerAvatar.name,
      };

      const playerMixer = setupMixer(playerMesh, playerAvatar.currentAnimation);
      mixersRef.current.set(playerAvatar.id, playerMixer);
      playerMeshRef.current = playerMesh;
      avatarGroup.add(playerMesh);

      // Phase D2 — spawn the player's active mount if they have one.
      // Calls mounts.list_for_player macro; if an active mounted_instance
      // exists, renders the mount group beside the player, ticks gait
      // per frame, and wires rotation to player rotation.
      try {
        const worldIdLs = (typeof window !== 'undefined'
          ? (window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub')
          : 'concordia-hub');
        const resp = await fetch('/api/lens/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'mounts', name: 'list_for_player', input: { worldId: worldIdLs } }),
        });
        const json = await resp.json().catch(() => null);
        const result = json?.result;
        const activeMounts = result?.active ?? [];
        if (Array.isArray(activeMounts) && activeMounts.length > 0) {
          const active = activeMounts[0] as {
            mount_companion_id: string;
            seat_offset_json?: string;
            seatOffset?: { x: number; y: number; z: number; yaw?: number } | null;
            species?: { size_class?: 'small' | 'medium' | 'large' | 'huge'; display_name?: string; coat_color?: string } | null;
          };
          // Wave 7a glue #2 — build from the REAL species the macro now ships
          // (not a hardcoded 'Steed'), seat-offset-aware, and FOLLOW the player
          // instead of freezing at a static +1.2m. The mount tracks the rider's
          // position + heading each frame and ticks its gait by actual speed.
          // NOTE (chair-verified follow-on): the rider astride-seat pose —
          // lifting the player onto the saddle via rider-ik.computeRiderIkTargets
          // + rein-hand FABRIK — interacts with the locomotion ground-clamp and
          // is tuned visually in the next slice; this slice makes the mount
          // appear, correct, and attached (today it never spawned at all).
          const sp = active.species || { size_class: 'medium' as const, display_name: 'Steed' };
          const seat = active.seatOffset || { x: 0, y: 1.4, z: 0, yaw: 0 };
          const { createMountGroup } = await import('@/components/concordia/mounts/MountAvatar3D');
          const m = createMountGroup(THREE, { species: sp, coatColor: sp.coat_color || '#8b5e3c' });
          m.group.position.copy(playerMesh.position);
          m.setRotation(playerMesh.rotation.y);
          avatarGroup.add(m.group);
          // Follow the rider: seat the mount horizontally under the rider via the
          // species seat offset (inverse of computeSaddleAnchor), yaw-aligned,
          // gait ticked by movement speed. Registered in the frame-loop ticker.
          // Wave 7a #3 — rider astride-seat via rider-ik. computeRiderIkTargets
          // gives the pelvis target (saddle anchor + seat offset + per-gait
          // bounce). Applying the vertical seat fights the locomotion ground-clamp,
          // so it's behind a default-OFF flag (chair-tunable): when enabled, the
          // rider lifts onto the saddle with gait bounce; default leaves the mount
          // following under the rider (already a clear win over the old 1.2m offset).
          const seatOn = typeof window !== 'undefined'
            && (window as unknown as { __concordMountRiderSeat?: boolean }).__concordMountRiderSeat === true;
          const prev = playerMesh.position.clone();
          let riderIk: typeof import('@/lib/concordia/mounts/rider-ik') | null = null;
          if (seatOn) { import('@/lib/concordia/mounts/rider-ik').then((mod) => { riderIk = mod; }).catch(() => {}); }
          let gaitPhase = 0;
          eyeTickersRef.current.set(`mount:${active.mount_companion_id}`, (dt) => {
            const speed = prev.distanceTo(playerMesh.position) / Math.max(dt, 1e-3);
            prev.copy(playerMesh.position);
            const yaw = playerMesh.rotation.y;
            const cos = Math.cos(yaw), sin = Math.sin(yaw);
            // Mount sits under the rider's seat point.
            const mountX = playerMesh.position.x - (seat.x * cos - seat.z * sin);
            const mountZ = playerMesh.position.z - (seat.x * sin + seat.z * cos);
            m.group.position.set(mountX, playerMesh.position.y, mountZ);
            m.setRotation(yaw);
            m.tick(dt, Math.min(speed, 6));
            if (seatOn && riderIk) {
              gaitPhase = (gaitPhase + dt * 1.5) % 1;
              const gaitMode = speed > 4 ? 'gallop' : speed > 1.5 ? 'trot' : 'walk';
              const targets = riderIk.computeRiderIkTargets(
                { pos: { x: mountX, y: playerMesh.position.y, z: mountZ }, yaw,
                  saddleAnchorWorld: { x: mountX, y: playerMesh.position.y, z: mountZ },
                  reinsAnchorWorld: { x: mountX + cos * 0.6, y: playerMesh.position.y + 1.0, z: mountZ + sin * 0.6 } },
                { x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw ?? 0 },
                { gaitMode, speedMps: speed, gaitPhase },
              );
              playerMesh.position.y = targets.pelvisTarget.y;
              playerMesh.rotation.y = targets.pelvisYaw;
            }
          });
          enhancedDisposeRef.current.set(`mount:${active.mount_companion_id}`, m.dispose);
        }
      } catch { /* mounts optional */ }

      // ── Secondary physics: hair chain ──────────────────────
      {
        const spm = new SecondaryPhysicsManager();
        const headBone = playerMesh.getObjectByName('head');
        if (headBone) {
          const headWorld = new THREE.Vector3();
          headBone.getWorldPosition(headWorld);
          const hairChain = buildHairChain(headWorld, 3, 0.06, ['head', 'neck']);
          spm.addChain('playerHair', hairChain);
        }
        secondaryPhysicsRef.current = spm;
      }

      // ── Facial controller: player ───────────────────────────
      {
        // The lookup returns Object3D | undefined; we narrow to Mesh by
        // checking morphTargetDictionary (only Mesh carries it). The
        // intersection-typed local already satisfies FacialController's
        // THREE.Mesh constructor param — no `as any` needed.
        const headMesh = playerMesh.getObjectByName('head') as
          | (InstanceType<typeof import('three').Mesh> & {
              morphTargetDictionary?: Record<string, number>;
            })
          | undefined;
        if (headMesh?.morphTargetDictionary) {
          facialControllersRef.current.set('player', new FacialController(headMesh));
        }
      }

      // ── Skin SSS (quality ≥ high) ───────────────────────────
      if (quality === 'high' || quality === 'ultra') {
        import('@/lib/world-lens/skin-sss-shader')
          .then(({ applySSSTOAvatar }) => {
            applySSSTOAvatar(
              playerMesh as unknown as InstanceType<typeof import('three').Group>,
              new THREE.Color(playerAvatar.appearance.skinColor)
            );
          })
          .catch(() => {
            /* SSS optional */
          });
      }

      // Player name tag
      const playerTag = createNameTag(
        playerAvatar.name,
        playerAvatar.profession,
        playerAvatar.firmEmblem
      );
      const bodyDims = BODY_DIMENSIONS[playerAvatar.appearance.bodyType];
      playerTag.position.y = bodyDims.totalHeight + 0.3;
      playerMesh.add(playerTag);

      // ── Other players (interpolated from 10Hz updates) ─────
      const otherPlayerMeshes = new Map<
        string,
        {
          mesh: InstanceType<typeof import('three').Group>;
          targetPos: InstanceType<typeof import('three').Vector3>;
          targetRot: number;
        }
      >();

      const sortedOthers = [...otherPlayers].slice(0, MAX_FULLY_ANIMATED);

      for (const other of sortedOthers) {
        const mesh = await createAvatarMeshSmart(other.id, other.appearance, THREE, {
          worldId: (typeof window !== 'undefined' ? (window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub') : 'concordia-hub'),
        });
        if (disposed) return;

        mesh.position.set(other.position.x, sampleGroundY(other.position.x, other.position.z) ?? other.position.y, other.position.z);
        mesh.rotation.y = other.rotation;
        mesh.userData = { avatarId: other.id, isOtherPlayer: true, name: other.name };

        const mixer = setupMixer(mesh, other.currentAnimation);
        mixersRef.current.set(other.id, mixer);

        const tag = createNameTag(other.name, other.profession, other.firmEmblem);
        const otherDims = BODY_DIMENSIONS[other.appearance.bodyType];
        tag.position.y = otherDims.totalHeight + 0.3;
        mesh.add(tag);

        avatarGroup.add(mesh);
        otherPlayerMeshes.set(other.id, {
          mesh,
          targetPos: new THREE.Vector3(other.position.x, other.position.y, other.position.z),
          targetRot: other.rotation,
        });
      }

      // ── NPCs (2Hz updates, freeze beyond distance) ────────
      const npcMeshes = new Map<
        string,
        {
          mesh: InstanceType<typeof import('three').Group>;
          targetPos: InstanceType<typeof import('three').Vector3>;
          targetRot: number;
        }
      >();

      for (const npc of npcs.slice(0, MAX_FULLY_ANIMATED)) {
        // Hero NPCs (Three Above All + authored legends) get the enhanced
        // builder; everyone else stays on the legacy primitive path.
        const HERO_IDS = new Set(['sovereign_first_refusal', 'concord_first_thought', 'concordia_first_breath', 'weaver_of_echoes']);
        const isHero = HERO_IDS.has(npc.id) || npc.appearance.bodyType === 'legend';
        const mesh = await createAvatarMeshSmart(npc.id, npc.appearance, THREE, {
          isHero,
          worldId: (typeof window !== 'undefined' ? (window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub') : 'concordia-hub'),
          factionId: (npc as { faction?: string }).faction ?? null,
          archetype: (npc as { occupation?: string }).occupation ?? null,
        });
        if (disposed) return;

        mesh.position.set(npc.position.x, sampleGroundY(npc.position.x, npc.position.z) ?? npc.position.y, npc.position.z);
        mesh.rotation.y = npc.rotation;
        mesh.userData = {
          avatarId: npc.id,
          isNPC: true,
          name: npc.name,
          occupation: npc.occupation,
        };

        const clipName = npc.occupationAnimation;
        const mixer = setupMixer(mesh, clipName);
        mixersRef.current.set(npc.id, mixer);

        const tag = createNameTag(npc.name, npc.occupation);
        const npcDims = BODY_DIMENSIONS[npc.appearance.bodyType];
        tag.position.y = npcDims.totalHeight + 0.3;
        mesh.add(tag);

        // NPC facial controller
        {
          // Same narrowing pattern as the player head above. Intersection-
          // typed local is structurally compatible with FacialController's
          // THREE.Mesh param without an `as any` escape.
          const npcHead = mesh.getObjectByName('head') as
            | (InstanceType<typeof import('three').Mesh> & {
                morphTargetDictionary?: Record<string, number>;
              })
            | undefined;
          if (npcHead?.morphTargetDictionary) {
            facialControllersRef.current.set(npc.id, new FacialController(npcHead));
          }
        }

        avatarGroup.add(mesh);
        npcMeshes.set(npc.id, {
          mesh,
          targetPos: new THREE.Vector3(npc.position.x, npc.position.y, npc.position.z),
          targetRot: npc.rotation,
        });
      }

      // ── Kinematic character controller (WASD + Space jump/glide) ──────────

      function handleKeyDown(e: KeyboardEvent) {
        const k = e.key.toLowerCase();
        const wasDown = keysRef.current.has(k);
        keysRef.current.add(k);

        // B1b — traversal dash/dodge: a double-tap of a movement key fires a
        // dash in the current move direction (or facing when stationary), with
        // i-frames, animated via the WS1 'dash' verb. Behind CONCORD_TRAVERSAL_VERBS.
        const traversalOn = (window as { __concordClientConfig?: { CONCORD_TRAVERSAL_VERBS?: unknown } })
          .__concordClientConfig?.CONCORD_TRAVERSAL_VERBS !== 0;
        if (traversalOn && !wasDown && (k === 'w' || k === 'a' || k === 's' || k === 'd')) {
          const tgt = e.target as HTMLElement | null;
          const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
          if (!typing) {
            void (async () => {
              try {
                const { isDoubleTap } = await import('@/lib/concordia/dash-input');
                if (!isDoubleTap(dashTapRef.current, k, performance.now())) return;
                // Direction: current planar move, else facing (sinθ, -cosθ).
                const pm = planarMoveRef.current;
                let dx = pm.x, dz = pm.z;
                if (Math.hypot(dx, dz) < 0.05) {
                  const rot = playerRotationRef.current;
                  dx = Math.sin(rot); dz = -Math.cos(rot);
                }
                const started = (physicsWorld as { requestDash?: (id: string, x: number, z: number) => boolean })
                  .requestDash?.('player', dx, dz);
                if (started) {
                  const pa = await import('@/lib/concordia/play-action');
                  const p = playerPositionRef.current;
                  pa.playAction('dodge', { pos: { x: p.x, y: p.y + 1, z: p.z } });
                }
              } catch { /* traversal optional */ }
            })();
          }
        }
        // B1b — slide: crouch (C) while moving fast preserves momentum into a slide.
        if (traversalOn && k === 'c' && !wasDown) {
          void (async () => {
            try {
              const moving = Math.hypot(planarMoveRef.current.x, planarMoveRef.current.z) > 0.05;
              const running = keysRef.current.has('shift');
              if (moving && running) {
                (physicsWorld as { setSlide?: (id: string, on: boolean) => void }).setSlide?.('player', true);
                const pa = await import('@/lib/concordia/play-action');
                const p = playerPositionRef.current;
                pa.playAction('slide', { pos: { x: p.x, y: p.y + 0.5, z: p.z } });
              }
            } catch { /* slide optional */ }
          })();
        }
        // Theme 6 (game-feel pass): Space = jump (when grounded) or
        // toggle glide (when airborne already and falling). We trigger
        // off keydown so a tap registers a single jump and a hold flips
        // straight into glide once the apex starts.
        if (k === ' ' || k === 'spacebar') {
          // Skip when typing in a text input.
          const tgt = e.target as HTMLElement | null;
          if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
          // Prevent default so Space doesn't scroll the page.
          e.preventDefault();
          const ok = physicsWorld.requestJump?.('player');
          if (!ok) {
            // Already airborne → start glide. Initialize flight-physics
            // state when glide begins so the next per-frame step can
            // integrate proper airspeed + stall handling.
            physicsWorld.setGlide?.('player', true);
            try {
              import('@/lib/concordia/flight-physics').then((m) => {
                flightStateRef.current = m.newFlightState();
              });
            } catch { /* flight optional */ }
          }
        }
      }
      function handleKeyUp(e: KeyboardEvent) {
        const k = e.key.toLowerCase();
        keysRef.current.delete(k);
        // B1b — end slide on crouch release.
        if (k === 'c') {
          (physicsWorld as { setSlide?: (id: string, on: boolean) => void }).setSlide?.('player', false);
        }
        if (k === ' ' || k === 'spacebar') {
          // B1 — variable jump height: releasing Space early cuts an ascending
          // jump for a shorter hop (no-op while falling/grounded).
          physicsWorld.releaseJump?.('player');
          // Release glide on key-up so the player can choose how long the
          // sail lasts. Grounded glide is a no-op anyway.
          physicsWorld.setGlide?.('player', false);
        }
      }
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      // Register player character controller with Rapier (guard: only if world is ready)
      if ((physicsWorld as unknown as Record<string, unknown>)['world'] != null) {
        physicsWorld.createCharacterController('player');
      }

      // Per-NPC stride phases — keyed by NPC id, captured in closure.
      const npcStridePhases = new Map<string, number>();

      // ── Update loop (called by parent scene's game loop) ───

      avatarGroup.userData.update = (delta: number, elapsed: number) => {
        // Theme 5 (game-feel pass): respect concordia:hit-pause window
        // events. While a target/attacker is in their hit-pause window,
        // their mixer freezes (delta=0) so the impact reads as weight.
        // hitPauseUntilRef is keyed by entity id; managed by the listener
        // installed below.
        const now = performance.now();
        const pauseMap = hitPauseUntilRef.current;
        // Track 1 — make slow-mo felt: scale each mixer's delta by the global
        // time scale (kill/finisher slow-mo, photo-mode pause, cinematic shots
        // all set it). The player stays crisp inside a world slow-mo (player
        // scale lifts to 0.5–0.8) while NPCs ride the world scale. At ts=1 the
        // multiply is identity, so default behaviour is byte-for-byte unchanged.
        const worldScale = getTimeScale();
        const playerScale = getPlayerTimeScale();
        for (const [id, mixer] of mixersRef.current.entries()) {
          const pauseUntil = pauseMap.get(id) ?? 0;
          const scale = id === 'player' ? playerScale : worldScale;
          const effectiveDelta = pauseUntil > now ? 0 : delta * scale;
          (mixer as { update: (d: number) => void }).update(effectiveDelta);
        }
        // GC expired pauses lazily.
        if (pauseMap.size > 0) {
          for (const [k, until] of pauseMap) {
            if (until <= now) pauseMap.delete(k);
          }
        }

        // B4 — flush a queued chained action once the current one's core window
        // has elapsed: replay its detail (tagged __chained so it plays straight
        // through) so harvest→plant etc. flows out of the recovery.
        if (actionQueueRef.current && actionQueueRef.current.pending > 0) {
          const next = actionQueueRef.current.flush(performance.now());
          if (next && typeof window !== 'undefined') {
            try {
              window.dispatchEvent(new CustomEvent('concordia:action-anim', {
                detail: { ...(next as object), __chained: true },
              }));
            } catch { /* flush is best-effort */ }
          }
        }

        // Phase 5: per-frame opacity fade on dying meshes
        deathFadeTickRef.current?.();

        // Tier 2 deferral 10: tick all active ragdolls so their bones
        // copy from rigid-body transforms each frame.
        ragdollTickRef.current?.();

        // I2 — weapon trail: sample the player's right-hand (weapon-tip) bone
        // each frame and tick the ribbon. Created lazily once the player mesh
        // exists; attached to the scene (player mesh's parent).
        try {
          const pMesh = playerMeshRef.current as
            | { parent?: unknown; userData?: { boneMap?: Map<string, unknown> } }
            | null;
          const sceneRoot = pMesh?.parent;
          if (pMesh && sceneRoot) {
            if (!weaponTrailRef.current) {
              weaponTrailRef.current = _createWeaponTrail(
                THREE as typeof import('three'),
                sceneRoot as import('three').Object3D,
              );
              weaponTipVecRef.current = new THREE.Vector3();
            }
            const trail = weaponTrailRef.current;
            const tipBone = pMesh.userData?.boneMap?.get('rightHand') as
              | { getWorldPosition: (v: unknown) => { x: number; y: number; z: number } }
              | undefined;
            if (trail && tipBone && weaponTipVecRef.current) {
              const wp = tipBone.getWorldPosition(weaponTipVecRef.current);
              trail.sample({ x: wp.x, y: wp.y, z: wp.z }, now / 1000);
            }
            trail?.tick(now / 1000);
          }
        } catch { /* trail best-effort — never throw out of the frame loop */ }

        // Phase A1: per-frame eye tick for enhanced avatars (wetness
        // sheen + iris animation). Bounded by tickerCount ≤ N players +
        // hero NPCs (small).
        if (eyeTickersRef.current.size > 0) {
          for (const ticker of eyeTickersRef.current.values()) {
            try { ticker(delta); } catch { /* never throw out of frame loop */ }
          }
        }

        // Phase B3 — flight-physics tick when player is gliding. Reads
        // weather wind, integrates state, emits to HUD.
        if (flightStateRef.current && physicsWorld) {
          try {
            const isAir = physicsWorld.isAirborne?.('player') ?? false;
            if (!isAir) {
              flightStateRef.current = null;
            } else {
              const wm = weatherModifiersRef.current;
              const wx = wm ? Math.max(0, (12 - wm.lateralDamping) / 12) * 3 : 0;
              const wind = { wind: { x: wx, y: 0, z: 0 }, lift: 0 };
              import('@/lib/concordia/flight-physics').then((m) => {
                if (flightStateRef.current) {
                  flightStateRef.current = m.stepFlight(flightStateRef.current, { roll: 0, pitch: 0, active: true }, wind, delta);
                  window.dispatchEvent(new CustomEvent('concordia:flight-state', { detail: flightStateRef.current }));
                }
              }).catch(() => { /* flight optional */ });
            }
          } catch { /* never throw */ }
        }

        // ── Movement style blend (0.4s transition) ─────────
        const sb = styleBlendRef.current;
        if (sb.t < 1) {
          sb.t = Math.min(1, sb.t + delta / 0.4);
        }
        const styleA = MOVEMENT_STYLE_CONFIGS[sb.current] ?? MOVEMENT_STYLE_CONFIGS.warrior;
        const styleB = MOVEMENT_STYLE_CONFIGS[sb.target] ?? MOVEMENT_STYLE_CONFIGS.warrior;
        const styleCfg = sb.t >= 1 ? styleB : lerpStyleConfigs(styleA, styleB, sb.t);

        // ── Player movement (WASD + shift to run) ───────────
        const keys = keysRef.current;
        const isRunning = keys.has('shift');
        const physics = physicsRef.current;

        // Stamina-driven speed (weather scales applied from physics modifiers)
        const wMods = weatherModifiersRef.current;
        const weatherSpeedScale = wMods?.moveSpeedScale ?? 1.0;
        const weatherFriction = wMods?.groundFriction ?? 1.0;
        const staminaScale = computeMoveSpeed(physics.currentStamina, physics.maxStamina);
        const baseSpeed = isRunning ? RUN_SPEED : MOVE_SPEED;
        const physicsSpeed = baseSpeed * staminaScale * weatherSpeedScale; // raw m/s for gait synthesis
        const speed = physicsSpeed * styleCfg.walkCycleSpeed; // style-adjusted for position delta
        const speedNorm = Math.min(physicsSpeed / 12, 1); // 0–1 for balance/gait tuning

        // Drain / recover stamina
        if (isRunning) {
          drainStamina(physics, 'sprint', 0, delta);
        } else {
          recoverStamina(physics, delta, false, false);
        }
        onStaminaChange?.(physics.currentStamina, physics.maxStamina);

        let moveX = 0;
        let moveZ = 0;
        if (keys.has('w')) moveZ -= 1;
        if (keys.has('s')) moveZ += 1;
        if (keys.has('a')) moveX -= 1;
        if (keys.has('d')) moveX += 1;

        const isMoving = moveX !== 0 || moveZ !== 0;

        // B2 — accel/decel curve: ease the planar input toward the raw WASD
        // vector so starts/stops/turns ramp rather than snap (responsive, not
        // floaty — fast rate). The smoothed vector drives the position delta.
        const pm = planarMoveRef.current;
        pm.x = accelToward(pm.x, moveX, delta);
        pm.z = accelToward(pm.z, moveZ, delta);
        moveX = Math.abs(pm.x) < 0.001 ? 0 : pm.x;
        moveZ = Math.abs(pm.z) < 0.001 ? 0 : pm.z;
        const exhausted = isExhausted(physics);

        // Theme 6 (game-feel pass): airborne / swim state from physics-world.
        // The kinematic capsule integrates verticalVel internally; we read
        // these flags to decide whether to clamp Y to the heightfield
        // (grounded path) or take Y from the physics step (airborne /
        // swimming path).
        const isAirborne = (physicsWorld as { isAirborne?: (id: string) => boolean }).isAirborne?.('player') ?? false;
        const isSwimming = (physicsWorld as { isSwimming?: (id: string) => boolean }).isSwimming?.('player') ?? false;

        // Theme 6: when not pressing WASD but airborne/swimming, still
        // step physics so gravity / glide / buoyancy integrate. This
        // runs ONCE before the existing if (isMoving) / else branch.
        if (!isMoving && (isAirborne || isSwimming)) {
          const pos = playerPositionRef.current;
          const corrected = physicsWorld.moveCharacter('player', { x: 0, y: 0, z: 0 }, delta);
          if (corrected) pos.y += corrected.y;
        }

        // Theme 6 swim toggle — compare player Y against registered water
        // plane for the active world. No-op when no plane registered.
        try {
          const wid = (typeof window !== 'undefined' && (window.localStorage?.getItem('concordia:activeWorldId'))) || 'concordia-hub';
          const waterY = (physicsWorld as { getWaterLevelFor?: (w: string) => number | null }).getWaterLevelFor?.(wid);
          if (waterY != null) {
            const below = playerPositionRef.current.y < waterY - 0.5;
            if (below !== isSwimming) physicsWorld.setSwim?.('player', below);
          }
        } catch { /* swim toggle is best-effort */ }

        // ── Invisible safety net: out-of-bounds / fall / NaN recovery (G1/G2) ──
        // The player is normally planted by the terrain heightfield, but a
        // physics glitch, walking off the ±WORLD_BOUND edge while airborne, or a
        // NaN reaching the vertical integration can drop them into the void with
        // no floor. Snap back to the last grounded position (NOT respawnPlayer —
        // a fall must not heal; that's death's job) and zero the fall speed.
        // Runs once per frame; the ≤1-frame latency is imperceptible and the
        // reconciliation buffer absorbs the corrected position on the next move.
        {
          const p = playerPositionRef.current;
          if (outOfBounds(p)) {
            const safe = lastGroundedPosRef.current;
            p.x = safe.x; p.y = safe.y; p.z = safe.z;
            physicsWorld.resetVerticalVelocity?.('player');
            const pmRecover = playerMeshRef.current as { position?: { set: (x: number, y: number, z: number) => void } } | null;
            pmRecover?.position?.set(p.x, p.y, p.z);
          } else if (!isAirborne && !isSwimming) {
            // Record the last KNOWN-good standing spot (in-bounds + grounded).
            lastGroundedPosRef.current = { x: p.x, y: p.y, z: p.z };
          }
        }

        if (isMoving) {
          const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
          moveX /= len;
          moveZ /= len;

          const pos = playerPositionRef.current;
          const desired = { x: moveX * speed * delta, y: -0.2 * delta, z: moveZ * speed * delta };
          const corrected = physicsWorld.moveCharacter('player', desired, delta);
          if (corrected) {
            pos.x += corrected.x;
            pos.z += corrected.z;
            // Theme 6: airborne/swimming → Y from physics (jump arc /
            // gravity / buoyancy). Grounded → still clamps to terrain
            // a few lines down.
            if (isAirborne || isSwimming) pos.y += corrected.y;
          } else {
            pos.x += desired.x;
            pos.z += desired.z;
          }

          // Momentum overshoot on sharp direction change (ice/wet = more slide)
          if (!isRunning && !isAirborne) {
            const frictionScale = 1 / Math.max(0.1, weatherFriction);
            const overshoot = computeMomentumOvershoot(physics.mass, speed) * frictionScale;
            if (overshoot > 0.01) {
              // Nudge position slightly in previous direction — subtle slide
              pos.x += Math.cos(playerRotationRef.current) * overshoot * 0.05;
              pos.z += Math.sin(playerRotationRef.current) * overshoot * 0.05;
            }
          }

          // Terrain elevation — clamp Y to ground (only when grounded).
          if (!isAirborne && !isSwimming) {
            const elevation = elevationRef.current?.(pos.x, pos.z) ?? pos.y;
            pos.y = elevation;
          }

          // Auto-face movement direction with smooth rotation.
          // In first-person, the player faces wherever the camera looks
          // (cameraLookState.yaw is driven by mouse) so WASD moves where
          // you're looking — otherwise WASD movement direction would
          // detach from the camera and the player would walk sideways.
          if (cameraMode === 'first-person') {
            playerRotationRef.current = cameraLookState.yaw;
          } else {
            const targetRot = Math.atan2(moveX, -moveZ);
            let rotDiff = targetRot - playerRotationRef.current;
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            const turnSpeed = ROTATION_SPEED * (0.5 + styleCfg.turnAnimationBlend * 0.5);
            playerRotationRef.current += rotDiff * Math.min(1, turnSpeed * delta);
          }

          const pm = playerMeshRef.current as InstanceType<typeof import('three').Group>;
          if (pm) {
            pm.position.set(pos.x, pos.y, pos.z);
            pm.rotation.y = playerRotationRef.current;

            // ── Procedural gait synthesis ──────────────────
            // Measure terrain slope ahead for uphill/downhill lean
            const slopeAhead = elevationRef.current
              ? (elevationRef.current(
                  pos.x + Math.sin(playerRotationRef.current) * 0.5,
                  pos.z - Math.cos(playerRotationRef.current) * 0.5
                ) -
                  elevationRef.current(
                    pos.x - Math.sin(playerRotationRef.current) * 0.5,
                    pos.z + Math.cos(playerRotationRef.current) * 0.5
                  )) /
                1.0
              : 0;

            // B2 — momentum-eased gait cadence. Drive leg speed from the
            // accel-smoothed throttle (|pm|, the eased WASD magnitude 0→~1,
            // diagonal up to 1.41 → clamped) × target speed, so cadence RAMPS on
            // start/stop instead of snapping. The stride phase itself is already
            // continuous (stridePhaseRef persists across stops — no reset).
            const throttle = Math.hypot(planarMoveRef.current.x, planarMoveRef.current.z);
            const gaitSpeed = Math.min(physicsSpeed, throttle * physicsSpeed);
            stridePhaseRef.current = advanceGaitPhase(
              stridePhaseRef.current,
              gaitSpeed,
              playerAvatar.appearance.bodyType as BodyType,
              delta
            );

            // ── Visual-polish wave 3: emit foot-plant events on phase
            // crossings so EmbodiedParticlesBridge can spawn dust +
            // play per-terrain SFX. Phase crosses 0 (left contact) and
            // 0.5 (right contact) each stride cycle.
            {
              const lastPhase = (pm.userData.__lastStridePhase as number | undefined) ?? stridePhaseRef.current;
              const cur = stridePhaseRef.current;
              const justCrossedLeft  = lastPhase > cur || (lastPhase < 0.05 && cur >= 0.0 && physicsSpeed > 0.3 && lastPhase > 0.9);
              const justCrossedRight = lastPhase < 0.5 && cur >= 0.5 && physicsSpeed > 0.3;
              const planted: Array<'L' | 'R'> = [];
              if (justCrossedLeft  && physicsSpeed > 0.3) planted.push('L');
              if (justCrossedRight) planted.push('R');
              pm.userData.__lastStridePhase = cur;
              if (planted.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const boneMap = pm.userData.boneMap as Map<string, any> | undefined;
                for (const side of planted) {
                  const footBone = boneMap?.get(side === 'L' ? 'leftFoot' : 'rightFoot');
                  const fp = new THREE.Vector3();
                  if (footBone) footBone.getWorldPosition(fp);
                  else fp.set(pos.x, pos.y, pos.z);
                  try {
                    window.dispatchEvent(new CustomEvent('concordia:foot-plant', {
                      detail: {
                        side,
                        position: { x: fp.x, y: fp.y, z: fp.z },
                        material: (pm.userData.__terrainMaterial as string | undefined) ?? 'grass',
                        wet: pm.userData.__terrainWet === true,
                        intensity: Math.min(2, 0.5 + physicsSpeed / 6),
                      },
                    }));
                  } catch { /* SSR */ }
                }
              }
            }

            const gaitParams: GaitParams = {
              speed: gaitSpeed,
              direction: 0,
              slope: Math.atan(slopeAhead),
              load: physics.mass > 70 ? (physics.mass - 70) * 0.1 : 0,
              fatigue: physics.currentStamina / physics.maxStamina,
              bodyType: playerAvatar.appearance.bodyType as BodyType,
              style: styleCfg,
            };

            // Phase AA2 — try Web Worker first; fall back to inline if the
            // worker isn't ready, returned null, or the hook failed.
            const workerPose = avatarAnimator.requestGait(
              playerAvatar.id || 'player',
              gaitParams,
              stridePhaseRef.current,
              delta,
            );
            const gaitPose = workerPose
              ? serializableToGaitPose(workerPose)
              : synthesizeGait(gaitParams, stridePhaseRef.current);
            applyGaitPose(gaitPose, (name) => pm.getObjectByName(name) ?? undefined);

            // ── FABRIK foot IK — plant feet on actual terrain ──
            if (elevationRef.current) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const boneMap = pm.userData.boneMap as Map<string, any> | undefined;
              if (boneMap) {
                const dims = BODY_DIMENSIONS[playerAvatar.appearance.bodyType];
                const leftChain = buildLeftLegChain(boneMap, dims);
                const rightChain = buildRightLegChain(boneMap, dims);

                const leftFootBone = boneMap.get('leftFoot');
                const rightFootBone = boneMap.get('rightFoot');

                if (leftFootBone && rightFootBone) {
                  const wL = new THREE.Vector3();
                  const wR = new THREE.Vector3();
                  leftFootBone.getWorldPosition(wL);
                  rightFootBone.getWorldPosition(wR);

                  const targetL = new THREE.Vector3(wL.x, elevationRef.current(wL.x, wL.z), wL.z);
                  const targetR = new THREE.Vector3(wR.x, elevationRef.current(wR.x, wR.z), wR.z);

                  const resultL = solveFABRIK(leftChain, targetL);
                  const resultR = solveFABRIK(rightChain, targetR);
                  applyFABRIKToSkeleton(leftChain, resultL, boneMap);
                  applyFABRIKToSkeleton(rightChain, resultR, boneMap);
                }
              }
            }

            // ── Center-of-mass balance correction ──────────────
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const boneMap = pm.userData.boneMap as Map<string, any> | undefined;
              if (boneMap) {
                const com = computeCenterOfMass(boneMap);
                const feet = getFootPositions(boneMap);
                if (feet) {
                  const balance = computeBalanceAdjustment(
                    com,
                    feet.footL,
                    feet.footR,
                    isMoving,
                    speedNorm
                  );
                  applyBalanceAdjustment(balance, (name) => pm.getObjectByName(name) ?? undefined);
                }
              }
            }
          }

          const newAnim = exhausted ? 'walk' : isRunning ? 'run' : 'walk';
          if (activeAnimation !== newAnim) setActiveAnimation(newAnim as AnimationClip);

          onMove?.(pos, playerRotationRef.current);
        } else {
          // Idle — synthesize breathing + postural sway
          const pm = playerMeshRef.current as InstanceType<typeof import('three').Group>;
          if (pm) {
            const idlePose = synthesizeIdle(
              elapsed,
              styleCfg,
              physics.currentStamina / physics.maxStamina
            );
            applyGaitPose(idlePose, (name) => pm.getObjectByName(name) ?? undefined);
          }
          if (
            activeAnimation !== 'idle' &&
            !['sit', 'build', 'inspect', 'craft'].includes(activeAnimation)
          ) {
            setActiveAnimation('idle');
          }
        }

        // Track 1 — additive breathing over ALL states: a subtle chest rise
        // applied AFTER whichever branch (moving gait / idle) ran, so the player
        // breathes while walking, in combat-idle, etc. — not only at true idle.
        {
          const pmB = playerMeshRef.current as InstanceType<typeof import('three').Group> | null;
          const chest = pmB?.getObjectByName('chest');
          if (chest) chest.scale.y = breathingChestScaleY(elapsed, styleCfg.idleBreathScale, isMoving);
        }

        // ── Secondary physics: hair chain (runs AFTER FABRIK IK) ──
        {
          const spm = secondaryPhysicsRef.current;
          const pm = playerMeshRef.current as InstanceType<typeof import('three').Group> | null;
          if (spm && pm) {
            const rootPositions = new Map<string, InstanceType<typeof import('three').Vector3>>();
            const headBone = pm.getObjectByName('head');
            if (headBone) {
              const wp = new THREE.Vector3();
              (headBone as InstanceType<typeof import('three').Object3D>).getWorldPosition(wp);
              rootPositions.set('playerHair', wp);
            }
            const wm = weatherModifiersRef.current;
            if (wm) {
              // Derive wind intensity from lateralDamping reduction (lower damping = more wind)
              const windX = Math.max(0, (12 - wm.lateralDamping) / 12) * 3;
              spm.setWind(new THREE.Vector3(windX, 0, 0));
            }
            spm.update(rootPositions, delta, (name) => {
              const obj = pm.getObjectByName(name);
              return obj ?? undefined;
            });
          }
        }

        // ── Facial blend shapes ─────────────────────────────────
        {
          const pm = playerMeshRef.current as InstanceType<typeof import('three').Group> | null;
          if (pm) {
            const fcs = facialControllersRef.current;
            const playerFC = fcs.get('player');
            if (playerFC) {
              const fatigue = physics.currentStamina / physics.maxStamina;
              if (exhausted) playerFC.setEmotion('exhausted', 1.5);
              else if (isMoving && isRunning) playerFC.setEmotion('determined', 2.0);
              else if (!isMoving) playerFC.setEmotion('neutral', 2.0);
              playerFC.update(delta, fatigue);
            }
            // WAVE EXPR: when expression is on, read the NPC's live mood (from the
            // concordia:npc-mood bridge) → a real facial emotion; else the legacy
            // hardcoded-neutral path (off == today). Listener installs once.
            const exprOn = !!getClientConfigSync().flags?.expression;
            if (exprOn) installMoodListener();
            for (const [npcId] of npcMeshes) {
              const fc = fcs.get(npcId);
              if (!fc) continue;
              const emotion = (exprOn && emotionFor(npcId)) || resolveNPCEmotion({
                health: 1,
                stamina: 1,
                threatLevel: 0,
                isInCombat: false,
                recentDamage: 0,
                relationship: 0,
              });
              fc.setEmotion(emotion);
              fc.update(delta, 1);
            }
          }
        }

        // ── NPC gait synthesis (per-NPC stride phase, style-driven) ──
        const exprOnRef = !!getClientConfigSync().flags?.expression;
        for (const [npcId, data] of npcMeshes) {
          const npcData = npcs.find((n) => n.id === npcId);
          if (!npcData) continue;
          const npcStyle = resolveNPCStyle(npcData.occupation, 'idle');
          const npcCfg = MOVEMENT_STYLE_CONFIGS[npcStyle] ?? MOVEMENT_STYLE_CONFIGS.merchant;
          const npcSpeed =
            data.mesh.position.distanceTo(data.targetPos) > 0.05
              ? MOVE_SPEED * npcCfg.walkCycleSpeed
              : 0;

          const prevPhase = npcStridePhases.get(npcId) ?? 0;
          const newPhase = advanceGaitPhase(
            prevPhase,
            npcSpeed,
            npcData.appearance.bodyType as BodyType,
            delta
          );
          npcStridePhases.set(npcId, newPhase);

          const getMesh = (name: string) => data.mesh.getObjectByName?.(name) ?? undefined;

          if (npcSpeed > 0) {
            const npcParams: GaitParams = {
              speed: npcSpeed,
              direction: 0,
              slope: 0,
              load: 0,
              fatigue: 1,
              bodyType: npcData.appearance.bodyType as BodyType,
              style: npcCfg,
            };
            // Phase AA2 — same worker-first / inline-fallback as the
            // player avatar. Per-NPC requestGait keyed by npcId so the
            // worker pool keeps a latest-pose cache per character.
            const workerNpcPose = avatarAnimator.requestGait(
              `npc:${npcId}`,
              npcParams,
              newPhase,
              delta,
            );
            const npcGaitPose = workerNpcPose
              ? serializableToGaitPose(workerNpcPose)
              : synthesizeGait(npcParams, newPhase);
            applyGaitPose(npcGaitPose, getMesh);
          } else {
            applyGaitPose(synthesizeIdle(elapsed, npcCfg, 1), getMesh);
          }
          // Track 1 — additive breathing over ALL states for NPCs too, phase-
          // offset per id so a crowd never inhales in lockstep (kills the
          // "frozen mannequin" read even when an NPC is standing still).
          const chestN = getMesh('chest') as InstanceType<typeof import('three').Object3D> | undefined;
          if (chestN) {
            chestN.scale.y = breathingChestScaleY(
              elapsed, npcCfg.idleBreathScale, npcSpeed > 0, breathPhaseFromId(npcId),
            );
          }

          // WAVE EXPR — posture bias: the body shows the feeling. When expression
          // is on, read the NPC's live mood → a bounded spine-up additive lean
          // (grieving slumps + head-down, hostile leans forward + tense, fearful
          // crouches). Applied additively to the gait/idle pose this frame so
          // legs/locomotion stay procedural and physics still solves on top.
          // Off == today (no mood → biasFor null → exactly the legacy pose).
          if (exprOnRef) {
            const sb = biasFor(npcId);
            if (sb) {
              const p = sb.posture;
              const addPitch = (boneName: string, rad: number) => {
                if (!rad) return;
                const b = getMesh(boneName) as InstanceType<typeof import('three').Object3D> | undefined;
                if (b) b.rotation.x += rad;
              };
              addPitch('head', p.headPitch);
              addPitch('neck', p.neckPitch);
              addPitch('chest', p.torsoPitch);
              addPitch('spine', p.spinePitch);
              addPitch('hips', p.hipDrop);
            }
          }
        }

        // ── Context-aware mode switching (10 Hz) ─────────────
        {
          const nearbyEntities: NearbyEntity[] = [];
          for (const [id] of npcMeshes) {
            nearbyEntities.push({ id, type: 'npc', position: { x: 0, y: 0, z: 0 } });
          }
          const ctx = buildContext(
            playerPositionRef.current,
            nearbyEntities,
            false, // inVehicle — updated externally when player boards
            'open' as ZoneType,
            0, // activeHostiles — updated by combat system
            null // dialoguePartnerId — updated by dialogue system
          );
          maybeUpdateMode(ctx);
        }

        // ── Interpolate other players (10Hz -> smooth) ───────
        const interpFactor = Math.min(1, delta * INTERPOLATION_RATE);
        for (const [, data] of otherPlayerMeshes) {
          data.mesh.position.lerp(data.targetPos, interpFactor);
          // Plant on the terrain surface (they arrive at server Y=0; the ground
          // is ~40m on the plateau). Skip when the sampler isn't ready yet.
          const gy = sampleGroundY(data.mesh.position.x, data.mesh.position.z);
          if (gy !== null) data.mesh.position.y = gy;
          let rd = data.targetRot - data.mesh.rotation.y;
          while (rd > Math.PI) rd -= Math.PI * 2;
          while (rd < -Math.PI) rd += Math.PI * 2;
          data.mesh.rotation.y += rd * interpFactor;
        }

        // ── Interpolate NPCs (2Hz -> smooth) ────────────────
        const npcInterpFactor = Math.min(1, delta * NPC_UPDATE_RATE);
        for (const [, data] of npcMeshes) {
          data.mesh.position.lerp(data.targetPos, npcInterpFactor);
          // Plant on the terrain surface (same reason as other players above).
          const gy = sampleGroundY(data.mesh.position.x, data.mesh.position.z);
          if (gy !== null) data.mesh.position.y = gy;
          let rd = data.targetRot - data.mesh.rotation.y;
          while (rd > Math.PI) rd -= Math.PI * 2;
          while (rd < -Math.PI) rd += Math.PI * 2;
          data.mesh.rotation.y += rd * npcInterpFactor;
        }

        // ── LOD: distance-based visibility ───────────────────
        const playerPos = playerPositionRef.current;
        const pVec = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

        avatarGroup.traverse((child) => {
          const obj = child as unknown as InstanceType<typeof import('three').Object3D> & {
            userData: { isOtherPlayer?: boolean; isNPC?: boolean };
            isSprite?: boolean;
          };
          if (obj.userData?.isOtherPlayer || obj.userData?.isNPC) {
            const dist = obj.position.distanceTo(pVec);
            // Full detail within 50m, simplified 50-100m, name-tag only 100-200m, hidden 200m+
            obj.traverse((part) => {
              const p = part as unknown as { isSprite?: boolean; visible: boolean };
              if (p.isSprite) {
                p.visible = dist < 200;
              } else if (part !== obj) {
                p.visible = dist < 100;
              }
            });
          }
        });
      };

      avatarGroupRef.current = avatarGroup;

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('concordia:avatars-ready', {
            detail: { avatarGroup },
          })
        );
      }

      // Return keyboard cleanup
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('concordia:hit-reaction', handleHitReaction);
        window.removeEventListener('concordia:hit-pause', handleHitPause);
        window.removeEventListener('concordia:knockback', handleKnockback);
        window.removeEventListener('concordia:combat-anim', handleCombatAnim);
        window.removeEventListener('concordia:action-anim', handleActionAnim);
        try { offNpcActivity?.(); } catch { /* unsubscribe best-effort */ }
        window.removeEventListener('concordia:death-collapse', handleDeathCollapse);
        window.removeEventListener('concordia:npc-look-at', handleNPCLookAt);
        for (const t of hitReactionTimers.values()) clearTimeout(t);
        hitReactionTimers.clear();
        for (const arr of dyingTimers.values()) for (const t of arr) clearTimeout(t);
        dyingTimers.clear();
        fadingMeshes.clear();
        for (const arr of knockbackTimers.values()) for (const t of arr) clearTimeout(t);
        knockbackTimers.clear();
        try { weaponTrailRef.current?.dispose(); } catch { /* ok */ }
        weaponTrailRef.current = null;
        physicsWorld.removeCharacter('player');
      };
    }

    const cleanupPromise = init();

    const mixers = mixersRef.current;
    const enhancedDisposals = enhancedDisposeRef.current;
    const facialControllers = facialControllersRef.current;
    const eyeTickers = eyeTickersRef.current;
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup?.());
      mixers.clear();
      // Phase A1: dispose every enhanced-avatar build so geometries +
      // shader materials get freed.
      for (const dispose of enhancedDisposals.values()) {
        try { dispose(); } catch { /* never throw on unmount */ }
      }
      enhancedDisposals.clear();
      facialControllers.clear();
      eyeTickers.clear();

      if (avatarGroupRef.current) {
        const group = avatarGroupRef.current as {
          traverse: (cb: (obj: unknown) => void) => void;
        };
        group.traverse((obj) => {
          const mesh = obj as {
            geometry?: { dispose: () => void };
            material?:
              | { dispose: () => void; map?: { dispose: () => void } }
              | { dispose: () => void; map?: { dispose: () => void } }[];
          };
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          }
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- createAvatarMeshSmart is a stable builder; effect keys on the listed avatar deps
  }, [
    playerAvatar,
    otherPlayers,
    npcs,
    onMove,
    onEmote,
    activeAnimation,
    createAvatarMesh,
    createAnimationClips,
    onStaminaChange,
    quality,
    cameraMode,
  ]);

  return (
    <div
      data-component="avatar-system-3d"
      data-player={playerAvatar.id}
      data-other-count={otherPlayers.length}
      data-npc-count={npcs.length}
      style={{ display: 'none' }}
      aria-hidden
    />
  );
}

export { BONE_HIERARCHY, BODY_DIMENSIONS, MAX_FULLY_ANIMATED };
