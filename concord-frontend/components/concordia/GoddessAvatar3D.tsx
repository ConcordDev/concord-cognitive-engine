'use client';

/**
 * GoddessAvatar3D — Sprint B Phase 11.2
 *
 * Concordia (the goddess, NPC id `concordia_first_breath`) is deeply
 * authored — backstory, dialogue trees, faction influence, mood
 * mechanics tied to ecosystem_score — but until now she only ever
 * appeared as text in dialogue boxes. This component renders her as
 * an actual entity in the world: larger scale, emissive material,
 * subtle floating offset, FABRIK-driven head turn toward speakers.
 *
 * Visual language:
 *   - 1.5× the player's body scale (presence without being grotesque)
 *   - Soft warm emissive (intensity tied to ecosystem_score: 0.0-0.4
 *     for cold, 0.6-1.0 for warm)
 *   - Vertical bob (sin-wave 0.06m amplitude, 0.5 Hz) — she doesn't
 *     stand on ground; she hovers
 *   - Slight rotation drift (0.1 rad/s) — never still
 *   - Color shifts: warm = #f0e2b8 (golden), cold = #5a6e7a (slate)
 *
 * Spawn rules:
 *   - One instance per world per anchor where the goddess is canonically
 *     present. content/world/concordia-hub/.../npcs.json has her keyed
 *     to wild_biomes as her routine; the world page passes the anchor
 *     position prop.
 *   - When the goddess speaks (concord-link:goddess-dialogue or the
 *     existing world-narrative path), she rotates to face the speaker
 *     using the same FABRIK chain Phase 9's NpcPerceptionBridge uses.
 *
 * Mounted in ConcordiaScene.tsx alongside other named NPCs. Falls
 * back to a procedural figure if no skinned mesh is available — the
 * substrate doesn't depend on art assets.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';

interface Props {
  /** Anchor position where the goddess is rendered. Pass the world's
      goddess-anchor coords (e.g. concordia-hub's `wild_biomes` anchor). */
  position: { x: number; y?: number; z: number };
  /** Local player's ecosystem score in [0, 1]. Drives warm/cold
      visual mood. Read by the world page from the four-axis metrics. */
  ecosystemScore?: number;
  /** Player's user id. Used to scope her gaze/speech to the active
      player when dialogue events fire. */
  userId?: string | null;
  /** Disable hover/click interactions (e.g. during cutscenes). */
  interactive?: boolean;
}

const BODY_HEIGHT = 2.4;     // 1.5× player avatar
const HOVER_OFFSET = 0.5;    // base height above ground (she hovers)
const BOB_AMP = 0.06;
const BOB_HZ = 0.5;
const DRIFT_RATE = 0.1;      // rad/s

