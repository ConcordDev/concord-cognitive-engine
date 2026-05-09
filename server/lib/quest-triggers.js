// server/lib/quest-triggers.js
//
// Theme deferred (game-feel pass): hidden quest triggers.
//
// Authors call defineQuestTrigger to plant a hidden trigger that
// activates a quest when conditions are met:
//
//   proximity:      player is within radius of a world point
//   visits:         player has been near (proximity) ≥ N times
//   dialogue:       player picked option X talking to NPC Y
//   item_handover:  player gave item I to NPC Y
//   time_window:    current world hour ∈ [start, end]
//   world_state:    arbitrary key=value match against a world-state KV
//
// evaluateTriggersAtPosition runs proximity + visits checks for a
// player at (x, z) in a world. Returns the list of triggers whose
// conditions are satisfied. Caller decides what to do (start a quest
// via the quest engine, emit a socket event, etc.).
//
// recordTriggerVisit increments the player's visit counter for a
// trigger; fireTrigger marks a fire and respects max_fires_per_user.
//
// Pure-ish: db is the only side-effect.

import crypto from "node:crypto";

export const TRIGGER_KINDS = new Set([
  "proximity", "visits", "dialogue", "item_handover", "time_window", "world_state",
]);

const PROXIMITY_DEFAULT_R = 6;     // metres
const TIME_PROXIMITY_S    = 30;    // re-trigger debounce per player

/** Author registration. Idempotent on `id`; updates payload + flags. */
export function defineQuestTrigger(db, opts) {
  if (!db || !opts) return { ok: false, reason: "no_input" };
  const {
    id = `qtrig_${crypto.randomUUID()}`,
    worldId, triggerKind, payload, targetQuestId,
    requiresVisits = 1, maxFiresPerUser = 1, author = null, enabled = true,
  } = opts;
  if (!worldId || !targetQuestId) return { ok: false, reason: "missing_fields" };
  if (!TRIGGER_KINDS.has(triggerKind)) return { ok: false, reason: "bad_kind" };
  let pjson;
  try { pjson = JSON.stringify(payload ?? {}); }
  catch { return { ok: false, reason: "bad_payload" }; }

  try {
    db.prepare(`
      INSERT INTO quest_triggers
        (id, world_id, trigger_kind, payload_json, target_quest_id,
         requires_visits, max_fires_per_user, author, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id,
        trigger_kind = excluded.trigger_kind,
        payload_json = excluded.payload_json,
        target_quest_id = excluded.target_quest_id,
        requires_visits = excluded.requires_visits,
        max_fires_per_user = excluded.max_fires_per_user,
        author = excluded.author,
        enabled = excluded.enabled
    `).run(id, worldId, triggerKind, pjson, targetQuestId,
           Math.max(1, Number(requiresVisits)),
           Math.max(1, Number(maxFiresPerUser)),
           author, enabled ? 1 : 0);
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
  return {
    ok: true,
    trigger: {
      id, worldId, triggerKind, payload, targetQuestId,
      requiresVisits, maxFiresPerUser, author, enabled,
    },
  };
}

/** List enabled triggers for a world (optional kind filter). */
export function listTriggers(db, opts) {
  if (!db || !opts) return [];
  const { worldId, kind = null, limit = 200 } = opts;
  if (!worldId) return [];
  try {
    const sql = kind
      ? `SELECT * FROM quest_triggers WHERE world_id = ? AND trigger_kind = ? AND enabled = 1 LIMIT ?`
      : `SELECT * FROM quest_triggers WHERE world_id = ? AND enabled = 1 LIMIT ?`;
    const args = kind ? [worldId, kind, limit] : [worldId, limit];
    return db.prepare(sql).all(...args).map(_hydrate);
  } catch { return []; }
}

/** Evaluate proximity + visits triggers for a player at a position. */
export function evaluateTriggersAtPosition(db, opts) {
  if (!db || !opts) return [];
  const { userId, worldId, position } = opts;
  if (!userId || !worldId || !position) return [];
  const x = Number(position.x);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [];

  const candidates = listTriggers(db, { worldId, limit: 500 })
    .filter((t) => t.triggerKind === "proximity" || t.triggerKind === "visits");

  const now = Math.floor(Date.now() / 1000);
  const ready = [];
  for (const t of candidates) {
    const tx = Number(t.payload?.x);
    const tz = Number(t.payload?.z);
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) continue;
    const r = Number(t.payload?.radiusM) || PROXIMITY_DEFAULT_R;
    if (Math.hypot(x - tx, z - tz) > r) continue;
    // De-bounce per-user visit by TIME_PROXIMITY_S so a player standing
    // in range for 5s doesn't bank 5 visits.
    let row = null;
    try {
      row = db.prepare(`
        SELECT visits, fired_count, last_fired_at, last_at
          FROM quest_trigger_visits
         WHERE trigger_id = ? AND user_id = ?
      `).get(t.id, userId);
    } catch { /* ok */ }
    const lastAt = Number(row?.last_at ?? 0);
    if (now - lastAt >= TIME_PROXIMITY_S) {
      _bumpVisit(db, t.id, userId);
      row = { ...(row ?? {}), visits: Number(row?.visits ?? 0) + 1, last_at: now };
    }
    const visits = Number(row?.visits ?? 0);
    const fired = Number(row?.fired_count ?? 0);
    if (visits >= t.requiresVisits && fired < t.maxFiresPerUser) {
      ready.push({ trigger: t, visits, firedCount: fired });
    }
  }
  return ready;
}

