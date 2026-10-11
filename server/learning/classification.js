// learning/classification.js
// DTU Classification System
//
// Every DTU carries a classification field separate from tier.
// Public DTU count = knowledge + seed + mega + hyper
// Everything else is internal infrastructure.

/**
 * Valid DTU classifications.
 */
export const CLASSIFICATIONS = Object.freeze({
  KNOWLEDGE: "knowledge",   // Genuine learned knowledge
  SEED: "seed",             // Original first-order principles
  MEGA: "mega",             // Compound knowledge structures
  HYPER: "hyper",           // Cross-domain compound structures
  SHADOW: "shadow",         // Internal reasoning anchors
  REPAIR: "repair",         // Repair cortex audit logs
  SCAFFOLD: "scaffold",     // Temporary DTUs not promoted
  DEPRECATED: "deprecated", // Retracted or superseded
});

/**
 * Classifications that count in the public total.
 */
export const PUBLIC_CLASSIFICATIONS = Object.freeze([
  CLASSIFICATIONS.KNOWLEDGE,
  CLASSIFICATIONS.SEED,
  CLASSIFICATIONS.MEGA,
  CLASSIFICATIONS.HYPER,
]);

/**
 * Classifications that are internal infrastructure.
 */
export const INTERNAL_CLASSIFICATIONS = Object.freeze([
  CLASSIFICATIONS.SHADOW,
  CLASSIFICATIONS.REPAIR,
  CLASSIFICATIONS.SCAFFOLD,
  CLASSIFICATIONS.DEPRECATED,
]);

/** Object fields that name a source when `dtu.source` is a record, not a string. */
const SOURCE_LABEL_KEYS = ["type", "name", "kind"];

/** How many failing DTU ids to keep on a migration result. */
const FAILED_SAMPLE_LIMIT = 5;

/**
 * Text used when a DTU field is compared as a label.
 * Strings pass through unchanged. An object contributes the first non-empty
 * string among type, name, and kind. Arrays, numbers, null, and other
 * non-strings are empty so callers never call string methods on them.
 */
function fieldText(value) {
  if (typeof value === "string") return value;
  if (value == null || typeof value !== "object" || Array.isArray(value)) return "";
  for (const key of SOURCE_LABEL_KEYS) {
    let inner;
    try {
      inner = value[key];
    } catch {
      continue;
    }
    if (typeof inner === "string" && inner) return inner;
  }
  return "";
}

function tagTexts(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const tag of tags) {
    const text = fieldText(tag);
    if (text) out.push(text);
  }
  return out;
}

function failureSampleId(key, dtu) {
  try {
    if (dtu && typeof dtu === "object" && typeof dtu.id === "string" && dtu.id) return dtu.id;
  } catch {
    // id itself can be the thing that threw; fall through to the map key.
  }
  if (typeof key === "string" && key) return key;
  if (typeof key === "number" && Number.isFinite(key)) return String(key);
  return "";
}

/**
 * Determine the classification for a DTU based on its properties.
 *
 * @param {object} dtu - DTU object
 * @returns {string} classification
 */
export function classifyDTU(dtu) {
  if (!dtu) return CLASSIFICATIONS.KNOWLEDGE;

  // Already classified — respect it
  if (dtu.classification && Object.values(CLASSIFICATIONS).includes(dtu.classification)) {
    return dtu.classification;
  }

  // Shadow DTUs
  const tier = fieldText(dtu.tier).toLowerCase();
  const tags = tagTexts(dtu.tags);
  if (tier === "shadow" || tags.includes("shadow")) {
    return CLASSIFICATIONS.SHADOW;
  }

  // Repair cortex DTUs
  if (isRepairDTU(dtu)) {
    return CLASSIFICATIONS.REPAIR;
  }

  // Tier-based classification
  if (tier === "hyper") return CLASSIFICATIONS.HYPER;
  if (tier === "mega") return CLASSIFICATIONS.MEGA;

  // Seed DTUs. Compared against the raw string (or an object's type/name/kind),
  // not a lowercased copy, so "Seed" still does not match "seed".
  const source = fieldText(dtu.source);
  if (source === "seed" || source === "bootstrap" || (dtu.authority && dtu.authority.model === "seed")) {
    return CLASSIFICATIONS.SEED;
  }

  // Default: knowledge
  return CLASSIFICATIONS.KNOWLEDGE;
}

