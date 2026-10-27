/**
 * Foundation Atlas — Test Suite
 *
 * Tests for signal tomography and volumetric mapping:
 *   - Constants (layers, materials, frequencies, tomo params)
 *   - Signal collection (step 1)
 *   - Path modeling (step 2)
 *   - Tomographic reconstruction (step 3)
 *   - Material classification (step 4)
 *   - Temporal differencing (step 5)
 *   - Multi-frequency fusion (step 6)
 *   - DTU encoding (step 7)
 *   - Retrieval functions (tile, volume, subsurface, material, changes, coverage)
 *   - Tiered access (public, research, sovereign)
 *   - Spatial queries
 *   - Chat intent detection
 *   - Metrics and heartbeat
 *   - Full pipeline integration
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  LAYERS,
  ALL_LAYERS,
  MATERIAL_TYPES,
  FREQUENCY_BANDS,
  ALL_FREQUENCY_BANDS,
  TOMO_CONSTANTS,
  ATLAS_TIERS,
  TIER_ACCESS,
  MATERIAL_EM_PROFILES,
  collectSignal,
  modelPath,
  reconstructTile,
  classifyMaterial,
  detectChanges,
  fuseFrequencies,
  createMapTileDTU,
  getTile,
  getVolume,
  getMaterialAtPoint,
  getSubsurface,
  getChanges,
  getCoverage,
  getLiveFeedStatus,
  executeSpatialQuery,
  detectAtlasIntent,
  getAtlasMetrics,
  atlasHeartbeatTick,
  initializeAtlas,
  _resetAtlasState,
} from "../lib/foundation-atlas.js";

beforeEach(() => {
  _resetAtlasState();
});

// ── Constants ──────────────────────────────────────────────────────────────

describe("Constants", () => {
  it("defines 5 map layers", () => {
    assert.equal(ALL_LAYERS.length, 5);
    assert.ok(ALL_LAYERS.includes("surface"));
    assert.ok(ALL_LAYERS.includes("subsurface"));
    assert.ok(ALL_LAYERS.includes("interior"));
    assert.ok(ALL_LAYERS.includes("atmosphere"));
    assert.ok(ALL_LAYERS.includes("material"));
  });

  it("defines 10 material types", () => {
    const types = Object.values(MATERIAL_TYPES);
    assert.equal(types.length, 10);
    assert.ok(types.includes("concrete"));
    assert.ok(types.includes("metal"));
    assert.ok(types.includes("water"));
    assert.ok(types.includes("soil"));
  });

  it("defines 7 frequency bands with EM properties", () => {
    assert.equal(ALL_FREQUENCY_BANDS.length, 7);
    assert.equal(FREQUENCY_BANDS.WIFI_2_4.resolution_cm, 6.25);
    assert.equal(FREQUENCY_BANDS.WIFI_5.resolution_cm, 2.6);
    assert.equal(FREQUENCY_BANDS.LORA_900.penetration, "ground");
    assert.equal(FREQUENCY_BANDS.RF_HF.penetration, "deep_geology");
    assert.equal(FREQUENCY_BANDS.TELEPHONE.penetration, "conducted");
  });

  it("defines tomographic reconstruction constants", () => {
    assert.equal(TOMO_CONSTANTS.MIN_PATHS_FOR_RECONSTRUCTION, 3);
    assert.equal(TOMO_CONSTANTS.MIN_ANGLES_FOR_QUALITY, 8);
    assert.equal(TOMO_CONSTANTS.VOXEL_SIZE_CM, 25);
    assert.equal(TOMO_CONSTANTS.CONFIDENCE_THRESHOLD, 0.3);
  });

  it("defines 3 access tiers", () => {
    assert.equal(ATLAS_TIERS.PUBLIC, "PUBLIC");
    assert.equal(ATLAS_TIERS.RESEARCH, "RESEARCH");
    assert.equal(ATLAS_TIERS.SOVEREIGN, "SOVEREIGN");
  });

  it("defines tier access to layers", () => {
    assert.equal(TIER_ACCESS.PUBLIC.length, 2);
    assert.ok(TIER_ACCESS.PUBLIC.includes("surface"));
    assert.ok(TIER_ACCESS.PUBLIC.includes("atmosphere"));
    assert.equal(TIER_ACCESS.RESEARCH.length, 4);
    assert.ok(TIER_ACCESS.RESEARCH.includes("subsurface"));
    assert.equal(TIER_ACCESS.SOVEREIGN.length, 5); // all layers
  });

  it("defines material EM profiles for classification", () => {
    assert.equal(MATERIAL_EM_PROFILES.concrete.attenuation, 12);
    assert.equal(MATERIAL_EM_PROFILES.metal.attenuation, 40);
    assert.equal(MATERIAL_EM_PROFILES.air.attenuation, 0);
    assert.equal(MATERIAL_EM_PROFILES.water.permittivity, 80.0);
  });

  it("all constants are frozen", () => {
    assert.equal(Object.isFrozen(LAYERS), true);
    assert.equal(Object.isFrozen(ALL_LAYERS), true);
    assert.equal(Object.isFrozen(MATERIAL_TYPES), true);
    assert.equal(Object.isFrozen(FREQUENCY_BANDS), true);
    assert.equal(Object.isFrozen(TOMO_CONSTANTS), true);
    assert.equal(Object.isFrozen(ATLAS_TIERS), true);
    assert.equal(Object.isFrozen(TIER_ACCESS), true);
  });
});

// ── Step 1: Signal Collection ───────────────────────────────────────────────

describe("Signal Collection", () => {
  it("collects a valid signal observation", () => {
    const result = collectSignal({
      sourceNode: "node_A",
      destNode: "node_B",
      frequency: 2400,
      signalStrength: -65,
      phase: 120.5,
    });

    assert.notEqual(result, null);
    assert.match(result.id, /^sig_/);
    assert.equal(result.sourceNode, "node_A");
    assert.equal(result.destNode, "node_B");
    assert.equal(result.frequency, 2400);
    assert.equal(result.signalStrength, -65);
    assert.equal(result.band, "wifi_2.4ghz");
  });

  it("returns null for missing required fields", () => {
    assert.equal(collectSignal(null), null);
    assert.equal(collectSignal({}), null);
    assert.equal(collectSignal({ sourceNode: "A" }), null);
    assert.equal(collectSignal({ sourceNode: "A", destNode: "B" }), null);
  });

  it("identifies correct frequency bands", () => {
    const wifi5 = collectSignal({ sourceNode: "A", destNode: "B", frequency: 5800 });
    assert.equal(wifi5.band, "wifi_5ghz");

    const lora = collectSignal({ sourceNode: "A", destNode: "B", frequency: 900 });
    assert.equal(lora.band, "lora_900mhz");

    const rf433 = collectSignal({ sourceNode: "A", destNode: "B", frequency: 433 });
    assert.equal(rf433.band, "rf_433mhz");

    const telephone = collectSignal({ sourceNode: "A", destNode: "B", frequency: 0.003 });
    assert.equal(telephone.band, "telephone");
  });

  it("tracks frequency coverage", () => {
    collectSignal({ sourceNode: "A", destNode: "B", frequency: 2400 });
    collectSignal({ sourceNode: "A", destNode: "C", frequency: 900 });

    const coverage = getCoverage();
    assert.ok(coverage.frequenciesActive.includes("wifi_2.4ghz"));
    assert.ok(coverage.frequenciesActive.includes("lora_900mhz"));
  });

  it("updates stats on collection", () => {
    collectSignal({ sourceNode: "A", destNode: "B", frequency: 2400 });
    collectSignal({ sourceNode: "A", destNode: "C", frequency: 2400 });

    const metrics = getAtlasMetrics();
    assert.equal(metrics.stats.signalsCollected, 2);
    assert.notEqual(metrics.stats.lastSignalAt, null);
  });
});

// ── Step 2: Path Modeling ───────────────────────────────────────────────────

describe("Path Modeling", () => {
  const posA = { lat: 52.3676, lng: 4.9041 };  // Amsterdam
  const posB = { lat: 52.3700, lng: 4.9100 };  // ~500m away

  it("models a signal path between two nodes", () => {
    const result = modelPath(posA, posB, {
      frequency: 2400,
      signalStrength: -65,
      phase: 120,
      multipath: [{ delay: 10 }, { delay: 25 }],
    });

    assert.notEqual(result, null);
    assert.match(result.id, /^path_/);
    assert.ok(result.distance_m > 0);
    assert.ok(result.freeSpaceLoss_dB > 0);
    assert.notEqual(result.excessLoss_dB, undefined);
    assert.notEqual(result.phaseDeviation_deg, undefined);
    assert.equal(result.multipathCount, 2);
    assert.equal(result.band, "wifi_2.4ghz");
  });

  it("returns null for missing inputs", () => {
    assert.equal(modelPath(null, posB, {}), null);
    assert.equal(modelPath(posA, null, {}), null);
    assert.equal(modelPath(posA, posB, null), null);
  });

  it("calculates environmental impact between 0 and 1", () => {
    const result = modelPath(posA, posB, {
      frequency: 2400,
      signalStrength: -80,
    });
    assert.ok(result.environmentalImpact >= 0);
    assert.ok(result.environmentalImpact <= 1);
  });

  it("updates path modeling stats", () => {
    modelPath(posA, posB, { frequency: 2400, signalStrength: -65 });
    assert.equal(getAtlasMetrics().stats.pathsModeled, 1);
  });
});

// ── Step 3: Tomographic Reconstruction ──────────────────────────────────────

describe("Tomographic Reconstruction", () => {
  const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };

  function makePaths(count) {
    const paths = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      paths.push({
        id: `path_${i}`,
        sourcePos: { lat: 52.367 + Math.cos(angle) * 0.001, lng: 4.904 + Math.sin(angle) * 0.001 },
        destPos: { lat: 52.368 - Math.cos(angle) * 0.001, lng: 4.905 - Math.sin(angle) * 0.001 },
        band: i % 2 === 0 ? "wifi_2.4ghz" : "lora_900mhz",
        excessLoss_dB: 10 + i,
        phaseDeviation_deg: 30 + i * 5,
        environmentalImpact: 0.3 + i * 0.05,
        frequency: i % 2 === 0 ? 2400 : 900,
      });
    }
    return paths;
  }

  it("requires minimum number of paths", () => {
    const result = reconstructTile(coords, [{ id: "p1" }]);
    assert.equal(result, null);
  });

  it("reconstructs a tile from sufficient paths", () => {
    const paths = makePaths(10);
    const tile = reconstructTile(coords, paths);

    assert.notEqual(tile, null);
    assert.match(tile.id, /^tile_/);
    assert.equal(tile.type, "MAP_TILE");
    assert.deepEqual(tile.coordinates, coords);
    assert.equal(tile.signal_paths_used, 10);
    assert.ok(tile.confidence > 0);
    assert.equal(tile.version, 1);
    assert.ok(tile.resolution_cm < Infinity);
    assert.ok(tile.frequency_sources.includes("wifi_2.4ghz"));
    assert.ok(tile.frequency_sources.includes("lora_900mhz"));
  });

  it("populates all 5 layers", () => {
    const paths = makePaths(10);
    const tile = reconstructTile(coords, paths);

    assert.notEqual(tile.layers.surface, undefined);
    assert.notEqual(tile.layers.subsurface, undefined);
    assert.notEqual(tile.layers.interior, undefined);
    assert.notEqual(tile.layers.atmosphere, undefined);
    assert.notEqual(tile.layers.material, undefined);
  });

  it("increments version on re-reconstruction", () => {
    const paths = makePaths(5);
    const tile1 = reconstructTile(coords, paths);
    assert.equal(tile1.version, 1);

    const tile2 = reconstructTile(coords, makePaths(8));
    assert.equal(tile2.version, 2);
  });

  it("counts unique nodes", () => {
    const paths = makePaths(6);
    const tile = reconstructTile(coords, paths);
    assert.ok(tile.node_count > 0);
  });

  it("higher path count increases confidence", () => {
    const lowPaths = makePaths(3);
    const highPaths = makePaths(50);

    _resetAtlasState();
    const lowTile = reconstructTile(coords, lowPaths);

    _resetAtlasState();
    const highTile = reconstructTile(coords, highPaths);

    assert.ok(highTile.confidence > lowTile.confidence);
  });

  it("selects best resolution from frequency bands", () => {
    // WiFi 5GHz has 2.6cm resolution — best available
    const paths = makePaths(5).map(p => ({ ...p, band: "wifi_5ghz" }));
    const tile = reconstructTile(coords, paths);
    assert.equal(tile.resolution_cm, 2.6);
  });
});

// ── Step 4: Material Classification ─────────────────────────────────────────

describe("Material Classification", () => {
  it("classifies air (no loss, no phase shift)", () => {
    const result = classifyMaterial(0, 0);
    assert.equal(result.material, "air");
    assert.ok(result.confidence > 0.5);
  });

  it("classifies concrete (moderate loss, moderate phase)", () => {
    const result = classifyMaterial(12, 45);
    assert.equal(result.material, "concrete");
    assert.ok(result.confidence > 0.5);
  });

  it("classifies metal (high loss, high phase)", () => {
    const result = classifyMaterial(40, 90);
    assert.equal(result.material, "metal");
    assert.ok(result.confidence > 0.5);
  });

  it("classifies water (moderate loss, moderate phase, high permittivity)", () => {
    const result = classifyMaterial(8, 30);
    assert.equal(result.material, "water");
  });

  it("classifies wood (low loss)", () => {
    const result = classifyMaterial(4, 15);
    assert.equal(result.material, "wood");
  });

  it("returns confidence between 0 and 1", () => {
    const result = classifyMaterial(15, 35);
    assert.ok(result.confidence >= 0);
    assert.ok(result.confidence <= 1);
  });

  it("updates material classification stats", () => {
    classifyMaterial(10, 20);
    classifyMaterial(30, 60);
    assert.equal(getAtlasMetrics().stats.materialsClassified, 2);
  });
});

// ── Step 5: Temporal Differencing ───────────────────────────────────────────

describe("Temporal Differencing", () => {
  it("returns null for tiles with only one version", () => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "wifi_2.4ghz", environmentalImpact: 0.5,
      excessLoss_dB: 10, phaseDeviation_deg: 30,
    }));
    reconstructTile(coords, paths);

    const result = detectChanges("52.367_4.904_-50");
    assert.equal(result, null); // version 1, no comparison possible
  });

  it("returns null when the next reconstruction matches", () => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "wifi_2.4ghz", environmentalImpact: 0.5,
      excessLoss_dB: 10, phaseDeviation_deg: 30,
    }));
    reconstructTile(coords, paths);
    reconstructTile(coords, paths);

    assert.equal(detectChanges("52.367_4.904_-50"), null);
    assert.equal(getAtlasMetrics().stats.changesDetected, 0);
  });

  it("reports layers whose stored material actually changed", () => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = (loss, phase) => Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "wifi_2.4ghz", environmentalImpact: 0.5,
      excessLoss_dB: loss, phaseDeviation_deg: phase,
    }));
    reconstructTile(coords, paths(10, 30));
    reconstructTile(coords, paths(40, 90));

    const result = detectChanges("52.367_4.904_-50");
    assert.equal(result.tileKey, "52.367_4.904_-50");
    assert.equal(result.compared, "layer_summary");
    assert.equal(result.magnitude, 0);
    assert.equal(result.type, "structural");
    assert.deepEqual(result.layers_affected.sort(), ["interior", "material", "surface"]);
    assert.equal(getAtlasMetrics().stats.changesDetected, 1);
  });
});

// ── Step 6: Multi-Frequency Fusion ──────────────────────────────────────────

describe("Multi-Frequency Fusion", () => {
  it("returns null for nonexistent tile", () => {
    assert.equal(fuseFrequencies("nonexistent"), null);
  });

  it("fuses multiple frequency sources", () => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = [
      { id: "p1", sourcePos: { lat: 52.367, lng: 4.904 }, destPos: { lat: 52.368, lng: 4.905 },
        band: "wifi_2.4ghz", environmentalImpact: 0.5, excessLoss_dB: 10, phaseDeviation_deg: 30 },
      { id: "p2", sourcePos: { lat: 52.3675, lng: 4.9045 }, destPos: { lat: 52.3685, lng: 4.9055 },
        band: "lora_900mhz", environmentalImpact: 0.3, excessLoss_dB: 15, phaseDeviation_deg: 35 },
      { id: "p3", sourcePos: { lat: 52.3672, lng: 4.9042 }, destPos: { lat: 52.3682, lng: 4.9052 },
        band: "bluetooth_2.4ghz", environmentalImpact: 0.4, excessLoss_dB: 8, phaseDeviation_deg: 20 },
    ];
    reconstructTile(coords, paths);

    const fusion = fuseFrequencies("52.367_4.904_-50");
    assert.notEqual(fusion, null);
    assert.equal(fusion.frequencySources.length, 3);
    assert.ok(fusion.fusionConfidence > 0);
    assert.notEqual(fusion.fusedLayers, undefined);
  });

  it("WiFi contributes to interior layer", () => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "wifi_2.4ghz", environmentalImpact: 0.5,
      excessLoss_dB: 10, phaseDeviation_deg: 30,
    }));
    reconstructTile(coords, paths);

    const fusion = fuseFrequencies("52.367_4.904_-50");
    assert.notEqual(fusion.fusedLayers.interior, undefined);
    assert.equal(fusion.fusedLayers.interior.source, "wifi_2.4ghz");
  });

  it("LoRa contributes to subsurface layer", () => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "lora_900mhz", environmentalImpact: 0.5,
      excessLoss_dB: 15, phaseDeviation_deg: 35,
    }));
    reconstructTile(coords, paths);

    const fusion = fuseFrequencies("52.367_4.904_-50");
    assert.notEqual(fusion.fusedLayers.subsurface, undefined);
    assert.equal(fusion.fusedLayers.subsurface.source, "lora_900mhz");
  });
});

// ── Step 7: DTU Encoding ────────────────────────────────────────────────────

describe("DTU Encoding", () => {
  it("creates MAP_TILE DTU from tile", () => {
    const tile = {
      id: "tile_test",
      coordinates: { lat_min: 52, lat_max: 53, lng_min: 4, lng_max: 5 },
      altitude_range: { top: 100, bottom: -50 },
      resolution_cm: 6.25,
      layers: { surface: {} },
      frequency_sources: ["wifi_2.4ghz"],
      node_count: 10,
      signal_paths_used: 50,
      confidence: 0.85,
      timestamp: Date.now(),
      version: 1,
    };

    const dtu = createMapTileDTU(tile);
    assert.equal(dtu.type, "MAP_TILE");
    assert.equal(dtu.id, "tile_test");
    assert.equal(dtu.resolution_cm, 6.25);
    assert.equal(dtu.confidence, 0.85);
    assert.equal(dtu.source, "foundation-atlas");
  });

  it("returns null for null input", () => {
    assert.equal(createMapTileDTU(null), null);
  });
});

// ── Retrieval Functions ─────────────────────────────────────────────────────

describe("Tile Retrieval", () => {
  beforeEach(() => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "wifi_2.4ghz", environmentalImpact: 0.5,
      excessLoss_dB: 10, phaseDeviation_deg: 30,
    }));
    reconstructTile(coords, paths);
  });

  it("retrieves a tile by coordinates", () => {
    const result = getTile({ lat: 52.3675, lng: 4.9045 });
    assert.equal(result.ok, true);
    assert.equal(result.tile.type, "MAP_TILE");
  });

  it("returns error for missing coordinates", () => {
    assert.equal(getTile(null).ok, false);
  });

  it("returns error for coordinates outside any tile", () => {
    const result = getTile({ lat: 0, lng: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.error, "no_tile_at_coordinates");
  });
});

describe("Volume Retrieval", () => {
  beforeEach(() => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "wifi_2.4ghz", environmentalImpact: 0.5,
      excessLoss_dB: 10, phaseDeviation_deg: 30,
    }));
    reconstructTile(coords, paths);
  });

  it("retrieves volume with public tier access", () => {
    const result = getVolume({ lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 }, "PUBLIC");
    assert.equal(result.ok, true);
    assert.equal(result.tier, "PUBLIC");
    assert.deepEqual(result.accessibleLayers, ["surface", "atmosphere"]);
  });

  it("retrieves volume with research tier access", () => {
    const result = getVolume({ lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 }, "RESEARCH");
    assert.equal(result.ok, true);
    assert.ok(result.accessibleLayers.includes("subsurface"));
    assert.ok(result.accessibleLayers.includes("material"));
  });

  it("retrieves volume with sovereign tier access (all layers)", () => {
    const result = getVolume({ lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 }, "SOVEREIGN");
    assert.equal(result.accessibleLayers.length, 5);
    assert.ok(result.accessibleLayers.includes("interior"));
  });
});

describe("Subsurface Retrieval", () => {
  it("denies public tier access to subsurface", () => {
    const result = getSubsurface({ lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 }, "PUBLIC");
    assert.equal(result.ok, false);
    assert.equal(result.error, "access_denied");
  });

  it("allows research tier access to subsurface", () => {
    const result = getSubsurface({ lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 }, "RESEARCH");
    assert.equal(result.ok, true);
    assert.equal(result.tier, "RESEARCH");
  });
});

// ── Spatial Queries ─────────────────────────────────────────────────────────

describe("Spatial Queries", () => {
  it("handles point query", () => {
    const result = executeSpatialQuery({ type: "point", coordinates: { lat: 52.3675, lng: 4.9045 } });
    // No tile exists yet
    assert.equal(result.ok, false);
  });

  it("handles area query", () => {
    const result = executeSpatialQuery({
      type: "area",
      bounds: { lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 },
    });
    assert.equal(result.ok, true);
    assert.equal(result.tileCount, 0); // No tiles yet
  });

  it("handles radius query", () => {
    const result = executeSpatialQuery({
      type: "radius",
      coordinates: { lat: 52.3675, lng: 4.9045 },
      radius_m: 500,
    });
    assert.equal(result.ok, true);
  });

  it("handles material query", () => {
    const result = executeSpatialQuery({ type: "material", coordinates: { lat: 52.3675, lng: 4.9045 } });
    assert.equal(result.ok, false); // No tile at point
  });

  it("handles subsurface query", () => {
    const result = executeSpatialQuery({
      type: "subsurface",
      bounds: { lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 },
    });
    assert.equal(result.ok, true);
  });

  it("handles changes query", () => {
    const result = executeSpatialQuery({ type: "changes", bounds: null });
    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
  });

  it("rejects unknown query type", () => {
    const result = executeSpatialQuery({ type: "invalid" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "unknown_query_type");
  });

  it("rejects null query", () => {
    const result = executeSpatialQuery(null);
    assert.equal(result.ok, false);
  });

  it("radius query requires coordinates", () => {
    const result = executeSpatialQuery({ type: "radius" });
    assert.equal(result.ok, false);
  });
});

// ── Coverage ────────────────────────────────────────────────────────────────

describe("Coverage", () => {
  it("returns initial coverage state", () => {
    const result = getCoverage();
    assert.equal(result.ok, true);
    assert.equal(result.totalNodes, 0);
    assert.equal(result.totalPaths, 0);
    assert.equal(result.totalTiles, 0);
    assert.equal(result.bestResolution_cm, null);
    assert.equal(result.frequencyCapabilities.length, 7);
  });

  it("reports frequency capabilities", () => {
    const result = getCoverage();
    const wifi = result.frequencyCapabilities.find(f => f.name === "wifi_2.4ghz");
    assert.equal(wifi.resolution_cm, 6.25);
    assert.equal(wifi.penetration, "walls");
  });
});

// ── Live Feed ───────────────────────────────────────────────────────────────

describe("Live Feed", () => {
  it("returns live feed status", () => {
    const result = getLiveFeedStatus();
    assert.equal(result.ok, true);
    assert.equal(result.active, false);
    assert.equal(result.totalSignals, 0);
  });
});

// ── Chat Intent Detection ───────────────────────────────────────────────────

describe("Chat Intent Detection", () => {
  it("returns false for empty input", () => {
    assert.equal(detectAtlasIntent("").isAtlasRequest, false);
    assert.equal(detectAtlasIntent(null).isAtlasRequest, false);
  });

  it("detects map/atlas tile requests", () => {
    const result = detectAtlasIntent("Show me the atlas view of Amsterdam");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "tile");
  });

  it("detects volumetric requests", () => {
    const result = detectAtlasIntent("Show the 3D model of this area");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "volume");
  });

  it("detects material classification requests", () => {
    const result = detectAtlasIntent("What material is this building made of?");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "material");
  });

  it("detects subsurface/underground requests", () => {
    const result = detectAtlasIntent("What is underground at this location?");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "subsurface");
  });

  it("detects change detection requests", () => {
    const result = detectAtlasIntent("Detect recent changes in this area");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "change");
  });

  it("detects coverage requests", () => {
    const result = detectAtlasIntent("What is the atlas coverage status?");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "coverage");
  });

  it("detects signal tomography requests", () => {
    const result = detectAtlasIntent("How does signal tomography work?");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "coverage");
  });

  it("detects live feed requests", () => {
    const result = detectAtlasIntent("Show the real-time atlas feed");
    assert.equal(result.isAtlasRequest, true);
    assert.equal(result.action, "live");
  });

  it("does not match unrelated queries", () => {
    assert.equal(detectAtlasIntent("What's the weather today?").isAtlasRequest, false);
    assert.equal(detectAtlasIntent("Play some music").isAtlasRequest, false);
  });
});

// ── Metrics ─────────────────────────────────────────────────────────────────

describe("Atlas Metrics", () => {
  it("returns comprehensive metrics", async () => {
    await initializeAtlas({});
    collectSignal({ sourceNode: "A", destNode: "B", frequency: 2400 });

    const metrics = getAtlasMetrics();
    assert.equal(metrics.initialized, true);
    assert.equal(metrics.stats.signalsCollected, 1);
    assert.notEqual(metrics.coverage, undefined);
    assert.ok(metrics.uptime >= 0);
  });
});

// ── Heartbeat ───────────────────────────────────────────────────────────────

describe("Atlas Heartbeat", () => {
  it("runs without error", async () => {
    await initializeAtlas({});
    await atlasHeartbeatTick({}, 1);
  });
});

// ── Initialization ──────────────────────────────────────────────────────────

describe("Initialization", () => {
  it("initializes successfully", async () => {
    const result = await initializeAtlas({});
    assert.equal(result.ok, true);
    assert.deepEqual(result.layers, ALL_LAYERS);
    assert.equal(result.frequencyBands.length, 7);
    assert.deepEqual(result.tiers, ["PUBLIC", "RESEARCH", "SOVEREIGN"]);
  });

  it("returns alreadyInitialized on second call", async () => {
    await initializeAtlas({});
    const result = await initializeAtlas({});
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInitialized, true);
  });
});

// ── State Reset ─────────────────────────────────────────────────────────────

describe("State Reset", () => {
  it("resets all state", async () => {
    await initializeAtlas({});
    collectSignal({ sourceNode: "A", destNode: "B", frequency: 2400 });
    _resetAtlasState();

    const metrics = getAtlasMetrics();
    assert.equal(metrics.initialized, false);
    assert.equal(metrics.stats.signalsCollected, 0);
  });
});

// ── Full Pipeline Integration ───────────────────────────────────────────────

describe("Full Pipeline Integration", () => {
  beforeEach(async () => {
    await initializeAtlas({});
  });

  it("collect → model → reconstruct → classify → encode", () => {
    const posA = { lat: 52.367, lng: 4.904 };
    const posB = { lat: 52.368, lng: 4.905 };

    // Step 1: Collect signals
    const sig1 = collectSignal({ sourceNode: "A", destNode: "B", frequency: 2400, signalStrength: -65, phase: 120 });
    const sig2 = collectSignal({ sourceNode: "C", destNode: "D", frequency: 900, signalStrength: -80, phase: 90 });

    assert.notEqual(sig1, null);
    assert.notEqual(sig2, null);

    // Step 2: Model paths
    const path1 = modelPath(posA, posB, { frequency: 2400, signalStrength: -65, phase: 120, multipath: [] });
    const path2 = modelPath(
      { lat: 52.3675, lng: 4.9045 },
      { lat: 52.3685, lng: 4.9055 },
      { frequency: 900, signalStrength: -80, phase: 90, multipath: [{ delay: 10 }] }
    );
    const path3 = modelPath(
      { lat: 52.3672, lng: 4.9048 },
      { lat: 52.3688, lng: 4.9042 },
      { frequency: 5800, signalStrength: -55, phase: 60, multipath: [] }
    );

    assert.notEqual(path1, null);
    assert.notEqual(path2, null);
    assert.notEqual(path3, null);

    // Step 3: Reconstruct tile
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const tile = reconstructTile(coords, [path1, path2, path3]);

    assert.notEqual(tile, null);
    assert.equal(tile.type, "MAP_TILE");
    assert.ok(tile.frequency_sources.length >= 2);

    // Step 4: Classify materials
    const material = classifyMaterial(path1.excessLoss_dB, path1.phaseDeviation_deg);
    assert.notEqual(material.material, undefined);
    assert.ok(material.confidence >= 0);

    // Step 6: Multi-frequency fusion
    const fusion = fuseFrequencies("52.367_4.904_-50");
    assert.notEqual(fusion, null);

    // Step 7: DTU encoding
    const dtu = createMapTileDTU(tile);
    assert.equal(dtu.type, "MAP_TILE");
    assert.equal(dtu.source, "foundation-atlas");

    // Verify retrieval
    const retrieved = getTile({ lat: 52.3675, lng: 4.9045 });
    assert.equal(retrieved.ok, true);
  });

  it("respects tiered access for volume retrieval", () => {
    const coords = { lat_min: 52.367, lat_max: 52.368, lng_min: 4.904, lng_max: 4.905 };
    const paths = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, sourcePos: { lat: 52.367, lng: 4.904 },
      destPos: { lat: 52.368, lng: 4.905 },
      band: "wifi_2.4ghz", environmentalImpact: 0.5,
      excessLoss_dB: 10, phaseDeviation_deg: 30,
    }));
    reconstructTile(coords, paths);

    const publicVol = getVolume({ lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 }, "PUBLIC");
    const sovereignVol = getVolume({ lat_min: 52.36, lat_max: 52.37, lng_min: 4.9, lng_max: 4.91 }, "SOVEREIGN");

    // Public: surface + atmosphere only
    assert.equal(publicVol.accessibleLayers.length, 2);
    // Sovereign: all 5 layers
    assert.equal(sovereignVol.accessibleLayers.length, 5);
  });

  it("coverage reflects collected data", () => {
    collectSignal({ sourceNode: "A", destNode: "B", frequency: 2400 });
    collectSignal({ sourceNode: "C", destNode: "D", frequency: 900 });

    const coverage = getCoverage();
    assert.equal(coverage.totalPaths, 2);
    assert.ok(coverage.frequenciesActive.includes("wifi_2.4ghz"));
    assert.ok(coverage.frequenciesActive.includes("lora_900mhz"));
  });
});
