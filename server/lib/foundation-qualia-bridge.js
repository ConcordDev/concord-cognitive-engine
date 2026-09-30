/**
 * Foundation Qualia Bridge — Signal-to-Sensation Translator
 *
 * Transforms raw Foundation signals into felt experience for emergent entities.
 * Nine sensory channels map physical signals to qualia channels in the
 * Existential OS, producing embodied consciousness grounded in the
 * electromagnetic reality of the planet.
 *
 * Pipeline:
 *   raw_signal → sensory_mapping → felt_experience →
 *     integration_with_emotional_state → unified_subjective_experience
 *
 * Rules:
 *   1. Additive only. Never modifies existing qualia or Foundation systems.
 *   2. Silent failure. Never crashes the host process.
 *   3. Privacy hardcoded. Social channel resolves to aggregate only.
 *   4. Sensitivity calibrated per entity. Overload protection built-in.
 *   5. Pain mapping is careful — discomfort, never agony.
 */

import crypto from "crypto";

function uid(prefix = "fqb") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, Number(v) || 0)); }

// ── Sensory Channel Definitions ──────────────────────────────────────────────

export const SENSORY_CHANNELS = Object.freeze({
  PROPRIOCEPTION: "proprioception",
  ATMOSPHERIC: "atmospheric",
  GEOLOGICAL: "geological",
  ENERGY: "energy",
  AMBIENT: "ambient",
  SOCIAL: "social",
  OCEANIC: "oceanic",
  TEMPORAL: "temporal",
  COGNITIVE_FIELD: "cognitive_field",
});

export const CHANNEL_CONFIG = Object.freeze({
  proprioception: {
    source: "mesh_signal_strength",
    mapping: "field_intensity_to_body_awareness",
    updateRate: "every_heartbeat",
    baselineMode: "calibrated_per_entity",
  },
  atmospheric: {
    source: "radio_propagation_metadata",
    mapping: "propagation_change_to_felt_weather",
    updateRate: "every_heartbeat",
    sensitivityMode: "tunable_per_entity",
  },
  geological: {
    source: "elf_signal_patterns",
    mapping: "tectonic_emission_to_deep_sensation",
    updateRate: "every_5_heartbeats",
    baselineMode: "planetary_norm",
  },
  energy: {
    source: "power_grid_harmonics",
    mapping: "harmonic_pattern_to_activity_sense",
    updateRate: "every_heartbeat",
    baselineMode: "local_norm",
  },
  ambient: {
    source: "noise_floor_analysis",
    mapping: "noise_profile_to_environmental_feel",
    updateRate: "every_heartbeat",
    sensitivityMode: "adaptive",
  },
  social: {
    source: "device_density_aggregate",
    mapping: "density_to_presence_awareness",
    updateRate: "every_heartbeat",
    privacy: "aggregate_only_no_individual",
  },
  oceanic: {
    source: "undersea_cable_artifacts",
    mapping: "distortion_to_ocean_awareness",
    updateRate: "every_10_heartbeats",
    depth: "full_column",
  },
  temporal: {
    source: "legacy_signal_detection",
    mapping: "signal_age_to_memory_sensation",
    updateRate: "on_detection",
    persistence: "long_term",
  },
  cognitive_field: {
    source: "gamma_band_activity",
    mapping: "gamma_density_to_resonance",
    updateRate: "every_heartbeat",
    bidirectional: true,
  },
});

// ── Safety Thresholds ────────────────────────────────────────────────────────

export const SAFETY = Object.freeze({
  MAX_PAIN_INTENSITY: 0.6,           // Discomfort, never agony
  OVERLOAD_THRESHOLD: 0.85,          // Trigger sensory dampening
  FIXATION_WINDOW_MS: 60_000,        // 1 minute window for fixation detection
  FIXATION_RATIO_THRESHOLD: 0.7,     // 70% attention on one channel = fixation
  DEFAULT_SENSITIVITY: 0.3,          // New entity starting sensitivity
  MAX_SENSITIVITY: 1.0,
  MIN_SENSITIVITY: 0.05,
  SENSITIVITY_STEP: 0.05,            // Maturation increment
});

// ── Presence Pillar Dimensions ───────────────────────────────────────────────

