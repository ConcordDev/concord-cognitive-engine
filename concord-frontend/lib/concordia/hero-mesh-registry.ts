/**
 * Hero mesh registry — Sprint D / DD1-DD4
 *
 * Lazy GLTF loader for named-character ("hero") NPCs. Authored NPCs gain
 * `hero_mesh: true` in their JSON; AvatarSystem3D's createAvatarMesh
 * dispatches to this registry when the flag is set, falls back to the
 * BB1 procedural-skinned humanoid otherwise.
 *
 * Fallback chain (DD4):
 *   1. /meshes/heroes/<npc_id>.glb        (per-NPC bespoke)
 *   2. /meshes/heroes/_archetype_<arch>.glb (shared archetype mesh)
 *   3. BB1 procedural skinned humanoid    (graceful fallback)
 *   4. primitive-Group humanoid           (last-resort, current shipping)
 *
 * Bone hierarchy MUST follow Mixamo / VRM 1.0 humanoid names so the
 * existing gait-synthesis bone outputs apply directly.
 */

import * as THREE from 'three';

export interface HeroMeshLoadResult {
  group:         THREE.Group;
  source:        'bespoke' | 'archetype' | 'procedural' | 'primitive';
  npcId:         string;
  /** Map of canonical bone names to THREE.Bone instances (Mixamo names). */
  boneMap:       Map<string, THREE.Bone>;
}

const cache = new Map<string, HeroMeshLoadResult>();
let loaderPromise: Promise<{ load: (url: string) => Promise<{ scene: THREE.Group }> }> | null = null;

async function getLoader() {
  if (loaderPromise) return loaderPromise;
  loaderPromise = (async () => {
    // Dynamic import so SSR / tests don't pull GLTFLoader unless needed.
    const mod = await import(
      // @ts-expect-error — GLTFLoader is a runtime addon
      'three/examples/jsm/loaders/GLTFLoader.js'
    );
    const Loader = mod.GLTFLoader;
    const loader = new Loader();
    return {
      load: (url: string) => new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        loader.load(url, (gltf: { scene: THREE.Group }) => resolve(gltf), undefined, reject);
      }),
    };
  })();
  return loaderPromise;
}

const ARCHETYPE_FALLBACK_PATH: Record<string, string> = {
  warrior: '/meshes/heroes/_archetype_warrior.glb',
  guard:   '/meshes/heroes/_archetype_guard.glb',
  scholar: '/meshes/heroes/_archetype_scholar.glb',
  mystic:  '/meshes/heroes/_archetype_mystic.glb',
  hunter:  '/meshes/heroes/_archetype_hunter.glb',
  trader:  '/meshes/heroes/_archetype_trader.glb',
  legend:  '/meshes/heroes/_archetype_legend.glb',
};

/**
 * Try to load a hero mesh. Returns null if not available — caller falls
 * back to the procedural BB1 path.
 */
export async function loadHeroMesh(npcId: string, archetype: string): Promise<HeroMeshLoadResult | null> {
  if (cache.has(npcId)) return cache.get(npcId)!;

  const candidates: { url: string; source: HeroMeshLoadResult['source'] }[] = [
    { url: `/meshes/heroes/${npcId}.glb`, source: 'bespoke' },
  ];
  if (ARCHETYPE_FALLBACK_PATH[archetype]) {
    candidates.push({ url: ARCHETYPE_FALLBACK_PATH[archetype], source: 'archetype' });
  }

  for (const candidate of candidates) {
    try {
      const exists = await checkExists(candidate.url);
      if (!exists) continue;
      const loader = await getLoader();
      const gltf = await loader.load(candidate.url);
      const boneMap = buildBoneMap(gltf.scene);
      const result: HeroMeshLoadResult = {
        group: gltf.scene,
        source: candidate.source,
        npcId,
        boneMap,
      };
      cache.set(npcId, result);
      return result;
    } catch (err) {
      // Try next candidate.
      void err;
    }
  }
  return null;
}

async function checkExists(url: string): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}

/**
 * Walk the loaded GLTF scene and map standard Mixamo / VRM 1.0 bone names
 * to actual THREE.Bone instances. Tolerates `mixamorig:` prefix and case
 * variations.
 */
const CANONICAL_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

function buildBoneMap(root: THREE.Object3D): Map<string, THREE.Bone> {
  const m = new Map<string, THREE.Bone>();
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const bone = obj as THREE.Bone;
    let name = bone.name;
    name = name.replace(/^mixamorig:?/i, '').replace(/^Armature\|/, '');
    if (CANONICAL_BONES.includes(name)) m.set(name, bone);
  });
  return m;
}

/** Cache control for tests. */
export function clearHeroMeshCache(): void { cache.clear(); }

export function getCachedHeroMesh(npcId: string): HeroMeshLoadResult | null {
  return cache.get(npcId) ?? null;
}

export const HERO_MESH_CONSTANTS = Object.freeze({
  ARCHETYPE_FALLBACK_PATH,
  CANONICAL_BONES,
});
