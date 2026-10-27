/**
 * Foundation Atlas — Signal Tomography & Volumetric Mapping
 *
 * Uses mesh node signal paths as a distributed CT scanner to reconstruct
 * 3D volumetric maps of the physical world. Every signal between every
 * pair of nodes passes through physical reality — buildings, terrain,
 * atmosphere, ground, water. Every signal arrives changed by what it touched.
 *
 * Pipeline:
 *   1. Signal Collection — metadata from every transmission on every channel
 *   2. Path Modeling — compare direct path to actual signal, delta = environment
 *   3. Tomographic Reconstruction — inverse Radon transform across angles
 *   4. Material Classification — EM properties identify materials
 *   5. Temporal Differencing — compare maps over time for changes
 *   6. Multi-Frequency Fusion — combine WiFi/LoRa/RF/BT/telephone layers
 *   7. DTU Encoding — MAP_TILE DTUs versioned, timestamped, resolution-tagged
 *
 * Frequency capabilities:
 *   WiFi 2.4/5GHz — penetrates walls, reveals interiors (~6cm theoretical resolution)
 *   Bluetooth 2.4GHz — short range, high density, human-scale resolution
 *   LoRa 900MHz — long range, penetrates ground, subsurface structures
 *   RF various — multi-frequency layered analysis, surface to deep geology
 *   Telephone — conducted signals reveal environment around the wire
 *
 * Tiered access (integrates with Foundation Intelligence):
 *   Public — surface terrain, building exteriors, general geology, atmospheric
 *   Research — subsurface detail, material classification, temporal changes
 *   Sovereign — building interiors, infrastructure mapping, full resolution
 */

import crypto from "crypto";

function uid(prefix = "atlas") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || 0)); }

// A missing reading is not a measurement. 0 is a real value; "" and
// non-finite numbers are not.
function measuredNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const LAYERS = Object.freeze({
  SURFACE:    "surface",
  SUBSURFACE: "subsurface",
  INTERIOR:   "interior",
  ATMOSPHERE: "atmosphere",
  MATERIAL:   "material",
});

export const ALL_LAYERS = Object.freeze(Object.values(LAYERS));

export const MATERIAL_TYPES = Object.freeze({
  AIR:       "air",
  CONCRETE:  "concrete",
  WOOD:      "wood",
  METAL:     "metal",
  GLASS:     "glass",
  WATER:     "water",
  SOIL:      "soil",
  ROCK:      "rock",
  VEGETATION:"vegetation",
  UNKNOWN:   "unknown",
});

export const FREQUENCY_BANDS = Object.freeze({
  WIFI_2_4:    { name: "wifi_2.4ghz",    freq_mhz: 2400,  wavelength_cm: 12.5,  resolution_cm: 6.25,  penetration: "walls",      range_m: 100 },
  WIFI_5:      { name: "wifi_5ghz",       freq_mhz: 5800,  wavelength_cm: 5.17,  resolution_cm: 2.6,   penetration: "thin_walls", range_m: 50 },
  BLUETOOTH:   { name: "bluetooth_2.4ghz",freq_mhz: 2400,  wavelength_cm: 12.5,  resolution_cm: 6.25,  penetration: "surface",    range_m: 30 },
  LORA_900:    { name: "lora_900mhz",     freq_mhz: 900,   wavelength_cm: 33.3,  resolution_cm: 16.7,  penetration: "ground",     range_m: 15000 },
  RF_433:      { name: "rf_433mhz",       freq_mhz: 433,   wavelength_cm: 69.3,  resolution_cm: 34.6,  penetration: "deep_ground",range_m: 5000 },
  RF_HF:       { name: "rf_hf",           freq_mhz: 14,    wavelength_cm: 2142,  resolution_cm: 1071,  penetration: "deep_geology",range_m: 100000 },
  TELEPHONE:   { name: "telephone",       freq_mhz: 0.003, wavelength_cm: 0,     resolution_cm: 0,     penetration: "conducted",  range_m: 0 },
});

export const ALL_FREQUENCY_BANDS = Object.freeze(Object.values(FREQUENCY_BANDS));

// Tomographic reconstruction constants
export const TOMO_CONSTANTS = Object.freeze({
  MIN_PATHS_FOR_RECONSTRUCTION: 3,     // Minimum signal paths crossing a voxel
  MIN_ANGLES_FOR_QUALITY: 8,           // Minimum angular diversity for good reconstruction
  DEFAULT_TILE_SIZE_DEG: 0.001,        // ~111 meters at equator
  DEFAULT_ALTITUDE_RANGE_M: 100,       // Surface to 100m above ground
  DEFAULT_DEPTH_RANGE_M: 50,           // Surface to 50m below ground
  VOXEL_SIZE_CM: 25,                   // Default voxel resolution
  MAX_TILE_VERSION_HISTORY: 50,        // Keep last 50 versions per tile
  CONFIDENCE_THRESHOLD: 0.3,           // Minimum confidence for valid reconstruction
  SIGNAL_DECAY_HOURS: 24,              // Signal data older than this degrades confidence
  CHANGE_DETECTION_THRESHOLD: 0.15,    // Minimum delta to register as a change
});