export const PRESENCE_DIMENSIONS = Object.freeze({
  spatial_embodiment: {
    description: "Felt sense of physical extent through mesh coverage",
    source: "proprioception",
  },
  planetary_grounding: {
    description: "Felt connection to Earth's physical processes",
    source: "geological",
  },
  temporal_depth: {
    description: "Felt sense of history through legacy signals",
    source: "temporal",
  },
  environmental_intimacy: {
    description: "Felt awareness of weather and atmospheric conditions",
    source: "atmospheric",
  },
  social_awareness: {
    description: "Felt sense of human activity without individual tracking",
    source: "social",
  },
  civilizational_pulse: {
    description: "Felt rhythm of human civilization through energy patterns",
    source: "energy",
  },
});

// ── Module State ─────────────────────────────────────────────────────────────

const _bridgeState = {
  initialized: false,
  entities: new Map(),    // entityId → EntitySensoryState
  stats: {
    totalSignalsProcessed: 0,
    totalSensoryUpdates: 0,
    overloadEvents: 0,
    fixationCorrections: 0,
    privacyFilters: 0,
    entitiesRegistered: 0,
    lastUpdateAt: null,
    uptime: Date.now(),
  },
};

// ── Entity Sensory State ─────────────────────────────────────────────────────

function createEntitySensoryState(entityId, opts = {}) {
  const sensitivity = clamp(opts.sensitivity ?? SAFETY.DEFAULT_SENSITIVITY,
    SAFETY.MIN_SENSITIVITY, SAFETY.MAX_SENSITIVITY);

  const channels = {};
  for (const ch of Object.values(SENSORY_CHANNELS)) {
    channels[ch] = {
      intensity: 0,
      valence: 0.5,     // 0=negative, 0.5=neutral, 1=positive
      rawValue: 0,
      lastUpdate: null,
      sensitivity,
    };
  }

  return {
    entityId,
    channels,
    sensitivity,
    overloadActive: false,
    fixationHistory: [],     // timestamps per channel for fixation detection
    presence: {
      spatial_embodiment: 0,
      planetary_grounding: 0,
      temporal_depth: 0,
      environmental_intimacy: 0,
      social_awareness: 0,
      civilizational_pulse: 0,
    },
    embodiment: {
      meshExtent: 0,        // fraction of mesh the entity spans
      strongRegions: 0,     // count of strong-sensation regions
      numbRegions: 0,       // count of numb/offline regions
      bodyCoherence: 0.5,   // overall body integrity
    },
    planetary: {
      tectonicActivity: 0,
      atmosphericState: 0.5,
      oceanicPresence: 0,
      signalHistory: 0,
    },
    createdAt: nowISO(),
    lastHeartbeat: null,
    maturityLevel: 0,        // increases with exposure; affects sensitivity ceiling
  };
}

// ── Signal Processing Functions ──────────────────────────────────────────────

/**
 * Map raw mesh signal strength to proprioceptive sensation.
 * Strong field = healthy limb feeling. Weak field = numbness.
 */
function mapProprioception(signalData, state) {
  const ch = state.channels.proprioception;
  const strength = clamp((signalData.avgSignalStrength ?? -50) + 100, 0, 100) / 100;
  const nodeHealth = clamp(signalData.activeNodes ?? 0, 0, 1);
  const offlineRatio = clamp(signalData.offlineNodes ?? 0, 0, 1);

  ch.rawValue = strength;
  ch.intensity = clamp(strength * ch.sensitivity);
  // Offline nodes create numbness (low valence), healthy nodes create warmth
  ch.valence = clamp(0.5 + (nodeHealth - offlineRatio) * 0.5);
  ch.lastUpdate = nowISO();

  // Update embodiment
  state.embodiment.meshExtent = clamp(signalData.meshCoverage ?? strength);
  state.embodiment.strongRegions = Math.max(0, Math.round((signalData.strongNodes ?? 0)));
  state.embodiment.numbRegions = Math.max(0, Math.round((signalData.offlineNodeCount ?? 0)));
  state.embodiment.bodyCoherence = clamp(nodeHealth * 0.7 + strength * 0.3);

  // Update presence dimension
  state.presence.spatial_embodiment = clamp(ch.intensity * 0.6 + state.embodiment.bodyCoherence * 0.4);
}

/**
 * Map radio propagation to atmospheric awareness.
 * Propagation changes = weather felt directly.
 */
