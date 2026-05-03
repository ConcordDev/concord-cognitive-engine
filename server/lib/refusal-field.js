// server/lib/refusal-field.js
//
// EvoEcosystem W6: the Refusal Field — the Sovereign's mechanical
// signature. Binds to the existing refusal-algebra (base-6 glyph
// arithmetic) for narrative flavor and provides time-bounded gates that
// world systems can consult before allowing certain actions.
//
// Lore anchor: in The Day Concordia Almost Left, the Sovereign used the
// Refusal Field for the first time to make death itself impossible so
// she couldn't withdraw her life force. We replicate that moment as a
// live mechanic: an authored Sovereign quest beat (or a system-driven
// imbalance event) can declare a kind for a duration, and any code
// path that respects the field is gated for that window.
//
// Active fields are kept in-memory keyed by world. Heartbeat sweeps
// expire stale entries.

import { add as glyphAdd, divide as glyphDiv, computeBase6Layer } from "./refusal-algebra/operations.js";

/** kind → human-readable label / glyph hint */
const FIELD_KINDS = Object.freeze({
  death_suspended:    { label: "Death is refused", glyphHint: "stillness" },
  harvest_disabled:   { label: "Harvest is refused", glyphHint: "withdrawal" },
  hostility_paused:   { label: "Violence is refused", glyphHint: "bridge" },
  consequence_held:   { label: "Consequence is refused", glyphHint: "void" },
});

/** state.refusalFields : Map<worldId, Array<{ id, kind, expiresAt, reason, glyph }>> */

function ensureMap(state) {
  if (!state.refusalFields) state.refusalFields = new Map();
  return state.refusalFields;
}

/**
 * Begin a Refusal Field for a world. Returns the entry on success.
 * @param {object} state
 * @param {string} worldId
 * @param {string} kind   — must be in FIELD_KINDS
 * @param {object} opts
 * @param {number} opts.durationMs
 * @param {string} [opts.reason]
 */
export function applyTemporaryRefusal(state, worldId, kind, opts = {}) {
  if (!state || !worldId) return null;
  if (!FIELD_KINDS[kind]) return null;
  const map = ensureMap(state);
  const list = map.get(worldId) ?? [];
  const id = `rf_${worldId}_${kind}_${Date.now()}`;
  const expiresAt = Date.now() + Math.max(1000, Number(opts.durationMs) || 30000);
  // Compute a glyph signature using the refusal-algebra so the entry
  // carries a small lore artifact (visible in dialogue / HUD).
  let glyph = null;
  try {
    const layered = computeBase6Layer(list.length + 1);
    glyph = glyphAdd(layered.value, glyphDiv(2, 1).value); // arbitrary mix
  } catch { /* glyph is decorative — never block the field */ }
  const entry = {
    id, kind, expiresAt,
    reason: String(opts.reason || ""),
    glyphHint: FIELD_KINDS[kind].glyphHint,
    glyph,
  };
  list.push(entry);
  map.set(worldId, list);
  return entry;
}

/** Active fields for a world (auto-prunes expired). */
export function activeFields(state, worldId) {
  if (!state || !worldId) return [];
  const map = ensureMap(state);
  const list = map.get(worldId) ?? [];
  const now = Date.now();
  const live = list.filter((e) => e.expiresAt > now);
  if (live.length !== list.length) map.set(worldId, live);
  return live;
}

/**
 * Convenience gate: should this kind currently block actions in this world?
 * Used by the death pipeline, harvest pipeline, etc.
 */
export function isRefused(state, worldId, kind) {
  return activeFields(state, worldId).some((e) => e.kind === kind);
}

/** Heartbeat sweep — cheap, just calls activeFields() to prune. */
export function runRefusalFieldSweep({ state }) {
  if (!state?.refusalFields) return { ok: true, pruned: 0 };
  let pruned = 0;
  for (const worldId of state.refusalFields.keys()) {
    const before = state.refusalFields.get(worldId)?.length ?? 0;
    activeFields(state, worldId);
    const after = state.refusalFields.get(worldId)?.length ?? 0;
    pruned += (before - after);
  }
  return { ok: true, pruned };
}

export const REFUSAL_FIELD_KINDS = FIELD_KINDS;
