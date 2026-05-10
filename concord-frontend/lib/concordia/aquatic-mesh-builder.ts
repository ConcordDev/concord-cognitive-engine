// concord-frontend/lib/concordia/aquatic-mesh-builder.ts
//
// Sprint C / Track C3 — procedural meshes for aquatic creatures.
//
// AvatarSystem3D's createAvatarMesh dispatches to this builder when
// appearance.topology ∈ {fish, eel, cephalopod, shark}. Returns the same
// THREE.Group shape so the rest of the rig (gait synthesis, animation)
// works without humanoid assumptions.
//
// Each builder returns a Group containing named bones the gait
// synthesis routine (aquatic-gait.ts) can advance per frame.

import * as THREE from 'three';

export type AquaticTopology = 'fish' | 'eel' | 'cephalopod' | 'shark';

export interface AquaticAppearance {
  topology: AquaticTopology;
  bodyColor?: number;          // base hex
  bioluminescent?: boolean;
  scaleMultiplier?: number;    // 1.0 default
}

const FALLBACK_COLOR = 0x4a6680;

export function createAquaticMesh(appearance: AquaticAppearance): THREE.Group {
  const group = new THREE.Group();
  group.name = `aquatic_${appearance.topology}`;
  const baseColor = appearance.bodyColor ?? FALLBACK_COLOR;
  const isBioluminescent = !!appearance.bioluminescent;
  const scale = appearance.scaleMultiplier ?? 1.0;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.55,
    metalness: 0.05,
    emissive: isBioluminescent ? new THREE.Color(baseColor) : new THREE.Color(0x000000),
    emissiveIntensity: isBioluminescent ? 0.3 : 0,
  });

  switch (appearance.topology) {
    case 'fish': buildFish(group, bodyMat, scale); break;
    case 'eel': buildEel(group, bodyMat, scale); break;
    case 'cephalopod': buildCephalopod(group, bodyMat, scale); break;
    case 'shark': buildShark(group, bodyMat, scale); break;
  }
  group.scale.setScalar(scale);
  return group;
}

function buildFish(group: THREE.Group, mat: THREE.MeshStandardMaterial, _scale: number) {
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), mat);
  body.scale.set(2.0, 0.7, 0.7);
  body.name = 'spine_root';
  group.add(body);
  // Caudal fin.
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.25, 6), mat);
  fin.rotation.z = Math.PI / 2;
  fin.position.x = -0.6;
  fin.scale.set(1.2, 0.05, 1.0);
  fin.name = 'caudal_fin';
  group.add(fin);
  // Dorsal.
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 5), mat);
  dorsal.rotation.x = Math.PI / 2;
  dorsal.position.set(0.0, 0.18, 0);
  dorsal.scale.set(1.0, 0.05, 1.0);
  dorsal.name = 'dorsal_fin';
  group.add(dorsal);
}

function buildEel(group: THREE.Group, mat: THREE.MeshStandardMaterial, _scale: number) {
  // 8 spine segments form a serpentine body. Each segment is a small
  // cylinder named so gait-synthesis can find them.
  const SEG = 8;
  for (let i = 0; i < SEG; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.10 - i * 0.005, 0.12 - i * 0.005, 0.30, 8), mat);
    s.name = `eel_spine_${i}`;
    s.rotation.z = Math.PI / 2;
    s.position.x = -i * 0.28;
    group.add(s);
  }
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.6), mat);
  ribbon.position.set(-0.3, 0.13, 0);
  ribbon.name = 'eel_ribbon';
  group.add(ribbon);
}

function buildCephalopod(group: THREE.Group, mat: THREE.MeshStandardMaterial, _scale: number) {
  // Soft body torus + 8 procedural tentacles.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), mat);
  body.scale.set(1.0, 1.1, 1.0);
  body.name = 'cephalopod_mantle';
  group.add(body);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const tentacleGroup = new THREE.Group();
    tentacleGroup.name = `tentacle_${i}`;
    for (let s = 0; s < 5; s++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06 - s * 0.01, 0.08 - s * 0.01, 0.12, 6), mat);
      seg.position.y = -0.10 - s * 0.12;
      tentacleGroup.add(seg);
    }
    tentacleGroup.position.set(Math.cos(angle) * 0.20, -0.10, Math.sin(angle) * 0.20);
    tentacleGroup.rotation.set(0, angle, 0);
    group.add(tentacleGroup);
  }
}

function buildShark(group: THREE.Group, mat: THREE.MeshStandardMaterial, _scale: number) {
  // Torpedo body + caudal fin + dorsal.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 1.6, 12), mat);
  body.rotation.z = Math.PI / 2;
  body.name = 'shark_spine';
  group.add(body);
  // Snout.
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 8), mat);
  snout.rotation.z = -Math.PI / 2;
  snout.position.x = 0.9;
  group.add(snout);
  // Caudal fin (forked).
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.4), mat);
  fin.position.x = -0.85;
  fin.name = 'shark_caudal';
  group.add(fin);
  // Dorsal.
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.32, 6), mat);
  dorsal.rotation.x = Math.PI / 2;
  dorsal.position.set(0, 0.30, 0);
  dorsal.scale.set(1.0, 0.05, 1.0);
  group.add(dorsal);
  // Pectoral fins.
  for (const z of [-0.30, 0.30]) {
    const pec = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.04, 0.18), mat);
    pec.position.set(0.10, -0.12, z);
    pec.name = `shark_pectoral_${z > 0 ? 'r' : 'l'}`;
    group.add(pec);
  }
}

export function isAquaticTopology(t?: string): t is AquaticTopology {
  return t === 'fish' || t === 'eel' || t === 'cephalopod' || t === 'shark';
}