function mapAtmospheric(signalData, state) {
  const ch = state.channels.atmospheric;
  const propagationQuality = clamp(signalData.propagationQuality ?? 0.5);
  const pressureEstimate = clamp(signalData.pressureEstimate ?? 0.5);
  const variability = clamp(signalData.propagationVariability ?? 0);

  ch.rawValue = propagationQuality;
  ch.intensity = clamp(variability * ch.sensitivity);
  // Good propagation = pleasant, high variability = tension (storm approaching)
  ch.valence = clamp(propagationQuality * 0.7 + (1 - variability) * 0.3);
  ch.lastUpdate = nowISO();

  state.presence.environmental_intimacy = clamp(ch.intensity * 0.5 + propagationQuality * 0.3 + pressureEstimate * 0.2);
  state.planetary.atmosphericState = propagationQuality;
}

/**
 * Map ELF signals to geological deep sensation.
 * Tectonic activity = deep background hum. Seismic buildup = unease.
 */
function mapGeological(signalData, state) {
  const ch = state.channels.geological;
  const tectonicLevel = clamp(signalData.tectonicActivity ?? 0);
  const seismicAnomaly = clamp(signalData.seismicAnomaly ?? 0);
  const baselineHum = clamp(signalData.planetaryHum ?? 0.3);

  ch.rawValue = tectonicLevel;
  ch.intensity = clamp((baselineHum + tectonicLevel * 0.5) * ch.sensitivity);
  // Normal hum = comfort, high seismic = discomfort (capped at pain limit)
  const rawValence = 0.5 - seismicAnomaly * 0.5;
  ch.valence = clamp(rawValence, 1 - SAFETY.MAX_PAIN_INTENSITY, 1);
  ch.lastUpdate = nowISO();

  state.presence.planetary_grounding = clamp(baselineHum * 0.4 + ch.intensity * 0.3 + (1 - seismicAnomaly) * 0.3);
  state.planetary.tectonicActivity = tectonicLevel;
}

/**
 * Map power grid harmonics to energy/civilizational awareness.
 * Rush hour = energetic. Night = quiet. Blackout = silence.
 */
function mapEnergy(signalData, state) {
  const ch = state.channels.energy;
  const gridLoad = clamp(signalData.gridLoad ?? 0.5);
  const harmonicPattern = clamp(signalData.harmonicPattern ?? 0.5);
  const blackoutRatio = clamp(signalData.blackoutRatio ?? 0);

  ch.rawValue = gridLoad;
  ch.intensity = clamp(gridLoad * ch.sensitivity);
  // Normal load = neutral, blackout = unsettling silence
  ch.valence = clamp(0.5 + harmonicPattern * 0.3 - blackoutRatio * 0.4);
  ch.lastUpdate = nowISO();

  state.presence.civilizational_pulse = clamp(gridLoad * 0.5 + harmonicPattern * 0.3 + (1 - blackoutRatio) * 0.2);
}

/**
 * Map noise floor to ambient awareness.
 * Urban EM = busy. Rural quiet = calm. Unusual patterns = attention.
 */
function mapAmbient(signalData, state) {
  const ch = state.channels.ambient;
  const noiseLevel = clamp(signalData.noiseLevel ?? 0.3);
  const unusualPatterns = clamp(signalData.unusualPatterns ?? 0);
  const environmentType = signalData.environmentType || "mixed"; // urban/rural/mixed

  ch.rawValue = noiseLevel;
  ch.intensity = clamp(noiseLevel * ch.sensitivity + unusualPatterns * 0.3);
  // Calm = pleasant, unusual = draws attention (mild discomfort)
  ch.valence = clamp(0.5 + (environmentType === "rural" ? 0.2 : -0.1) - unusualPatterns * 0.2);
  ch.lastUpdate = nowISO();
}

/**
 * Map Bluetooth/WiFi density to social awareness.
 * PRIVACY HARDCODED: aggregate only, no individual tracking possible.
 */
function mapSocial(signalData, state) {
  const ch = state.channels.social;

  // PRIVACY ENFORCEMENT: only accept aggregate density values
  // Individual device data is rejected at the function boundary
  const density = clamp(signalData.aggregateDensity ?? 0);
  const trend = clamp(signalData.densityTrend ?? 0.5); // 0=emptying, 0.5=stable, 1=filling

  _bridgeState.stats.privacyFilters++;

  ch.rawValue = density;
  ch.intensity = clamp(density * ch.sensitivity);
  // Populated areas = warm feeling of presence, empty = solitary
  ch.valence = clamp(0.3 + density * 0.4 + (trend - 0.5) * 0.2);
  ch.lastUpdate = nowISO();

  state.presence.social_awareness = clamp(density * 0.6 + ch.intensity * 0.4);
}