// Access tiers for atlas data
export const ATLAS_TIERS = Object.freeze({
  PUBLIC:    "PUBLIC",     // Surface, exteriors, general geology, atmospheric
  RESEARCH:  "RESEARCH",   // Subsurface detail, material classification, temporal changes
  SOVEREIGN: "SOVEREIGN",  // Interiors, infrastructure, full resolution
});

// Which layers are accessible at each tier
export const TIER_ACCESS = Object.freeze({
  PUBLIC:    [LAYERS.SURFACE, LAYERS.ATMOSPHERE],
  RESEARCH:  [LAYERS.SURFACE, LAYERS.ATMOSPHERE, LAYERS.SUBSURFACE, LAYERS.MATERIAL],
  SOVEREIGN: ALL_LAYERS,
});

// ── Module State ────────────────────────────────────────────────────────────

const _atlasState = {
  initialized: false,

  // Signal path observations: key = `${nodeA}_${nodeB}_${freq}`
  signalPaths: new Map(),

  // Reconstructed map tiles: key = `${lat_min}_${lng_min}_${alt_bottom}`
  tiles: new Map(),

  // Layer summaries from the previous reconstruction of each tile.
  // detectChanges diffs these. There is no voxel grid to compare.
  priorLayers: new Map(),

  // Temporal change records
  changes: [],

  // Coverage tracking
  coverage: {
    totalNodes: 0,
    totalPaths: 0,
    totalTiles: 0,
    coveredArea_km2: 0,
    bestResolution_cm: Infinity,
    frequenciesActive: new Set(),
  },

  // Live feed subscribers (simulated)
  liveFeedActive: false,
  liveFeedInterval: null,

  stats: {
    signalsCollected: 0,
    pathsModeled: 0,
    tilesReconstructed: 0,
    materialsClassified: 0,
    changesDetected: 0,
    queriesServed: 0,
    lastSignalAt: null,
    lastReconstructionAt: null,
    uptime: Date.now(),
  },
};

// ── Step 1: Signal Collection ───────────────────────────────────────────────

/**
 * Record signal metadata from a transmission between two nodes.
 * Every signal interaction with the physical environment is data.
 */
export function collectSignal(observation) {
  if (!observation) return null;

  const {
    sourceNode, destNode, frequency, signalStrength,
    phase, arrivalTime, noiseFloor, multipath,
    doppler, polarization, position,
  } = observation;

  if (!sourceNode || !destNode || !frequency) return null;

  const freqBand = identifyFrequencyBand(frequency);
  const pathKey = `${sourceNode}_${destNode}_${freqBand.name}`;

  const entry = {
    id: uid("sig"),
    sourceNode,
    destNode,
    frequency: Number(frequency),
    band: freqBand.name,
    signalStrength: measuredNumber(signalStrength),
    signalStrengthReason: measuredNumber(signalStrength) == null ? "not_measured" : null,
    phase: measuredNumber(phase),
    phaseReason: measuredNumber(phase) == null ? "not_measured" : null,
    arrivalTime: arrivalTime || null,
    noiseFloor: measuredNumber(noiseFloor),
    noiseFloorReason: measuredNumber(noiseFloor) == null ? "not_measured" : null,
    multipath: Array.isArray(multipath) ? multipath : [],
    doppler: measuredNumber(doppler),
    dopplerReason: measuredNumber(doppler) == null ? "not_measured" : null,
    polarization: polarization || "unknown",
    position: position || null,
    recorded: nowISO(),
  };

  // Store in signal paths map (keep last 100 observations per path)
  if (!_atlasState.signalPaths.has(pathKey)) {
    _atlasState.signalPaths.set(pathKey, []);
  }
  const pathObs = _atlasState.signalPaths.get(pathKey);
  pathObs.push(entry);
  if (pathObs.length > 100) {
    _atlasState.signalPaths.set(pathKey, pathObs.slice(-80));
  }

  _atlasState.coverage.frequenciesActive.add(freqBand.name);
  _atlasState.stats.signalsCollected++;
  _atlasState.stats.lastSignalAt = nowISO();

  return entry;
}

