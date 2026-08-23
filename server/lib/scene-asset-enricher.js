// server/lib/scene-asset-enricher.js
//
// Enriches the exportScene output with:
// 1. Per-world combat styles (from world-combat-styles.js)
// 2. Asset URLs (Kenney, KayKit, Polygonal Mind) per building slot
// 3. Unity client hints (engineHints)
// 4. Three.js client hints (cel-shading, soft shadows, ssgi)
// 5. Godot client hints (forward+, outline, SDFGI)
//
// This runs on the SERVER before shipping the scene to the client, so all
// three clients (Three.js, Godot 4, Unity WebGL) get the SAME enriched
// descriptor and render the SAME world.

import { getWorldCombatStyle } from './world-combat-styles.js';
import { toUnityScene, getUnityAssetList } from './unity-bridge.js';

/**
 * Map a building type/archetype to a GLB URL.
 * Tries the asset list first, falls back to procedural.
 */
function buildingToAssetUrl(node) {
  const type = node.buildingType || node.kind || node.archetype || 'unknown';
  const id = node.id || type;

  // Try Kenney city builder first (we just downloaded it)
  const kenneyMap = {
    'small-shop': '/models/building/kenney_city/models/building-small-a.glb',
    'medium-shop': '/models/building/kenney_city/models/building-small-b.glb',
    'tall-building': '/models/building/kenney_city/models/building-small-c.glb',
    'wide-building': '/models/building/kenney_city/models/building-small-d.glb',
    'garage': '/models/building/kenney_city/models/building-garage.glb',
    'pavement': '/models/building/kenney_city/models/pavement.glb',
    'road-straight': '/models/building/kenney_city/models/road-straight.glb',
    'road-intersection': '/models/building/kenney_city/models/road-intersection.glb',
    'grass': '/models/building/kenney_city/models/grass.glb',
    'trees': '/models/building/kenney_city/models/grass-trees.glb',
    'trees-tall': '/models/building/kenney_city/models/grass-trees-tall.glb',
  };

  if (kenneyMap[type]) return kenneyMap[type];

  // Try KayKit / Polygonal Mind (already in CREDITS.md)
  const kayKitMap = {
    'tavern': '/models/building/tavern.glb',
    'market': '/models/building/market.glb',
    'archive': '/models/building/archive.glb',
    'forge': '/models/building/forge.glb',
    'tower': '/models/building/tower.glb',
  };

  // Try Kenney Mini Arena (basic_scene) — fantasy / superhero / cyber NPCs
  const kenneyArenaMap = {
    'npc-soldier': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/character-soldier.glb',
    'tree-mega': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/tree.glb',
    'wall-gate': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/wall-gate.glb',
    'wall-stone': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/wall.glb',
    'wall-corner': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/wall-corner.glb',
    'banner-fantasy': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/banner.glb',
    'trophy-statue': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/statue.glb',
    'trophy-cup': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/trophy.glb',
    'weapon-rack': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/weapon-rack.glb',
    'weapon-sword-display': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/weapon-sword.glb',
    'bricks-stack': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/bricks.glb',
    'column-stone': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/column.glb',
    'column-damaged': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/column-damaged.glb',
    'border-corner': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/border-corner.glb',
    'floor-detail': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/floor-detail.glb',
    'floor': '/models/kenney/basic_scene/sample/Mini Arena/Models/GLB format/floor.glb',
  };

  // Try Kenney Platformer — fantasy props, character.glb
  const kenneyPlatformerMap = {
    'character-platformer': '/models/kenney/platformer/models/character.glb',
    'coin-stack': '/models/kenney/platformer/models/coin.glb',
    'coin-block': '/models/kenney/platformer/models/block-coin.glb',
    'brick': '/models/kenney/platformer/models/brick.glb',
    'cloud': '/models/kenney/platformer/models/cloud.glb',
    'flag': '/models/kenney/platformer/models/flag.glb',
    'grass-small': '/models/kenney/platformer/models/grass-small.glb',
    'grass-block': '/models/kenney/platformer/models/grass.glb',
    'platform-large': '/models/kenney/platformer/models/platform-large.glb',
    'platform-grass-large-round': '/models/kenney/platformer/models/platform-grass-large-round.glb',
  };

  if (kayKitMap[type]) return kayKitMap[type];
  if (kenneyArenaMap[type]) return kenneyArenaMap[type];
  if (kenneyPlatformerMap[type]) return kenneyPlatformerMap[type];

  // No asset found — flag for procedural fallback
  return null;
}

/**
 * Three.js-specific rendering hints (matches concordia-theme.ts)
 */
