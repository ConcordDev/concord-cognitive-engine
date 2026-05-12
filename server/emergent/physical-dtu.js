/**
 * Physical DTU Schema — System 11
 *
 * DTU schema extensions for physical world observations.
 * Defines four physical DTU types: movement, craft, observation, spatial.
 * Each created DTU follows the standard DTU format with machine.kind set
 * to the physical type kind, and machine.physical containing type-specific fields.
 *
 * Additive only. One file. Silent failure. All state in-memory.
 */

import crypto from "crypto";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ── In-Memory Store ─────────────────────────────────────────────────────────

const _physicalDTUs = new LruMap();   // dtuId -> DTU
const _byKind = new LruMap();        // kind -> Set<dtuId>
const _metrics = {
  totalCreated: 0,
  totalValidated: 0,
  totalValidationErrors: 0,
  byKind: {},
};

// ── Physical DTU Type Definitions ───────────────────────────────────────────

export const PHYSICAL_DTU_TYPES = Object.freeze({
  movement: {
    kind: "movement_dtu",
    label: "Movement",
    description: "Motor action with force vectors, precision, and correction data.",
    fields: {
      bodyPart:     { type: "string",  required: true,  description: "Body part performing the movement" },
      movementType: { type: "string",  required: true,  description: "Type of movement (e.g. grasp, throw, walk)" },
      forceVectors: { type: "array",   required: false, description: "Array of {x, y, z, magnitude, timestamp}" },
      duration:     { type: "number",  required: false, description: "Duration in milliseconds" },
      precision:    { type: "number",  required: false, description: "Precision score 0-1", min: 0, max: 1 },
      repetitions:  { type: "number",  required: false, description: "Number of repetitions" },
      errorRate:    { type: "number",  required: false, description: "Error rate 0-1", min: 0, max: 1 },
      corrections:  { type: "array",   required: false, description: "Array of micro-adjustment records" },
    },
  },

  craft: {
    kind: "craft_dtu",
    label: "Craft",
    description: "Skilled craft knowledge with technique, tools, materials, and ordered steps.",
    fields: {
      craftName:    { type: "string",  required: true,  description: "Name of the craft (e.g. woodworking, welding)" },
      technique:    { type: "string",  required: true,  description: "Specific technique used" },
      tools:        { type: "array",   required: false, description: "Array of tools used" },
      materials:    { type: "array",   required: false, description: "Array of materials used" },
      steps:        { type: "array",   required: false, description: "Ordered steps with movement DTU refs" },
      skillLevel:   { type: "string",  required: false, description: "Skill level", enum: ["novice", "intermediate", "advanced", "master"] },
      commonErrors: { type: "array",   required: false, description: "Array of common errors" },
      masterTips:   { type: "array",   required: false, description: "Array of master-level tips" },
    },
  },

  observation: {
    kind: "observation_dtu",
    label: "Observation",
    description: "Sensory observation with signal data, interpretation, and environmental context.",
    fields: {
      sensorType:              { type: "string",  required: true,  description: "Sensor type", enum: ["visual", "auditory", "tactile", "olfactory", "gustatory"] },
      rawSignal:               { type: "object",  required: false, description: "Raw signal data object" },
      interpretation:          { type: "string",  required: false, description: "Human-readable interpretation" },
      confidence:              { type: "number",  required: false, description: "Confidence score 0-1", min: 0, max: 1 },
      location:                { type: "object",  required: false, description: "Location {lat, lng, alt}" },
      timestamp:               { type: "string",  required: false, description: "ISO timestamp of observation" },
      environmentalConditions: { type: "object",  required: false, description: "Environmental context {temp, humidity, light}" },
    },
  },

  spatial: {
    kind: "spatial_dtu",
    label: "Spatial",
    description: "Spatial object description with dimensions, position, orientation, and physical properties.",
    fields: {
      objectId:    { type: "string",  required: true,  description: "Unique identifier for the spatial object" },
      dimensions:  { type: "object",  required: false, description: "Dimensions {width, height, depth}" },
      position:    { type: "object",  required: false, description: "Position {x, y, z}" },
      orientation: { type: "object",  required: false, description: "Orientation {roll, pitch, yaw}" },
      material:    { type: "string",  required: false, description: "Material composition" },
      mass:        { type: "number",  required: false, description: "Mass in kilograms" },
      constraints: { type: "array",   required: false, description: "Array of physical constraints" },
    },
  },
});

