'use client';

// concord-frontend/components/conkay/artifacts/CreatureAdapter.tsx
//
// Unit F9 (K5) — the `creature` adapter. `creatures.creature-publish` reports a
// REAL generated rig topology (server/domains/creatures.js); the normalizer only
// produced this artifact when that topology was genuinely present. Here we mount
// the real, pure procedural factory `createCreatureMesh` (lib/world-lens/
// creature-mesh-builder.ts) — the SAME builder the world lens uses — inside a
// react-three-fiber Canvas and drive its per-frame gait `tick` from useFrame with
// the real frame delta — never a JS timer / fake animation clock. Because it returns
// an imperative THREE.Group, we bridge it into r3f via <primitive> (the same way
// createMountGroup is mounted), disposing it on unmount. Nothing is invented — the
// silhouette is a pure function of the backend's real topology + coat colour.

import { useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createCreatureMesh } from '@/lib/world-lens/creature-mesh-builder';
import type { CreatureTopology } from '@/lib/world-lens/creature-mesh-builder';
import type { ConkayCreatureArtifact } from '@/lib/conkay/artifact-kinds';
import { StepInControls } from './StepInControls';
import { StepInToggle } from './StepInToggle';
import { ArtifactProvenance } from './ArtifactProvenance';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// The r3f bridge for the imperative creature group. Builds the real mesh once per
// (topology, coatColor, scale), mounts its THREE.Group via <primitive>, ticks its
// gait every frame with the real delta, and disposes it on teardown.
function CreatureMeshBridge({
  topology,
  coatColor,
  scale,
}: {
  topology: CreatureTopology;
  coatColor: string | null;
  scale: number;
}) {
  const built = useMemo(
    () => createCreatureMesh(THREE, { topology, coatColor: coatColor ?? undefined, scale }),
    [topology, coatColor, scale],
  );

  // Dispose the previous build when deps change or on unmount — no leaked geometry.
  useEffect(() => () => built.dispose(), [built]);

  // Real per-frame gait — dt is r3f's genuine frame delta, never a timer.
  useFrame((_state, dt) => {
    built.tick(dt);
  });

  return <primitive object={built.group} />;
}

export function CreatureAdapter({ artifact }: { artifact: ConkayCreatureArtifact }) {
  // The builder's silhouettes stand ~1.2 units tall at scale 1; normalise the real
  // reported height so a 1.2m creature reads at scale 1, clamped for framing.
  const scale = artifact.heightM && artifact.heightM > 0 ? clamp(artifact.heightM / 1.2, 0.3, 4) : 1;
  const camDist = 2.6 * scale;
  const targetY = 0.6 * scale;

  // S2-b — orbit ↔ walk. Scene units track metres (the mesh is scaled by real
  // height / 1.2), so the walk start pose is derived from the creature's REAL
  // reported height: stand ~mid-body eye height (capped at human ~1.7m) a step
  // back, aimed at the creature's centre. "Real scale" is honest by construction.
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit');
  const heightM = artifact.heightM && artifact.heightM > 0 ? artifact.heightM : 1.2;
  const eyeY = clamp(heightM * 0.55, 0.35, 1.7);
  const backDist = Math.max(heightM * 1.7, 1.4);
  const walkStart: [number, number, number] = [0, eyeY, backDist];

  return (
    <div data-testid="ck-adapter-creature">
      <div className="relative h-[340px] w-full overflow-hidden rounded-lg bg-black">
      <Canvas camera={{ position: [camDist, camDist * 0.55, camDist], fov: 45 }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[3, 5, 2]} intensity={0.85} />
        <CreatureMeshBridge topology={artifact.topology} coatColor={artifact.coatColor} scale={scale} />
        <StepInControls mode={mode} target={[0, targetY, 0]} walkStart={walkStart} />
      </Canvas>

      <StepInToggle mode={mode} onToggle={() => setMode((m) => (m === 'orbit' ? 'walk' : 'orbit'))} />


      {/* Honest facts, straight from the publish result — labels, not invented stats. */}
      <div
        data-testid="ck-adapter-creature-facts"
        className="pointer-events-none absolute left-2 top-2 flex flex-col gap-0.5 rounded-md bg-black/50 px-2 py-1 text-[10px] text-emerald-200"
      >
        {artifact.speciesId && <span className="font-mono">{artifact.speciesId}</span>}
        <span>{artifact.topology}</span>
        {artifact.massKg != null && <span>{artifact.massKg} kg</span>}
        {artifact.heightM != null && <span>{artifact.heightM} m</span>}
        {artifact.spawned && <span className="text-cyan-300">spawned live</span>}
      </div>
      </div>
      <ArtifactProvenance artifact={artifact} />
    </div>
  );
}

export default CreatureAdapter;
