'use client';

/**
 * MountAvatar3D — procedural quadruped renderer driven by gait phase.
 *
 * The mount substrate (lib/concordia/mounts/) already defines species,
 * gait profiles, and a state machine. What was missing was a *renderer*:
 * a Three.js component that takes a MountedFrame ({ pos, yaw, speed,
 * gaitPhase, gaitMode }) and a MountGaitProfile (with FL/FR/RL/RR phase
 * offsets) and animates four procedural-stick legs in real time.
 *
 * The component is intentionally rig-light: a body box + neck box + four
 * leg pairs (upper + lower segment hinged at a knee). That is enough to
 * stress-test gait phase, stride length, foot ground-clearance, and the
 * mountCareLevel gait-slowdown without requiring artist-time skinned
 * meshes. Once skinned mounts ship, this component can be swapped out
 * — the same MountedFrame contract drives both.
 *
 * Mount in ConcordiaScene whenever an entity has an active mount.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type {
  MountSpecies,
  MountGaitProfile,
  MountedFrame,
  GaitMode,
} from '@/lib/concordia/mounts/mount-types';

/**
 * Per-species body proportions. Tuned for visual plausibility against
 * the four size classes; not meant to be canonical biology.
 */
const BODY_DIMS: Record<MountSpecies['sizeClass'], {
  bodyLen: number; bodyWid: number; bodyHt: number;
  neckLen: number; legUpper: number; legLower: number;
  hipSpacing: number;
}> = {
  small:  { bodyLen: 0.85, bodyWid: 0.40, bodyHt: 0.45, neckLen: 0.40, legUpper: 0.30, legLower: 0.30, hipSpacing: 0.30 },
  medium: { bodyLen: 1.50, bodyWid: 0.55, bodyHt: 0.65, neckLen: 0.65, legUpper: 0.55, legLower: 0.55, hipSpacing: 0.45 },
  large:  { bodyLen: 2.20, bodyWid: 0.75, bodyHt: 0.95, neckLen: 0.85, legUpper: 0.80, legLower: 0.80, hipSpacing: 0.55 },
  huge:   { bodyLen: 3.20, bodyWid: 1.00, bodyHt: 1.30, neckLen: 1.10, legUpper: 1.05, legLower: 1.05, hipSpacing: 0.70 },
};

export interface MountAvatar3DProps {
  /** Species record from the macros (mounts.get_species). */
  species: MountSpecies;
  /** Gait profile (mounts.get_gait). Keyed phase-offsets for FL/FR/RL/RR. */
  gait: MountGaitProfile;
  /** Live frame state — mount-state-machine emits this every tick. */
  frame: MountedFrame;
  /** Care level ∈ [0,1]. 1.0 = perfectly cared-for; 0 = neglected.
   *  Below 0.5 the mount's gait visibly slows down + stride shortens. */
  careLevel?: number;
  /** Optional tint colour for the body. Lets MountDesigner preview swatches. */
  bodyColor?: string;
}

const _vec = new THREE.Vector3();

