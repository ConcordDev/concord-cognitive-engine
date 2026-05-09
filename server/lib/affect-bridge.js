// server/lib/affect-bridge.js
//
// Layer 2: Wake the affect engine.
//
// Bridges the in-memory affect/engine.js (which has full applyEvent/tick/
// invariants logic) to migration 110's persistent affect_state +
// affect_events_log tables. Also writes affect signals into
// brain_interactions outcomes via Layer 3's outcome-signals dispatch
// when valence delta exceeds a threshold.
//
// Consumers call applyAffectEvent(db, entityId, event) from anywhere
// that produces an affective signal — chat handler success, repair
// pain, refusal-field activation, council consensus, etc. The bridge
// loads or creates the entity's state, applies the event, persists
// the new state, logs the delta, and (when valence shifts) emits a
// resolver signal.
//
// fail-safe: every operation is wrapped in try/catch. Affect logging
// must NEVER block a user-facing path.

import crypto from "node:crypto";
import { applyEvent, tick, createState, createMomentum } from "../affect/engine.js";

const DEFAULT_WORLD = "concordia-hub";
const VALENCE_POSITIVE_THRESHOLD = 0.15; // delta.v >= this → positive resolver signal
const VALENCE_NEGATIVE_THRESHOLD = -0.15; // delta.v <= this → negative resolver signal

/**
 * Load existing state for an entity, or create at baseline.
 * Returns the engine-compatible { E, M } pair.
 */
export function loadOrCreate(db, entityId, worldId = DEFAULT_WORLD) {
  if (!db || !entityId) return { E: createState(), M: createMomentum() };
  try {
    const row = db.prepare(
      // TODO: project explicit columns (auto-fix suggestion)
      `SELECT * FROM affect_state WHERE entity_id = ? AND world_id = ?`,
    ).get(entityId, worldId);
    if (row) {
      const E = {
        v: row.v, a: row.a, s: row.s, c: row.c, g: row.g, t: row.t, f: row.f,
        ts: (row.last_tick_at || row.updated_at) * 1000,
        meta: _safeParse(row.meta_json) || {},
      };
      const M = {
        v: row.m_v, a: row.m_a, s: row.m_s, c: row.m_c,
        g: row.m_g, t: row.m_t, f: row.m_f,
      };
      return { E, M };
    }
  } catch { /* fall through to fresh state */ }
  return { E: createState(), M: createMomentum() };
}

/**
 * Persist E + M back to affect_state. UPSERT pattern.
 */
function _persist(db, entityId, worldId, E, M) {
  if (!db || !entityId) return;
  try {
    db.prepare(
      `INSERT INTO affect_state
        (entity_id, world_id, v, a, s, c, g, t, f,
         m_v, m_a, m_s, m_c, m_g, m_t, m_f,
         meta_json, last_tick_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
       ON CONFLICT(entity_id, world_id) DO UPDATE SET
         v=excluded.v, a=excluded.a, s=excluded.s, c=excluded.c,
         g=excluded.g, t=excluded.t, f=excluded.f,
         m_v=excluded.m_v, m_a=excluded.m_a, m_s=excluded.m_s, m_c=excluded.m_c,
         m_g=excluded.m_g, m_t=excluded.m_t, m_f=excluded.m_f,
         meta_json=excluded.meta_json,
         last_tick_at=unixepoch(),
         updated_at=unixepoch()`,
    ).run(
      entityId, worldId,
      E.v, E.a, E.s, E.c, E.g, E.t, E.f,
      M.v, M.a, M.s, M.c, M.g, M.t, M.f,
      JSON.stringify(E.meta || {}),
    );
  } catch { /* persistence failure must not break caller */ }
}

/**
 * Apply an affect event for an entity. Wraps the engine's applyEvent
 * with persistence + delta log + (when significant) outcome-signal
 * emit on a referenced brain_interaction.
 *
 * @param {object} db
 * @param {string} entityId — user_id, npc:id, world:id, system:scope
 * @param {object} event    — { type, source?, magnitude?, meta? } (per affect/schema.js AffectEventSchema)
 * @param {object} [opts]
 * @param {string} [opts.worldId='concordia-hub']
 * @param {string} [opts.refId]    — brain_interaction id this event is associated with
 * @returns {{ ok: boolean, delta?: object, label?: string, error?: string }}
 */
