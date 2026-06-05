'use client';

// concord-frontend/components/conkay/ConKayScene.tsx
//
// ConKay's full-bleed holographic field (P1) — a Three.js particle sphere via
// @react-three/fiber (the stack Concordia already uses). The field reacts to the
// real state machine + live mic amplitude (when listening). GPU-driven so it
// never competes with inference for CPU. Mounted ssr:false behind a WebGL +
// reduced-motion check by ConKayBackdrop (which falls back to the 2D surface).

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ConKayState } from './conkay-persona';
import { CONKAY_STATE_COLOR } from './ConKayHud';

const N = 1500;

function Field({ stateRef, amplitudeRef }: {
  stateRef: React.MutableRefObject<ConKayState>;
  amplitudeRef: React.MutableRefObject<number>;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const color = useRef(new THREE.Color('#22d3ee'));
  const target = useRef(new THREE.Color('#22d3ee'));

  const positions = useMemo(() => {
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      const r = 2.2 + (Math.random() - 0.5) * 0.9;
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, []);

  useFrame((_, dt) => {
    const st = stateRef.current;
    const amp = amplitudeRef.current;
    const time = performance.now() / 1000;
    target.current.set(CONKAY_STATE_COLOR[st]);
    color.current.lerp(target.current, 0.06);
    if (matRef.current) matRef.current.color.copy(color.current);
    if (coreMatRef.current) coreMatRef.current.color.copy(color.current);

    const pts = pointsRef.current;
    if (pts) {
      const spin = st === 'processing' || st === 'acting' ? 0.5 : st === 'listening' ? 0.14 : 0.05;
      pts.rotation.y += spin * dt;
      pts.rotation.x += spin * 0.3 * dt;
      const breathe = 1 + Math.sin(time * (st === 'presenting' ? 3 : 1.2)) * 0.04;
      const ampScale = st === 'listening' ? 1 + amp * 0.55 : 1;
      const expand = st === 'presenting' ? 1.15 : (st === 'processing' || st === 'acting') ? 1.08 : 1;
      pts.scale.setScalar(breathe * ampScale * expand);
      if (matRef.current) matRef.current.opacity = st === 'idle' ? 0.7 : 0.92;
    }
    const core = coreRef.current;
    if (core) {
      const pulse = st === 'listening' ? 1 + amp * 0.9 + Math.sin(time * 4) * 0.1
        : st === 'presenting' ? 1 + Math.sin(time * 6) * 0.15
        : 1 + Math.sin(time * 1.2) * 0.07;
      core.scale.setScalar(pulse);
      core.rotation.y += dt * 0.6;
      core.rotation.x += dt * 0.25;
    }
  });

  return (
    <group>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={matRef} size={0.04} transparent opacity={0.85} sizeAttenuation
          depthWrite={false} blending={THREE.AdditiveBlending} color="#22d3ee" />
      </points>
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[0.42, 2]} />
        <meshBasicMaterial ref={coreMatRef} color="#22d3ee" transparent opacity={0.5}
          blending={THREE.AdditiveBlending} wireframe />
      </mesh>
    </group>
  );
}

export function ConKayScene({ state, amplitudeRef, className }: {
  state: ConKayState;
  amplitudeRef: React.MutableRefObject<number>;
  className?: string;
}) {
  const stateRef = useRef<ConKayState>(state);
  stateRef.current = state;
  return (
    <div className={className} aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 6], fov: 50 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
        dpr={[1, 1.75]}
      >
        <Field stateRef={stateRef} amplitudeRef={amplitudeRef} />
      </Canvas>
    </div>
  );
}

export default ConKayScene;