// Reverse lookup: kind string -> type key
const _kindToType = new LruMap();
for (const [key, def] of Object.entries(PHYSICAL_DTU_TYPES)) {
  _kindToType.set(def.kind, key);
}

// ── Schema Validation ───────────────────────────────────────────────────────

/**
 * Validate a field value against a field schema definition.
 *
 * @param {*} value - The value to validate
 * @param {object} fieldDef - The field definition from PHYSICAL_DTU_TYPES
 * @returns {{ ok: boolean, error?: string }}
 */
function validateField(value, fieldDef) {
  if (value === undefined || value === null) {
    if (fieldDef.required) return { ok: false, error: "required" };
    return { ok: true };
  }

  switch (fieldDef.type) {
    case "string":
      if (typeof value !== "string") return { ok: false, error: "expected_string" };
      if (fieldDef.enum && !fieldDef.enum.includes(value)) {
        return { ok: false, error: `expected_one_of: ${fieldDef.enum.join(", ")}` };
      }
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) return { ok: false, error: "expected_number" };
      if (fieldDef.min !== undefined && value < fieldDef.min) return { ok: false, error: `min_${fieldDef.min}` };
      if (fieldDef.max !== undefined && value > fieldDef.max) return { ok: false, error: `max_${fieldDef.max}` };
      break;
    case "array":
      if (!Array.isArray(value)) return { ok: false, error: "expected_array" };
      break;
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "expected_object" };
      break;
    default:
      break;
  }

  return { ok: true };
}

/**
 * Validate a physical DTU against its schema.
 *
 * @param {object} dtu - The DTU to validate
 * @returns {{ ok: boolean, errors?: string[] }}
 */
export function validatePhysicalDTU(dtu) {
  try {
    if (!dtu || typeof dtu !== "object") {
      _metrics.totalValidationErrors++;
      return { ok: false, errors: ["dtu_must_be_object"] };
    }

    const kind = dtu.machine?.kind;
    if (!kind) {
      _metrics.totalValidationErrors++;
      return { ok: false, errors: ["missing_machine_kind"] };
    }

    const typeKey = _kindToType.get(kind);
    if (!typeKey) {
      _metrics.totalValidationErrors++;
      return { ok: false, errors: [`unknown_physical_kind: ${kind}`] };
    }

    const typeDef = PHYSICAL_DTU_TYPES[typeKey];
    const physical = dtu.machine?.physical;

    if (!physical || typeof physical !== "object") {
      _metrics.totalValidationErrors++;
      return { ok: false, errors: ["missing_machine_physical"] };
    }

    const errors = [];
    for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
      const result = validateField(physical[fieldName], fieldDef);
      if (!result.ok) {
        errors.push(`${fieldName}: ${result.error}`);
      }
    }

    _metrics.totalValidated++;

    if (errors.length > 0) {
      _metrics.totalValidationErrors++;
      return { ok: false, errors };
    }

    return { ok: true };
  } catch (_e) {
    _metrics.totalValidationErrors++;
    return { ok: false, errors: ["validation_exception"] };
  }
}

// ── DTU Creation Helpers ────────────────────────────────────────────────────

/**
 * Build the standard DTU envelope around physical data.
 *
 * @param {string} kind - The physical DTU kind (e.g. "movement_dtu")
 * @param {object} physical - Type-specific physical fields
 * @param {object} data - Optional extra DTU fields (tags, tier, human, etc.)
 * @returns {object} Complete DTU object
 */
