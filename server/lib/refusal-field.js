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
  // Mass-Raid kinds — used during The Great Refusal raid event.
  // Each is a phase mechanic the Sovereign declares against the raid
  // as a whole. See server/lib/sovereign/raid-event.js.
  numbers_refused:    { label: "Numbers are refused", glyphHint: "inversion" },
  dome_collapse:      { label: "The arena is refused", glyphHint: "shrinking" },
  win_refused:        { label: "Victory is refused", glyphHint: "eternal" },
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

  // Persist to refusal_fields table so the field survives a process
  // restart. Best-effort — persistence failure does not block the
  // in-memory entry, since live gameplay queries hit memory first.
  if (state.db) {
    try {
      state.db.prepare(`
        INSERT INTO refusal_fields (id, world_id, kind, reason, glyph_hint, glyph_json, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id, worldId, entry.kind, entry.reason,
        entry.glyphHint ?? null,
        entry.glyph != null ? JSON.stringify(entry.glyph) : null,
        Math.floor(entry.expiresAt / 1000),
      );
    } catch { /* persistence best-effort — table may not exist on minimal builds */ }
  }
  return entry;
}

/**
 * Load any non-expired refusal_fields rows back into STATE on startup.
 * Should be called once after STATE.db is set, before the heartbeat
 * sweep runs.
 */
export function loadPersistedRefusalFields(state) {
  if (!state?.db) return { ok: false, reason: "no_db" };
  let rows;
  try {
    rows = state.db.prepare(`
      SELECT id, world_id, kind, reason, glyph_hint, glyph_json, expires_at
      FROM refusal_fields WHERE expires_at > unixepoch()
    `).all();
  } catch { return { ok: false, reason: "table_missing" }; }

  const map = ensureMap(state);
  for (const row of rows) {
    let glyph = null;
    try { glyph = row.glyph_json ? JSON.parse(row.glyph_json) : null; } catch { /* ignore */ }
    const list = map.get(row.world_id) ?? [];
    list.push({
      id: row.id,
      kind: row.kind,
      expiresAt: row.expires_at * 1000,
      reason: row.reason ?? "",
      glyphHint: row.glyph_hint ?? null,
      glyph,
    });
    map.set(row.world_id, list);
  }
  return { ok: true, loaded: rows.length };
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

/**
 * Compose all active field glyphs into a single composite signature using
 * the base-6 refusal algebra. Returns a numeric strength score derived from
 * the composed glyph, plus the underlying glyph object for HUD/dialogue use.
 *
 * Strength semantics (what callers should branch on):
 *   0     — no refusal active
 *   1-2   — single field active (mild refusal)
 *   3-5   — multiple fields composed; the Sovereign is exerting will
 *   6+    — compounded refusal; reality bends. Triggers special phases:
 *           Concordia goddess dialogue shifts to "deep cold", world events
 *           suspend, and the dome-collapse Mass Raid phase becomes eligible.
 *
 * This is the load-bearing seat for the glyph algebra: callers consult the
 * composite signature, not the individual field list, so the algebra
 * actually shapes what the world does.
 */
export function computeFieldComposition(state, worldId) {
  const live = activeFields(state, worldId);
  if (live.length === 0) return { strength: 0, glyph: null, composedFrom: 0 };

  // Compose every active field glyph via glyphAdd. Each addition layers
  // the algebra: stacking more refusals raises the composite layer index,
  // which is what we read for strength.
  let composite = null;
  let composedFrom = 0;
  for (const entry of live) {
    if (!entry.glyph) continue;
    try {
      composite = composite == null
        ? entry.glyph
        : glyphAdd(composite, entry.glyph).value;
      composedFrom += 1;
    } catch { /* algebra failure must never break gameplay */ }
  }

  // Strength derives from how many active fields contributed to the
  // composite plus the composite glyph's layer depth (when available).
  // A single field yields strength 1; two compose to 2 or 3 depending on
  // whether their glyphs interact constructively; deep stacks reach 6+.
  let strength = composedFrom;
  if (composite && typeof composite === "object" && Number.isFinite(composite.depth)) {
    strength = Math.max(strength, Math.min(9, composedFrom + composite.depth));
  }

  return { strength, glyph: composite, composedFrom };
}

/**
 * Numeric strength shortcut. Returns 0 when no fields are active.
 * Use this in branch logic that wants compound-refusal awareness without
 * caring about the underlying glyph object.
 */
export function getFieldStrength(state, worldId) {
  return computeFieldComposition(state, worldId).strength;
}

/**
 * Compound-refusal gate. True once 3+ stacked refusal fields produce
 * a composite glyph that crosses the "reality bends" threshold. This
 * is the actual mechanic the algebra now drives — Concordia dialogue
 * cold phase, world-event suspension, dome-collapse raid phase.
 */
export function isCompoundRefusal(state, worldId) {
  return getFieldStrength(state, worldId) >= 6;
}

/** Heartbeat sweep — calls activeFields() to prune memory, also deletes
 * expired rows from the persistent table so on next restart we don't
 * reload stale entries. */
export function runRefusalFieldSweep({ state }) {
  if (state?.db) {
    try { state.db.prepare(`DELETE FROM refusal_fields WHERE expires_at < unixepoch()`).run(); }
    catch { /* table may not exist on minimal builds */ }
  }
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
