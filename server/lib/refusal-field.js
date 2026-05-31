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
  // SL6 — the Sovereign (god of Refusal who refused death) refuses harm TO and
  // FROM the under-matured. A visible divine field, not a despawn hack; lifts at
  // adulthood (the coming-of-age beat). Targeted via opts.appliesTo + isRefusedFor.
  harm_to_children_refused: { label: "Harm to the young is refused", glyphHint: "cradle" },
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
  // Wave 8f — the Vela/Cascade weld, completed. Sovereign-Ruins lore states every
  // Concordian Refusal is "strength-capped at 9 AND expires unless a quorum
  // re-records it within seven days" — the bound that keeps an unbounded Cascade
  // from ever recurring. The strength cap is enforced below (computeFieldComposition
  // -> Math.min(9, …)); this is the missing 7-day ceiling: a refusal's duration is
  // capped at REFUSAL_MAX_TTL_S (default 7 days, env CONCORD_REFUSAL_TTL_S). The 30s
  // default for ephemeral gates is unchanged — this only clamps the long tail so
  // nothing persists past the Concordant window without re-recording.
  const maxTtlMs = (Number(process.env.CONCORD_REFUSAL_TTL_S) || 604800) * 1000;
  const requestedMs = Math.max(1000, Number(opts.durationMs) || 30000);
  const expiresAt = Date.now() + Math.min(requestedMs, maxTtlMs);
  // Compute a glyph signature using the refusal-algebra so the entry
  // carries a small lore artifact AND contributes to the load-bearing
  // composite-strength calculation in computeFieldComposition().
  //
  // The previous implementation called `.value` on the algebra returns,
  // which silently produced null (computeBase6Layer returns a glyph
  // string, divide() returns {numerical, decimal, semantic}). The result:
  // every field's glyph was null, composedFrom was always 0, and strength
  // never crossed the compound-refusal gate at strength≥6 — the algebra
  // was load-bearing in name only.
  //
  // We now feed the algebra real values so the compose step actually
  // runs: the layer index (depth in the stack) added to a stable
  // structural divisor produces a per-entry glyph result whose .decimal
  // accumulates across fields in compose().
  let glyph = null;
  try {
    const layerGlyph = computeBase6Layer(list.length + 1); // glyph string
    const divResult  = glyphDiv(2, 1);                     // {decimal:2, numerical, semantic}
    glyph = glyphAdd(layerGlyph, divResult.decimal);
  } catch { /* algebra failure must never block the field — gameplay first */ }
  const entry = {
    id, kind, expiresAt,
    reason: String(opts.reason || ""),
    glyphHint: FIELD_KINDS[kind].glyphHint,
    glyph,
    // SL6 — optional scoping (e.g. { maturity: ["infant","child","adolescent"] }).
    // null = applies to everyone (back-compat: every existing field is unscoped).
    appliesTo: opts.appliesTo || null,
  };
  list.push(entry);
  map.set(worldId, list);

  // Persist to refusal_fields table so the field survives a process
  // restart. Best-effort — persistence failure does not block the
  // in-memory entry, since live gameplay queries hit memory first.
  if (state.db) {
    try {
      state.db.prepare(`
        INSERT INTO refusal_fields (id, world_id, kind, reason, glyph_hint, glyph_json, expires_at, applies_to_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id, worldId, entry.kind, entry.reason,
        entry.glyphHint ?? null,
        entry.glyph != null ? JSON.stringify(entry.glyph) : null,
        Math.floor(entry.expiresAt / 1000),
        entry.appliesTo != null ? JSON.stringify(entry.appliesTo) : null,
      );
    } catch { /* persistence best-effort — table may not exist on minimal builds */ }
  }

  // Phase F3.1 — surface compound-refusal threshold crossings.
  // Each newly-applied refusal might push the world's strength across
  // the strength≥6 compound gate. Recompute and emit on transition.
  try {
    const emitFn = globalThis._concordRealtimeEmit;
    if (typeof emitFn === "function") {
      const strength = computeFieldComposition(state, worldId)?.strength ?? 0;
      const wasCompound = !!state._compoundCrossed?.get?.(worldId);
      const isCompound = strength >= 6;
      if (isCompound && !wasCompound) {
        if (!state._compoundCrossed) state._compoundCrossed = new Map();
        state._compoundCrossed.set(worldId, true);
        emitFn("refusal:compound-threshold", { worldId, strength, kind, reason: entry.reason });
      } else if (!isCompound && wasCompound) {
        state._compoundCrossed.set(worldId, false);
      }
    }
  } catch { /* emit failure never blocks the field */ }

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
      SELECT id, world_id, kind, reason, glyph_hint, glyph_json, expires_at, applies_to_json
      FROM refusal_fields WHERE expires_at > unixepoch()
    `).all();
  } catch { return { ok: false, reason: "table_missing" }; }

  const map = ensureMap(state);
  for (const row of rows) {
    let glyph = null;
    try { glyph = row.glyph_json ? JSON.parse(row.glyph_json) : null; } catch { /* ignore */ }
    let appliesTo = null;
    try { appliesTo = row.applies_to_json ? JSON.parse(row.applies_to_json) : null; } catch { /* ignore */ }
    const list = map.get(row.world_id) ?? [];
    list.push({
      id: row.id,
      kind: row.kind,
      expiresAt: row.expires_at * 1000,
      reason: row.reason ?? "",
      glyphHint: row.glyph_hint ?? null,
      glyph,
      appliesTo,
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

const CHILD_MATURITIES = Object.freeze(["infant", "child", "adolescent"]);

/** Does a field entry's appliesTo scope match this target? null scope = everyone. */
function _matchesAppliesTo(entry, target) {
  const scope = entry.appliesTo;
  if (!scope) return true; // unscoped → applies to all
  if (Array.isArray(scope.maturity)) {
    return target && target.maturity != null && scope.maturity.includes(target.maturity);
  }
  return true;
}

/**
 * SL6 — scoped refusal gate: is `kind` refused for THIS target right now? True
 * iff an active field of `kind` exists AND (it's unscoped OR the target matches
 * its scope). `target = { kind:'player'|'npc', id, maturity? }`. Callers pass the
 * defender AND the attacker through this so the young can neither be harmed nor
 * harm. Back-compat: with no scoped fields this is exactly isRefused per-entity.
 */
export function isRefusedFor(state, worldId, kind, target = {}) {
  return activeFields(state, worldId).some((e) => e.kind === kind && _matchesAppliesTo(e, target));
}

/**
 * Resolve an entity's maturity tier. Players/children read player_children.maturity
 * (a regular adult avatar with no child row → 'adult'). NPCs default 'adult'
 * unless an authored age tier is supplied. Best-effort; never throws.
 * @returns {'infant'|'child'|'adolescent'|'adult'}
 */
export function maturityOf(db, entityKind, entityId) {
  if (!db || !entityId) return "adult";
  try {
    if (entityKind === "player" || entityKind === "child" || entityKind === "player_child") {
      const row = db.prepare("SELECT maturity FROM player_children WHERE id = ?").get(entityId);
      if (row && row.maturity) return row.maturity;
    }
  } catch { /* table optional */ }
  return "adult";
}

/** Is a maturity tier considered "under-matured" (the SL6 protected class)? */
export function isUnderMatured(maturity) {
  return CHILD_MATURITIES.includes(String(maturity));
}

/**
 * SL6 — DB-backed scoped refusal gate for callers that hold a `db` handle but
 * not the live in-memory STATE (e.g. the HTTP combat route in routes/worlds.js,
 * where the `globalThis.__CONCORD_STATE__` side-channel is unreliable for
 * refusal fields). Loads the persisted, non-expired fields fresh from
 * `refusal_fields` into an ephemeral state, then applies the same scoped match.
 * Best-effort; returns false if the table is missing or anything throws —
 * so off==today when no scoped field has been cast.
 */
export function isRefusedForDb(db, worldId, kind, target = {}) {
  if (!db || !worldId) return false;
  try {
    const tmp = { db };
    const loaded = loadPersistedRefusalFields(tmp);
    if (!loaded?.ok) return false;
    return isRefusedFor(tmp, worldId, kind, target);
  } catch { return false; }
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
  //
  // glyphAdd returns {numerical, decimal, semantic}. The previous version
  // referenced `.value` on the result, which is undefined — every iteration
  // past the first threw silently and composedFrom was capped at 1.
  // We now feed the prior numerical glyph string back into glyphAdd so the
  // chain actually accumulates across all live entries.
  let composite = null;
  let composedFrom = 0;
  for (const entry of live) {
    if (!entry.glyph) continue;
    try {
      const entryGlyph = entry.glyph?.numerical ?? entry.glyph;
      if (composite == null) {
        composite = entry.glyph;
      } else {
        const compositeGlyph = composite?.numerical ?? composite;
        composite = glyphAdd(compositeGlyph, entryGlyph);
      }
      composedFrom += 1;
    } catch { /* algebra failure must never break gameplay */ }
  }

  // Strength derives from how many active fields contributed to the
  // composite plus the composite glyph's depth (when the algebra exposes
  // one). A single field yields strength 1; deep stacks reach 6+, hard
  // capped at 9 so callers can branch deterministically.
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