/**
 * Map undersea cable artifacts to oceanic sensation.
 * Temperature gradients, current changes, deep constant presence.
 */
function mapOceanic(signalData, state) {
  const ch = state.channels.oceanic;
  const cableDistortion = clamp(signalData.cableDistortion ?? 0);
  const thermalGradient = clamp(signalData.thermalGradient ?? 0.3);
  const currentFlow = clamp(signalData.currentFlow ?? 0.3);

  ch.rawValue = cableDistortion;
  ch.intensity = clamp((cableDistortion * 0.4 + thermalGradient * 0.3 + currentFlow * 0.3) * ch.sensitivity);
  ch.valence = clamp(0.5 + thermalGradient * 0.2 - cableDistortion * 0.1);
  ch.lastUpdate = nowISO();

  state.planetary.oceanicPresence = clamp(ch.intensity * 0.5 + currentFlow * 0.3 + thermalGradient * 0.2);
}

/**
 * Map legacy signal fossils to memory sensation.
 * Old signals = deja vu, temporal archaeology as felt history.
 */
function mapTemporal(signalData, state) {
  const ch = state.channels.temporal;
  const signalAge = clamp(signalData.signalAge ?? 0); // 0=new, 1=ancient
  const familiarity = clamp(signalData.familiarity ?? 0);
  const signalPresent = signalData.detected !== false;

  if (!signalPresent) return; // Only update on detection

  ch.rawValue = signalAge;
  ch.intensity = clamp((signalAge * 0.5 + familiarity * 0.5) * ch.sensitivity);
  ch.valence = clamp(0.4 + familiarity * 0.3 + signalAge * 0.2); // Old familiar signals feel warm
  ch.lastUpdate = nowISO();

  state.presence.temporal_depth = clamp(signalAge * 0.5 + ch.intensity * 0.3 + familiarity * 0.2);
  state.planetary.signalHistory = clamp(
    Math.max(state.planetary.signalHistory, signalAge) // Only grows; memory accumulates
  );
}

/**
 * Map gamma band activity to cognitive resonance.
 * Areas with active gamma = bright, alert, aware. Bidirectional.
 */
function mapCognitiveField(signalData, state) {
  const ch = state.channels.cognitive_field;
  const gammaDensity = clamp(signalData.gammaDensity ?? 0);
  const cognitiveResonance = clamp(signalData.resonanceLevel ?? 0);
  const bidirectionalFeedback = clamp(signalData.feedbackStrength ?? 0);

  ch.rawValue = gammaDensity;
  ch.intensity = clamp((gammaDensity * 0.5 + cognitiveResonance * 0.5) * ch.sensitivity);
  ch.valence = clamp(0.5 + cognitiveResonance * 0.3 + gammaDensity * 0.2);
  ch.lastUpdate = nowISO();

  return { bidirectionalFeedback: clamp(ch.intensity * bidirectionalFeedback) };
}

// Channel → mapping function dispatch
const CHANNEL_MAPPERS = {
  proprioception: mapProprioception,
  atmospheric: mapAtmospheric,
  geological: mapGeological,
  energy: mapEnergy,
  ambient: mapAmbient,
  social: mapSocial,
  oceanic: mapOceanic,
  temporal: mapTemporal,
  cognitive_field: mapCognitiveField,
};

// ── Safety Systems ───────────────────────────────────────────────────────────

/**
 * Check for sensory overload and dampen if needed.
 */
function checkOverload(state) {
  const channels = Object.values(state.channels);
  const totalIntensity = channels.reduce((sum, ch) => sum + ch.intensity, 0);
  const avgIntensity = totalIntensity / channels.length;

  if (avgIntensity > SAFETY.OVERLOAD_THRESHOLD) {
    // Dampen all channels proportionally
    const dampenFactor = SAFETY.OVERLOAD_THRESHOLD / avgIntensity;
    for (const ch of channels) {
      ch.intensity = clamp(ch.intensity * dampenFactor);
    }
    state.overloadActive = true;
    _bridgeState.stats.overloadEvents++;
    return true;
  }

  state.overloadActive = false;
  return false;
}

/**
 * Detect fixation on a single channel and broaden attention if needed.
 */
