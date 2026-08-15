/**
 * procedural-character-detail.ts
 *
 * TypeScript counterpart to procedural_character_detail.gd.
 * Adds real visual detail to AvatarSystem3D meshes.
 */

import * as THREE from 'three';

export type Archetype = 'tunya' | 'sovereign' | 'concordia' | 'concord';

export interface ArchetypeConfig {
  skinTone: THREE.Color;
  skinDetail: string;
  hairColor: THREE.Color;
  hairStyle: string;
  eyeColor: THREE.Color;
  clothTop: THREE.Color;
  clothBottom: THREE.Color;
  boots: THREE.Color;
  tattoos: string[];
  accessories: string[];
}

export const ARCHETYPE_DETAIL: Record<Archetype, ArchetypeConfig> = {
  tunya: {
    skinTone: new THREE.Color(0.78, 0.62, 0.45),
    skinDetail: 'freckles_dense',
    hairColor: new THREE.Color(0.36, 0.24, 0.15),
    hairStyle: 'long_braided',
    eyeColor: new THREE.Color(0.55, 0.4, 0.2),
    clothTop: new THREE.Color(0.55, 0.45, 0.30),
    clothBottom: new THREE.Color(0.42, 0.36, 0.27),
    boots: new THREE.Color(0.30, 0.22, 0.15),
    tattoos: ['prairie_lattice_left_arm', 'sun_disc_back'],
    accessories: ['ranger_belt', 'lasso_loop'],
  },
  sovereign: {
    skinTone: new THREE.Color(0.85, 0.78, 0.70),
    skinDetail: 'scar_left_cheek',
    hairColor: new THREE.Color(0.08, 0.06, 0.05),
    hairStyle: 'swept_back',
    eyeColor: new THREE.Color(0.20, 0.25, 0.35),
    clothTop: new THREE.Color(0.18, 0.18, 0.22),
    clothBottom: new THREE.Color(0.12, 0.12, 0.16),
    boots: new THREE.Color(0.06, 0.06, 0.08),
    tattoos: ['refusal_glyph_chest', 'void_mark_neck'],
    accessories: ['refusal_field_emitter', 'hood'],
  },
  concordia: {
    skinTone: new THREE.Color(0.82, 0.68, 0.55),
    skinDetail: 'copper_freckles',
    hairColor: new THREE.Color(0.45, 0.28, 0.15),
    hairStyle: 'long_wavy',
    eyeColor: new THREE.Color(0.45, 0.30, 0.18),
    clothTop: new THREE.Color(0.65, 0.40, 0.20),
    clothBottom: new THREE.Color(0.45, 0.30, 0.18),
    boots: new THREE.Color(0.40, 0.27, 0.16),
    tattoos: ['copper_lattice_arms', 'sun_disc_wrist'],
    accessories: ['witness_pin', 'satchel'],
  },
  concord: {
    skinTone: new THREE.Color(0.88, 0.80, 0.72),
    skinDetail: 'ink_stains_fingers',
    hairColor: new THREE.Color(0.20, 0.18, 0.16),
    hairStyle: 'short_neat',
    eyeColor: new THREE.Color(0.30, 0.32, 0.38),
    clothTop: new THREE.Color(0.35, 0.38, 0.42),
    clothBottom: new THREE.Color(0.25, 0.27, 0.32),
    boots: new THREE.Color(0.18, 0.18, 0.20),
    tattoos: ['code_glyph_forearm', 'ledger_mark_hand'],
    accessories: ['stylus_holster', 'ledger_clutch'],
  },
};

interface TattooSpec {
  color: THREE.Color;
  intensity: number;
  position: [number, number, number];
}

const TATTOO_SPECS: Record<string, TattooSpec> = {
  refusal_glyph_chest:      { color: new THREE.Color(0.4, 0.3, 0.6),    intensity: 0.8, position: [0, 1.45, 0.21] },
  void_mark_neck:           { color: new THREE.Color(0.2, 0.15, 0.3),   intensity: 0.6, position: [0, 1.7,  0.05] },
  copper_lattice_arms:      { color: new THREE.Color(0.85, 0.55, 0.20), intensity: 0.5, position: [0.32, 1.0, 0] },
  sun_disc_wrist:           { color: new THREE.Color(0.95, 0.7, 0.30),  intensity: 0.4, position: [0.45, 0.7, 0.05] },
  sun_disc_back:            { color: new THREE.Color(0.95, 0.7, 0.30),  intensity: 0.4, position: [0, 1.5, -0.21] },
  prairie_lattice_left_arm: { color: new THREE.Color(0.35, 0.20, 0.10), intensity: 0.3, position: [-0.32, 1.0, 0] },
  code_glyph_forearm:       { color: new THREE.Color(0.20, 0.45, 0.65), intensity: 0.4, position: [0.30, 1.0, 0.10] },
  ledger_mark_hand:         { color: new THREE.Color(0.15, 0.15, 0.20), intensity: 0.3, position: [0.50, 0.5, 0] },
};

const _matCache = new Map<string, THREE.MeshStandardMaterial>();

