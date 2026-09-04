// server/lib/unity-bridge.js
//
// Unity is a presentation client of the Concord kernel — not a second sim.
// `mountUnityGateway` is mounted from server.js next to `/godot-ws` at
// `/unity-ws`. Same WebSocket primitive, same auth, same rooms, same
// `{evt,data}` envelope. Combat is `combat:attack` (not `unity:combat:attack`)
// so `_onGodotClientMessage` → `_dispatchGodotCombatAttack` → `applyAttack`
// is the one resolver.
//
// `UNITY_MESSAGE_TYPES` below is the unused prefixed-envelope experiment.
// The in-repo Editor client (`apps/concordia-living-world/unity-client/`)
// speaks the Godot envelope. Do not revive a parallel combat math path.
//
// Scene helpers (`toUnityScene`, asset lists) still decorate the shared
// descriptor for Unity-specific materials/shaders.

import { mountGodotGateway } from './godot-gateway.js';

export const UNITY_MESSAGE_TYPES = {
  CLIENT_HELLO: 'unity:hello',
  SCENE_REQUEST: 'unity:scene:request',
  SCENE_DATA: 'unity:scene:data',
  ASSET_REQUEST: 'unity:asset:request',
  ASSET_DATA: 'unity:asset:data',
  PLAYER_MOVE: 'unity:player:move',
  PLAYER_MOVE_ACK: 'unity:player:move:ack',
  PLAYER_MOVE_NACK: 'unity:player:move:nack',
  COMBAT: 'unity:combat:attack',
  PORTAL_ENTER: 'unity:portal:enter',
  PORTAL_EXIT: 'unity:portal:exit',
};

/**
 * Mount the Unity Editor / standalone client at /unity-ws.
 * Same protocol as /godot-ws. Pass the same `onClientMessage` the Godot
 * mount uses so combat/move hit the kernel once.
 * @param {import('http').Server} server
 * @param {object} deps
 * @returns {object}
 */
export function mountUnityGateway(server, deps) {
  const verifyToken = async (token) => {
    if (token && token !== "unity-local-guest" && typeof deps.verifyToken === "function") {
      const hit = await deps.verifyToken(token);
      if (hit) return hit;
    }
    // Kitchen / Editor guest. Production still requires a real bearer —
    // never a fabricated world, only a socket identity so /unity-ws can speak.
    if (process.env.NODE_ENV !== "production" && (!token || token === "unity-local-guest")) {
      return { userId: "unity-local-guest" };
    }
    return null;
  };
  const getUser = async (userId) => {
    if (userId === "unity-local-guest") {
      return { id: "unity-local-guest", username: "unity-local" };
    }
    if (typeof deps.getUser === "function") return deps.getUser(userId);
    return null;
  };
  return mountGodotGateway(server, {
    ...deps,
    verifyToken,
    getUser,
    path: '/unity-ws',
    clientHint: 'unity',
  });
}

/**
 * Build a Unity-compatible scene descriptor from the existing exportScene.
 * Unity reads the same JSON, with Unity-specific extras for materials, lighting,
 * and shader hints (Unity uses Shader Graph / Standard Shader).
 *
 * @param {object} sceneDescriptor  output from exportScene(db, worldId)
 * @returns {object} unitySceneDescriptor
 */
export function toUnityScene(sceneDescriptor) {
  if (!sceneDescriptor || !sceneDescriptor.ok) return sceneDescriptor;
  return {
    ...sceneDescriptor,
    format: 'concord-unity-scene/v1',
    engineHints: {
      unityVersion: '2022.3+',
      renderPipeline: 'universal',
      shaderModel: 'standard',
      // Unity reads the same .gltf/.glb files Three.js + Godot use
      assetFormat: 'glb',
      // Unity's "Standard Assets" First Person Controller hooks into player:move
      controllers: {
        first_person: true,
        third_person: true,
        // Camera follows player per character_controller.gd pattern
        follow_camera: true,
      },
    },
    // Unity-specific: pre-warmed asset bundles for the world
    assetBundles: sceneDescriptor.nodes?.map(n => ({
      nodeId: n.id,
      assetUrl: n.url || `/models/${n.kind}/${n.id}.glb`,
      // Unity's "asset" is a GameObject with mesh + materials + colliders
      gameObjectHint: {
        needsMeshRenderer: true,
        needsCollider: n.collidable !== false,
        needsRigidbody: n.kinematic === false,
      },
    })) || [],
  };
}

/**
 * Build a Unity asset list for the asset-bundle downloader.
 * Unity prefabs ship as .prefab (YAML), but Unity can also import .glb directly
 * via GLTFImporter (com.unity.formats.glb). We use .glb for cross-client compatibility.
 *
 * @param {string} worldId
 * @returns {Array<{kind:string, id:string, glbUrl:string, thumbnailUrl:string|null}>}
 */