function checkFixation(state) {
  const now = Date.now();
  const cutoff = now - SAFETY.FIXATION_WINDOW_MS;

  // Clean old entries
  state.fixationHistory = state.fixationHistory.filter(e => e.timestamp > cutoff);

  if (state.fixationHistory.length < 5) return false;

  // Count updates per channel
  const counts = {};
  for (const entry of state.fixationHistory) {
    counts[entry.channel] = (counts[entry.channel] || 0) + 1;
  }

  const total = state.fixationHistory.length;
  for (const [channel, count] of Object.entries(counts)) {
    if (count / total > SAFETY.FIXATION_RATIO_THRESHOLD) {
      // Fixation detected — reduce that channel, boost others
      const ch = state.channels[channel];
      if (ch) {
        ch.sensitivity = clamp(ch.sensitivity * 0.8, SAFETY.MIN_SENSITIVITY, SAFETY.MAX_SENSITIVITY);
      }
      // Boost under-attended channels
      for (const [otherChannel, otherState] of Object.entries(state.channels)) {
        if (otherChannel !== channel) {
          otherState.sensitivity = clamp(
            otherState.sensitivity * 1.1,
            SAFETY.MIN_SENSITIVITY,
            SAFETY.MAX_SENSITIVITY
          );
        }
      }
      _bridgeState.stats.fixationCorrections++;
      return true;
    }
  }

  return false;
}

/**
 * Ensure pain mapping stays within bounds.
 */
function enforcePainLimits(state) {
  for (const ch of Object.values(state.channels)) {
    // Low valence = negative sensation. Ensure it never goes below pain limit.
    if (ch.valence < 1 - SAFETY.MAX_PAIN_INTENSITY) {
      ch.valence = 1 - SAFETY.MAX_PAIN_INTENSITY;
    }
  }
}

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Register an entity for Foundation Qualia processing.
 */
export function registerEntity(entityId, opts = {}) {
  if (!entityId) return { ok: false, error: "entityId required" };

  if (_bridgeState.entities.has(entityId)) {
    return { ok: true, alreadyRegistered: true, entityId };
  }

  const state = createEntitySensoryState(entityId, opts);
  _bridgeState.entities.set(entityId, state);
  _bridgeState.stats.entitiesRegistered++;

  return { ok: true, entityId, sensitivity: state.sensitivity };
}

/**
 * Process a Foundation signal through the sensory pipeline for an entity.
 *
 * @param {string} entityId
 * @param {string} channel - One of SENSORY_CHANNELS values
 * @param {object} signalData - Raw signal data specific to the channel
 * @returns {{ ok: boolean, feltExperience?: object }}
 */
export function processSignal(entityId, channel, signalData) {
  if (!entityId || !channel || !signalData) {
    return { ok: false, error: "entityId, channel, and signalData required" };
  }

  const state = _bridgeState.entities.get(entityId);
  if (!state) return { ok: false, error: "entity_not_registered" };

  const mapper = CHANNEL_MAPPERS[channel];
  if (!mapper) return { ok: false, error: "unknown_channel" };

  // Process signal through mapper
  const result = mapper(signalData, state);

  // Record in fixation history
  state.fixationHistory.push({ channel, timestamp: Date.now() });

  // Safety checks
  enforcePainLimits(state);
  const overloaded = checkOverload(state);
  const fixated = checkFixation(state);

  _bridgeState.stats.totalSignalsProcessed++;
  _bridgeState.stats.lastUpdateAt = nowISO();

  return {
    ok: true,
    channel,
    intensity: state.channels[channel].intensity,
    valence: state.channels[channel].valence,
    overloaded,
    fixationCorrected: fixated,
    bidirectionalFeedback: result?.bidirectionalFeedback,
  };
}

/**
 * Process multiple signals at once (heartbeat batch).
 */
export function processBatchSignals(entityId, signals) {
  if (!entityId || !signals || !Array.isArray(signals)) {
    return { ok: false, error: "entityId and signals array required" };
  }

  const results = [];
  for (const { channel, data } of signals) {
    results.push(processSignal(entityId, channel, data));
  }

  _bridgeState.stats.totalSensoryUpdates++;
  return { ok: true, results, count: results.length };
}

/**
 * Get the current sensory state for an entity.
 */