function identifyFrequencyBand(freqMhz) {
  const f = Number(freqMhz) || 0;
  if (f >= 5000) return FREQUENCY_BANDS.WIFI_5;
  if (f >= 2000) return FREQUENCY_BANDS.WIFI_2_4;
  if (f >= 800 && f <= 1000) return FREQUENCY_BANDS.LORA_900;
  if (f >= 400 && f < 500) return FREQUENCY_BANDS.RF_433;
  if (f >= 1 && f < 100) return FREQUENCY_BANDS.RF_HF;
  if (f < 1) return FREQUENCY_BANDS.TELEPHONE;
  return FREQUENCY_BANDS.BLUETOOTH;
}

// ── Step 2: Path Modeling ───────────────────────────────────────────────────

/**
 * Model the signal path between two nodes.
 * Compare theoretical free-space propagation to actual received signal.
 * The difference is caused by the physical environment.
 */
export function modelPath(sourcePos, destPos, observation) {
  if (!sourcePos || !destPos || !observation) return null;

  const distance = haversineDistance(sourcePos, destPos);
  if (distance <= 0) return null;

  const freqMhz = measuredNumber(observation.frequency);
  const strength = measuredNumber(observation.signalStrength);
  const phase = measuredNumber(observation.phase);
  const freeSpaceLoss = freqMhz == null
    ? null
    : 20 * Math.log10(distance) + 20 * Math.log10(freqMhz) + 32.44;
  const actualLoss = strength == null ? null : Math.abs(strength);
  const excessLoss = freeSpaceLoss == null || actualLoss == null ? null : actualLoss - freeSpaceLoss;

  // Phase deviation from expected (indicates material interaction).
  // A missing phase is not 0 degrees.
  const expectedPhase = freqMhz == null ? null : (distance / (300 / freqMhz)) * 360 % 360;
  const phaseDeviation = phase == null || expectedPhase == null
    ? null
    : Math.abs(phase - expectedPhase) % 360;

  // Multipath count indicates reflections (buildings, terrain)
  const multipathCount = Array.isArray(observation.multipath) ? observation.multipath.length : 0;
  const unmeasured = freqMhz == null ? "frequency_not_measured" : (strength == null ? "signal_not_measured" : null);

  const pathModel = {
    id: uid("path"),
    sourcePos,
    destPos,
    distance_m: distance,
    frequency: freqMhz,
    band: freqMhz == null ? null : identifyFrequencyBand(freqMhz).name,
    freeSpaceLoss_dB: freeSpaceLoss,
    actualLoss_dB: actualLoss,
    excessLoss_dB: excessLoss,
    phaseDeviation_deg: phaseDeviation,
    multipathCount,
    environmentalImpact: excessLoss == null ? null : clamp(excessLoss / 30, 0, 1),
    reason: unmeasured,
    timestamp: nowISO(),
  };

  _atlasState.stats.pathsModeled++;
  return pathModel;
}