export function getUnityAssetList(worldId) {
  const registry = {
    'concordia-hub': [
      { kind: 'building', id: 'forge', glbUrl: '/models/building/forge.glb' },
      { kind: 'building', id: 'tower', glbUrl: '/models/building/tower.glb' },
      { kind: 'building', id: 'market', glbUrl: '/models/building/market.glb' },
      { kind: 'building', id: 'tavern', glbUrl: '/models/building/tavern.glb' },
      { kind: 'building', id: 'archive', glbUrl: '/models/building/archive.glb' },
      { kind: 'building', id: 'kenney-city-garage', glbUrl: '/models/building/kenney_city/models/building-garage.glb' },
      { kind: 'building', id: 'kenney-city-small-a', glbUrl: '/models/building/kenney_city/models/building-small-a.glb' },
      { kind: 'building', id: 'kenney-city-small-b', glbUrl: '/models/building/kenney_city/models/building-small-b.glb' },
      { kind: 'building', id: 'kenney-city-small-c', glbUrl: '/models/building/kenney_city/models/building-small-c.glb' },
      { kind: 'building', id: 'kenney-city-small-d', glbUrl: '/models/building/kenney_city/models/building-small-d.glb' },
      { kind: 'terrain', id: 'road-straight', glbUrl: '/models/building/kenney_city/models/road-straight.glb' },
      { kind: 'terrain', id: 'road-intersection', glbUrl: '/models/building/kenney_city/models/road-intersection.glb' },
      { kind: 'terrain', id: 'pavement', glbUrl: '/models/building/kenney_city/models/pavement.glb' },
      { kind: 'terrain', id: 'grass', glbUrl: '/models/building/kenney_city/models/grass.glb' },
      { kind: 'vegetation', id: 'kenney-trees', glbUrl: '/models/building/kenney_city/models/grass-trees.glb' },
    ],
    cyber: [
      { kind: 'creature', id: 'quadruped_01', glbUrl: '/models/creature/quadruped_01.glb' },
      { kind: 'building', id: 'server-rack', glbUrl: '/models/prop/server-rack.glb' },
    ],
    fantasy: [
      { kind: 'building', id: 'forge', glbUrl: '/models/building/forge.glb' },
      { kind: 'building', id: 'tavern', glbUrl: '/models/building/tavern.glb' },
    ],
    crime: [
      { kind: 'building', id: 'kenney-city-garage', glbUrl: '/models/building/kenney_city/models/building-garage.glb' },
    ],
    superhero: [
      { kind: 'building', id: 'kenney-city-small-c', glbUrl: '/models/building/kenney_city/models/building-small-c.glb' },
    ],
    'concord-link-frontier': [
      { kind: 'building', id: 'tower', glbUrl: '/models/building/tower.glb' },
    ],
    'lattice-crucible': [
      { kind: 'terrain', id: 'road-straight', glbUrl: '/models/building/kenney_city/models/road-straight.glb' },
    ],
    'sovereign-ruins': [
      { kind: 'building', id: 'tower', glbUrl: '/models/building/tower.glb' },
      { kind: 'vegetation', id: 'kenney-trees-tall', glbUrl: '/models/building/kenney_city/models/grass-trees-tall.glb' },
    ],
    tunya: [
      { kind: 'terrain', id: 'grass', glbUrl: '/models/building/kenney_city/models/grass.glb' },
      { kind: 'vegetation', id: 'kenney-trees-tall', glbUrl: '/models/building/kenney_city/models/grass-trees-tall.glb' },
    ],
  };
  return registry[worldId] || [];
}

/**
 * Generate Unity WebGL build settings (for inclusion in project.godot-equivalent
 * Unity scene file). Returns the BuildSettings JSON that a Unity build script
 * would consume.
 *
 * @param {string} sceneName
 * @param {Array} sceneAssets
 * @returns {object}
 */
export function unityBuildSettings(sceneName, sceneAssets) {
  return {
    scenes: [
      {
        path: `Assets/Scenes/${sceneName}.unity`,
        enabled: true,
      },
    ],
    bundleAssets: sceneAssets.map(a => ({
      assetPath: a.glbUrl.replace('/models/', 'Assets/Models/'),
      bundleName: `${a.kind}-${a.id}`,
    })),
    webgl: {
      compressionFormat: 'brotli',
      developmentBuild: false,
      memorySize: 512,
      threading: 'disabled', // Sandboxed environment
    },
  };
}

export default {
  mountUnityGateway,
  toUnityScene,
  getUnityAssetList,
  unityBuildSettings,
  UNITY_MESSAGE_TYPES,
};
