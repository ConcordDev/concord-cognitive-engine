// server/lib/goddess-arcs.js
//
// Goddess (or patron / antagonist) phase arcs.
//
// The phase-from-ecosystem framework already runs in world-narrative.js
// for the hard-coded "concordia_first_breath" NPC: it auto-selects
// warm/cold tone from ecosystem_score and overrides to "cold" when the
// Refusal Field composition crosses the compound-refusal strength
// threshold (see lib/refusal-field.js#isCompoundRefusal).
//
// What's missing — and what this module ships — is the authoring path
// so a creator or emergent agent can declare *their own* deity / patron
// / antagonist with custom thresholds, custom dialogue lines per phase,
// and optional cinematic cues. The runtime registry below is read by
// the world-narrative dialogue endpoint when a NPC has an attached arc
// id (npc.arc_id), making the goddess pattern composable across the
// authored-content pipeline.

const _arcs = new Map();          // arcId → arc
const _npcToArc = new Map();      // npcId → arcId (one-to-one)

const METRIC_KEYS = new Set([
  "ecosystem_score",
  "concord_alignment",
  "concordia_alignment",
  "refusal_debt",
  "refusal_field_strength",
]);
const COMPARATORS = new Set(["gte", "lte", "gt", "lt", "eq"]);

const TONES = new Set([
  "gentle", "warm", "neutral", "distant", "cold",
  "stern", "wrathful", "mournful", "exalted", "broken",
]);

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a phase condition object. Each metric maps to an object
 * with optional comparator keys (gte/lte/gt/lt/eq) and numeric values.
 */
function validateConditions(conds, path) {
  if (conds === undefined) return { ok: true };
  if (!isPlainObject(conds)) return { ok: false, reason: `${path}.conditions_must_be_object` };
  for (const [metric, range] of Object.entries(conds)) {
    if (!METRIC_KEYS.has(metric)) {
      return { ok: false, reason: `${path}.conditions.${metric}_invalid_metric` };
    }
    if (!isPlainObject(range)) {
      return { ok: false, reason: `${path}.conditions.${metric}_must_be_object` };
    }
    for (const [cmp, val] of Object.entries(range)) {
      if (!COMPARATORS.has(cmp)) {
        return { ok: false, reason: `${path}.conditions.${metric}.${cmp}_invalid_comparator` };
      }
      if (typeof val !== "number" || !Number.isFinite(val)) {
        return { ok: false, reason: `${path}.conditions.${metric}.${cmp}_must_be_number` };
      }
    }
  }
  return { ok: true };
}

export function validateGoddessArc(arc) {
  if (!isPlainObject(arc)) return { ok: false, reason: "not_object" };
  if (typeof arc.id !== "string" || !arc.id) return { ok: false, reason: "missing_id" };
  if (typeof arc.name !== "string" || !arc.name) return { ok: false, reason: "missing_name" };
  if (typeof arc.patron_npc_id !== "string" || !arc.patron_npc_id) {
    return { ok: false, reason: "missing_patron_npc_id" };
  }
  if (!Array.isArray(arc.phases) || arc.phases.length === 0) {
    return { ok: false, reason: "phases_required" };
  }
  for (let i = 0; i < arc.phases.length; i++) {
    const phase = arc.phases[i];
    if (!isPlainObject(phase)) return { ok: false, reason: `phases[${i}]_not_object` };
    if (typeof phase.id !== "string" || !phase.id) {
      return { ok: false, reason: `phases[${i}].id_required` };
    }
    if (phase.tone && !TONES.has(phase.tone)) {
      return { ok: false, reason: `phases[${i}].tone_unknown` };
    }
    const condCheck = validateConditions(phase.conditions, `phases[${i}]`);
    if (!condCheck.ok) return condCheck;
    if (!Array.isArray(phase.dialogue) || phase.dialogue.length === 0) {
      return { ok: false, reason: `phases[${i}].dialogue_required` };
    }
    for (let j = 0; j < phase.dialogue.length; j++) {
      if (typeof phase.dialogue[j] !== "string" || !phase.dialogue[j].trim()) {
        return { ok: false, reason: `phases[${i}].dialogue[${j}]_must_be_nonempty_string` };
      }
    }
    if (phase.cinematic !== undefined && !isPlainObject(phase.cinematic)) {
      return { ok: false, reason: `phases[${i}].cinematic_must_be_object` };
    }
  }
  return { ok: true };
}

export function addGoddessArc(arc) {
  const v = validateGoddessArc(arc);
  if (!v.ok) return v;
  _arcs.set(arc.id, { ...arc, registeredAt: new Date().toISOString() });
  _npcToArc.set(arc.patron_npc_id, arc.id);
  return { ok: true };
}

export function getGoddessArc(arcId) {
  return _arcs.get(arcId) ?? null;
}

export function getArcForNPC(npcId) {
  const arcId = _npcToArc.get(npcId);
  return arcId ? _arcs.get(arcId) ?? null : null;
}

export function listGoddessArcs(filter = {}) {
  const all = [..._arcs.values()];
  if (filter.patron_npc_id) return all.filter((a) => a.patron_npc_id === filter.patron_npc_id);
  return all;
}

export function removeGoddessArc(arcId) {
  const arc = _arcs.get(arcId);
  if (!arc) return false;
  _npcToArc.delete(arc.patron_npc_id);
  _arcs.delete(arcId);
  return true;
}

/**
 * Test a single condition object against the live world metrics.
 * Returns true only if every metric / comparator passes.
 */
function conditionsMatch(conds, signals) {
  if (!isPlainObject(conds)) return true;
  for (const [metric, range] of Object.entries(conds)) {
    const value = signals[metric];
    if (value === undefined || value === null) return false;
    for (const [cmp, target] of Object.entries(range)) {
      if (cmp === "gte" && !(value >= target)) return false;
      if (cmp === "lte" && !(value <= target)) return false;
      if (cmp === "gt"  && !(value >  target)) return false;
      if (cmp === "lt"  && !(value <  target)) return false;
      if (cmp === "eq"  && !(value === target)) return false;
    }
  }
  return true;
}

/**
 * Pick the matching phase for an arc given current world signals.
 * Walks phases in order; the first whose conditions pass wins. The
 * authoring convention is "most specific phase first" so wrathful /
 * compound-refusal cases override the warm/cold default.
 *
 * Returns the phase object, or null if no phase matches (callers
 * should fall back to baseline tone).
 *
 * @param {object} arc — validated goddess arc
 * @param {object} signals — { ecosystem_score, concord_alignment, … }
 * @returns {object|null}
 */
export function selectPhase(arc, signals = {}) {
  if (!arc || !Array.isArray(arc.phases)) return null;
  for (const phase of arc.phases) {
    if (conditionsMatch(phase.conditions || {}, signals)) return phase;
  }
  return null;
}

export const GODDESS_ARC_METRICS = [...METRIC_KEYS];
export const GODDESS_ARC_TONES = [...TONES];
export const GODDESS_ARC_COMPARATORS = [...COMPARATORS];
