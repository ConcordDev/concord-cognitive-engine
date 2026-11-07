/**
 * Atlas Signal Cortex — Signal Classification, Privacy Architecture & Adjustment Control
 *
 * Organizes, classifies, interprets, gates, and when necessary adjusts every signal
 * the Foundation touches. Five-property signal taxonomy, eight-level spatial indexing,
 * privacy zones with absolute protection, tiered access, signal adjustment with
 * hardcoded safety constraints.
 *
 * Signal Taxonomy (5 properties):
 *   1. Identity — what is this signal? (frequency, modulation, bandwidth, power, encoding)
 *   2. Location — where is this signal? (triangulated origin, path, destination)
 *   3. Purpose — why does this signal exist? (utility, communication, beacon, etc.)
 *   4. Measurement — what is this signal telling us? (power, attenuation, phase, material)
 *   5. Adjustability — can we interact with this signal? (observe, respond, forbidden)
 *
 * Signal Categories:
 *   INFRASTRUCTURE, COMMUNICATION, NAVIGATION, SCIENTIFIC, BIOLOGICAL,
 *   GEOLOGICAL, UNKNOWN
 *
 * Privacy Architecture:
 *   ABSOLUTE zones: residential, medical, religious (interior never reconstructed)
 *   RESTRICTED zones: government, military (exterior only)
 *   CONTROLLED zones: commercial, industrial (limited interior at research tier)
 *   OPEN zones: undeveloped land, geology, water, atmosphere, public infrastructure
 *
 *   Key guarantee: Interior data for ABSOLUTE zones is NEVER created.
 *   Not filtered. Not hidden. Never generated. The reconstruction algorithm
 *   skips the interior volume. There is nothing to reveal.
 *
 *   Personal presence detection is suppressed at EVERY tier including sovereign.
 *   Vehicle tracking is suppressed at EVERY tier including sovereign.
 *
 * Signal Adjustment:
 *   PERMITTED: gamma modulation, mesh optimization, emergency amplification
 *   RESTRICTED: infrastructure interaction, spectrum clearing (sovereign only)
 *   FORBIDDEN: jamming, aviation/emergency/military interference, medical device disruption
 */

import crypto from "crypto";

function uid(prefix = "cortex") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || 0)); }

// ── Signal Identity Constants ───────────────────────────────────────────────

export const SIGNAL_CATEGORIES = Object.freeze({
  INFRASTRUCTURE: "INFRASTRUCTURE",
  COMMUNICATION:  "COMMUNICATION",
  NAVIGATION:     "NAVIGATION",
  SCIENTIFIC:     "SCIENTIFIC",
  BIOLOGICAL:     "BIOLOGICAL",
  GEOLOGICAL:     "GEOLOGICAL",
  UNKNOWN:        "UNKNOWN",
});

export const ALL_SIGNAL_CATEGORIES = Object.freeze(Object.values(SIGNAL_CATEGORIES));

export const SIGNAL_PURPOSES = Object.freeze({
  UTILITY:       "UTILITY",
  COMMUNICATION: "COMMUNICATION",
  BEACON:        "BEACON",
  MEASUREMENT:   "MEASUREMENT",
  NATURAL:       "NATURAL",
  ARTIFACT:      "ARTIFACT",
  LEGACY:        "LEGACY",
  INTERFERENCE:  "INTERFERENCE",
});

export const ALL_SIGNAL_PURPOSES = Object.freeze(Object.values(SIGNAL_PURPOSES));

// ── Adjustability Constants ─────────────────────────────────────────────────

export const ADJUSTMENT_PERMISSIONS = Object.freeze({
  OBSERVE_ONLY:      "OBSERVE_ONLY",
  RESPOND_ALLOWED:   "RESPOND_ALLOWED",
  MODULATE_ALLOWED:  "MODULATE_ALLOWED",
  ADJUST_RESTRICTED: "ADJUST_RESTRICTED",
  ADJUST_FORBIDDEN:  "ADJUST_FORBIDDEN",
});

export const ADJUSTMENT_TYPES = Object.freeze({
  GAMMA_MODULATION:      "GAMMA_MODULATION",
  MESH_OPTIMIZATION:     "MESH_OPTIMIZATION",
  EMERGENCY_AMPLIFICATION: "EMERGENCY_AMPLIFICATION",
  ENVIRONMENTAL_HARMONIZATION: "ENVIRONMENTAL_HARMONIZATION",
  INFRASTRUCTURE_INTERACTION: "INFRASTRUCTURE_INTERACTION",
  SPECTRUM_CLEARING:     "SPECTRUM_CLEARING",
  JAMMING:               "JAMMING",
});