/** Record a visit (e.g., from dialogue / item-handover paths that
 *  don't go through evaluateTriggersAtPosition). */
export function recordTriggerVisit(db, triggerId, userId) {
  if (!db || !triggerId || !userId) return null;
  return _bumpVisit(db, triggerId, userId);
}

/** Mark the trigger as fired for the user. Returns { ok, fired_count, reason? }. */
export function fireTrigger(db, triggerId, userId) {
  if (!db || !triggerId || !userId) return { ok: false, reason: "missing_fields" };
  let row;
  try {
    row = db.prepare(`SELECT * FROM quest_triggers WHERE id = ?`).get(triggerId);
  } catch { return { ok: false, reason: "no_table" }; }
  if (!row) return { ok: false, reason: "not_found" };
  const t = _hydrate(row);
  if (!t.enabled) return { ok: false, reason: "disabled" };

  const now = Math.floor(Date.now() / 1000);
  let v = null;
  try {
    v = db.prepare(`
      SELECT visits, fired_count FROM quest_trigger_visits
       WHERE trigger_id = ? AND user_id = ?
    `).get(triggerId, userId);
  } catch { /* ok */ }
  const fired = Number(v?.fired_count ?? 0);
  if (fired >= t.maxFiresPerUser) return { ok: false, reason: "fire_cap" };
  const visits = Number(v?.visits ?? 0);
  if (visits < t.requiresVisits) return { ok: false, reason: "needs_visits", needs: t.requiresVisits, have: visits };

  try {
    db.prepare(`
      INSERT INTO quest_trigger_visits (trigger_id, user_id, visits, first_at, last_at, fired_count, last_fired_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(trigger_id, user_id) DO UPDATE SET
        fired_count = fired_count + 1,
        last_fired_at = excluded.last_fired_at,
        last_at = excluded.last_at
    `).run(triggerId, userId, visits, now, now, now);
  } catch (err) {
    return { ok: false, reason: "fire_failed", error: err?.message };
  }
  return { ok: true, firedCount: fired + 1, targetQuestId: t.targetQuestId, payload: t.payload };
}

/** Helper: increment visit row, idempotent upsert. */
function _bumpVisit(db, triggerId, userId) {
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      INSERT INTO quest_trigger_visits (trigger_id, user_id, visits, first_at, last_at, fired_count)
      VALUES (?, ?, 1, ?, ?, 0)
      ON CONFLICT(trigger_id, user_id) DO UPDATE SET
        visits = visits + 1,
        last_at = excluded.last_at
    `).run(triggerId, userId, now, now);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _hydrate(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload_json ?? "{}"); }
  catch { /* default {} */ }
  return {
    id: row.id,
    worldId: row.world_id,
    triggerKind: row.trigger_kind,
    targetQuestId: row.target_quest_id,
    requiresVisits: Number(row.requires_visits),
    maxFiresPerUser: Number(row.max_fires_per_user),
    author: row.author ?? null,
    enabled: !!row.enabled,
    payload,
  };
}