function buildPhysicalDTU(kind, physical, data) {
  const d = data || {};
  const ts = nowISO();

  const dtu = {
    id: uid("pdtu"),
    tier: d.tier || "physical",
    tags: Array.isArray(d.tags) ? d.tags : [kind],
    human: {
      summary: d.summary || `Physical DTU: ${kind}`,
      bullets: Array.isArray(d.bullets) ? d.bullets : [],
    },
    core: {
      definitions: d.definitions || [],
      invariants: d.invariants || [],
      claims: d.claims || [],
      examples: d.examples || [],
      nextActions: d.nextActions || [],
    },
    machine: {
      kind,
      physical,
    },
    lineage: {
      parents: Array.isArray(d.parents) ? d.parents : [],
      children: [],
    },
    source: d.source || "physical_observation",
    meta: {
      hidden: false,
      physicalType: _kindToType.get(kind) || kind,
    },
    authority: {
      model: d.authorModel || "sensor",
      score: typeof d.authorityScore === "number" ? clamp01(d.authorityScore) : 0.5,
    },
    createdAt: ts,
    updatedAt: ts,
    hash: "",
  };

  return dtu;
}

/**
 * Persist a physical DTU into the in-memory store.
 *
 * @param {object} dtu - The DTU to store
 */
function storeDTU(dtu) {
  _physicalDTUs.set(dtu.id, dtu);

  const kind = dtu.machine.kind;
  if (!_byKind.has(kind)) {
    _byKind.set(kind, new Set());
  }
  _byKind.get(kind).add(dtu.id);

  _metrics.totalCreated++;
  _metrics.byKind[kind] = (_metrics.byKind[kind] || 0) + 1;
}

// ── Public Creation Functions ───────────────────────────────────────────────

/**
 * Create a movement DTU.
 *
 * @param {object} data - Movement data and optional DTU envelope fields
 * @param {string} data.bodyPart - Body part performing the movement
 * @param {string} data.movementType - Type of movement (grasp, throw, walk, etc.)
 * @param {Array}  [data.forceVectors] - Array of {x, y, z, magnitude, timestamp}
 * @param {number} [data.duration] - Duration in ms
 * @param {number} [data.precision] - Precision 0-1
 * @param {number} [data.repetitions] - Number of repetitions
 * @param {number} [data.errorRate] - Error rate 0-1
 * @param {Array}  [data.corrections] - Array of micro-adjustment records
 * @returns {{ ok: boolean, dtu?: object, error?: string }}
 */
export function createMovementDTU(data) {
  try {
    const d = data || {};

    const physical = {
      bodyPart:     d.bodyPart || "",
      movementType: d.movementType || "",
      forceVectors: Array.isArray(d.forceVectors) ? d.forceVectors : [],
      duration:     typeof d.duration === "number" ? d.duration : 0,
      precision:    typeof d.precision === "number" ? clamp01(d.precision) : 0,
      repetitions:  typeof d.repetitions === "number" ? d.repetitions : 1,
      errorRate:    typeof d.errorRate === "number" ? clamp01(d.errorRate) : 0,
      corrections:  Array.isArray(d.corrections) ? d.corrections : [],
    };

    const dtu = buildPhysicalDTU("movement_dtu", physical, d);

    const validation = validatePhysicalDTU(dtu);
    if (!validation.ok) {
      return { ok: false, error: "validation_failed", details: validation.errors };
    }

    storeDTU(dtu);
    return { ok: true, dtu };
  } catch (_e) {
    return { ok: false, error: "creation_exception" };
  }
}

/**
 * Create a craft DTU.
 *
 * @param {object} data - Craft data and optional DTU envelope fields
 * @param {string} data.craftName - Name of the craft (woodworking, welding, etc.)
 * @param {string} data.technique - Specific technique
 * @param {Array}  [data.tools] - Array of tools
 * @param {Array}  [data.materials] - Array of materials
 * @param {Array}  [data.steps] - Ordered steps with movement DTU refs
 * @param {string} [data.skillLevel] - novice|intermediate|advanced|master
 * @param {Array}  [data.commonErrors] - Array of common errors
 * @param {Array}  [data.masterTips] - Array of master-level tips
 * @returns {{ ok: boolean, dtu?: object, error?: string }}
 */
