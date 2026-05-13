'use client';

/**
 * R3FOverlayLayer — Phase O bridge.
 *
 * Mounts a transparent @react-three/fiber Canvas on top of the
 * imperative ConcordiaScene so existing R3F-only components
 * (WalkerOnHorizon, LandmarkSpires, ExplorationControls, the
 * original GoddessAvatar3D + MountAvatar3D, etc.) can run alongside
 * the imperative renderer without rewriting them.
 *
 * Caveats:
 *   - The overlay Canvas has its own scene + camera. We sync the
 *     camera position + look-at from the imperative scene's
 *     `concordia:camera-sync` event when present.
 *   - Lighting is duplicated cheaply (one ambient + one directional)
 *     so R3F-rendered geometry doesn't go black.
 *   - z-index ensures the overlay sits above the canvas but below
 *     the HUD DOM layer.
 */

import { useEffect, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CameraSyncDetail {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
}

function CameraSync() {
  const { camera } = useThree();
  const targetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  useEffect(() => {
    function onSync(e: Event) {
      const detail = (e as CustomEvent<CameraSyncDetail>).detail;
      if (!detail) return;
      camera.position.set(detail.position.x, detail.position.y, detail.position.z);
      targetRef.current.set(detail.target.x, detail.target.y, detail.target.z);
      camera.lookAt(targetRef.current);
      if (detail.fov && 'fov' in camera) {
        (camera as THREE.PerspectiveCamera).fov = detail.fov;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
    }
    window.addEventListener('concordia:camera-sync', onSync);
    return () => window.removeEventListener('concordia:camera-sync', onSync);
  }, [camera]);

  useFrame(() => {
    // Keep look-at lined up in case position drifts (one-shot via sync).
    camera.lookAt(targetRef.current);
  });

  return null;
}

interface Props {
  children?: React.ReactNode;
}

export function R3FOverlayLayer({ children }: Props) {
  return (
    <div className="fixed inset-0 pointer-events-none z-20">
      <Canvas
        camera={{ position: [0, 8, 12], fov: 55 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[100, 200, 80]} intensity={0.9} />
        <CameraSync />
        {children}
      </Canvas>
    </div>
  );
}
