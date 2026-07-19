import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

const mockGltfLoad = vi.fn();
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(url: string, onLoad: (gltf: { scene: THREE.Group }) => void, _p: undefined, onError: (e: unknown) => void) {
      mockGltfLoad(url).then(onLoad, onError);
    }
  },
}));

const { buildBoneMap, HERO_MESH_CONSTANTS, loadHeroMesh, clearHeroMeshCache, getCachedHeroMesh } = await import(
  '@/lib/concordia/hero-mesh-registry'
);

function boneTree(names: string[]): THREE.Group {
  const root = new THREE.Group();
  for (const name of names) {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
  }
  return root;
}

describe('hero-mesh-registry buildBoneMap', () => {
  it('maps mixamorig:-prefixed bones to canonical names (Soldier/Michelle/Xbot convention)', () => {
    const root = boneTree(['mixamorig:Hips', 'mixamorig:LeftUpLeg', 'mixamorig:RightForeArm', 'NotABone']);
    const map = buildBoneMap(root);
    expect(map.get('Hips')?.name).toBe('mixamorig:Hips');
    expect(map.get('LeftUpLeg')?.name).toBe('mixamorig:LeftUpLeg');
    expect(map.get('RightForeArm')?.name).toBe('mixamorig:RightForeArm');
    expect(map.has('NotABone')).toBe(false);
  });

  it('maps bare canonical bone names with no prefix', () => {
    const root = boneTree(['Hips', 'Spine1', 'RightHand']);
    const map = buildBoneMap(root);
    expect(map.get('Hips')).toBeDefined();
    expect(map.get('Spine1')).toBeDefined();
    expect(map.get('RightHand')).toBeDefined();
  });

  it('maps 3ds Max Biped bone names (Microsoft Rocketbox convention) to canonical names', () => {
    const root = boneTree([
      'Bip01 Pelvis', 'Bip01 Spine', 'Bip01 Spine1', 'Bip01 Spine2', 'Bip01 Neck', 'Bip01 Head',
      'Bip01 L Clavicle', 'Bip01 L UpperArm', 'Bip01 L Forearm', 'Bip01 L Hand',
      'Bip01 R Clavicle', 'Bip01 R UpperArm', 'Bip01 R Forearm', 'Bip01 R Hand',
      'Bip01 L Thigh', 'Bip01 L Calf', 'Bip01 L Foot', 'Bip01 L Toe0',
      'Bip01 R Thigh', 'Bip01 R Calf', 'Bip01 R Foot', 'Bip01 R Toe0',
      // Non-canonical facial/finger bones present in the real rig — must be ignored, not crash.
      'Bip01 L Finger0', 'Bip01 MJaw', 'Bip01',
    ]);
    const map = buildBoneMap(root);
    for (const canonical of HERO_MESH_CONSTANTS.CANONICAL_BONES) {
      expect(map.has(canonical), `missing canonical bone ${canonical}`).toBe(true);
    }
    expect(map.get('Hips')?.name).toBe('Bip01 Pelvis');
    expect(map.get('LeftUpLeg')?.name).toBe('Bip01 L Thigh');
    expect(map.get('RightForeArm')?.name).toBe('Bip01 R Forearm');
    expect(map.size).toBe(HERO_MESH_CONSTANTS.CANONICAL_BONES.length);
  });

  it('ignores non-bone objects and unmapped bone names without throwing', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh());
    const stray = new THREE.Bone();
    stray.name = 'SomeVendorSpecificBoneName';
    root.add(stray);
    expect(() => buildBoneMap(root)).not.toThrow();
    expect(buildBoneMap(root).size).toBe(0);
  });
});

describe('hero-mesh-registry loadHeroMesh', () => {
  beforeEach(() => {
    clearHeroMeshCache();
    mockGltfLoad.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the bespoke per-NPC GLB when it exists', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: url.endsWith('/meshes/heroes/npc-1.glb') })));
    const scene = new THREE.Group();
    scene.add(Object.assign(new THREE.Bone(), { name: 'mixamorig:Hips' }));
    mockGltfLoad.mockResolvedValue({ scene });

    const result = await loadHeroMesh('npc-1', 'warrior');
    expect(result?.source).toBe('bespoke');
    expect(result?.npcId).toBe('npc-1');
    expect(result?.boneMap.has('Hips')).toBe(true);
    expect(mockGltfLoad).toHaveBeenCalledWith('/meshes/heroes/npc-1.glb');
  });

  it('falls through to the archetype GLB when no bespoke mesh exists', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve({ ok: url === '/meshes/heroes/_archetype_warrior.glb' })
    ));
    mockGltfLoad.mockResolvedValue({ scene: new THREE.Group() });

    const result = await loadHeroMesh('npc-2', 'warrior');
    expect(result?.source).toBe('archetype');
    expect(mockGltfLoad).toHaveBeenCalledWith('/meshes/heroes/_archetype_warrior.glb');
  });

  it('tries the per-world archetype variant before the universal one when homeWorldId is given', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve({ ok: url === '/meshes/heroes/_archetype_warrior__concordia-hub.glb' })
    ));
    mockGltfLoad.mockResolvedValue({ scene: new THREE.Group() });

    const result = await loadHeroMesh('npc-3', 'warrior', 'concordia-hub');
    expect(result?.source).toBe('archetype-world');
  });

  it('returns null (honest fallback signal) when nothing exists for this npc/archetype', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    const result = await loadHeroMesh('npc-4', 'unknown-archetype');
    expect(result).toBeNull();
    expect(mockGltfLoad).not.toHaveBeenCalled();
  });

  it('caches by npcId + homeWorldId and does not re-fetch on the second call', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: url === '/meshes/heroes/npc-5.glb' })));
    mockGltfLoad.mockResolvedValue({ scene: new THREE.Group() });

    const first = await loadHeroMesh('npc-5', 'warrior');
    const second = await loadHeroMesh('npc-5', 'warrior');
    expect(second).toBe(first);
    expect(mockGltfLoad).toHaveBeenCalledTimes(1);
    expect(getCachedHeroMesh('npc-5')).toBe(first);
  });
});