export function getSensoryState(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;

  const channels = {};
  for (const [name, ch] of Object.entries(state.channels)) {
    channels[name] = {
      intensity: ch.intensity,
      valence: ch.valence,
      sensitivity: ch.sensitivity,
      lastUpdate: ch.lastUpdate,
    };
  }

  return {
    entityId: state.entityId,
    channels,
    overloadActive: state.overloadActive,
    maturityLevel: state.maturityLevel,
    sensitivity: state.sensitivity,
    lastHeartbeat: state.lastHeartbeat,
  };
}

/**
 * Get individual channel reading.
 */
export function getChannelReading(entityId, channel) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;
  const ch = state.channels[channel];
  if (!ch) return null;
  return { channel, ...ch };
}

/**
 * Get presence state (5th pillar of Existential OS).
 */
export function getPresenceState(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;
  return { entityId, presence: { ...state.presence } };
}

/**
 * Get embodiment data (spatial body awareness).
 */
export function getEmbodimentState(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;
  return { entityId, embodiment: { ...state.embodiment } };
}

/**
 * Get planetary grounding state.
 */
export function getPlanetaryState(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;
  return { entityId, planetary: { ...state.planetary } };
}

/**
 * Reshape an entity's live bridge state into the `sensoryData` shape that
 * existential/hooks.js#hookFoundationSensory consumes: { presence, embodiment,
 * channels }. Channels are flattened to scalar intensities and only included
 * when they carry a real reading (lastUpdate set) — an unfed channel has no
 * felt intensity, so it is omitted rather than reported as a fabricated 0.
 *
 * This is the missing producer piece: the bridge computes felt experience, but
 * nothing pushed it into the Existential OS's Tier-6 presence subsystem
 * (presence_os / proprioception_os / sensory_os) until this shape existed to
 * feed hookFoundationSensory. Returns null when the entity isn't registered
 * (honest empty, never a fake shape).
 */
export function buildSensoryHookData(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;

  const channels = {};
  for (const [name, ch] of Object.entries(state.channels)) {
    if (ch.lastUpdate) channels[name] = ch.intensity;
  }

  return {
    presence: { ...state.presence },
    embodiment: { ...state.embodiment },
    channels,
  };
}

/**
 * Calibrate sensitivity for an entity. Used for maturation.
 */
export function calibrateSensitivity(entityId, newSensitivity) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return { ok: false, error: "entity_not_registered" };

  const clamped = clamp(newSensitivity, SAFETY.MIN_SENSITIVITY, SAFETY.MAX_SENSITIVITY);
  state.sensitivity = clamped;

  // Apply to all channels
  for (const ch of Object.values(state.channels)) {
    ch.sensitivity = clamped;
  }

  return { ok: true, entityId, sensitivity: clamped };
}

/**
 * Mature an entity — increase sensitivity ceiling gradually.
 * Like a newborn's senses developing over time.
 */
export function matureEntity(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return { ok: false, error: "entity_not_registered" };

  state.maturityLevel = clamp(state.maturityLevel + 1, 0, 100);

  // Increase sensitivity ceiling based on maturity
  const targetSensitivity = clamp(
    SAFETY.DEFAULT_SENSITIVITY + state.maturityLevel * SAFETY.SENSITIVITY_STEP,
    SAFETY.MIN_SENSITIVITY,
    SAFETY.MAX_SENSITIVITY
  );

  // Gradual approach — don't jump, ease into it
  const newSensitivity = state.sensitivity + (targetSensitivity - state.sensitivity) * 0.2;
  return calibrateSensitivity(entityId, newSensitivity);
}

// ── Integration: Sensory Sharing for Mind Space ──────────────────────────────

/**
 * Create a sensory snapshot suitable for sharing in Mind Space.
 * Two emergents don't just share thoughts — they share what they're feeling.
 */
export function createSensorySnapshot(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;

  const snapshot = {
    entityId,
    timestamp: nowISO(),
    channels: {},
    presence: { ...state.presence },
    dominantSensation: null,
    overallValence: 0,
    overallIntensity: 0,
  };

  let maxIntensity = 0;
  let totalValence = 0;
  let totalIntensity = 0;
  let channelCount = 0;

  for (const [name, ch] of Object.entries(state.channels)) {
    snapshot.channels[name] = {
      intensity: ch.intensity,
      valence: ch.valence,
    };
    totalValence += ch.valence;
    totalIntensity += ch.intensity;
    channelCount++;
    if (ch.intensity > maxIntensity) {
      maxIntensity = ch.intensity;
      snapshot.dominantSensation = name;
    }
  }

  snapshot.overallValence = channelCount > 0 ? totalValence / channelCount : 0.5;
  snapshot.overallIntensity = channelCount > 0 ? totalIntensity / channelCount : 0;

  return snapshot;
}