export default function MountAvatar3D({
  species,
  gait,
  frame,
  careLevel = 1.0,
  bodyColor = '#8b5e3c',
}: MountAvatar3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef  = useRef<THREE.Mesh>(null);
  const legRefs = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const lowerRefs = useRef<Array<THREE.Mesh | null>>([null, null, null, null]);

  const dims = BODY_DIMS[species.sizeClass];

  // Hip positions (FL, FR, RL, RR), local to the mount body. The body
  // is centred at origin; legs hang from it at the four corners.
  const hipPositions = useMemo<Array<[number, number, number]>>(() => [
    // FL: forward-left
    [ +dims.bodyLen / 2 - 0.1, -dims.bodyHt / 2,  +dims.hipSpacing / 2 ],
    // FR: forward-right
    [ +dims.bodyLen / 2 - 0.1, -dims.bodyHt / 2,  -dims.hipSpacing / 2 ],
    // RL: rear-left
    [ -dims.bodyLen / 2 + 0.1, -dims.bodyHt / 2,  +dims.hipSpacing / 2 ],
    // RR: rear-right
    [ -dims.bodyLen / 2 + 0.1, -dims.bodyHt / 2,  -dims.hipSpacing / 2 ],
  ], [dims.bodyLen, dims.bodyHt, dims.hipSpacing]);

  const block = useMemo(() => {
    if (frame.gaitMode === 'walk' || frame.gaitMode === 'trot') {
      return frame.gaitMode === 'walk' ? gait.walk : gait.trot;
    }
    return gait.gallop; // canter shares gallop block (substrate convention)
  }, [frame.gaitMode, gait.walk, gait.trot, gait.gallop]);

  useFrame(() => {
    const root = groupRef.current;
    if (!root) return;

    // World pose — drive the root group's position + yaw from the
    // MountedFrame. Care decay reduces effective speed by up to 30%.
    const careFactor = THREE.MathUtils.clamp(careLevel, 0.0, 1.0);
    const speedFactor = 1.0 - (1.0 - careFactor) * 0.3;

    root.position.set(frame.mountPos.x, frame.mountPos.y, frame.mountPos.z);
    root.rotation.y = frame.mountYaw;

    // Each leg cycles based on (frame.gaitPhase + leg-specific offset).
    // The leg "swing" portion lifts the lower segment; the "stance"
    // portion plants the foot. Stride amplitude scales with care
    // (sick mounts shuffle).
    const stride = block.stride_m * speedFactor;
    const clearance = block.ground_clearance_m * speedFactor;

    for (let i = 0; i < 4; i++) {
      const leg = legRefs.current[i];
      const lower = lowerRefs.current[i];
      if (!leg || !lower) continue;

      // Wrap phase ∈ [0, 1)
      const localPhase = (frame.gaitPhase + block.phase_offsets[i] + 1) % 1;

      // Swing phase = first 40% of cycle (foot off ground); stance = remainder.
      // During swing, the upper leg pitches forward and the foot lifts.
      const swing = localPhase < 0.4;
      const swingT = swing ? localPhase / 0.4 : 1.0;
      const stanceT = swing ? 0.0 : (localPhase - 0.4) / 0.6;

      // Upper-leg pitch about the local Z axis (sagittal plane).
      // At the start of swing the leg pitches BACKWARD (foot picked up),
      // at end of swing it pitches FORWARD (foot lands). Stance plants.
      const swingAngle = swing
        ? THREE.MathUtils.lerp(-0.4, 0.6, swingT) * (stride / 0.5)
        : THREE.MathUtils.lerp(0.6, -0.4, stanceT) * (stride / 0.5);
      leg.rotation.z = swingAngle;

      // Foot lift via lower-leg pitch (knee bend) + a sin lobe for height.
      // Only swing has clearance; stance keeps the foot planted.
      const liftAngle = swing
        ? -Math.sin(swingT * Math.PI) * 0.5 * (clearance / 0.3)
        : 0.0;
      lower.rotation.z = liftAngle;

      // Slight foot-clearance via vertical offset on the lower segment
      // origin (already pitched; this fakes a knee-bend lift).
      const liftY = swing ? Math.sin(swingT * Math.PI) * clearance * 0.5 : 0;
      lower.position.y = -dims.legUpper / 2 + liftY;
    }

    // Body bob — gentle vertical oscillation tied to gait phase.
    // Different gaits feel different: trot bobs twice per cycle, gallop
    // bobs once but deeper. This is decorative; doesn't affect physics.
    if (bodyRef.current) {
      const bobPhase = frame.gaitMode === 'trot'
        ? frame.gaitPhase * 2
        : frame.gaitPhase;
      const bobAmp = frame.gaitMode === 'gallop' ? 0.06 : 0.03;
      const bobOffset = Math.sin(bobPhase * Math.PI * 2) * bobAmp * speedFactor;
      bodyRef.current.position.y = bobOffset;
    }
  });

  // Body color faded by care: neglected mounts look duller.
  const finalColor = useMemo(() => {
    const c = new THREE.Color(bodyColor);
    const desat = 1.0 - (1.0 - careLevel) * 0.5;
    c.lerp(new THREE.Color('#888888'), 1.0 - desat);
    return c.getStyle();
  }, [bodyColor, careLevel]);

  return (
    <group ref={groupRef}>
      {/* Body */}
      <mesh ref={bodyRef} position={[0, 0, 0]}>
        <boxGeometry args={[dims.bodyLen, dims.bodyHt, dims.bodyWid]} />
        <meshStandardMaterial color={finalColor} roughness={0.85} />
      </mesh>

      {/* Neck — angled forward and slightly up */}
      <mesh
        position={[+dims.bodyLen / 2 + dims.neckLen * 0.4, dims.bodyHt * 0.4, 0]}
        rotation={[0, 0, -0.5]}
      >
        <boxGeometry args={[dims.neckLen, dims.bodyHt * 0.5, dims.bodyWid * 0.7]} />
        <meshStandardMaterial color={finalColor} roughness={0.85} />
      </mesh>

      {/* Head — small block at the end of the neck */}
      <mesh
        position={[+dims.bodyLen / 2 + dims.neckLen * 0.85, dims.bodyHt * 0.7, 0]}
      >
        <boxGeometry args={[dims.neckLen * 0.5, dims.bodyHt * 0.45, dims.bodyWid * 0.55]} />
        <meshStandardMaterial color={finalColor} roughness={0.85} />
      </mesh>

      {/* Tail — only for non-flight species; a thin block trailing back */}
      {!species.flightCapable && (
        <mesh
          position={[-dims.bodyLen / 2 - dims.neckLen * 0.3, dims.bodyHt * 0.2, 0]}
          rotation={[0, 0, 0.4]}
        >
          <boxGeometry args={[dims.neckLen * 0.6, dims.bodyHt * 0.2, dims.bodyWid * 0.3]} />
          <meshStandardMaterial color={finalColor} roughness={0.9} />
        </mesh>
      )}

      {/* Four legs — each is a hinge group with upper + lower segment */}
      {hipPositions.map(([x, y, z], i) => (
        <group
          key={`leg_${i}`}
          ref={(el) => { legRefs.current[i] = el; }}
          position={[x, y, z]}
        >
          {/* Upper leg segment — pivots from the hip */}
          <mesh position={[0, -dims.legUpper / 2, 0]}>
            <boxGeometry args={[dims.legUpper * 0.25, dims.legUpper, dims.legUpper * 0.25]} />
            <meshStandardMaterial color={finalColor} roughness={0.85} />
          </mesh>
          {/* Lower leg + foot — pivots from the knee */}
          <mesh
            ref={(el) => { lowerRefs.current[i] = el; }}
            position={[0, -dims.legUpper, 0]}
          >
            <boxGeometry args={[dims.legLower * 0.22, dims.legLower, dims.legLower * 0.22]} />
            <meshStandardMaterial color={finalColor} roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * Helper: compute the in-world saddle anchor for a player to sit on.
 * Uses species.riderSeatOffset combined with the mount's pose. The
 * caller (rider-ik / AvatarSystem3D) feeds this into the FABRIK chain
 * for the rider's pelvis.
 */
export function computeSaddleAnchor(species: MountSpecies, frame: MountedFrame): {
  x: number; y: number; z: number; yaw: number;
} {
  const off = species.riderSeatOffset;
  // Rotate offset by mount yaw.
  const cos = Math.cos(frame.mountYaw);
  const sin = Math.sin(frame.mountYaw);
  return {
    x: frame.mountPos.x + off.x * cos - off.z * sin,
    y: frame.mountPos.y + off.y,
    z: frame.mountPos.z + off.x * sin + off.z * cos,
    yaw: frame.mountYaw + off.yaw,
  };
}

/**
 * Helper: select the correct gait block for the current MountedFrame.
 * Exported for unit tests.
 */
export function gaitBlockFor(profile: MountGaitProfile, mode: GaitMode): MountGaitProfile['walk'] {
  if (mode === 'walk') return profile.walk;
  if (mode === 'trot') return profile.trot;
  return profile.gallop;
}