function threeJsHints(scene) {
  return {
    renderer: 'three.js',
    toneMapping: 'ACESFilmicToneMapping',
    outputColorSpace: 'SRGBColorSpace',
    shadows: {
      type: 'PCFSoftShadowMap',
      size: 2048,
    },
    postprocessing: {
      celShading: true,
      outline: true,
      outlineWidth: 0.018,
      ssao: true,
      ssgi: true,
      bloom: true,
      glowStrength: 0.6,
      rimPower: 2.5,
      vignette: true,
    },
    lights: {
      directionalShadow: true,
      maxOmniLights: 4,
      maxSpotLights: 4,
      ambientLightIntensity: 0.6,
    },
  };
}

/**
 * Godot 4-specific rendering hints (matches world-lens-godot/world/art_style.gd)
 */
function godotHints(scene) {
  return {
    renderer: 'godot-4.4',
    renderingMethod: 'forward_plus',
    webRenderingMethod: 'gl_compatibility',
    postprocessing: {
      outlineWidth: 0.018,
      rampBands: 3,
      groundedDial: 0.45,
      outlineDarken: 0.35,
      sdfgi: true,
      glow: true,
      glowStrength: 0.6,
      ssao: true,
      ssaoIntensity: 1.0,
      colorAdjustment: true,
      rimStrength: 0.35,
      rimPower: 2.5,
    },
    lightCount: {
      directional: 1,
      omni: 4,
      spot: 4,
    },
  };
}

/**
 * Unity-specific rendering hints (Universal Render Pipeline)
 */
function unityHints(scene) {
  return {
    renderer: 'unity-2022.3-universal',
    renderPipeline: 'URP',
    shaderModel: 'standard',
    postprocessing: {
      bloom: true,
      vignette: true,
      colorGrading: true,
      ambientOcclusion: true,
    },
    lightCount: {
      directional: 1,
      point: 4,
      spot: 4,
    },
  };
}

/**
 * Main enrichment function. Takes the exportScene output and returns
 * a fully-enriched scene descriptor ready to ship to any of the 3 clients.
 *
 * @param {object} scene  output from exportScene(db, worldId)
 * @param {string} worldId
 * @returns {object} enrichedSceneDescriptor
 */
export function enrichScene(scene, worldId) {
  if (!scene || !scene.ok) return scene;

  // 1. Combat style
  const combatStyle = getWorldCombatStyle(worldId);

  // 2. Asset URLs per node
  const enrichedNodes = (scene.nodes || []).map(node => {
    const assetUrl = buildingToAssetUrl(node);
    return {
      ...node,
      assetUrl: assetUrl || node.url || null,
      // Flag if we have a real GLB vs need procedural fallback
      assetKind: assetUrl ? 'real-glb' : 'procedural-fallback',
    };
  });

  // 3. Per-client hints
  const three = threeJsHints(scene);
  const godot = godotHints(scene);
  const unity = unityHints(scene);

  // 4. Unity asset list (additional pre-warmed bundles)
  const unityAssetList = getUnityAssetList(worldId);

  // 5. Cross-world travel hints (only on hub)
  const portals = worldId === 'concordia-hub'
    ? [
        { worldId: 'cyber', position: [0, 0, 12], color: '#4a90e2' },
        { worldId: 'crime', position: [12, 0, 0], color: '#d0021b' },
        { worldId: 'fantasy', position: [0, 0, -12], color: '#7ed321' },
        { worldId: 'frontier', position: [-12, 0, 0], color: '#f5a623' },
        { worldId: 'superhero', position: [8, 0, 8], color: '#f8e71c' },
        { worldId: 'lattice-crucible', position: [-8, 0, 8], color: '#9013fe' },
        { worldId: 'sovereign-ruins', position: [8, 0, -8], color: '#8b572a' },
        { worldId: 'tunya', position: [-8, 0, -8], color: '#ff6c00' },
      ]
    : [];

  return {
    ...scene,
    format: 'concord-scene/v2',
    worldId,
    combatStyle,
    nodes: enrichedNodes,
    portals,
    unityAssets: unityAssetList,
    clientHints: {
      threeJs: three,
      godot4: godot,
      unity: unity,
    },
  };
}

/**
 * Build a complete Three.js scene descriptor (legacy format, no Unity)
 */
export function toThreeJsScene(scene, worldId) {
  return enrichScene(scene, worldId);
}

/**
 * Build a Godot 4 scene descriptor (extends v1 with hints)
 */
export function toGodotScene(scene, worldId) {
  return enrichScene(scene, worldId);
}

/**
 * Build a Unity scene descriptor (uses unity-bridge.js helpers)
 */
export function toUnitySceneDescriptor(scene, worldId) {
  const enriched = enrichScene(scene, worldId);
  return toUnityScene(enriched);
}

export {
  buildingToAssetUrl,
}

export default {
  enrichScene,
  toThreeJsScene,
  toGodotScene,
  toUnitySceneDescriptor,
  buildingToAssetUrl,
};