function stdMat(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify({ color, ...opts });
  if (_matCache.has(key)) return _matCache.get(key) as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardMaterial({ color, ...opts });
  _matCache.set(key, m);
  return m;
}

interface AccessorySpec {
  factory: () => THREE.Object3D;
  position: [number, number, number];
  rotation?: [number, number, number];
}

const ACCESSORY_SPECS: Record<string, AccessorySpec> = {
  hood: {
    factory: () => new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 16), stdMat(0x1a1a24, { roughness: 0.9 })),
    position: [0, 1.95, -0.05],
  },
  ranger_belt: {
    factory: () => new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.022, 8, 24), stdMat(0x4d3826, { roughness: 0.7 })),
    position: [0, 0.95, 0],
    rotation: [Math.PI / 2, 0, 0],
  },
  lasso_loop: {
    factory: () => new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 24), stdMat(0x80664d)),
    position: [0, 0.6, 0],
    rotation: [Math.PI / 2, 0, 0],
  },
  satchel: {
    factory: () => new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.20, 0.10), stdMat(0x664d33, { roughness: 0.85 })),
    position: [-0.25, 1.0, 0],
  },
  witness_pin: {
    factory: () => new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.005, 16), stdMat(0xd98c33, { emissive: 0xd98c33, emissiveIntensity: 0.3 })),
    position: [0.15, 1.4, 0.21],
  },
  stylus_holster: {
    factory: () => new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.005, 0.18, 8), stdMat(0x2e2e33, { metalness: 0.6, roughness: 0.4 })),
    position: [-0.18, 1.0, 0.10],
    rotation: [0, 0, Math.PI / 6],
  },
  ledger_clutch: {
    factory: () => new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.04), stdMat(0x735940, { roughness: 0.85 })),
    position: [0.20, 0.95, 0.12],
  },
  refusal_field_emitter: {
    factory: () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), stdMat(0x664d99, { emissive: 0x664d99, emissiveIntensity: 1.5, transparent: true, opacity: 0.6 }));
      m.name = 'RefusalEmitter';
      return m;
    },
    position: [0, 1.5, 0.18],
  },
};

/** Apply archetype detail to an existing mesh group. */
export function applyCharacterDetail(root: THREE.Group, archetype: Archetype): void {
  const cfg = ARCHETYPE_DETAIL[archetype];
  if (!cfg) return;
  applyColors(root, cfg);
  addTattoos(root, cfg.tattoos);
  const accessories = addAccessories(root, cfg.accessories);
  if (accessories.refusal_field_emitter) {
    pulseEmitter(accessories.refusal_field_emitter);
  }
}

function applyColors(root: THREE.Group, cfg: ArchetypeConfig): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const name = child.name.toLowerCase();
    if (!(child.material instanceof THREE.MeshStandardMaterial)) {
      child.material = new THREE.MeshStandardMaterial();
    }
    const mat = child.material as THREE.MeshStandardMaterial;
    if (name.includes('skin') || name.includes('head')) {
      mat.color.copy(cfg.skinTone); mat.roughness = 0.65;
    } else if (name.includes('hair')) {
      mat.color.copy(cfg.hairColor); mat.roughness = 0.75;
    } else if (name.includes('top') || name.includes('torso') || name.includes('shirt')) {
      mat.color.copy(cfg.clothTop); mat.roughness = 0.85;
    } else if (name.includes('bottom') || name.includes('leg') || name.includes('pants')) {
      mat.color.copy(cfg.clothBottom); mat.roughness = 0.85;
    } else if (name.includes('boot') || name.includes('foot')) {
      mat.color.copy(cfg.boots); mat.roughness = 0.80;
    }
    mat.needsUpdate = true;
  });
}

function addTattoos(root: THREE.Group, tattooIds: string[]): void {
  for (const tid of tattooIds) {
    const spec = TATTOO_SPECS[tid];
    if (!spec) continue;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.06, 0, 0),
      new THREE.Vector3( 0.06, 0, 0),
      new THREE.Vector3( 0,    0.015, 0),
      new THREE.Vector3( 0.03, -0.015, 0),
      new THREE.Vector3(-0.03, -0.015, 0),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: spec.intensity,
    });
    const line = new THREE.Line(geo, mat);
    line.position.set(spec.position[0], spec.position[1], spec.position[2]);
    root.add(line);
  }
}

function addAccessories(root: THREE.Group, accessoryIds: string[]): Record<string, THREE.Object3D> {
  const result: Record<string, THREE.Object3D> = {};
  for (const aid of accessoryIds) {
    const spec = ACCESSORY_SPECS[aid];
    if (!spec) continue;
    const mesh = spec.factory();
    mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
    if (spec.rotation) mesh.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
    root.add(mesh);
    result[aid] = mesh;
  }
  return result;
}

function pulseEmitter(emitter: THREE.Object3D): void {
  const start = performance.now();
  const animate = () => {
    const t = (performance.now() - start) / 1000;
    const pulse = 0.7 + 0.3 * Math.sin(t * 2.0);
    emitter.scale.setScalar(pulse);
    requestAnimationFrame(animate);
  };
  animate();
}

export default { ARCHETYPE_DETAIL, applyCharacterDetail };