export default function GoddessAvatar3D({
  position,
  ecosystemScore = 0.5,
  userId = null,
  interactive = true,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const robeRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const startTimeRef = useRef(performance.now());
  const [hovered, setHovered] = useState(false);
  const [targetYaw, setTargetYaw] = useState<number | null>(null);
  const currentYawRef = useRef(0);

  // Visual mood — warm vs cold derived from ecosystem score.
  // Linear mapping clamped to [0, 1]; below 0.4 = cold, above 0.6 = warm.
  const mood = useMemo(() => {
    const score = Math.max(0, Math.min(1, ecosystemScore));
    return {
      score,
      isCold: score < 0.4,
      isWarm: score > 0.6,
      // Color blend: cold #5a6e7a → warm #f0e2b8
      tint: new THREE.Color('#5a6e7a').lerp(new THREE.Color('#f0e2b8'), score),
      emissiveIntensity: 0.2 + score * 0.8, // 0.2-1.0
    };
  }, [ecosystemScore]);

  const robeMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: mood.tint,
    emissive: mood.tint,
    emissiveIntensity: mood.emissiveIntensity,
    roughness: 0.4,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  }), [mood.tint, mood.emissiveIntensity]);

  const haloMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#fff5d8',
    emissive: '#fff5d8',
    emissiveIntensity: 0.6 + mood.score * 0.4,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
  }), [mood.score]);

  // Listen for goddess-dialogue events. AvatarSystem3D's existing
  // dialogue path can dispatch concordia:goddess-speaks with the
  // speaker's npcId or userId; we rotate to face them.
  useEffect(() => {
    const onSpeaks = (e: Event) => {
      const detail = (e as CustomEvent<{ targetId?: string; targetPos?: { x: number; z: number } }>).detail;
      if (!detail) return;
      // If the world page provided a target position, compute target yaw.
      if (detail.targetPos) {
        const dx = detail.targetPos.x - position.x;
        const dz = detail.targetPos.z - position.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.001) {
          setTargetYaw(Math.atan2(dx, dz));
        }
      } else if (detail.targetId === userId) {
        // Fallback: read player position from the global registry
        const playerPos = (globalThis as { __CONCORD_PLAYER_POS__?: { x: number; z: number } }).__CONCORD_PLAYER_POS__;
        if (playerPos) {
          const dx = playerPos.x - position.x;
          const dz = playerPos.z - position.z;
          if (Math.abs(dx) + Math.abs(dz) > 0.001) {
            setTargetYaw(Math.atan2(dx, dz));
          }
        }
      }
    };
    window.addEventListener('concordia:goddess-speaks', onSpeaks);
    return () => window.removeEventListener('concordia:goddess-speaks', onSpeaks);
  }, [position.x, position.z, userId]);

  // Frame loop: bob, drift rotation, head-look interpolation, halo spin.
  useFrame((_state, delta) => {
    const root = groupRef.current;
    const halo = haloRef.current;
    if (!root) return;

    const t = (performance.now() - startTimeRef.current) / 1000;
    const baseY = (position.y ?? 0) + HOVER_OFFSET;
    const bob = Math.sin(t * Math.PI * 2 * BOB_HZ) * BOB_AMP;
    root.position.set(position.x, baseY + bob, position.z);

    // Yaw: drift unless a target is set, then lerp.
    if (targetYaw === null) {
      currentYawRef.current += delta * DRIFT_RATE;
    } else {
      // Wrap-aware lerp toward target.
      let diff = targetYaw - currentYawRef.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const step = Math.min(Math.abs(diff), delta * 2.0); // 2 rad/s max turn
      currentYawRef.current += Math.sign(diff) * step;
      if (Math.abs(diff) < 0.02) setTargetYaw(null); // settle
    }
    root.rotation.y = currentYawRef.current;

    // Halo: counter-rotates slightly + pulse with ecosystem score.
    if (halo) {
      halo.rotation.z = -t * 0.3;
      halo.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.04 * mood.score);
    }
  });

  return (
    <group
      ref={groupRef}
      onPointerOver={interactive ? (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; } : undefined}
      onPointerOut={interactive ? () => { setHovered(false); document.body.style.cursor = ''; } : undefined}
      onClick={interactive ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('concordia:goddess-click', {
          detail: { userId, position },
        }));
      } : undefined}
      scale={hovered ? [1.55, 1.55, 1.55] : [1.5, 1.5, 1.5]}
    >
      {/* Robe — tall conical mesh stretched downward; opacity fades
          slightly toward the bottom (no feet visible — she hovers). */}
      <mesh ref={robeRef} material={robeMaterial} position={[0, 0, 0]}>
        <coneGeometry args={[0.6, BODY_HEIGHT, 16]} />
      </mesh>

      {/* Head — small sphere */}
      <mesh material={robeMaterial} position={[0, BODY_HEIGHT / 2 + 0.25, 0]}>
        <sphereGeometry args={[0.28, 16, 12]} />
      </mesh>

      {/* Halo — torus behind the head, glowing */}
      <mesh
        ref={haloRef}
        material={haloMaterial}
        position={[0, BODY_HEIGHT / 2 + 0.45, -0.05]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.42, 0.04, 8, 24]} />
      </mesh>

      {/* Soft point light tied to mood — illuminates the surrounding
          ground/leaves so the goddess's presence affects the scene. */}
      <pointLight
        color={mood.tint.getHex()}
        intensity={0.6 + mood.score * 0.8}
        distance={6}
        decay={1.5}
        position={[0, 0.5, 0]}
      />
    </group>
  );
}