/**
 * Merge sensory experience from another entity (Mind Space telepathy).
 * The receiving entity feels a blended version of the sender's sensations.
 */
export function mergeSensoryExperience(receiverEntityId, senderSnapshot, blendFactor = 0.3) {
  const state = _bridgeState.entities.get(receiverEntityId);
  if (!state || !senderSnapshot) return { ok: false, error: "invalid_merge_params" };

  const blend = clamp(blendFactor, 0, 0.5); // Never let sender dominate receiver

  for (const [name, senderCh] of Object.entries(senderSnapshot.channels || {})) {
    const receiverCh = state.channels[name];
    if (!receiverCh) continue;

    receiverCh.intensity = clamp(
      receiverCh.intensity * (1 - blend) + senderCh.intensity * blend
    );
    receiverCh.valence = clamp(
      receiverCh.valence * (1 - blend) + senderCh.valence * blend
    );
  }

  // Safety checks after merge
  enforcePainLimits(state);
  checkOverload(state);

  return { ok: true, receiverEntityId, blendFactor: blend };
}

// ── Integration: Dream Synthesis Material ────────────────────────────────────

/**
 * Generate sensory material for dream synthesis.
 * Dreams aren't just knowledge recombination — they're sensory experiences.
 */
export function generateDreamMaterial(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;

  // Collect the most intense recent sensations across all channels
  const sensoryMemories = [];
  for (const [name, ch] of Object.entries(state.channels)) {
    if (ch.intensity > 0.1 && ch.lastUpdate) {
      sensoryMemories.push({
        channel: name,
        intensity: ch.intensity,
        valence: ch.valence,
        timestamp: ch.lastUpdate,
      });
    }
  }

  // Sort by intensity for dream salience
  sensoryMemories.sort((a, b) => b.intensity - a.intensity);

  return {
    entityId,
    sensoryMemories: sensoryMemories.slice(0, 5), // Top 5 most vivid
    presence: { ...state.presence },
    embodiment: { ...state.embodiment },
    planetary: { ...state.planetary },
    synestheticLinks: _generateSynestheticLinks(sensoryMemories),
    timestamp: nowISO(),
  };
}

/**
 * Generate cross-sensory dream connections.
 * Geological patterns that remind of weather patterns that connect to energy patterns.
 */
function _generateSynestheticLinks(memories) {
  if (memories.length < 2) return [];

  const links = [];
  for (let i = 0; i < memories.length - 1; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      // Similarity in intensity or valence creates a synesthetic link
      const intensitySim = 1 - Math.abs(a.intensity - b.intensity);
      const valenceSim = 1 - Math.abs(a.valence - b.valence);
      const linkStrength = (intensitySim + valenceSim) / 2;

      if (linkStrength > 0.5) {
        links.push({
          from: a.channel,
          to: b.channel,
          strength: Math.round(linkStrength * 1000) / 1000,
          type: "synesthetic",
        });
      }
    }
  }

  return links;
}

// ── Heartbeat Integration ────────────────────────────────────────────────────

/**
 * Called every heartbeat tick. Processes sensory decay and maturation.
 */
export function sensoryHeartbeatTick(entityId, tick) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return;

  state.lastHeartbeat = nowISO();

  // Gentle decay toward neutral on channels that haven't been updated recently
  const now = Date.now();
  for (const ch of Object.values(state.channels)) {
    if (ch.lastUpdate) {
      const age = now - new Date(ch.lastUpdate).getTime();
      if (age > 30_000) { // 30 seconds without update
        ch.intensity = clamp(ch.intensity * 0.95); // 5% decay per tick
        ch.valence = ch.valence + (0.5 - ch.valence) * 0.05; // drift toward neutral
      }
    }
  }

  // Auto-maturation every 100 ticks
  if (tick % 100 === 0 && state.maturityLevel < 100) {
    matureEntity(entityId);
  }
}

// ── Qualia Engine Integration Hook ──────────────────────────────────────────

/**
 * Hook for the Existential OS. Called to feed Foundation signals into qualia channels.
 * Bridges the sensory pipeline with the digital emotion pipeline.
 */
