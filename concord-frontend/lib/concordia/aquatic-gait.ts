// concord-frontend/lib/concordia/aquatic-gait.ts
//
// Sprint C / Track C3 — gait synthesis for aquatic topologies.
//
// Each topology has a different per-frame deformation:
//   fish   → caudal fin sweeps L/R sinusoidally
//   eel    → 8 spine segments undulate as a sine wave traveling tail-to-head
//   shark  → caudal fin sweeps; pectoral fins glide
//   cephalopod → tentacle tips wave; jet propulsion bursts toggle scale
//
// Caller (AvatarSystem3D animation tick) gets the THREE.Group from
// createAquaticMesh and calls advanceAquaticGait(group, topology, t, dt).

import * as THREE from 'three';
import type { AquaticTopology } from './aquatic-mesh-builder';

export function advanceAquaticGait(
  group: THREE.Group,
  topology: AquaticTopology,
  t: number,
  velocity: number = 1.0,
) {
  switch (topology) {
    case 'fish': return advanceFish(group, t, velocity);
    case 'eel': return advanceEel(group, t, velocity);
    case 'cephalopod': return advanceCephalopod(group, t, velocity);
    case 'shark': return advanceShark(group, t, velocity);
  }
}

function advanceFish(group: THREE.Group, t: number, velocity: number) {
  const fin = group.getObjectByName('caudal_fin') as THREE.Mesh | null;
  if (fin) fin.rotation.y = Math.sin(t * 8 * velocity) * 0.5;
}

function advanceEel(group: THREE.Group, t: number, velocity: number) {
  const SEG = 8;
  for (let i = 0; i < SEG; i++) {
    const seg = group.getObjectByName(`eel_spine_${i}`) as THREE.Mesh | null;
    if (!seg) continue;
    // Sinusoidal undulation traveling from tail (highest i) to head (i=0).
    const phase = t * 6 * velocity - i * 0.6;
    seg.position.z = Math.sin(phase) * 0.12;
    seg.rotation.y = Math.cos(phase) * 0.4;
  }
}

function advanceCephalopod(group: THREE.Group, t: number, velocity: number) {
  // Tentacles wave; mantle bobbles slightly.
  const mantle = group.getObjectByName('cephalopod_mantle');
  if (mantle) {
    const breath = 1 + Math.sin(t * 1.5) * 0.06;
    mantle.scale.set(breath, breath * 1.1, breath);
  }
  for (let i = 0; i < 8; i++) {
    const tent = group.getObjectByName(`tentacle_${i}`);
    if (!tent) continue;
    tent.rotation.x = Math.sin(t * 3 + i * 0.7) * 0.4 * velocity;
    tent.rotation.z = Math.cos(t * 3 + i * 0.7) * 0.3 * velocity;
  }
}

function advanceShark(group: THREE.Group, t: number, velocity: number) {
  const caudal = group.getObjectByName('shark_caudal') as THREE.Mesh | null;
  if (caudal) caudal.rotation.y = Math.sin(t * 5 * velocity) * 0.6;
  // Slight pectoral wobble for glide.
  for (const side of ['l', 'r']) {
    const pec = group.getObjectByName(`shark_pectoral_${side}`) as THREE.Mesh | null;
    if (pec) pec.rotation.z = Math.sin(t * 1.2 + (side === 'l' ? 0 : Math.PI)) * 0.08;
  }
}
