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
import { createArmorSet, type ArmorAppearance, type ArmorSlot } from '@/lib/concordia/armor-system';

export interface HeroMeshLoadResult {
  group:         THREE.Group;
  source:        'bespoke' | 'archetype-world' | 'archetype' | 'procedural' | 'primitive';
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
    // Modern Three.js ships GLTFLoader types under three/examples/jsm,
    // so no @ts-expect-error needed; if a future version drops them,
    // the build will surface a clear error here.
    const mod = await import('three/examples/jsm/loaders/GLTFLoader.js') as { GLTFLoader: new () => unknown };
    type GLTFLoaderInstance = { load: (url: string, onLoad: (gltf: { scene: THREE.Group }) => void, onProgress?: undefined, onError?: (err: unknown) => void) => void };
    const Loader = mod.GLTFLoader;
    const loader = new Loader() as GLTFLoaderInstance;
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

// Authored NPC occupations (content/world/*/npcs.json) are free-text —
// "beat cop", "hedge-mage", "getaway driver" — not the 7 archetype keys
// above. AvatarSystem3D previously only ever set `isHero: true` for 4
// hardcoded named goddess NPCs, so the real GLB archetype meshes were
// effectively dead code for the rest of the world's population, which all
// stayed on the procedural/primitive fallback. Keyword-matched so most
// occupations resolve to a real mesh; genuinely ambiguous ones (e.g.
// "lookout", "analyst") fall through to null, which callers already treat
// as "no hero mesh — use the procedural path", so this never worsens
// coverage, only improves it.
const OCCUPATION_KEYWORDS: [RegExp, string][] = [
  [/guard|enforc|beat cop|bagman|lookout/i, 'guard'],
  [/hunt|beast-tamer|tracker/i, 'hunter'],
  [/mage|mystic|rune|hedge|heal|priest|shaman|witch/i, 'mystic'],
  [/scholar|archiv|lore|scribe|analy|lab tech|reporter|investigat/i, 'scholar'],
  [/trad|fence|fix|broker|runner|corpo|pilgrim|farm|merchant|vendor/i, 'trader'],
  // 'warrior' itself must be in this list: routes/worlds.js's occupation
  // field falls back to the raw archetype column (`state.occupation ||
  // r.archetype`) when no live routine occupation is set, so an
  // authored NPC's archetype string ("warrior") is frequently the
  // occupation text verbatim — every other archetype's own name already
  // self-matched its keyword list (guard/hunt.../mystic/scholar/trad...);
  // warrior's list was the one gap, silently stranding every
  // warrior-archetype NPC on the procedural fallback.
  [/warrior|sword|sellsword|vigilante|getaway|forg|smith|tinker|netrunner|ripperdoc|drone-tech|informant|forger/i, 'warrior'],
];

/**
 * Best-effort map from a free-text NPC occupation string to one of the 7
 * authored archetype keys. Returns null for no confident match — callers
 * should treat that as "stay on the procedural path", never force a guess.
 */
export function archetypeForOccupation(occupation: string | null | undefined): string | null {
  if (!occupation) return null;
  for (const [re, archetype] of OCCUPATION_KEYWORDS) {
    if (re.test(occupation)) return archetype;
  }
  return null;
}

/**
 * Try to load a hero mesh. Returns null if not available — caller falls
 * back to the procedural BB1 path.
 *
 * Phase S/T extension: `homeWorldId` lets a travelling NPC carry their
 * world's visual identity. A courier from `concord-link-frontier`
 * visiting concordia-hub still loads
 * `_archetype_trader__concord-link-frontier.glb`. If the per-world GLB
 * doesn't exist, falls through to the universal archetype.
 */
export async function loadHeroMesh(
  npcId: string,
  archetype: string,
  homeWorldId?: string,
  armor?: ArmorAppearance,
): Promise<HeroMeshLoadResult | null> {
  const cacheKey = `${npcId}::${homeWorldId ?? ''}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const candidates: { url: string; source: HeroMeshLoadResult['source'] }[] = [
    { url: `/meshes/heroes/${npcId}.glb`, source: 'bespoke' },
  ];
  if (homeWorldId && ARCHETYPE_FALLBACK_PATH[archetype]) {
    candidates.push({
      url: `/meshes/heroes/_archetype_${archetype}__${homeWorldId}.glb`,
      source: 'archetype-world',
    });
  }
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
      if (armor) attachArmorToHeroMesh(gltf.scene, boneMap, armor);
      const result: HeroMeshLoadResult = {
        group: gltf.scene,
        source: candidate.source,
        npcId,
        boneMap,
      };
      cache.set(cacheKey, result);
      return result;
    } catch (err) {
      // Try next candidate.
      void err;
    }
  }
  return null;
}

// Slot -> which bone(s) to try, in priority order. Real skinned rigs
// (Mixamo / 3ds Max Biped, both normalized into CANONICAL_BONES by
// buildBoneMap) always carry Hips/Head; Spine2 is present on most but
// not universally, hence the Spine1/Spine fallback chain for 'arms'.
const ARMOR_SLOT_BONES: Record<ArmorSlot, readonly string[]> = {
  head:  ['Head'],
  torso: ['Hips'],
  arms:  ['Spine2', 'Spine1', 'Spine'],
  legs:  ['Hips'],
};

/**
 * Attaches a real per-character armor set (armor-system.ts, grounded in
 * real material reference data — see material-reference-palettes.ts) onto
 * a loaded hero GLB's skeleton, so hero NPCs wear their armor too, not
 * just the procedural-body population (enhanced-avatar-builder.ts).
 *
 * Uses `Object3D.attach()` — the standard three.js technique for parenting
 * a freshly-built object onto a bone while landing it at the bone's
 * current WORLD position with identity world-rotation (not the bone's own
 * local rest-pose rotation, which for a limb bone typically points along
 * the limb rather than world-up and would otherwise leave the armor
 * piece sideways). `attach()` recomputes the local transform under the
 * new parent to preserve whatever world transform the object had at
 * attach time — the piece then moves/rotates WITH the bone as the rig
 * animates, correct equipped-item behavior.
 *
 * `root.updateMatrixWorld(true)` first forces the (never-yet-rendered)
 * skeleton's rest-pose world matrices to compute — otherwise every
 * bone's matrixWorld is still the uninitialized identity default and
 * every piece would land at the mesh's local origin.
 *
 * A slot with no matching bone on this particular skeleton is skipped,
 * never thrown — a partial armor kit beats a crashed avatar.
 */
export function attachArmorToHeroMesh(root: THREE.Group, boneMap: Map<string, THREE.Bone>, armor: ArmorAppearance): void {
  root.updateMatrixWorld(true);
  const armorSet = createArmorSet(armor);
  const worldPos = new THREE.Vector3();
  for (const [slot, piece] of armorSet) {
    const bone = ARMOR_SLOT_BONES[slot].map((n) => boneMap.get(n)).find((b): b is THREE.Bone => !!b);
    if (!bone) continue;
    bone.getWorldPosition(worldPos);
    piece.position.copy(worldPos);
    piece.quaternion.identity();
    piece.scale.setScalar(1);
    piece.traverse((obj) => { (obj as THREE.Mesh).castShadow = true; });
    bone.attach(piece);
  }
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

// 3ds Max Biped rig (Microsoft Rocketbox and other Max-authored characters
// export with this convention) -> canonical Mixamo name. Space-separated,
// not a prefix, so this needs an explicit table rather than a regex strip.
const BIPED_TO_CANONICAL: Record<string, string> = {
  'Bip01 Pelvis': 'Hips',
  'Bip01 Spine': 'Spine',
  'Bip01 Spine1': 'Spine1',
  'Bip01 Spine2': 'Spine2',
  'Bip01 Neck': 'Neck',
  'Bip01 Head': 'Head',
  'Bip01 L Clavicle': 'LeftShoulder',
  'Bip01 L UpperArm': 'LeftArm',
  'Bip01 L Forearm': 'LeftForeArm',
  'Bip01 L Hand': 'LeftHand',
  'Bip01 R Clavicle': 'RightShoulder',
  'Bip01 R UpperArm': 'RightArm',
  'Bip01 R Forearm': 'RightForeArm',
  'Bip01 R Hand': 'RightHand',
  'Bip01 L Thigh': 'LeftUpLeg',
  'Bip01 L Calf': 'LeftLeg',
  'Bip01 L Foot': 'LeftFoot',
  'Bip01 L Toe0': 'LeftToeBase',
  'Bip01 R Thigh': 'RightUpLeg',
  'Bip01 R Calf': 'RightLeg',
  'Bip01 R Foot': 'RightFoot',
  'Bip01 R Toe0': 'RightToeBase',
};

/** Exported for tests — maps a loaded skeleton's actual bone names (Mixamo
 *  or 3ds Max Biped) to canonical Mixamo bone names. */
export function buildBoneMap(root: THREE.Object3D): Map<string, THREE.Bone> {
  const m = new Map<string, THREE.Bone>();
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const bone = obj as THREE.Bone;
    const raw = bone.name;
    const stripped = raw.replace(/^mixamorig:?/i, '').replace(/^Armature\|/, '');
    if (CANONICAL_BONES.includes(stripped)) {
      m.set(stripped, bone);
    } else if (BIPED_TO_CANONICAL[raw]) {
      m.set(BIPED_TO_CANONICAL[raw], bone);
    }
  });
  return m;
}

/** Cache control for tests. */
export function clearHeroMeshCache(): void { cache.clear(); }

export function getCachedHeroMesh(npcId: string, homeWorldId?: string): HeroMeshLoadResult | null {
  return cache.get(`${npcId}::${homeWorldId ?? ''}`) ?? null;
}

export const HERO_MESH_CONSTANTS = Object.freeze({
  ARCHETYPE_FALLBACK_PATH,
  CANONICAL_BONES,
});
