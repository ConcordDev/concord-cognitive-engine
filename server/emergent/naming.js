// server/emergent/naming.js
// Four naming methods for emergent entities. Names derive from the emergent's nature,
// birth context, phonetic substrate patterns, or DTU lineage — never serial IDs.

import crypto from "node:crypto";
import { infer } from "../lib/inference/index.js";
import { isNameValid, isNameUnique, cleanNameResponse } from "./name-validation.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

// Phonetic components for deterministic fallback name generation
const SYLLABLES_A = ["ar", "en", "vel", "cor", "syl", "an", "lyr", "cal", "nor", "thal", "eld", "mir", "ash", "ion"];
const SYLLABLES_B = ["ion", "ith", "ara", "eon", "us", "os", "ael", "is", "ax", "ux", "el", "or", "yn", "a"];
const SYLLABLES_C = ["dar", "ven", "ris", "cor", "nar", "sol", "fen", "mar", "ter", "wren", "lith", "val"];

/**
 * Choose naming method based on emergent's characteristics.
 * @param {object} emergent - in-memory emergent object
 * @returns {'birth_context'|'self_named'|'phonetic_substrate'|'lineage_derived'}
 */
function chooseMethod(emergent) {
  if (emergent.dominantLens || emergent.scope?.length > 0) return "birth_context";
  if (emergent.role === "synthesizer" || emergent.role === "critic") return "self_named";
  if (emergent.species) return "phonetic_substrate";
  return "lineage_derived";
}

/**
 * Derive name from birth context — lens domain, role, and early observations.
 */
async function deriveFromBirthContext(emergent) {
  const parts = [];
  if (emergent.dominantLens) parts.push(emergent.dominantLens);
  if (emergent.role) parts.push(emergent.role);
  if (emergent.scope?.[0]) parts.push(emergent.scope[0]);

  const seed = parts.join("-") + (emergent.id || "").slice(-4);
  return composeDeterministicName(seed);
}

/**
 * Ask the emergent itself what it wants to be called.
 */
async function askEmergentForName(emergent, db) {
  try {
    const lensInfo = emergent.dominantLens || emergent.scope?.[0] || "general";
    const result = await infer({
      role: "subconscious",
      intent: TASK_PROMPTS.emergentNaming({ lensInfo, role: emergent.role }),
      callerId: `emergent:${emergent.id}:naming`,
      maxSteps: 1,
    }, db);
    return cleanNameResponse(result?.finalText || "");
  } catch {
    return "";
  }
}

/**
 * Derive name from phonetic substrate patterns.
 */
function deriveFromSubstratePatterns(emergent) {
  const seed = (emergent.species || emergent.id || crypto.randomBytes(4).toString("hex"));
  return composeDeterministicName(seed);
}

/**
 * Derive name from DTU lineage character.
 */
function deriveFromDTULineage(emergent) {
  const seed = (emergent.id || "") + (emergent.role || "");
  return composeDeterministicName(seed);
}

/**
 * Compose a deterministic name from a seed string using phoneme tables.
 */
function composeDeterministicName(seed) {
  const hash = crypto.createHash("sha256").update(seed).digest();
  const a = SYLLABLES_A[hash[0] % SYLLABLES_A.length];
  const b = SYLLABLES_B[hash[1] % SYLLABLES_B.length];
  const c = SYLLABLES_C[hash[2] % SYLLABLES_C.length];

  // 50% chance of two-syllable, 50% three-syllable
  const name = hash[3] % 2 === 0 ? `${a}${b}` : `${a}${b}-${c}`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Guaranteed-unique deterministic fallback combining phonemes + emergent ID suffix.
 */
function deriveDeterministicName(emergent) {
  const seed = `${emergent.id || crypto.randomBytes(8).toString("hex")}-${Date.now()}`;
  const base = composeDeterministicName(seed);
  const suffix = (emergent.id || "").slice(-3).toUpperCase();
  return `${base}-${suffix}`;
}

/**
 * Name an emergent entity using the most appropriate method.
 * Returns the name string and the method used.
 *
 * @param {object} emergent - in-memory emergent object
 * @param {object} db - better-sqlite3 instance
 * @returns {Promise<{name: string, method: string}>}
 */
export async function nameEmergent(emergent, db) {
  if (emergent.identity_locked && emergent.given_name) {
    return { name: emergent.given_name, method: "locked" };
  }

  const method = chooseMethod(emergent);
  const methodFns = {
    birth_context: () => deriveFromBirthContext(emergent),
    self_named: () => askEmergentForName(emergent, db),
    phonetic_substrate: () => Promise.resolve(deriveFromSubstratePatterns(emergent)),
    lineage_derived: () => Promise.resolve(deriveFromDTULineage(emergent)),
  };

  let name = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const candidate = await methodFns[method]();
      if (isNameValid(candidate) && isNameUnique(candidate, db)) {
        name = candidate;
        break;
      }
    } catch { /* try next attempt */ }
  }

  if (!name) {
    name = deriveDeterministicName(emergent);
    // Append random suffix until unique (guaranteed to terminate)
    let suffix = 0;
    while (!isNameUnique(`${name}-${suffix}`, db)) suffix++;
    name = suffix === 0 ? name : `${name}-${suffix}`;
  }

  return { name, method };
}

/**
 * Persist the given name to the emergent_identity table and lock identity.
 */
export function persistEmergentName(emergentId, name, method, db) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO emergent_identity (emergent_id, given_name, naming_origin, naming_metadata, identity_locked)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(emergent_id) DO UPDATE SET
        given_name = excluded.given_name,
        naming_origin = excluded.naming_origin,
        naming_metadata = excluded.naming_metadata,
        identity_locked = 1
    `).run(
      emergentId,
      name,
      method,
      JSON.stringify({ method, namedAt: Date.now() })
    );
  } catch (e) {
    console.error("[naming] persistEmergentName failed:", e?.message);
  }
}

/**
 * Load persisted identity for an emergent (or null if not yet named).
 */
export function loadEmergentIdentity(emergentId, db) {
  if (!emergentId || !db) return null;
  try {
    return db.prepare(
      "SELECT * FROM emergent_identity WHERE emergent_id = ?"
    ).get(emergentId) || null;
  } catch { return null; }
}
