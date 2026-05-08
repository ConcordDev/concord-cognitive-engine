// server/lib/commune-templates.js
//
// Community commune-template registry.
//
// Concord's cook → eat → fight → commune onboarding loop has "commune"
// as the deliberately open-ended verb: it's where the community defines
// what gathering *means* in their world. This module is the substrate
// users author against — they declare templates (trigger, location,
// participants, ritual steps, faction effect) and emergent NPCs +
// other players can instantiate them.
//
// In-memory only: like the quest engine, the registry lives in process
// state. Persistence to disk is the seeded-JSON path
// (content/world/<world>/commune-templates.json), not the runtime
// authoring path. The runtime registry survives only as long as the
// process — which is the right shape for community content that
// changes faster than restarts.

const _templates = new Map(); // templateId → template

const TRIGGERS = new Set([
  "ritual",        // scheduled or solstice-style; system-initiated
  "summon",        // a faction or guild summons participants
  "spontaneous",   // any player can start when conditions met
  "scheduled",     // calendar entry + RSVP
  "milestone",     // triggered by a world event / quest completion
]);

const LOCATION_TYPES = new Set([
  "faction-hall",
  "wilderness",
  "sanctuary",
  "open",
  "underground",
  "celestial",
]);

const RITUAL_STEP_KINDS = new Set([
  "speak",      // each participant contributes a phrase
  "offer",      // each contributes an item / DTU
  "vote",       // collective decision
  "share",      // share a memory / DTU into the commune pool
  "sing",       // synchronized cue (rhythm / chant)
  "vow",        // each makes a binding promise
  "bless",      // a leader confers a status effect on participants
  "witness",    // observe an event together
]);

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a commune template.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function validateCommuneTemplate(t) {
  if (!isPlainObject(t)) return { ok: false, reason: "not_object" };
  if (typeof t.id !== "string" || !t.id) return { ok: false, reason: "missing_id" };
  if (typeof t.name !== "string" || !t.name) return { ok: false, reason: "missing_name" };
  if (typeof t.trigger !== "string" || !TRIGGERS.has(t.trigger)) {
    return { ok: false, reason: "invalid_trigger" };
  }
  if (typeof t.location_type !== "string" || !LOCATION_TYPES.has(t.location_type)) {
    return { ok: false, reason: "invalid_location_type" };
  }
  const min = Number(t.participants_min);
  const max = Number(t.participants_max);
  if (!Number.isFinite(min) || min < 1) return { ok: false, reason: "participants_min_must_be_positive" };
  if (!Number.isFinite(max) || max < min) return { ok: false, reason: "participants_max_must_be_gte_min" };
  if (!Array.isArray(t.ritual_steps) || t.ritual_steps.length === 0) {
    return { ok: false, reason: "ritual_steps_required" };
  }
  for (let i = 0; i < t.ritual_steps.length; i++) {
    const step = t.ritual_steps[i];
    if (!isPlainObject(step)) return { ok: false, reason: `ritual_steps[${i}]_must_be_object` };
    if (typeof step.kind !== "string" || !RITUAL_STEP_KINDS.has(step.kind)) {
      return { ok: false, reason: `ritual_steps[${i}].kind_invalid` };
    }
    if (typeof step.prompt !== "string" || !step.prompt.trim()) {
      return { ok: false, reason: `ritual_steps[${i}].prompt_required` };
    }
  }
  if (t.faction_effects !== undefined) {
    if (!isPlainObject(t.faction_effects)) {
      return { ok: false, reason: "faction_effects_must_be_object" };
    }
    for (const [factionId, delta] of Object.entries(t.faction_effects)) {
      if (typeof factionId !== "string") return { ok: false, reason: "faction_effects_key_invalid" };
      if (typeof delta !== "number" || !Number.isFinite(delta)) {
        return { ok: false, reason: `faction_effects[${factionId}]_must_be_number` };
      }
      if (delta < -1 || delta > 1) {
        return { ok: false, reason: `faction_effects[${factionId}]_out_of_range` };
      }
    }
  }
  return { ok: true };
}

/**
 * Register a commune template. Returns the validate result; on success
 * the template is immediately available to any caller of
 * getCommuneTemplate / listCommuneTemplates.
 */
export function addCommuneTemplate(template) {
  const v = validateCommuneTemplate(template);
  if (!v.ok) return v;
  _templates.set(template.id, { ...template, registeredAt: new Date().toISOString() });
  return { ok: true };
}

export function getCommuneTemplate(id) {
  return _templates.get(id) ?? null;
}

export function listCommuneTemplates(filter = {}) {
  const all = [..._templates.values()];
  if (filter.trigger) return all.filter((t) => t.trigger === filter.trigger);
  if (filter.location_type) return all.filter((t) => t.location_type === filter.location_type);
  return all;
}

export function removeCommuneTemplate(id) {
  return _templates.delete(id);
}

/** Surface the canonical option lists so the composer UI stays in sync. */
export const COMMUNE_TRIGGERS = [...TRIGGERS];
export const COMMUNE_LOCATION_TYPES = [...LOCATION_TYPES];
export const COMMUNE_RITUAL_STEP_KINDS = [...RITUAL_STEP_KINDS];