export function createCraftDTU(data) {
  try {
    const d = data || {};

    const skillLevels = ["novice", "intermediate", "advanced", "master"];
    const skillLevel = skillLevels.includes(d.skillLevel) ? d.skillLevel : "novice";

    const physical = {
      craftName:    d.craftName || "",
      technique:    d.technique || "",
      tools:        Array.isArray(d.tools) ? d.tools : [],
      materials:    Array.isArray(d.materials) ? d.materials : [],
      steps:        Array.isArray(d.steps) ? d.steps : [],
      skillLevel,
      commonErrors: Array.isArray(d.commonErrors) ? d.commonErrors : [],
      masterTips:   Array.isArray(d.masterTips) ? d.masterTips : [],
    };

    const dtu = buildPhysicalDTU("craft_dtu", physical, d);

    const validation = validatePhysicalDTU(dtu);
    if (!validation.ok) {
      return { ok: false, error: "validation_failed", details: validation.errors };
    }

    storeDTU(dtu);
    return { ok: true, dtu };
  } catch (_e) {
    return { ok: false, error: "creation_exception" };
  }
}

/**
 * Create an observation DTU.
 *
 * @param {object} data - Observation data and optional DTU envelope fields
 * @param {string} data.sensorType - Sensor type (visual, auditory, tactile, olfactory, gustatory)
 * @param {object} [data.rawSignal] - Raw signal data object
 * @param {string} [data.interpretation] - Human-readable interpretation
 * @param {number} [data.confidence] - Confidence score 0-1
 * @param {object} [data.location] - Location {lat, lng, alt}
 * @param {string} [data.timestamp] - ISO timestamp of observation
 * @param {object} [data.environmentalConditions] - {temp, humidity, light}
 * @returns {{ ok: boolean, dtu?: object, error?: string }}
 */
export function createObservationDTU(data) {
  try {
    const d = data || {};

    const physical = {
      sensorType:              d.sensorType || "",
      rawSignal:               (d.rawSignal && typeof d.rawSignal === "object" && !Array.isArray(d.rawSignal)) ? d.rawSignal : {},
      interpretation:          typeof d.interpretation === "string" ? d.interpretation : "",
      confidence:              typeof d.confidence === "number" ? clamp01(d.confidence) : 0,
      location:                (d.location && typeof d.location === "object" && !Array.isArray(d.location)) ? d.location : null,
      timestamp:               d.timestamp || nowISO(),
      environmentalConditions: (d.environmentalConditions && typeof d.environmentalConditions === "object" && !Array.isArray(d.environmentalConditions)) ? d.environmentalConditions : {},
    };

    const dtu = buildPhysicalDTU("observation_dtu", physical, d);

    const validation = validatePhysicalDTU(dtu);
    if (!validation.ok) {
      return { ok: false, error: "validation_failed", details: validation.errors };
    }

    storeDTU(dtu);
    return { ok: true, dtu };
  } catch (_e) {
    return { ok: false, error: "creation_exception" };
  }
}

/**
 * Create a spatial DTU.
 *
 * @param {object} data - Spatial data and optional DTU envelope fields
 * @param {string} data.objectId - Unique identifier for the spatial object
 * @param {object} [data.dimensions] - Dimensions {width, height, depth}
 * @param {object} [data.position] - Position {x, y, z}
 * @param {object} [data.orientation] - Orientation {roll, pitch, yaw}
 * @param {string} [data.material] - Material composition
 * @param {number} [data.mass] - Mass in kilograms
 * @param {Array}  [data.constraints] - Array of physical constraints
 * @returns {{ ok: boolean, dtu?: object, error?: string }}
 */
