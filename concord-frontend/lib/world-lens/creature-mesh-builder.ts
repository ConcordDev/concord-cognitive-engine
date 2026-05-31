// concord-frontend/lib/world-lens/creature-mesh-builder.ts
//
// Wave 6 — topology-aware creature meshes. The backend (creature.for_world)
// ships each creature's rig topology (quadruped / winged_biped / serpentine /
// fish / shark / cephalopod / polyped / amorphous) + coat colour + genotype
// variant. This builds a recognizable procedural silhouette per topology + a
// per-frame gait tick, so the simulated-but-invisible bestiary finally renders.
//
// Deliberately primitive (like createMountGroup): a generic-but-correct body
// plan tinted by genotype, never a missing-asset cube. Bespoke meshes can
// replace these per species later; the floor reads coherent at every stage.

import type * as THREE_NS from 'three';

export type CreatureTopology =
  | 'quadruped' | 'winged_quadruped' | 'winged_biped' | 'serpentine'
  | 'eel' | 'fish' | 'shark' | 'cephalopod' | 'polyped' | 'amorphous' | 'humanoid';

export interface CreatureMeshResult {
  group: THREE_NS.Group;
  tick: (dt: number, speed?: number) => void;
  dispose: () => void;
}

export interface CreatureMeshOpts {
  topology: CreatureTopology;
  coatColor?: string;
  scale?: number;
  variant?: string | null;
}

export function createCreatureMesh(THREE: typeof THREE_NS, opts: CreatureMeshOpts): CreatureMeshResult {
  const color = new THREE.Color(opts.coatColor || '#8b5e3c');
  const scale = opts.scale ?? 1;
  const group = new THREE.Group();
  group.name = 'creature';
  group.scale.setScalar(scale);

  // A reacted/variant creature reads faintly lit (steam/magma/storm glow).
  const emissiveVariant = opts.variant ? 0.18 : 0;
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.75, metalness: 0,
    emissive: color, emissiveIntensity: emissiveVariant,
  });

  const limbs: Array<{ mesh: THREE_NS.Mesh; phase: number; restY: number }> = [];
  const segments: Array<{ mesh: THREE_NS.Mesh; phase: number }> = [];
  let finMesh: THREE_NS.Mesh | null = null;

  const top = opts.topology;
  if (top === 'quadruped' || top === 'winged_quadruped' || top === 'humanoid') {
    buildQuadruped();
    if (top === 'winged_quadruped') buildWings(1.0);
  } else if (top === 'winged_biped') {
    buildBipedBird();
    buildWings(0.8);
  } else if (top === 'serpentine' || top === 'eel') {
    buildSerpentine();
  } else if (top === 'fish' || top === 'shark') {
    buildFish(top === 'shark');
  } else if (top === 'cephalopod') {
    buildCephalopod();
  } else if (top === 'polyped') {
    buildPolyped();
  } else {
    buildBlob();
  }

  function addBody(len: number, r: number, y: number) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    body.rotation.z = Math.PI / 2;
    body.position.set(0, y, 0);
    group.add(body);
    return body;
  }
  function buildQuadruped() {
    addBody(1.4, 0.3, 0.85);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), mat);
    head.position.set(0.9, 0.95, 0);
    group.add(head);
    const legGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8);
    for (const [lx, lz, ph] of [[0.45, 0.22, 0], [0.45, -0.22, 0.5], [-0.45, 0.22, 0.5], [-0.45, -0.22, 0]] as const) {
      const leg = new THREE.Mesh(legGeom, mat);
      leg.position.set(lx, 0.4, lz);
      group.add(leg);
      limbs.push({ mesh: leg, phase: ph, restY: 0.4 });
    }
  }
  function buildBipedBird() {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), mat);
    body.scale.set(1, 1.2, 0.9);
    body.position.set(0, 0.9, 0);
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
    head.position.set(0.1, 1.25, 0);
    group.add(head);
    const legGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6);
    for (const lz of [0.1, -0.1]) {
      const leg = new THREE.Mesh(legGeom, mat);
      leg.position.set(0, 0.45, lz);
      group.add(leg);
    }
  }
  function buildWings(span: number) {
    const wingGeom = new THREE.PlaneGeometry(span, span * 0.5);
    const wingMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    for (const sgn of [1, -1]) {
      const wing = new THREE.Mesh(wingGeom, wingMat);
      wing.position.set(0, 1.0, sgn * 0.35);
      wing.rotation.x = sgn * 0.3;
      group.add(wing);
      limbs.push({ mesh: wing, phase: sgn > 0 ? 0 : Math.PI, restY: 1.0 });
    }
  }
  function buildSerpentine() {
    const segGeom = new THREE.SphereGeometry(0.18, 8, 6);
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Mesh(segGeom, mat);
      seg.position.set(0.7 - i * 0.22, 0.25, 0);
      group.add(seg);
      segments.push({ mesh: seg, phase: i * 0.6 });
    }
  }
  function buildFish(shark: boolean) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(shark ? 0.4 : 0.28, 12, 8), mat);
    body.scale.set(1.8, 0.9, 0.7);
    body.position.set(0, 0.5, 0);
    group.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 6), mat);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-0.55, 0.5, 0);
    group.add(tail);
    finMesh = tail;
    if (shark) {
      const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), mat);
      dorsal.position.set(0, 0.85, 0);
      group.add(dorsal);
    }
  }
  function buildCephalopod() {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), mat);
    bulb.scale.set(1, 1.2, 1);
    bulb.position.set(0, 0.8, 0);
    group.add(bulb);
    const tGeom = new THREE.CylinderGeometry(0.04, 0.02, 0.6, 6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const t = new THREE.Mesh(tGeom, mat);
      t.position.set(Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18);
      group.add(t);
      segments.push({ mesh: t, phase: i * 0.4 });
    }
  }
  function buildPolyped() {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat);
    body.scale.set(1.3, 0.6, 1);
    body.position.set(0, 0.4, 0);
    group.add(body);
    const legGeom = new THREE.CylinderGeometry(0.025, 0.025, 0.4, 5);
    for (let i = 0; i < 6; i++) {
      const sgn = i % 2 === 0 ? 1 : -1;
      const leg = new THREE.Mesh(legGeom, mat);
      leg.position.set((Math.floor(i / 2) - 1) * 0.25, 0.2, sgn * 0.28);
      leg.rotation.x = sgn * 0.5;
      group.add(leg);
      limbs.push({ mesh: leg, phase: i * 0.5, restY: 0.2 });
    }
  }
  function buildBlob() {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), mat);
    blob.position.set(0, 0.5, 0);
    group.add(blob);
    segments.push({ mesh: blob, phase: 0 });
  }

  let t = 0;
  function tick(dt: number, speed = 1) {
    t += dt * (1.5 + Math.min(speed, 6) * 1.2);
    for (const l of limbs) {
      l.mesh.rotation.x = Math.sin(t + l.phase * Math.PI * 2) * 0.3;
    }
    for (const s of segments) {
      s.mesh.position.z = Math.sin(t + s.phase) * 0.08;
    }
    if (finMesh) finMesh.rotation.y = Math.sin(t * 1.5) * 0.4;
  }

  function dispose() {
    group.traverse((m) => {
      const mesh = m as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } };
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    });
  }

  return { group, tick, dispose };
}