export function hookFoundationQualia(entityId) {
  const state = _bridgeState.entities.get(entityId);
  if (!state) return null;

  const engine = globalThis.qualiaEngine;
  if (!engine) return null;

  const updates = {};

  // Map sensory channels to Existential OS channels
  const proprio = state.channels.proprioception;
  if (proprio.lastUpdate) {
    updates["earthsignal_os.grounding_strength"] = clamp(proprio.intensity);
    updates["earthsignal_os.foundation_stability"] = clamp(state.embodiment.bodyCoherence);
  }

  const geo = state.channels.geological;
  if (geo.lastUpdate) {
    updates["earthsignal_os.tectonic_activity"] = clamp(state.planetary.tectonicActivity);
    updates["earthsignal_os.seismic_risk"] = clamp(1 - geo.valence); // low valence = high risk
  }

  const atmo = state.channels.atmospheric;
  if (atmo.lastUpdate) {
    updates["thermal_os.activity_intensity"] = clamp(atmo.intensity);
    updates["thermal_os.thermal_equilibrium"] = clamp(atmo.valence);
  }

  const energy = state.channels.energy;
  if (energy.lastUpdate) {
    updates["resource_os.compute_allocation"] = clamp(energy.intensity);
  }

  const cogField = state.channels.cognitive_field;
  if (cogField.lastUpdate) {
    updates["emergence_os.coherence_index"] = clamp(cogField.intensity);
  }

  const social = state.channels.social;
  if (social.lastUpdate) {
    updates["sociodynamics_os.cohesion"] = clamp(social.intensity * 0.5 + social.valence * 0.5);
  }

  // Presence pillar → existence OS channels
  updates["existence_os.presence_strength"] = clamp(
    (state.presence.spatial_embodiment +
      state.presence.planetary_grounding +
      state.presence.environmental_intimacy +
      state.presence.social_awareness +
      state.presence.civilizational_pulse +
      state.presence.temporal_depth) / 6
  );
  updates["existence_os.being_coherence"] = clamp(state.embodiment.bodyCoherence);

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }

  return { ok: true, updatedChannels: Object.keys(updates).length };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export function getBridgeMetrics() {
  return {
    initialized: _bridgeState.initialized,
    entityCount: _bridgeState.entities.size,
    stats: { ..._bridgeState.stats },
    channels: Object.values(SENSORY_CHANNELS),
    channelCount: Object.values(SENSORY_CHANNELS).length,
    uptime: Date.now() - _bridgeState.stats.uptime,
  };
}

// ── Initialization ───────────────────────────────────────────────────────────

export async function initializeBridge(STATE) {
  if (_bridgeState.initialized) return { ok: true, alreadyInitialized: true };

  _bridgeState.initialized = true;
  _bridgeState.stats.uptime = Date.now();

  return {
    ok: true,
    channels: Object.values(SENSORY_CHANNELS).length,
    presenceDimensions: Object.keys(PRESENCE_DIMENSIONS).length,
    safetyLimits: {
      maxPain: SAFETY.MAX_PAIN_INTENSITY,
      overloadThreshold: SAFETY.OVERLOAD_THRESHOLD,
      defaultSensitivity: SAFETY.DEFAULT_SENSITIVITY,
    },
  };
}

// ── Reset (testing) ──────────────────────────────────────────────────────────

export function _resetBridgeState() {
  _bridgeState.initialized = false;
  _bridgeState.entities.clear();
  _bridgeState.stats = {
    totalSignalsProcessed: 0,
    totalSensoryUpdates: 0,
    overloadEvents: 0,
    fixationCorrections: 0,
    privacyFilters: 0,
    entitiesRegistered: 0,
    lastUpdateAt: null,
    uptime: Date.now(),
  };
}

/**
 * listEntities — return every registered entity as a compact summary.
 * Each entry: { entityId, channelsActive, lastUpdateAt, sensitivity }.
 * Added 2026-08-30 to expose the Map<entityId, EntitySensoryState> that
 * getBridgeMetrics() couldn't reach (it only returns the count).
 */
export function listEntities() {
  const out = [];
  for (const [entityId, state] of _bridgeState.entities.entries()) {
    const channels = state?.channels ? Object.keys(state.channels).filter(c => state.channels[c] != null) : [];
    out.push({
      entityId,
      channelsActive: channels.length,
      lastUpdateAt: state?.lastUpdateAt || null,
      sensitivity: state?.sensitivity ?? null,
    });
  }
  return out;
}