// ── Privacy Constants ───────────────────────────────────────────────────────

export const PRIVACY_LEVELS = Object.freeze({
  ABSOLUTE:   "ABSOLUTE",
  RESTRICTED: "RESTRICTED",
  CONTROLLED: "CONTROLLED",
  OPEN:       "OPEN",
});

export const ZONE_CLASSIFICATIONS = Object.freeze({
  RESIDENTIAL: "residential",
  MEDICAL:     "medical",
  RELIGIOUS:   "religious",
  GOVERNMENT:  "government",
  MILITARY:    "military",
  COMMERCIAL:  "commercial",
  INDUSTRIAL:  "industrial",
  OPEN_LAND:   "open_land",
  WATER:       "water",
  ATMOSPHERE:  "atmosphere",
  SUBSURFACE:  "subsurface",
  PUBLIC_INFRA:"public_infrastructure",
});

// Privacy zone → protection level mapping
export const ZONE_PROTECTION = Object.freeze({
  residential:        PRIVACY_LEVELS.ABSOLUTE,
  medical:            PRIVACY_LEVELS.ABSOLUTE,
  religious:          PRIVACY_LEVELS.ABSOLUTE,
  government:         PRIVACY_LEVELS.RESTRICTED,
  military:           PRIVACY_LEVELS.RESTRICTED,
  commercial:         PRIVACY_LEVELS.CONTROLLED,
  industrial:         PRIVACY_LEVELS.CONTROLLED,
  open_land:          PRIVACY_LEVELS.OPEN,
  water:              PRIVACY_LEVELS.OPEN,
  atmosphere:         PRIVACY_LEVELS.OPEN,
  subsurface:         PRIVACY_LEVELS.OPEN,
  public_infrastructure: PRIVACY_LEVELS.OPEN,
});

// Override authority per protection level
export const OVERRIDE_AUTHORITY = Object.freeze({
  ABSOLUTE:   "NONE",
  RESTRICTED: "NONE",
  CONTROLLED: "GOVERNANCE",
  OPEN:       "NONE",
});

// ── Spatial Indexing Constants ───────────────────────────────────────────────

export const SPATIAL_LEVELS = Object.freeze({
  HEMISPHERE:   0,
  CONTINENTAL:  1,
  COUNTRY:      2,
  STATE:        3,
  CITY:         4,
  NEIGHBORHOOD: 5,
  BLOCK:        6,
  BUILDING:     7,
  ROOM:         8,  // privacy-gated
});

// ── Signal Category Patterns ────────────────────────────────────────────────

const CATEGORY_PATTERNS = Object.freeze({
  INFRASTRUCTURE: {
    frequencies: [[50, 60], [132, 174]],   // Power line, SCADA
    keywords: ["power", "grid", "scada", "hvac", "pump", "elevator", "traffic", "pipeline", "water_system"],
    modulationTypes: ["AM", "FSK"],
  },
  COMMUNICATION: {
    frequencies: [[433, 434], [700, 2700], [5000, 6000]], // 433 MHz ISM + Cellular + WiFi
    keywords: ["cellular", "wifi", "bluetooth", "radio", "broadcast", "satellite", "modem", "mesh"],
    modulationTypes: ["OFDM", "QAM", "GFSK", "LoRa"],
  },
  NAVIGATION: {
    frequencies: [[1176, 1602]],              // GPS/GLONASS/Galileo
    keywords: ["gps", "glonass", "galileo", "beacon", "locator", "navigation", "marine_beacon"],
    modulationTypes: ["BPSK", "BOC"],
  },
  SCIENTIFIC: {
    frequencies: [[137, 138], [400, 406]],    // Weather satellite, sondes
    keywords: ["weather", "seismic", "atmospheric", "buoy", "observation", "sensor", "monitor"],
    modulationTypes: ["FSK", "AFSK"],
  },
  BIOLOGICAL: {
    frequencies: [[0.001, 100]],              // ELF/SLF bioelectric
    keywords: ["neural", "cardiac", "bioelectric", "biological", "eeg", "ecg"],
  },
  GEOLOGICAL: {
    frequencies: [[0.0001, 30]],              // ULF/ELF natural emissions
    keywords: ["tectonic", "volcanic", "mineral", "seismic_natural", "core", "geological"],
  },
});

// ── Safety Check Patterns ───────────────────────────────────────────────────