export function createSpatialDTU(data) {
  try {
    const d = data || {};

    const physical = {
      objectId:    d.objectId || "",
      dimensions:  (d.dimensions && typeof d.dimensions === "object" && !Array.isArray(d.dimensions)) ? d.dimensions : null,
      position:    (d.position && typeof d.position === "object" && !Array.isArray(d.position)) ? d.position : null,
      orientation: (d.orientation && typeof d.orientation === "object" && !Array.isArray(d.orientation)) ? d.orientation : null,
      material:    typeof d.material === "string" ? d.material : "",
      mass:        typeof d.mass === "number" ? d.mass : 0,
      constraints: Array.isArray(d.constraints) ? d.constraints : [],
    };

    const dtu = buildPhysicalDTU("spatial_dtu", physical, d);

    const validation = validatePhysicalDTU(dtu);
    if (!validation.ok) {
      return { ok: false, error: "validation_failed", details: validation.errors };
    }

    storeDTU(dtu);
    return { ok: true, dtu };
  } catch (_e) {
    return { ok: false, error: "creation_exception" };
  }
}

// ── Query & Lookup ──────────────────────────────────────────────────────────

/**
 * Get the schema definition for a physical DTU type by its kind string.
 *
 * @param {string} kind - The kind string (e.g. "movement_dtu")
 * @returns {object|null} The type definition, or null if not found
 */
export function getPhysicalDTUType(kind) {
  try {
    const typeKey = _kindToType.get(kind);
    if (!typeKey) return null;
    return { ...PHYSICAL_DTU_TYPES[typeKey] };
  } catch (_e) {
    return null;
  }
}

/**
 * List all physical DTU type definitions.
 *
 * @returns {object[]} Array of { key, kind, label, description, fields }
 */
export function listPhysicalDTUTypes() {
  try {
    return Object.entries(PHYSICAL_DTU_TYPES).map(([key, def]) => ({
      key,
      kind: def.kind,
      label: def.label,
      description: def.description,
      fields: Object.keys(def.fields),
    }));
  } catch (_e) {
    return [];
  }
}

/**
 * Query physical DTUs from the in-memory store.
 *
 * Supported filter keys:
 *   - kind: filter by machine.kind
 *   - tag: filter by tag presence
 *   - source: filter by source
 *   - since: filter by createdAt >= ISO string
 *   - limit: max results (default 100)
 *
 * @param {object} filter - Query filter
 * @returns {object[]} Matching DTUs
 */
export function queryPhysicalDTUs(filter) {
  try {
    const f = filter || {};
    const limit = typeof f.limit === "number" ? Math.max(1, f.limit) : 100;

    let candidates;

    // Narrow by kind first if specified
    if (f.kind) {
      const kindSet = _byKind.get(f.kind);
      if (!kindSet) return [];
      candidates = Array.from(kindSet).map(id => _physicalDTUs.get(id)).filter(Boolean);
    } else {
      candidates = Array.from(_physicalDTUs.values());
    }

    // Apply filters
    const results = [];
    for (const dtu of candidates) {
      if (results.length >= limit) break;

      if (f.tag && !(dtu.tags || []).includes(f.tag)) continue;
      if (f.source && dtu.source !== f.source) continue;
      if (f.since && dtu.createdAt < f.since) continue;

      results.push(dtu);
    }

    return results;
  } catch (_e) {
    return [];
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Get metrics about physical DTU usage.
 *
 * @returns {object} Metrics snapshot
 */
export function getPhysicalDTUMetrics() {
  try {
    return {
      totalCreated: _metrics.totalCreated,
      totalValidated: _metrics.totalValidated,
      totalValidationErrors: _metrics.totalValidationErrors,
      totalStored: _physicalDTUs.size,
      byKind: { ..._metrics.byKind },
      kindCount: _byKind.size,
      timestamp: nowISO(),
    };
  } catch (_e) {
    return {
      totalCreated: 0,
      totalValidated: 0,
      totalValidationErrors: 0,
      totalStored: 0,
      byKind: {},
      kindCount: 0,
      timestamp: nowISO(),
    };
  }
}