/**
 * Check if a DTU was created by the repair cortex.
 */
export function isRepairDTU(dtu) {
  if (!dtu) return false;

  const source = fieldText(dtu.source).toLowerCase();
  const tags = tagTexts(dtu.tags);
  const meta = dtu.meta && typeof dtu.meta === "object" && !Array.isArray(dtu.meta) ? dtu.meta : {};
  const createdBy = fieldText(meta.createdBy);
  const brainSource = fieldText(meta.brainSource);

  return (
    source.includes("repair") ||
    tags.includes("repair") ||
    tags.includes("repair_cortex") ||
    createdBy === "repair_cortex" ||
    brainSource === "repair" ||
    source.startsWith("repair.")
  );
}

/**
 * Check if a DTU's classification counts in the public total.
 */
export function isPublicDTU(dtu) {
  const cls = dtu?.classification || classifyDTU(dtu);
  return PUBLIC_CLASSIFICATIONS.includes(cls);
}

/**
 * Apply classification to a DTU (mutates).
 *
 * @param {object} dtu
 * @returns {object} the same dtu with classification field set
 */
export function applyClassification(dtu) {
  if (!dtu) return dtu;
  dtu.classification = classifyDTU(dtu);
  return dtu;
}

/**
 * Migrate existing DTUs — add classification field to all DTUs that lack one.
 * One record that throws is counted and skipped; the rest of the map still runs.
 *
 * @param {Map} dtus - STATE.dtus map
 * @returns {{ migrated: number, failed: number, failedSamples: string[], byClassification: object }}
 */
export function migrateClassifications(dtus) {
  const counts = {};
  let migrated = 0;
  let failed = 0;
  const failedSamples = [];

  for (const [key, dtu] of dtus) {
    try {
      if (!dtu || typeof dtu !== "object") {
        throw new TypeError("dtu is not an object");
      }
      let cls = dtu.classification;
      if (!cls) {
        cls = classifyDTU(dtu);
        dtu.classification = cls;
        migrated++;
      }
      counts[cls] = (counts[cls] || 0) + 1;
    } catch {
      failed++;
      if (failedSamples.length < FAILED_SAMPLE_LIMIT) {
        const sample = failureSampleId(key, dtu);
        if (sample) failedSamples.push(sample);
      }
    }
  }

  return { migrated, failed, failedSamples, byClassification: counts };
}

/**
 * Compute substrate stats with proper classification separation.
 *
 * @param {Map} dtus - STATE.dtus map
 * @param {Map} [shadowDtus] - STATE.shadowDtus map (if separate)
 * @returns {object} Structured substrate stats
 */
export function computeSubstrateStats(dtus, shadowDtus = null) {
  const knowledge = { total: 0, seed: 0, regular: 0, mega: 0, hyper: 0 };
  const internal = { shadow: 0, repair: 0, scaffold: 0, deprecated: 0 };

  for (const dtu of dtus.values()) {
    const cls = dtu.classification || classifyDTU(dtu);

    switch (cls) {
      case CLASSIFICATIONS.KNOWLEDGE:
        knowledge.total++;
        knowledge.regular++;
        break;
      case CLASSIFICATIONS.SEED:
        knowledge.total++;
        knowledge.seed++;
        break;
      case CLASSIFICATIONS.MEGA:
        knowledge.total++;
        knowledge.mega++;
        break;
      case CLASSIFICATIONS.HYPER:
        knowledge.total++;
        knowledge.hyper++;
        break;
      case CLASSIFICATIONS.SHADOW:
        internal.shadow++;
        break;
      case CLASSIFICATIONS.REPAIR:
        internal.repair++;
        break;
      case CLASSIFICATIONS.SCAFFOLD:
        internal.scaffold++;
        break;
      case CLASSIFICATIONS.DEPRECATED:
        internal.deprecated++;
        break;
    }
  }

  // Also count separate shadow DTU store if it exists
  if (shadowDtus) {
    for (const dtu of shadowDtus.values()) {
      internal.shadow++;
    }
  }

  const grandTotal = knowledge.total + internal.shadow + internal.repair + internal.scaffold + internal.deprecated;

  return {
    substrate: {
      knowledge,
      internal,
      grand_total: grandTotal,
    },
  };
}
