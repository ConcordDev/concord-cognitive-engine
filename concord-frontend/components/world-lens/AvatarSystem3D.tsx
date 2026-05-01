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
import { FacialController, resolveNPCEmotion } from '@/lib/concordia/facial-blend-shapes';
import { physicsWorld } from '@/lib/world-lens/physics-world';

// ── Types ──────────────────────────────────────────────────────────

export interface AppearanceConfig {
  skinColor: string; // hex color
  hairColor: string;
  hairStyle: 'short' | 'medium' | 'long' | 'bald' | 'ponytail' | 'bun';
  bodyType: 'slim' | 'average' | 'stocky' | 'tall';
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
}: AvatarSystem3DProps) {
  const avatarGroupRef = useRef<unknown>(null);
  const playerMeshRef = useRef<unknown>(null);
  const mixersRef = useRef<Map<string, unknown>>(new Map());
  // Phase 5: tick fn for the per-frame opacity fade on dying meshes;
  // hoisted to a ref so the existing game-loop block can invoke it.
  const deathFadeTickRef = useRef<(() => void) | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const playerPositionRef = useRef({ ...playerAvatar.position });
  const playerRotationRef = useRef(playerAvatar.rotation);
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
      const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 });
      const clothTopMat = new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.7 });
      const clothBottomMat = new THREE.MeshStandardMaterial({ color: bottomColor, roughness: 0.7 });

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

      return group;
    },
    []
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
          }
        }
      }
      window.addEventListener('concordia:hit-reaction', handleHitReaction);

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

        // Crossfade into the collapse animation. The clip holds its final
        // pose so the body stays prone after the 1.5s collapse.
        playClip(mixer, 'death_collapse', 80);

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
      const playerMesh = await createAvatarMesh(playerAvatar.appearance, THREE);
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
        const headMesh = playerMesh.getObjectByName('head') as
          | (InstanceType<typeof import('three').Mesh> & {
              morphTargetDictionary?: Record<string, number>;
            })
          | undefined;
        if (headMesh?.morphTargetDictionary) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          facialControllersRef.current.set('player', new FacialController(headMesh as any));
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
        const mesh = await createAvatarMesh(other.appearance, THREE);
        if (disposed) return;

        mesh.position.set(other.position.x, other.position.y, other.position.z);
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
        const mesh = await createAvatarMesh(npc.appearance, THREE);
        if (disposed) return;

        mesh.position.set(npc.position.x, npc.position.y, npc.position.z);
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
          const npcHead = mesh.getObjectByName('head') as
            | (InstanceType<typeof import('three').Mesh> & {
                morphTargetDictionary?: Record<string, number>;
              })
            | undefined;
          if (npcHead?.morphTargetDictionary) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            facialControllersRef.current.set(npc.id, new FacialController(npcHead as any));
          }
        }

        avatarGroup.add(mesh);
        npcMeshes.set(npc.id, {
          mesh,
          targetPos: new THREE.Vector3(npc.position.x, npc.position.y, npc.position.z),
          targetRot: npc.rotation,
        });
      }

      // ── Kinematic character controller (WASD) ──────────────

      function handleKeyDown(e: KeyboardEvent) {
        keysRef.current.add(e.key.toLowerCase());
      }
      function handleKeyUp(e: KeyboardEvent) {
        keysRef.current.delete(e.key.toLowerCase());
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
        // Update all animation mixers
        for (const mixer of mixersRef.current.values()) {
          (mixer as { update: (d: number) => void }).update(delta);
        }

        // Phase 5: per-frame opacity fade on dying meshes
        deathFadeTickRef.current?.();

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
        const exhausted = isExhausted(physics);

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
          } else {
            pos.x += desired.x;
            pos.z += desired.z;
          }

          // Momentum overshoot on sharp direction change (ice/wet = more slide)
          if (!isRunning) {
            const frictionScale = 1 / Math.max(0.1, weatherFriction);
            const overshoot = computeMomentumOvershoot(physics.mass, speed) * frictionScale;
            if (overshoot > 0.01) {
              // Nudge position slightly in previous direction — subtle slide
              pos.x += Math.cos(playerRotationRef.current) * overshoot * 0.05;
              pos.z += Math.sin(playerRotationRef.current) * overshoot * 0.05;
            }
          }

          // Terrain elevation — clamp Y to ground
          const elevation = elevationRef.current?.(pos.x, pos.z) ?? pos.y;
          pos.y = elevation;

          // Auto-face movement direction with smooth rotation
          const targetRot = Math.atan2(moveX, -moveZ);
          let rotDiff = targetRot - playerRotationRef.current;
          while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
          while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
          const turnSpeed = ROTATION_SPEED * (0.5 + styleCfg.turnAnimationBlend * 0.5);
          playerRotationRef.current += rotDiff * Math.min(1, turnSpeed * delta);

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

            stridePhaseRef.current = advanceGaitPhase(
              stridePhaseRef.current,
              physicsSpeed,
              playerAvatar.appearance.bodyType as BodyType,
              delta
            );

            const gaitParams: GaitParams = {
              speed: physicsSpeed,
              direction: 0,
              slope: Math.atan(slopeAhead),
              load: physics.mass > 70 ? (physics.mass - 70) * 0.1 : 0,
              fatigue: physics.currentStamina / physics.maxStamina,
              bodyType: playerAvatar.appearance.bodyType as BodyType,
              style: styleCfg,
            };

            const gaitPose = synthesizeGait(gaitParams, stridePhaseRef.current);
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
            // Subtle chest scale breath (complements hipOffset from synthesizeIdle)
            const chest = pm.getObjectByName('chest');
            if (chest)
              chest.scale.y = 1 + Math.sin(elapsed * 0.8) * 0.004 * styleCfg.idleBreathScale;
          }
          if (
            activeAnimation !== 'idle' &&
            !['sit', 'build', 'inspect', 'craft'].includes(activeAnimation)
          ) {
            setActiveAnimation('idle');
          }
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
            for (const [npcId] of npcMeshes) {
              const fc = fcs.get(npcId);
              if (!fc) continue;
              const emotion = resolveNPCEmotion({
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
            applyGaitPose(synthesizeGait(npcParams, newPhase), getMesh);
          } else {
            applyGaitPose(synthesizeIdle(elapsed, npcCfg, 1), getMesh);
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
          let rd = data.targetRot - data.mesh.rotation.y;
          while (rd > Math.PI) rd -= Math.PI * 2;
          while (rd < -Math.PI) rd += Math.PI * 2;
          data.mesh.rotation.y += rd * interpFactor;
        }

        // ── Interpolate NPCs (2Hz -> smooth) ────────────────
        const npcInterpFactor = Math.min(1, delta * NPC_UPDATE_RATE);
        for (const [, data] of npcMeshes) {
          data.mesh.position.lerp(data.targetPos, npcInterpFactor);
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
        window.removeEventListener('concordia:death-collapse', handleDeathCollapse);
        for (const t of hitReactionTimers.values()) clearTimeout(t);
        hitReactionTimers.clear();
        for (const arr of dyingTimers.values()) for (const t of arr) clearTimeout(t);
        dyingTimers.clear();
        fadingMeshes.clear();
        for (const arr of knockbackTimers.values()) for (const t of arr) clearTimeout(t);
        knockbackTimers.clear();
        physicsWorld.removeCharacter('player');
      };
    }

    const cleanupPromise = init();

    const mixers = mixersRef.current;
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup?.());
      mixers.clear();

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
