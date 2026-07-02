'use client';

// concord-frontend/components/conkay/LatticeGlobe.tsx
//
// F6 — the lattice globe (K4: honest activity visualization). A wireframe
// icosphere floating above the world-tree whose spin + glow are driven ONLY
// by REAL backend signals read from `conkayHudStore`: `inFlight` (macro runs
// the backend currently reports started-but-not-completed) and
// `runDtuRefs.length` (the real DTU citations the live/most-recent
// `reason.verify` run actually checked against — F2's substrate). There is no
// ambient spin and no fake progress: when there is no in-flight work AND no
// real DTU refs, the globe settles into a slow "breath" — visibly, honestly
// distinct from the working spin — so a viewer can tell at a glance whether
// ConKay is doing anything real.
//
// Follows `OrbitalRings`' exact idiom (same file, above): read the store via
// `useConkayHudStore.getState()` INSIDE `useFrame` every frame — never a React
// selector/hook subscription, which would force a 60fps re-render. The actual
// gating math is extracted into the framework-free `computeLatticeGlobeMotion`
// (lattice-globe-motion.ts) so the honesty contract is unit-testable without
// mounting Three.js/R3F — see lattice-globe-motion.test.ts.
//
// Reduced-motion: this component only ever mounts inside `ConKayScene`'s
// `Scene`, which `ConKayBackdrop` only renders when
// `prefers-reduced-motion` is NOT set (it swaps to the 2D `ConKaySurface`
// otherwise) — so the reduced-motion gate is inherited structurally, the same
// way `OrbitalRings`/`EnergyTrunk`/`HoloShell` already rely on it. No
// component in this file re-checks `matchMedia` individually.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useConkayHudStore } from './conkayHudStore';
import { computeLatticeGlobeMotion } from './lattice-globe-motion';

const IDLE_BREATH_HZ = 0.6; // must match lattice-globe-motion.ts's internal constant's cadence

export function LatticeGlobe() {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<THREE.LineBasicMaterial>(null);
  const vel = useRef(0);  // current angular velocity (eased)
  const glow = useRef(0); // current glow level (eased)

  // Clean wireframe via EdgesGeometry (crisper lines than a raw wireframe
  // material on the solid icosahedron, especially under Bloom).
  const edges = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1.15, 1);
    const e = new THREE.EdgesGeometry(geo);
    geo.dispose();
    return e;
  }, []);

  useFrame((rstate, dt) => {
    const { inFlight, runDtuRefs } = useConkayHudStore.getState();
    const motion = computeLatticeGlobeMotion({
      inFlight,
      dtuRefCount: runDtuRefs.length,
      idleBreathPhase: rstate.clock.elapsedTime * IDLE_BREATH_HZ,
    });
    // Ease toward the target — the same smoothing idiom OrbitalRings uses —
    // so idle<->working transitions read as a spin-up/coast-down, not a jump-cut.
    vel.current += (motion.rotationSpeed - vel.current) * Math.min(1, dt * 3);
    glow.current += (motion.glowIntensity - glow.current) * Math.min(1, dt * 3);
    if (group.current) {
      group.current.rotation.y += vel.current * dt;
      group.current.rotation.x += vel.current * dt * 0.35; // gentle tumble, not a flat spin
    }
    if (mat.current) mat.current.opacity = glow.current;
  });

  return (
    <group ref={group} position={[0, 1.25, -0.4]}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial
          ref={mat}
          color="#5eead4"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}

export default LatticeGlobe;
