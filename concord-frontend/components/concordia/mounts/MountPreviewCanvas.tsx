'use client';

/**
 * MountPreviewCanvas — Three.js preview for the MountDesigner.
 *
 * Wraps MountAvatar3D in a tiny scene with a camera, two lights, and a
 * synthetic MountedFrame whose gaitPhase advances each frame so authors
 * see the gait in motion before they save. Three gait modes are
 * cycled (walk → trot → gallop) on a 4-second timer so the author sees
 * all three without input.
 */

import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import MountAvatar3D from './MountAvatar3D';
import type {
  MountSpecies,
  MountGaitProfile,
  MountedFrame,
  GaitMode,
} from '@/lib/concordia/mounts/mount-types';

interface Props {
  species: MountSpecies;
  gait: MountGaitProfile;
  /** 0..1 — drives the gait-slowdown effect when mount is neglected. */
  careLevel?: number;
}

const GAIT_CYCLE: GaitMode[] = ['walk', 'trot', 'gallop'];
const SECONDS_PER_GAIT = 4;

function AnimatedMount({ species, gait, careLevel = 1.0 }: Props) {
  const startRef = useRef<number>(0);
  const [frame, setFrame] = useState<MountedFrame>({
    mountPos: { x: 0, y: 0, z: 0 },
    mountYaw: 0,
    speed: 4.0,
    gaitPhase: 0,
    gaitMode: 'walk',
  });

  useFrame(({ clock }) => {
    if (startRef.current === 0) startRef.current = clock.elapsedTime;
    const t = clock.elapsedTime - startRef.current;

    // Pick gait by time (cycles every SECONDS_PER_GAIT × 3 seconds).
    const gaitIdx = Math.floor((t / SECONDS_PER_GAIT)) % GAIT_CYCLE.length;
    const mode = GAIT_CYCLE[gaitIdx];

    // Phase advance rate: gallop fastest, walk slowest. Tied to gait
    // stride so the animation feels right.
    const cycleDuration =
      mode === 'walk' ? 1.0 : mode === 'trot' ? 0.7 : 0.5; // seconds per gait cycle
    const phase = (t % cycleDuration) / cycleDuration;

    // Slow turn so the preview shows the mount from multiple angles.
    const yaw = (t * 0.3) % (Math.PI * 2);

    setFrame({
      mountPos: { x: 0, y: 0, z: 0 },
      mountYaw: yaw,
      speed: mode === 'walk' ? 2.0 : mode === 'trot' ? 4.5 : 9.0,
      gaitPhase: phase,
      gaitMode: mode,
    });
  });

  return <MountAvatar3D species={species} gait={gait} frame={frame} careLevel={careLevel} />;
}

export default function MountPreviewCanvas({ species, gait, careLevel = 1.0 }: Props) {
  return (
    <Canvas
      camera={{ position: [4, 2.2, 4], fov: 38 }}
      shadows={false}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Ambient + a single keylight; this is preview-grade, not in-game */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 3]} intensity={0.8} />
      {/* Ground plane so the mount has something to walk on */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.95} />
      </mesh>
      {/* Subtle grid for depth cue */}
      <gridHelper args={[12, 12, '#2a2a2a', '#1f1f1f']} position={[0, -1.19, 0]} />

      <AnimatedMount species={species} gait={gait} careLevel={careLevel} />
    </Canvas>
  );
}