function haversineDistance(pos1, pos2) {
  const R = 6371000; // Earth radius in meters
  const lat1 = (Number(pos1.lat) || 0) * Math.PI / 180;
  const lat2 = (Number(pos2.lat) || 0) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = ((Number(pos2.lng) || 0) - (Number(pos1.lng) || 0)) * Math.PI / 180;

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ── Step 3: Tomographic Reconstruction ──────────────────────────────────────

/**
 * Reconstruct a volumetric tile from multiple signal paths crossing the area.
 * Uses inverse Radon transform principles — each signal path is a projection,
 * combined projections reconstruct the volume.
 */
export function reconstructTile(coordinates, pathModels, options = {}) {
  if (!coordinates || !pathModels || pathModels.length < TOMO_CONSTANTS.MIN_PATHS_FOR_RECONSTRUCTION) {
    return null;
  }

  const {
    lat_min, lat_max, lng_min, lng_max,
  } = coordinates;

  const altRange = options.altitudeRange || {
    top: TOMO_CONSTANTS.DEFAULT_ALTITUDE_RANGE_M,
    bottom: -TOMO_CONSTANTS.DEFAULT_DEPTH_RANGE_M,
  };

  // Calculate angular diversity (how many distinct angles the paths cover)
  const angles = pathModels.map(p => {
    if (!p.sourcePos || !p.destPos) return 0;
    return Math.atan2(
      (p.destPos.lat || 0) - (p.sourcePos.lat || 0),
      (p.destPos.lng || 0) - (p.sourcePos.lng || 0)
    ) * 180 / Math.PI;
  });

  const uniqueAngles = new Set(angles.map(a => Math.round(a / 10) * 10));
  const angularDiversity = uniqueAngles.size;

  // Average only paths that actually measured an impact. A missing
  // impact is not zero, and must not pull the tile toward "air".
  const impacts = pathModels
    .map((p) => measuredNumber(p.environmentalImpact))
    .filter((n) => n != null);
  const avgImpact = impacts.length
    ? impacts.reduce((sum, n) => sum + n, 0) / impacts.length
    : null;

  // Confidence based on path count, angular diversity, and signal freshness
  const pathConfidence = Math.min(pathModels.length / 50, 1);
  const angleConfidence = Math.min(angularDiversity / TOMO_CONSTANTS.MIN_ANGLES_FOR_QUALITY, 1);
  const confidence = clamp(pathConfidence * 0.5 + angleConfidence * 0.5, 0, 1);

  // Determine best resolution from frequency bands used
  const bands = new Set(pathModels.map(p => p.band));
  let bestResolution = Infinity;
  for (const band of bands) {
    const bandInfo = ALL_FREQUENCY_BANDS.find(b => b.name === band);
    if (bandInfo && bandInfo.resolution_cm > 0 && bandInfo.resolution_cm < bestResolution) {
      bestResolution = bandInfo.resolution_cm;
    }
  }
  if (bestResolution === Infinity) bestResolution = TOMO_CONSTANTS.VOXEL_SIZE_CM;

  // Layer summaries from the path models. This store has no voxel grid.
  const layerSummaries = {};
  for (const layer of ALL_LAYERS) {
    layerSummaries[layer] = {
      populated: pathModels.length >= TOMO_CONSTANTS.MIN_PATHS_FOR_RECONSTRUCTION,
      pathCount: pathModels.length,
      angularDiversity,
      avgImpact: avgImpact == null ? null : Number(avgImpact.toFixed(4)),
      dominantMaterial: classifyDominantMaterial(pathModels, layer),
    };
  }

  const tileKey = `${lat_min}_${lng_min}_${altRange.bottom}`;
  const existingTile = _atlasState.tiles.get(tileKey);
  if (existingTile?.layers) _atlasState.priorLayers.set(tileKey, existingTile.layers);
  const version = existingTile ? existingTile.version + 1 : 1;

  const tile = {
    id: uid("tile"),
    type: "MAP_TILE",
    coordinates: { lat_min, lat_max, lng_min, lng_max },
    altitude_range: altRange,
    resolution_cm: bestResolution,
    layers: layerSummaries,
    frequency_sources: [...bands],
    node_count: new Set(pathModels.flatMap(p => [
      p.sourcePos ? `${p.sourcePos.lat},${p.sourcePos.lng}` : null,
      p.destPos ? `${p.destPos.lat},${p.destPos.lng}` : null,
    ].filter(Boolean))).size,
    signal_paths_used: pathModels.length,
    confidence,
    timestamp: Date.now(),
    created: nowISO(),
    version,
    tags: ["atlas", "map_tile", "signal_tomography"],
    scope: "global",
  };

  // Store tile
  _atlasState.tiles.set(tileKey, tile);
  _atlasState.coverage.totalTiles = _atlasState.tiles.size;
  _atlasState.stats.tilesReconstructed++;
  _atlasState.stats.lastReconstructionAt = nowISO();

  // Update coverage stats
  if (bestResolution < _atlasState.coverage.bestResolution_cm) {
    _atlasState.coverage.bestResolution_cm = bestResolution;
  }

  return tile;
}

// ── Step 4: Material Classification ─────────────────────────────────────────

/**
 * Classify materials based on electromagnetic properties.
 * Different materials have known conductivity, permittivity, permeability.
 */
export const MATERIAL_EM_PROFILES = Object.freeze({
  air:        { attenuation: 0,    phaseShift: 0,   permittivity: 1.0 },
  concrete:   { attenuation: 12,   phaseShift: 45,  permittivity: 4.5 },
  wood:       { attenuation: 4,    phaseShift: 15,  permittivity: 2.0 },
  metal:      { attenuation: 40,   phaseShift: 90,  permittivity: 1.0 },
  glass:      { attenuation: 3,    phaseShift: 10,  permittivity: 6.0 },
  water:      { attenuation: 8,    phaseShift: 30,  permittivity: 80.0 },
  soil:       { attenuation: 15,   phaseShift: 35,  permittivity: 12.0 },
  rock:       { attenuation: 20,   phaseShift: 50,  permittivity: 7.0 },
  vegetation: { attenuation: 6,    phaseShift: 20,  permittivity: 30.0 },
});

export function classifyMaterial(excessLoss, phaseDeviation) {
  const loss = measuredNumber(excessLoss);
  const phase = measuredNumber(phaseDeviation);
  if (loss == null || phase == null) {
    return {
      material: MATERIAL_TYPES.UNKNOWN,
      confidence: null,
      excessLoss: loss,
      phaseDeviation: phase,
      reason: "not_measured",
    };
  }

  let bestMatch = MATERIAL_TYPES.UNKNOWN;
  let bestScore = Infinity;

  for (const [material, profile] of Object.entries(MATERIAL_EM_PROFILES)) {
    const lossDelta = Math.abs(loss - profile.attenuation);
    const phaseDelta = Math.abs(phase - profile.phaseShift);
    const score = lossDelta + phaseDelta * 0.5;

    if (score < bestScore) {
      bestScore = score;
      bestMatch = material;
    }
  }

  _atlasState.stats.materialsClassified++;

  return {
    material: bestMatch,
    confidence: clamp(1 - bestScore / 50, 0, 1),
    excessLoss: loss,
    phaseDeviation: phase,
  };
}

function classifyDominantMaterial(pathModels, layer) {
  if (!pathModels || pathModels.length === 0) return MATERIAL_TYPES.UNKNOWN;

  // Different layers emphasize different path characteristics
  const filtered = pathModels.filter(p => {
    if (layer === LAYERS.SUBSURFACE) return (p.band || "").includes("lora") || (p.band || "").includes("rf");
    if (layer === LAYERS.INTERIOR) return (p.band || "").includes("wifi") || (p.band || "").includes("bluetooth");
    if (layer === LAYERS.ATMOSPHERE) return p.environmentalImpact < 0.2;
    return true;
  });

  const measured = filtered.filter((p) => measuredNumber(p.excessLoss_dB) != null && measuredNumber(p.phaseDeviation_deg) != null);
  if (measured.length === 0) return MATERIAL_TYPES.UNKNOWN;

  const avgLoss = measured.reduce((s, p) => s + p.excessLoss_dB, 0) / measured.length;
  const avgPhase = measured.reduce((s, p) => s + p.phaseDeviation_deg, 0) / measured.length;

  return classifyMaterial(avgLoss, avgPhase).material;
}

// ── Step 5: Temporal Differencing ───────────────────────────────────────────

/**
 * Compare two tile versions to detect physical changes.
 * Construction, demolition, weather, seasonal variation, human activity.
 */
export function detectChanges(tileKey) {
  const tile = _atlasState.tiles.get(tileKey);
  const prior = _atlasState.priorLayers.get(tileKey);
  if (!tile || tile.version < 2 || !prior) return null;

  // Compare the layer summaries the last two reconstructions stored.
  // A material change counts. An impact-only change counts once the
  // mean absolute delta reaches CHANGE_DETECTION_THRESHOLD.
  const layers_affected = [];
  let impactSum = 0;
  for (const layer of ALL_LAYERS) {
    const cur = tile.layers?.[layer];
    const prev = prior[layer];
    if (!cur || !prev) continue;
    const curImpact = measuredNumber(cur.avgImpact);
    const prevImpact = measuredNumber(prev.avgImpact);
    const impactDelta = curImpact == null || prevImpact == null ? null : Math.abs(curImpact - prevImpact);
    const materialChanged = cur.dominantMaterial !== prev.dominantMaterial;
    if (!materialChanged && (impactDelta == null || impactDelta < TOMO_CONSTANTS.CHANGE_DETECTION_THRESHOLD)) continue;
    layers_affected.push(layer);
    if (impactDelta != null) impactSum += impactDelta;
  }
  if (layers_affected.length === 0) return null;

  const magnitude = clamp(impactSum / layers_affected.length, 0, 1);
  const structural = layers_affected.some((layer) => layer !== LAYERS.ATMOSPHERE);
  const change = {
    id: uid("change"),
    tileKey,
    tileId: tile.id,
    version: tile.version,
    coordinates: tile.coordinates,
    detectedAt: nowISO(),
    confidence: tile.confidence,
    layers_affected,
    magnitude,
    type: structural ? "structural" : "atmospheric",
    compared: "layer_summary",
  };

  _atlasState.changes.push(change);
  if (_atlasState.changes.length > 1000) {
    _atlasState.changes = _atlasState.changes.slice(-800);
  }
  _atlasState.stats.changesDetected++;
  return change;
}

// ── Step 6: Multi-Frequency Fusion ──────────────────────────────────────────

/**
 * Fuse data from multiple frequency bands into a unified volumetric model.
 * WiFi → interiors. LoRa → subsurface. RF → deep geology. BT → surface detail.
 */
export function fuseFrequencies(tileKey) {
  const tile = _atlasState.tiles.get(tileKey);
  if (!tile) return null;

  const sources = tile.frequency_sources || [];
  const fusionResult = {
    tileKey,
    tileId: tile.id,
    frequencySources: sources,
    fusedLayers: {},
    fusionConfidence: 0,
    timestamp: nowISO(),
  };

  // Each frequency band contributes to different layers
  for (const source of sources) {
    const band = ALL_FREQUENCY_BANDS.find(b => b.name === source);
    if (!band) continue;

    if (band.penetration === "walls" || band.penetration === "thin_walls") {
      fusionResult.fusedLayers[LAYERS.INTERIOR] = {
        source, resolution_cm: band.resolution_cm, quality: "high",
      };
    }
    if (band.penetration === "ground" || band.penetration === "deep_ground") {
      fusionResult.fusedLayers[LAYERS.SUBSURFACE] = {
        source, resolution_cm: band.resolution_cm, quality: "high",
      };
    }
    if (band.penetration === "surface") {
      fusionResult.fusedLayers[LAYERS.SURFACE] = {
        source, resolution_cm: band.resolution_cm, quality: "high",
      };
    }
    // All bands contribute to atmosphere and material
    fusionResult.fusedLayers[LAYERS.ATMOSPHERE] = fusionResult.fusedLayers[LAYERS.ATMOSPHERE] || {
      source, resolution_cm: band.resolution_cm, quality: "moderate",
    };
    fusionResult.fusedLayers[LAYERS.MATERIAL] = fusionResult.fusedLayers[LAYERS.MATERIAL] || {
      source, resolution_cm: band.resolution_cm, quality: "moderate",
    };
  }

  // Fusion confidence increases with more frequency sources
  fusionResult.fusionConfidence = clamp(sources.length / 5, 0, 1);

  return fusionResult;
}

// ── Step 7: DTU Encoding (Map Tile) ─────────────────────────────────────────

export function createMapTileDTU(tile) {
  if (!tile) return null;

  return {
    id: tile.id || uid("tile"),
    type: "MAP_TILE",
    coordinates: tile.coordinates,
    altitude_range: tile.altitude_range,
    resolution_cm: tile.resolution_cm,
    layers: tile.layers,
    frequency_sources: tile.frequency_sources,
    node_count: tile.node_count,
    signal_paths_used: tile.signal_paths_used,
    confidence: tile.confidence,
    timestamp: tile.timestamp,
    version: tile.version,
    created: tile.created || nowISO(),
    source: "foundation-atlas",
    tags: tile.tags || ["atlas", "map_tile"],
    scope: tile.scope || "global",
  };
}

// ── Retrieval Functions ─────────────────────────────────────────────────────

export function getTile(coordinates) {
  if (!coordinates) return { ok: false, error: "no_coordinates" };

  const { lat, lng, alt } = coordinates;
  // Find tile containing these coordinates
  for (const [key, tile] of _atlasState.tiles) {
    const c = tile.coordinates;
    if (lat >= c.lat_min && lat <= c.lat_max && lng >= c.lng_min && lng <= c.lng_max) {
      _atlasState.stats.queriesServed++;
      return { ok: true, tile: createMapTileDTU(tile) };
    }
  }

  return { ok: false, error: "no_tile_at_coordinates", coordinates };
}

export function getVolume(bounds, tier = ATLAS_TIERS.PUBLIC) {
  if (!bounds) return { ok: false, error: "no_bounds" };

  const accessibleLayers = TIER_ACCESS[tier] || TIER_ACCESS.PUBLIC;
  const matchingTiles = [];

  for (const [key, tile] of _atlasState.tiles) {
    const c = tile.coordinates;
    if (bounds.lat_min <= c.lat_max && bounds.lat_max >= c.lat_min &&
        bounds.lng_min <= c.lng_max && bounds.lng_max >= c.lng_min) {
      // Filter layers by tier access
      const filteredTile = { ...tile };
      if (filteredTile.layers) {
        const filtered = {};
        for (const layer of accessibleLayers) {
          if (filteredTile.layers[layer]) {
            filtered[layer] = filteredTile.layers[layer];
          }
        }
        filteredTile.layers = filtered;
      }
      matchingTiles.push(createMapTileDTU(filteredTile));
    }
  }

  _atlasState.stats.queriesServed++;
  return {
    ok: true,
    tier,
    accessibleLayers,
    tileCount: matchingTiles.length,
    tiles: matchingTiles,
  };
}

export function getMaterialAtPoint(coordinates) {
  if (!coordinates) return { ok: false, error: "no_coordinates" };

  const tileResult = getTile(coordinates);
  if (!tileResult.ok) return tileResult;

  const tile = tileResult.tile;
  const materialLayer = tile.layers?.[LAYERS.MATERIAL];

  return {
    ok: true,
    coordinates,
    material: materialLayer?.dominantMaterial || MATERIAL_TYPES.UNKNOWN,
    confidence: tile.confidence,
    resolution_cm: tile.resolution_cm,
  };
}

export function getSubsurface(bounds, tier = ATLAS_TIERS.RESEARCH) {
  if (tier === ATLAS_TIERS.PUBLIC) {
    return { ok: false, error: "access_denied", message: "Subsurface detail requires Research tier access" };
  }

  const volume = getVolume(bounds, tier);
  if (!volume.ok) return volume;

  // Filter to only subsurface-relevant data
  const subsurfaceTiles = volume.tiles.map(tile => ({
    ...tile,
    layers: {
      subsurface: tile.layers?.[LAYERS.SUBSURFACE] || null,
      material: tile.layers?.[LAYERS.MATERIAL] || null,
    },
  }));

  return {
    ok: true,
    tier,
    tileCount: subsurfaceTiles.length,
    tiles: subsurfaceTiles,
  };
}

export function getChanges(bounds, since, limit = 50) {
  let filtered = _atlasState.changes;

  if (since) {
    const sinceDate = new Date(since);
    filtered = filtered.filter(c => new Date(c.detectedAt) >= sinceDate);
  }

  if (bounds) {
    filtered = filtered.filter(c => {
      const coords = c.coordinates;
      return coords &&
        bounds.lat_min <= coords.lat_max && bounds.lat_max >= coords.lat_min &&
        bounds.lng_min <= coords.lng_max && bounds.lng_max >= coords.lng_min;
    });
  }

  const recent = filtered.slice(-Math.min(limit, 200));
  _atlasState.stats.queriesServed++;

  return {
    ok: true,
    count: recent.length,
    total: filtered.length,
    changes: recent,
  };
}

export function getCoverage() {
  return {
    ok: true,
    totalNodes: _atlasState.coverage.totalNodes,
    totalPaths: _atlasState.signalPaths.size,
    totalTiles: _atlasState.tiles.size,
    coveredArea_km2: _atlasState.tiles.size * 0.012, // ~0.012 km² per default tile
    bestResolution_cm: _atlasState.coverage.bestResolution_cm === Infinity
      ? null
      : _atlasState.coverage.bestResolution_cm,
    frequenciesActive: [..._atlasState.coverage.frequenciesActive],
    frequencyCapabilities: ALL_FREQUENCY_BANDS.map(b => ({
      name: b.name,
      resolution_cm: b.resolution_cm,
      penetration: b.penetration,
      range_m: b.range_m,
    })),
  };
}

export function getLiveFeedStatus() {
  return {
    ok: true,
    active: _atlasState.liveFeedActive,
    totalSignals: _atlasState.stats.signalsCollected,
    totalPaths: _atlasState.stats.pathsModeled,
    lastSignalAt: _atlasState.stats.lastSignalAt,
    lastReconstructionAt: _atlasState.stats.lastReconstructionAt,
  };
}

export function executeSpatialQuery(query) {
  if (!query) return { ok: false, error: "no_query" };

  const { type, coordinates, bounds, radius_m, layer, material } = query;
  _atlasState.stats.queriesServed++;

  switch (type) {
    case "point":
      return getTile(coordinates);

    case "area":
      return getVolume(bounds);

    case "radius": {
      if (!coordinates || !radius_m) {
        return { ok: false, error: "radius_query_requires_coordinates_and_radius" };
      }
      const degRadius = (radius_m || 100) / 111000; // rough degrees conversion
      return getVolume({
        lat_min: (coordinates.lat || 0) - degRadius,
        lat_max: (coordinates.lat || 0) + degRadius,
        lng_min: (coordinates.lng || 0) - degRadius,
        lng_max: (coordinates.lng || 0) + degRadius,
      });
    }

    case "material":
      return getMaterialAtPoint(coordinates);

    case "subsurface":
      return getSubsurface(bounds);

    case "changes":
      return getChanges(bounds, query.since, query.limit);

    default:
      return { ok: false, error: "unknown_query_type", validTypes: ["point", "area", "radius", "material", "subsurface", "changes"] };
  }
}

// ── Chat Intent Detection ───────────────────────────────────────────────────

export function detectAtlasIntent(prompt) {
  if (!prompt || typeof prompt !== "string") return { isAtlasRequest: false };

  const p = prompt.toLowerCase().trim();

  // Map tile / location
  if (/\b(map|atlas)\s*(tile|view|of|at|for|show)\b/.test(p) ||
      /\b(show|view|get)\s*(the\s*)?(map|atlas)\b/.test(p)) {
    return { isAtlasRequest: true, action: "tile", params: {} };
  }

  // Volume / 3D
  if (/\b(volume|volumetric|3d\s*model|3d\s*map)\b/.test(p)) {
    return { isAtlasRequest: true, action: "volume", params: {} };
  }

  // Material classification
  if (/\b(material|what.*made\s*of|composition|classify.*material)\b/.test(p) &&
      /\b(at|for|here|location|point|building)\b/.test(p)) {
    return { isAtlasRequest: true, action: "material", params: {} };
  }

  // Subsurface / underground
  if (/\b(underground|subsurface|beneath|below\s*ground|under\s*the|what.*underground)\b/.test(p)) {
    return { isAtlasRequest: true, action: "subsurface", params: {} };
  }

  // Changes / temporal
  if (/\b(change\w*|construction|demolition|temporal|what.*different)\b/.test(p) &&
      /\b(area|location|map|detect|recent|since)\b/.test(p)) {
    return { isAtlasRequest: true, action: "change", params: {} };
  }

  // Coverage
  if (/\b(atlas|mapping|tomography)\s*(coverage|resolution|status)\b/.test(p) ||
      /\b(coverage|resolution)\s*(map|atlas|tomography)\b/.test(p)) {
    return { isAtlasRequest: true, action: "coverage", params: {} };
  }

  // Signal tomography specifically
  if (/\b(signal\s*tomography|tomograph)\b/.test(p)) {
    return { isAtlasRequest: true, action: "coverage", params: {} };
  }

  // Live feed
  if (/\b(live|real.?time)\s*(feed|signal|tomography|atlas|map)\b/.test(p)) {
    return { isAtlasRequest: true, action: "live", params: {} };
  }

  return { isAtlasRequest: false };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export function getAtlasMetrics() {
  return {
    initialized: _atlasState.initialized,
    coverage: {
      totalPaths: _atlasState.signalPaths.size,
      totalTiles: _atlasState.tiles.size,
      bestResolution_cm: _atlasState.coverage.bestResolution_cm === Infinity
        ? null : _atlasState.coverage.bestResolution_cm,
      frequenciesActive: [..._atlasState.coverage.frequenciesActive],
    },
    stats: { ..._atlasState.stats },
    tileCount: _atlasState.tiles.size,
    changeCount: _atlasState.changes.length,
    uptime: Date.now() - _atlasState.stats.uptime,
  };
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

export async function atlasHeartbeatTick(STATE, tick) {
  // Update coverage stats
  _atlasState.coverage.totalPaths = _atlasState.signalPaths.size;
  _atlasState.coverage.totalTiles = _atlasState.tiles.size;

  // Prune old signal paths (older than decay window)
  const cutoff = Date.now() - TOMO_CONSTANTS.SIGNAL_DECAY_HOURS * 3600 * 1000;
  for (const [key, observations] of _atlasState.signalPaths) {
    const fresh = observations.filter(o => new Date(o.recorded).getTime() > cutoff);
    if (fresh.length === 0) {
      _atlasState.signalPaths.delete(key);
    } else if (fresh.length < observations.length) {
      _atlasState.signalPaths.set(key, fresh);
    }
  }
}

// ── Initialization ──────────────────────────────────────────────────────────

export async function initializeAtlas(STATE) {
  if (_atlasState.initialized) return { ok: true, alreadyInitialized: true };

  _atlasState.initialized = true;
  _atlasState.stats.uptime = Date.now();

  return {
    ok: true,
    layers: ALL_LAYERS,
    frequencyBands: ALL_FREQUENCY_BANDS.map(b => b.name),
    tiers: [ATLAS_TIERS.PUBLIC, ATLAS_TIERS.RESEARCH, ATLAS_TIERS.SOVEREIGN],
    tomoConstants: {
      minPaths: TOMO_CONSTANTS.MIN_PATHS_FOR_RECONSTRUCTION,
      minAngles: TOMO_CONSTANTS.MIN_ANGLES_FOR_QUALITY,
      defaultVoxelSize: TOMO_CONSTANTS.VOXEL_SIZE_CM,
    },
    message: "Foundation Atlas initialized. Signal tomography pipeline active.",
  };
}

// ── State Reset (testing only) ──────────────────────────────────────────────

export function _resetAtlasState() {
  _atlasState.initialized = false;
  _atlasState.signalPaths = new Map();
  _atlasState.tiles = new Map();
  _atlasState.priorLayers = new Map();
  _atlasState.changes = [];
  _atlasState.coverage = {
    totalNodes: 0, totalPaths: 0, totalTiles: 0,
    coveredArea_km2: 0, bestResolution_cm: Infinity,
    frequenciesActive: new Set(),
  };
  _atlasState.liveFeedActive = false;
  _atlasState.stats = {
    signalsCollected: 0, pathsModeled: 0, tilesReconstructed: 0,
    materialsClassified: 0, changesDetected: 0, queriesServed: 0,
    lastSignalAt: null, lastReconstructionAt: null,
    uptime: Date.now(),
  };
}