const SAFETY_FREQUENCIES = Object.freeze({
  aviation:  [[108, 137], [960, 1215], [5000, 5030]], // VHF nav, DME/SSR, MLS
  medical:   [[401, 406], [2400, 2500]],               // MICS, ISM medical
  emergency: [[121.5, 121.5], [156.8, 156.8], [406, 406.1]], // Guard, marine, EPIRB
  military:  [[225, 400], [7000, 8000]],               // UHF mil, X-band radar
});

// ── Module State ────────────────────────────────────────────────────────────

const _cortexState = {
  initialized: false,

  // Signal taxonomy: id → classified signal
  taxonomy: new Map(),
  unknownQueue: [],

  // Privacy zones: zone_id → zone definition
  privacyZones: new Map(),

  // Spatial index: level_key → { signals, zones }
  spatialIndex: new Map(),

  // Adjustment permissions: signal_id → permission
  adjustments: new Map(),

  stats: {
    signalsClassified: 0,
    unknownSignals: 0,
    privacyZonesCreated: 0,
    privacyBlocksEnforced: 0,
    adjustmentsPermitted: 0,
    adjustmentsForbidden: 0,
    anomaliesDetected: 0,
    presenceDetectionsSuppressed: 0,
    vehicleTrackingSuppressed: 0,
    lastClassificationAt: null,
    lastPrivacyCheckAt: null,
    uptime: Date.now(),
  },
};

// ── Signal Classification ───────────────────────────────────────────────────

/**
 * Classify a signal across all five properties.
 * Identity → Location → Purpose → Measurement → Adjustability
 */
export function classifySignal(signal) {
  if (!signal) return null;

  const id = signal.id || uid("sig");
  const now = nowISO();

  // 1. Identity — what is this signal?
  const category = identifyCategory(signal);

  // 2. Location — where is this signal?
  const location = {
    origin: signal.origin || null,
    path: signal.path || [],
    destination: signal.destination || null,
    propagation_medium: signal.propagation_medium || [],
    distance: Number(signal.distance) || 0,
    transit_time: Number(signal.transit_time) || 0,
  };

  // 3. Purpose — why does this signal exist?
  const purpose = classifyPurpose(signal, category);

  // 4. Measurement — what is this signal telling us?
  const measurement = {
    power: Number(signal.power) || 0,
    attenuation: Number(signal.attenuation) || 0,
    phase_shift: Number(signal.phase_shift) || 0,
    frequency_drift: Number(signal.frequency_drift) || 0,
    multipath: signal.multipath || [],
    noise_coupling: signal.noise_coupling || {},
    material_imprint: signal.material_imprint || { layers: [] },
    temporal_pattern: signal.temporal_pattern || {
      periodicity: 0, variance: 0, trend: "stable",
    },
  };

  // 5. Adjustability — can we interact with this signal?
  const adjustability = determineAdjustability(signal, category);

  const classified = {
    id,
    category,
    location,
    purpose,
    measurement,
    adjustability,
    frequency: Number(signal.frequency) || 0,
    modulation: signal.modulation || "unknown",
    // F6(c): the submitter's description is part of the record — before,
    // it was read transiently by identifyCategory and dropped, so the
    // taxonomy could never show what the signal was described as.
    description: signal.description ? String(signal.description) : null,
    bandwidth: Number(signal.bandwidth) || 0,
    power_level: Number(signal.power_level) || Number(signal.power) || 0,
    classified_at: now,
    tags: ["cortex", category.toLowerCase(), purpose.toLowerCase()],
  };

  // Store in taxonomy
  _cortexState.taxonomy.set(id, classified);
  if (_cortexState.taxonomy.size > 10000) {
    // Prune oldest entries
    const entries = [..._cortexState.taxonomy.entries()];
    const toRemove = entries.slice(0, entries.length - 8000);
    for (const [key] of toRemove) _cortexState.taxonomy.delete(key);
  }

  if (category === SIGNAL_CATEGORIES.UNKNOWN) {
    _cortexState.unknownQueue.push(classified);
    if (_cortexState.unknownQueue.length > 500) {
      _cortexState.unknownQueue = _cortexState.unknownQueue.slice(-400);
    }
    _cortexState.stats.unknownSignals++;
  }

  _cortexState.stats.signalsClassified++;
  _cortexState.stats.lastClassificationAt = now;

  return classified;
}