export function applyAffectEvent(db, entityId, event, opts = {}) {
  if (!db || !entityId || !event || typeof event !== "object") {
    return { ok: false, error: "missing_args" };
  }
  const worldId = opts.worldId || DEFAULT_WORLD;
  try {
    const { E, M } = loadOrCreate(db, entityId, worldId);
    const result = applyEvent(E, M, { ...event, ts: Date.now() });
    _persist(db, entityId, worldId, result.E, M);

    // Log the delta for audit / replay.
    try {
      db.prepare(
        `INSERT INTO affect_events_log
          (id, entity_id, world_id, event_type, delta_json, magnitude, source, ref_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `ae_${crypto.randomBytes(8).toString("hex")}`,
        entityId, worldId,
        String(event.type || "UNKNOWN"),
        JSON.stringify(result.delta || {}),
        Number.isFinite(event.magnitude) ? event.magnitude : null,
        event.source || null,
        opts.refId || null,
      );
    } catch { /* log-skip is non-fatal */ }

    // Layer 3 hand-off: if valence shifted significantly AND a brain
    // interaction is referenced, emit a resolver signal so the daily
    // training corpus reflects the affective outcome.
    if (opts.refId && result.delta && Number.isFinite(result.delta.v)) {
      const dv = result.delta.v;
      if (dv >= VALENCE_POSITIVE_THRESHOLD) {
        _emitResolverSignal(db, opts.refId, "positive", {
          source: "affect_valence_delta",
          delta: dv,
          eventType: event.type,
        });
      } else if (dv <= VALENCE_NEGATIVE_THRESHOLD) {
        _emitResolverSignal(db, opts.refId, "negative", {
          source: "affect_valence_delta",
          delta: dv,
          eventType: event.type,
        });
      }
    }

    // Layer 4 hand-off: feed the affective state into the existential
    // qualia engine so emotional_resonance_os / motivation_os reflect
    // accumulated affect. The qualia channels then influence council
    // voice biases and chat-context assembly.
    _crossEmitQualia(entityId, { type: event.type, valence: result.E.v, arousal: result.E.a });

    return { ok: true, delta: result.delta, E: result.E };
  } catch (e) {
    return { ok: false, error: e?.message || "exception" };
  }
}

/**
 * Heartbeat tick: walk all affect_state rows and apply decay.
 * Persists the post-tick state. Fail-safe — skips rows on error.
 *
 * @param {object} db
 * @returns {{ ok: boolean, ticked: number, errors: number }}
 */
export function affectTickAll(db) {
  if (!db) return { ok: false, ticked: 0, errors: 0 };
  let ticked = 0;
  let errors = 0;
  try {
    const rows = db.prepare(
      `SELECT entity_id, world_id, last_tick_at FROM affect_state
        WHERE last_tick_at < unixepoch() - 30
        ORDER BY last_tick_at ASC
        LIMIT 500`,
    ).all();
    for (const r of rows) {
      try {
        const { E, M } = loadOrCreate(db, r.entity_id, r.world_id);
        tick(E, M);
        _persist(db, r.entity_id, r.world_id, E, M);
        ticked++;
      } catch { errors++; }
    }
    return { ok: true, ticked, errors };
  } catch (e) {
    return { ok: false, ticked, errors, error: e?.message };
  }
}

/**
 * Get an entity's current state, ticked-up-to-now.
 */
export function getAffectStateFor(db, entityId, worldId = DEFAULT_WORLD) {
  if (!db || !entityId) return null;
  try {
    const { E, M } = loadOrCreate(db, entityId, worldId);
    tick(E, M);
    _persist(db, entityId, worldId, E, M);
    return { ...E };
  } catch { return null; }
}

function _safeParse(s) {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Internal: emit a resolver signal for a brain interaction.
 * Uses Layer 3's outcome-signals dispatch. Lazy-imported to avoid
 * a circular dep at module init.
 */
function _emitResolverSignal(db, interactionId, outcome, signal) {
  // Lazy import to break circular dep.
  import("./brain-training/outcome-signals.js")
    .then(({ emitOutcomeSignal }) => {
      try { emitOutcomeSignal(db, interactionId, outcome, signal); } catch { /* swallow */ }
    })
    .catch(() => { /* module may not exist yet at first boot */ });
}

/**
 * Internal: feed the affect event into the existential qualia engine
 * via hookAffect. Lazy-imported to avoid a startup-order coupling.
 * Updates emotional_resonance_os.empathy + motivation_os.drive based
 * on the post-event affective state.
 */
function _crossEmitQualia(entityId, affectEvent) {
  import("../existential/hooks.js")
    .then(({ hookAffect }) => {
      try { if (typeof hookAffect === "function") hookAffect(entityId, affectEvent); } catch { /* swallow */ }
    })
    .catch(() => { /* hooks module may not be loaded */ });
}

export const _internal = {
  VALENCE_POSITIVE_THRESHOLD,
  VALENCE_NEGATIVE_THRESHOLD,
  DEFAULT_WORLD,
};