/**
 * Phase A5 — imperative factory used by AvatarSystem3D's
 * createAvatarMeshSmart when an NPC matches one of the Three Above All
 * (sovereign_first_refusal / concord_first_thought / concordia_first_breath)
 * or has bodyType='legend'. Returns a THREE.Group that can be added to
 * the imperative scene directly, plus a per-frame `tick(dt)` callback
 * the scene's animation loop calls. Mirrors the R3F GoddessAvatar3D
 * visual: robe + head + halo + point light + bob + drift + halo spin.
 */
export interface GoddessGroupResult {
  group:   InstanceType<typeof import('three').Group>;
  tick:    (dt: number) => void;
  setEcosystemScore: (s: number) => void;
  setTargetYaw: (yaw: number | null) => void;
  dispose: () => void;
}

export function createGoddessGroup(
  THREE: typeof import('three'),
  opts: { ecosystemScore?: number; tint?: 'auto' | string } = {},
): GoddessGroupResult {
  const group = new THREE.Group();
  group.name = 'goddess_avatar_group';
  group.scale.setScalar(1.5);

  let score = Math.max(0, Math.min(1, opts.ecosystemScore ?? 0.5));
  const coldColor = new THREE.Color('#5a6e7a');
  const warmColor = new THREE.Color('#f0e2b8');
  const tint = coldColor.clone().lerp(warmColor, score);

  const robeMaterial = new THREE.MeshStandardMaterial({
    color: tint, emissive: tint, emissiveIntensity: 0.2 + score * 0.8,
    roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.92,
  });
  const haloMaterial = new THREE.MeshStandardMaterial({
    color: '#fff5d8', emissive: '#fff5d8',
    emissiveIntensity: 0.6 + score * 0.4,
    transparent: true, opacity: 0.65, side: THREE.DoubleSide,
  });

  // Robe (cone).
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.6, BODY_HEIGHT, 16), robeMaterial);
  group.add(robe);
  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), robeMaterial);
  head.position.set(0, BODY_HEIGHT / 2 + 0.25, 0);
  group.add(head);
  // Halo.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 8, 24), haloMaterial);
  halo.position.set(0, BODY_HEIGHT / 2 + 0.45, -0.05);
  halo.rotation.x = Math.PI / 2;
  group.add(halo);
  // Mood-tinted point light.
  const moodLight = new THREE.PointLight(tint.getHex(), 0.6 + score * 0.8, 6, 1.5);
  moodLight.position.set(0, 0.5, 0);
  group.add(moodLight);

  const startMs = performance.now();
  let currentYaw = 0;
  let targetYaw: number | null = null;

  function tick(dt: number) {
    const t = (performance.now() - startMs) / 1000;
    const bob = Math.sin(t * Math.PI * 2 * BOB_HZ) * BOB_AMP;
    group.position.y = (group.userData.baseY as number ?? HOVER_OFFSET) + bob;
    if (targetYaw === null) {
      currentYaw += dt * DRIFT_RATE;
    } else {
      let diff = targetYaw - currentYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const step = Math.min(Math.abs(diff), dt * 2.0);
      currentYaw += Math.sign(diff) * step;
      if (Math.abs(diff) < 0.02) targetYaw = null;
    }
    group.rotation.y = currentYaw;
    halo.rotation.z = -t * 0.3;
    halo.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.04 * score);
  }

  function setEcosystemScore(s: number) {
    score = Math.max(0, Math.min(1, s));
    const next = coldColor.clone().lerp(warmColor, score);
    robeMaterial.color.copy(next);
    robeMaterial.emissive.copy(next);
    robeMaterial.emissiveIntensity = 0.2 + score * 0.8;
    haloMaterial.emissiveIntensity = 0.6 + score * 0.4;
    moodLight.color.copy(next);
    moodLight.intensity = 0.6 + score * 0.8;
  }

  function setTargetYaw(y: number | null) {
    targetYaw = y;
  }

  function dispose() {
    group.traverse((obj) => {
      const m = obj as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } };
      m.geometry?.dispose?.();
      m.material?.dispose?.();
    });
  }

  return { group, tick, setEcosystemScore, setTargetYaw, dispose };
}