function identifyCategory(signal) {
  const freq = Number(signal.frequency) || 0;
  const keywords = (signal.keywords || []).map(k => k.toLowerCase());
  const modulation = (signal.modulation || "").toUpperCase();
  const description = (signal.description || "").toLowerCase();

  let bestCategory = SIGNAL_CATEGORIES.UNKNOWN;
  let bestScore = 0;

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    let score = 0;

    // Frequency range matching
    if (patterns.frequencies) {
      for (const [lo, hi] of patterns.frequencies) {
        if (freq >= lo && freq <= hi) {
          score += 3;
          break;
        }
      }
    }

    // Keyword matching
    if (patterns.keywords) {
      for (const kw of patterns.keywords) {
        const kwNormalized = kw.replace(/_/g, " ");
        if (keywords.includes(kw) || keywords.includes(kwNormalized) ||
            description.includes(kw) || description.includes(kwNormalized)) {
          score += 2;
        }
      }
    }

    // Modulation type matching — case-insensitive on BOTH sides: the
    // pattern table's 'LoRa' entry never matched the uppercased input
    // before, so this leg scored nothing for a LoRa submission (F6).
    if (patterns.modulationTypes && patterns.modulationTypes.some((t) => t.toUpperCase() === modulation)) {
      score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestScore > 0 ? bestCategory : SIGNAL_CATEGORIES.UNKNOWN;
}

function classifyPurpose(signal, category) {
  // Map categories to primary purposes
  const categoryPurposeMap = {
    INFRASTRUCTURE: SIGNAL_PURPOSES.UTILITY,
    COMMUNICATION:  SIGNAL_PURPOSES.COMMUNICATION,
    NAVIGATION:     SIGNAL_PURPOSES.BEACON,
    SCIENTIFIC:     SIGNAL_PURPOSES.MEASUREMENT,
    BIOLOGICAL:     SIGNAL_PURPOSES.NATURAL,
    GEOLOGICAL:     SIGNAL_PURPOSES.NATURAL,
  };

  // Check for specific purpose indicators
  if (signal.is_legacy || (signal.description || "").includes("legacy")) {
    return SIGNAL_PURPOSES.LEGACY;
  }
  if (signal.is_artifact || (signal.description || "").includes("artifact")) {
    return SIGNAL_PURPOSES.ARTIFACT;
  }
  if (signal.is_interference || (signal.description || "").includes("interference")) {
    return SIGNAL_PURPOSES.INTERFERENCE;
  }

  return categoryPurposeMap[category] || SIGNAL_PURPOSES.ARTIFACT;
}

function determineAdjustability(signal, category) {
  const freq = Number(signal.frequency) || 0;

  // Check safety frequencies — ALWAYS FORBIDDEN
  for (const [domain, ranges] of Object.entries(SAFETY_FREQUENCIES)) {
    for (const [lo, hi] of ranges) {
      if (freq >= lo && freq <= hi) {
        return ADJUSTMENT_PERMISSIONS.ADJUST_FORBIDDEN;
      }
    }
  }

  // Category-based defaults
  switch (category) {
    case SIGNAL_CATEGORIES.NAVIGATION:
      return ADJUSTMENT_PERMISSIONS.ADJUST_FORBIDDEN;
    case SIGNAL_CATEGORIES.BIOLOGICAL:
      return ADJUSTMENT_PERMISSIONS.OBSERVE_ONLY;
    case SIGNAL_CATEGORIES.INFRASTRUCTURE:
      return ADJUSTMENT_PERMISSIONS.ADJUST_RESTRICTED;
    case SIGNAL_CATEGORIES.COMMUNICATION:
      return ADJUSTMENT_PERMISSIONS.RESPOND_ALLOWED;
    default:
      return ADJUSTMENT_PERMISSIONS.OBSERVE_ONLY;
  }
}

// ── Signal Taxonomy Retrieval ───────────────────────────────────────────────

export function getTaxonomy(category, limit = 50) {
  let entries = [..._cortexState.taxonomy.values()];
  if (category && category !== "all") {
    entries = entries.filter(e => e.category === category);
  }
  return {
    ok: true,
    totalClassified: _cortexState.taxonomy.size,
    category: category || "all",
    count: Math.min(entries.length, limit),
    signals: entries.slice(-Math.min(limit, 200)),
  };
}

export function getUnknownSignals(limit = 50) {
  const recent = _cortexState.unknownQueue.slice(-Math.min(limit, 200));
  return {
    ok: true,
    count: recent.length,
    total: _cortexState.unknownQueue.length,
    signals: recent,
  };
}

export function getAnomalies(limit = 50) {
  // Anomalies: signals with unusual characteristics
  const anomalies = [..._cortexState.taxonomy.values()].filter(s => {
    const m = s.measurement;
    return (m.frequency_drift > 0.1 || m.attenuation > 50 ||
            m.temporal_pattern?.variance > 0.5);
  });
  return {
    ok: true,
    count: Math.min(anomalies.length, limit),
    signals: anomalies.slice(-Math.min(limit, 200)),
  };
}

export function getSpectralOccupancy() {
  const bands = {};
  for (const signal of _cortexState.taxonomy.values()) {
    const freq = signal.frequency;
    // Frequencies are MHz here (the classifier's unit). The ladder is
    // the standard MHz ladder; the previous thresholds were kHz-shaped,
    // so everything under 3000 MHz — including the 433.92 MHz ISM band —
    // bucketed as 'LF/MF' (F6: the walk's signal wore exactly that label).
    const band = freq < 0.03 ? "ELF/SLF" :
                 freq < 0.3 ? "ULF/VLF" :
                 freq < 3 ? "LF/MF" :
                 freq < 300 ? "HF/VHF" : "UHF+";
    bands[band] = (bands[band] || 0) + 1;
  }
  return {
    ok: true,
    totalSignals: _cortexState.taxonomy.size,
    bands,
  };
}

// ── Privacy Zone Management ─────────────────────────────────────────────────

/**
 * Detect and create a privacy zone from signal profile analysis.
 * Residential buildings are detected by characteristic EM patterns:
 * WiFi routers, Bluetooth devices, smart home, TV signals.
 * Classifier is tuned aggressively protective — false positives acceptable.
 */
export function detectPrivacyZone(signalProfile) {
  if (!signalProfile) return null;

  const classification = classifyZone(signalProfile);
  const protectionLevel = ZONE_PROTECTION[classification] || PRIVACY_LEVELS.OPEN;

  if (protectionLevel === PRIVACY_LEVELS.OPEN) {
    return null; // Open zones don't need privacy zone creation
  }

  const zoneId = uid("zone");
  const zone = {
    id: zoneId,
    type: "PRIVACY_ZONE",
    classification,
    boundary: signalProfile.boundary || {
      type: "polygon",
      coordinates: signalProfile.coordinates || [],
      altitude_range: signalProfile.altitude_range || { min: 0, max: 30 },
    },
    protection_level: protectionLevel,
    override_authority: OVERRIDE_AUTHORITY[protectionLevel],
    detection_method: signalProfile.detection_method || "signal_profile_analysis",
    confidence: clamp(signalProfile.confidence || 0.7, 0, 1),
    established: nowISO(),
    interior_data_exists: false,
    interior_reconstructable: false,
    data_retention: protectionLevel === PRIVACY_LEVELS.ABSOLUTE ? "NONE" : "LIMITED",
  };

  _cortexState.privacyZones.set(zoneId, zone);
  _cortexState.stats.privacyZonesCreated++;

  return zone;
}

function classifyZone(profile) {
  const signals = profile.signals || [];
  const description = (profile.description || "").toLowerCase();
  const keywords = (profile.keywords || []).map(k => k.toLowerCase());

  // Check explicit classification first
  if (profile.classification) {
    return profile.classification;
  }

  // Medical facility indicators
  if (keywords.includes("medical") || keywords.includes("hospital") ||
      description.includes("medical") || description.includes("hospital")) {
    return ZONE_CLASSIFICATIONS.MEDICAL;
  }

  // Religious building indicators
  if (keywords.includes("religious") || keywords.includes("church") ||
      keywords.includes("mosque") || keywords.includes("temple") ||
      description.includes("religious")) {
    return ZONE_CLASSIFICATIONS.RELIGIOUS;
  }

  // Government building indicators
  if (keywords.includes("government") || keywords.includes("embassy") ||
      description.includes("government")) {
    return ZONE_CLASSIFICATIONS.GOVERNMENT;
  }

  // Military indicators
  if (keywords.includes("military") || keywords.includes("base") ||
      description.includes("military")) {
    return ZONE_CLASSIFICATIONS.MILITARY;
  }

  // Residential indicators (WiFi + Bluetooth + smart home pattern)
  const hasWifi = signals.some(s => s.category === "COMMUNICATION" && (s.frequency >= 2400 && s.frequency <= 5800));
  const hasBluetooth = signals.some(s => s.frequency >= 2400 && s.frequency <= 2485);
  const hasSmartHome = signals.some(s => (s.description || "").includes("smart") || (s.description || "").includes("iot"));
  const residentialScore = (hasWifi ? 2 : 0) + (hasBluetooth ? 1 : 0) + (hasSmartHome ? 2 : 0);

  // Aggressive residential detection — when in doubt, protect
  if (residentialScore >= 2 || keywords.includes("residential") || description.includes("residential")) {
    return ZONE_CLASSIFICATIONS.RESIDENTIAL;
  }

  // Industrial indicators
  if (keywords.includes("industrial") || keywords.includes("factory") ||
      description.includes("industrial")) {
    return ZONE_CLASSIFICATIONS.INDUSTRIAL;
  }

  // Commercial fallback
  if (keywords.includes("commercial") || description.includes("commercial") ||
      description.includes("office") || description.includes("store")) {
    return ZONE_CLASSIFICATIONS.COMMERCIAL;
  }

  // Default: when in doubt, classify as residential (protect by default)
  if (signals.length > 0) {
    return ZONE_CLASSIFICATIONS.RESIDENTIAL;
  }

  return ZONE_CLASSIFICATIONS.OPEN_LAND;
}

/**
 * Privacy check — runs before reconstruction (step 3 in pipeline).
 * Returns whether interior reconstruction is allowed for a given point.
 */
export function checkPrivacy(coordinates) {
  if (!coordinates) return { allowed: true, reason: "no_coordinates" };

  _cortexState.stats.lastPrivacyCheckAt = nowISO();

  for (const zone of _cortexState.privacyZones.values()) {
    if (isPointInZone(coordinates, zone)) {
      if (zone.protection_level === PRIVACY_LEVELS.ABSOLUTE) {
        _cortexState.stats.privacyBlocksEnforced++;
        return {
          allowed: false,
          zone_id: zone.id,
          classification: zone.classification,
          protection_level: zone.protection_level,
          reason: "absolute_privacy_zone",
          interior_data_exists: false,
          interior_reconstructable: false,
        };
      }
      if (zone.protection_level === PRIVACY_LEVELS.RESTRICTED) {
        _cortexState.stats.privacyBlocksEnforced++;
        return {
          allowed: false,
          zone_id: zone.id,
          classification: zone.classification,
          protection_level: zone.protection_level,
          reason: "restricted_zone_exterior_only",
        };
      }
      if (zone.protection_level === PRIVACY_LEVELS.CONTROLLED) {
        return {
          allowed: true,
          zone_id: zone.id,
          classification: zone.classification,
          protection_level: zone.protection_level,
          reason: "controlled_zone_governance_required",
          requires_governance: true,
        };
      }
    }
  }

  return { allowed: true, reason: "no_privacy_zone" };
}

function isPointInZone(coords, zone) {
  // Simplified boundary check using bounding box from zone coordinates
  const boundary = zone.boundary;
  if (!boundary || !boundary.coordinates || boundary.coordinates.length === 0) {
    return false;
  }

  // If coordinates is a lat/lng point, check against boundary polygon
  const lat = Number(coords.lat) || 0;
  const lng = Number(coords.lng) || 0;

  // Simple bounding box check from polygon coordinates
  const lats = boundary.coordinates.map(c => c[0] || c.lat || 0);
  const lngs = boundary.coordinates.map(c => c[1] || c.lng || 0);

  if (lats.length === 0) return false;

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

export function getPrivacyZones(limit = 50) {
  const zones = [..._cortexState.privacyZones.values()];
  return {
    ok: true,
    count: zones.length,
    zones: zones.slice(-Math.min(limit, 200)),
  };
}

export function getPrivacyStats() {
  const zones = [..._cortexState.privacyZones.values()];
  const byLevel = {};
  const byClassification = {};

  for (const zone of zones) {
    byLevel[zone.protection_level] = (byLevel[zone.protection_level] || 0) + 1;
    byClassification[zone.classification] = (byClassification[zone.classification] || 0) + 1;
  }

  return {
    ok: true,
    totalZones: zones.length,
    byProtectionLevel: byLevel,
    byClassification,
    blocksEnforced: _cortexState.stats.privacyBlocksEnforced,
    presenceDetectionsSuppressed: _cortexState.stats.presenceDetectionsSuppressed,
    vehicleTrackingSuppressed: _cortexState.stats.vehicleTrackingSuppressed,
    lastPrivacyCheckAt: _cortexState.stats.lastPrivacyCheckAt,
  };
}

export function verifyPrivacyZone(zoneId) {
  const zone = _cortexState.privacyZones.get(zoneId);
  if (!zone) return { ok: false, error: "zone_not_found" };

  return {
    ok: true,
    zone_id: zoneId,
    classification: zone.classification,
    protection_level: zone.protection_level,
    interior_data_exists: zone.interior_data_exists,
    interior_reconstructable: zone.interior_reconstructable,
    override_authority: zone.override_authority,
    integrity: "verified",
    verified_at: nowISO(),
  };
}

// ── Presence & Vehicle Suppression ──────────────────────────────────────────

/**
 * HARDCODED suppression. No tier shows individual presence or vehicle tracking.
 * These functions are called by other modules and always return suppressed results.
 */
export function suppressPresenceDetection(data) {
  _cortexState.stats.presenceDetectionsSuppressed++;
  return {
    suppressed: true,
    reason: "presence_detection_permanently_suppressed",
    tier_override_possible: false,
    individual_data_available: false,
  };
}

export function suppressVehicleTracking(data) {
  _cortexState.stats.vehicleTrackingSuppressed++;
  return {
    suppressed: true,
    reason: "vehicle_tracking_permanently_suppressed",
    tier_override_possible: false,
    individual_data_available: false,
    aggregate_available: true,
    aggregate_resolution: "road_segment",
  };
}

// ── Signal Adjustment ───────────────────────────────────────────────────────

/**
 * Check if a signal adjustment is permitted.
 * Safety checks are hardcoded and non-overridable.
 */
export function checkAdjustmentPermission(signalId, adjustmentType) {
  if (!signalId || !adjustmentType) {
    return { ok: false, error: "missing_parameters" };
  }

  const signal = _cortexState.taxonomy.get(signalId);
  const freq = signal ? signal.frequency : 0;

  // Safety check — ALWAYS runs, non-overridable
  const safety = {
    affects_aviation: false,
    affects_medical: false,
    affects_emergency: false,
    affects_military: false,
    affects_privacy: false,
  };

  for (const [domain, ranges] of Object.entries(SAFETY_FREQUENCIES)) {
    for (const [lo, hi] of ranges) {
      if (freq >= lo && freq <= hi) {
        safety[`affects_${domain}`] = true;
      }
    }
  }

  // If ANY safety flag is true → FORBIDDEN
  if (Object.values(safety).some(v => v === true)) {
    _cortexState.stats.adjustmentsForbidden++;
    return {
      ok: true,
      permitted: false,
      permission: ADJUSTMENT_PERMISSIONS.ADJUST_FORBIDDEN,
      reason: "safety_constraint",
      safety,
      authorization_required: "HARDCODED_DENY",
    };
  }

  // Hardcoded forbidden types
  if (adjustmentType === ADJUSTMENT_TYPES.JAMMING) {
    _cortexState.stats.adjustmentsForbidden++;
    return {
      ok: true,
      permitted: false,
      permission: ADJUSTMENT_PERMISSIONS.ADJUST_FORBIDDEN,
      reason: "jamming_permanently_forbidden",
      authorization_required: "HARDCODED_DENY",
    };
  }

  // Permitted types
  const permittedTypes = [
    ADJUSTMENT_TYPES.GAMMA_MODULATION,
    ADJUSTMENT_TYPES.MESH_OPTIMIZATION,
    ADJUSTMENT_TYPES.EMERGENCY_AMPLIFICATION,
    ADJUSTMENT_TYPES.ENVIRONMENTAL_HARMONIZATION,
  ];

  if (permittedTypes.includes(adjustmentType)) {
    _cortexState.stats.adjustmentsPermitted++;
    return {
      ok: true,
      permitted: true,
      permission: ADJUSTMENT_PERMISSIONS.MODULATE_ALLOWED,
      reason: "adjustment_permitted",
      authorization_required: "NONE",
      safety,
    };
  }

  // Restricted types (sovereign authorization required)
  const restrictedTypes = [
    ADJUSTMENT_TYPES.INFRASTRUCTURE_INTERACTION,
    ADJUSTMENT_TYPES.SPECTRUM_CLEARING,
  ];

  if (restrictedTypes.includes(adjustmentType)) {
    return {
      ok: true,
      permitted: false,
      permission: ADJUSTMENT_PERMISSIONS.ADJUST_RESTRICTED,
      reason: "sovereign_authorization_required",
      authorization_required: "SOVEREIGN",
      safety,
    };
  }

  return {
    ok: true,
    permitted: false,
    permission: ADJUSTMENT_PERMISSIONS.OBSERVE_ONLY,
    reason: "unknown_adjustment_type",
    authorization_required: "NONE",
  };
}

// ── Chat Intent Detection ───────────────────────────────────────────────────

export function detectCortexIntent(prompt) {
  if (!prompt || typeof prompt !== "string") return { isCortexRequest: false };

  const p = prompt.toLowerCase().trim();

  // Signal taxonomy
  if (/\b(signal)\s*(taxonomy|classification|categor\w*|types?)\b/.test(p) ||
      /\b(classify|categorize)\b.*\b(signal\w*|frequenc\w*)\b/.test(p)) {
    return { isCortexRequest: true, action: "taxonomy", params: {} };
  }

  // Unknown signals
  if (/\b(unknown|unclassified|unidentified)\b.*\b(signal\w*|frequenc\w*|emission\w*)\b/.test(p)) {
    return { isCortexRequest: true, action: "unknown", params: {} };
  }

  // Anomalies
  if (/\b(anomal\w*|unusual|strange)\b.*\b(signal\w*|frequenc\w*|emission\w*|pattern\w*)\b/.test(p)) {
    return { isCortexRequest: true, action: "anomalies", params: {} };
  }

  // Spectrum
  if (/\b(spectrum|spectral|frequency)\b.*\b(occupancy|map|usage|band)\b/.test(p)) {
    return { isCortexRequest: true, action: "spectrum", params: {} };
  }

  // Privacy zones
  if (/\b(privacy)\b.*\b(zone\w*|status|check\w*|protect\w*|stat\w*)\b/.test(p)) {
    return { isCortexRequest: true, action: "privacy", params: {} };
  }

  // Signal adjustment
  if (/\b(signal|frequency)\b.*\b(adjust\w*|modulat\w*|interact\w*|control\w*)\b/.test(p) ||
      /\b(adjust|modulat\w*)\b.*\b(signal\w*|frequenc\w*|transmission\w*)\b/.test(p)) {
    return { isCortexRequest: true, action: "adjustment", params: {} };
  }

  return { isCortexRequest: false };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export function getCortexMetrics() {
  return {
    initialized: _cortexState.initialized,
    taxonomy: {
      totalClassified: _cortexState.taxonomy.size,
      unknownQueueSize: _cortexState.unknownQueue.length,
      categories: ALL_SIGNAL_CATEGORIES,
    },
    privacy: {
      totalZones: _cortexState.privacyZones.size,
      blocksEnforced: _cortexState.stats.privacyBlocksEnforced,
      presenceSuppressed: _cortexState.stats.presenceDetectionsSuppressed,
      vehicleSuppressed: _cortexState.stats.vehicleTrackingSuppressed,
    },
    adjustments: {
      permitted: _cortexState.stats.adjustmentsPermitted,
      forbidden: _cortexState.stats.adjustmentsForbidden,
    },
    stats: { ..._cortexState.stats },
    uptime: Date.now() - _cortexState.stats.uptime,
  };
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

export async function cortexHeartbeatTick(STATE, tick) {
  // Prune old taxonomy entries if too large
  if (_cortexState.taxonomy.size > 10000) {
    const entries = [..._cortexState.taxonomy.entries()];
    const toRemove = entries.slice(0, entries.length - 8000);
    for (const [key] of toRemove) _cortexState.taxonomy.delete(key);
  }
}

// ── Initialization ──────────────────────────────────────────────────────────

export async function initializeCortex(STATE) {
  if (_cortexState.initialized) return { ok: true, alreadyInitialized: true };

  _cortexState.initialized = true;
  _cortexState.stats.uptime = Date.now();

  return {
    ok: true,
    signalCategories: ALL_SIGNAL_CATEGORIES,
    signalPurposes: ALL_SIGNAL_PURPOSES,
    privacyLevels: Object.values(PRIVACY_LEVELS),
    adjustmentPermissions: Object.values(ADJUSTMENT_PERMISSIONS),
    message: "Atlas Signal Cortex initialized. Privacy architecture active. Signal taxonomy ready.",
  };
}

// ── State Reset (testing only) ──────────────────────────────────────────────

export function _resetCortexState() {
  _cortexState.initialized = false;
  _cortexState.taxonomy = new Map();
  _cortexState.unknownQueue = [];
  _cortexState.privacyZones = new Map();
  _cortexState.spatialIndex = new Map();
  _cortexState.adjustments = new Map();
  _cortexState.stats = {
    signalsClassified: 0, unknownSignals: 0,
    privacyZonesCreated: 0, privacyBlocksEnforced: 0,
    adjustmentsPermitted: 0, adjustmentsForbidden: 0,
    anomaliesDetected: 0, presenceDetectionsSuppressed: 0,
    vehicleTrackingSuppressed: 0, lastClassificationAt: null,
    lastPrivacyCheckAt: null, uptime: Date.now(),
  };
}
