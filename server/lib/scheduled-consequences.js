// server/lib/scheduled-consequences.js
//
// Wave A / A1 — generic delayed-action ledger. Schedules a row in
// `scheduled_consequences` to fire N seconds after now, with a payload
// and source/target metadata. The consequence-dispatcher-cycle heartbeat
// drains due rows and routes each by `kind` into a handler.
//
// API:
//   schedule(db, { kind, fireInS, payload?, source?, target?, worldId? })
//     -> { id, firesAt }
//   due(db, now?)  -> rows with fired_at IS NULL AND fires_at <= now
//   markFired(db, id, result?)
//   listForTarget(db, kind, id) -> recent (fired or pending) rows
//   listForSource(db, kind, id) -> recent rows
//
// `kind` is a free-form string; dispatcher handlers map it to behavior.
// Known kinds (Waves A-E will register these):
//   scheme:reveal           — Wave B / item 4
//   royal_kill_radicalize   — Wave C / item 9
//   royal_kill_form_cult    — Wave C / item 9
//   royal_kill_attack       — Wave C / item 9
//   betrayal_gossip         — Wave C / item 9
//   betrayal_distrust       — Wave C / item 9
//   betrayal_blacklist      — Wave C / item 9
//   mass_atrocity_legend    — Wave D / item 2
//   mass_atrocity_news      — Wave D / item 2
//   bounty_posted           — Wave C / item 9
//   echo_quest_spawn        — Wave E / item 5

const MAX_HORIZON_S = 30 * 24 * 3600;  // 30 days — anything further out is
                                        // wrong and almost certainly a bug.

export function schedule(db, opts) {
  if (!db) return { ok: false, reason: "no_db" };
  const { kind, fireInS, payload = null, source = null, target = null, worldId = null } = opts || {};
  if (!kind || typeof kind !== "string") return { ok: false, reason: "missing_kind" };
  const n = Number(fireInS);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: "invalid_fireInS" };
  if (n > MAX_HORIZON_S) return { ok: false, reason: "horizon_too_far" };

  const firesAt = Math.floor(Date.now() / 1000) + Math.floor(n);
  try {
    const r = db.prepare(`
      INSERT INTO scheduled_consequences
        (kind, fires_at, source_kind, source_id, target_kind, target_id, world_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      kind, firesAt,
      source?.kind ?? null, source?.id ?? null,
      target?.kind ?? null, target?.id ?? null,
      worldId,
      payload ? JSON.stringify(payload) : null,
    );
    return { ok: true, id: r.lastInsertRowid, firesAt };
  } catch (err) {
    return { ok: false, reason: "persist_failed", message: err?.message };
  }
}

export function due(db, now = Math.floor(Date.now() / 1000), limit = 50) {
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT id, kind, fires_at, source_kind, source_id,
             target_kind, target_id, world_id, payload_json, created_at
      FROM scheduled_consequences
      WHERE fired_at IS NULL AND fires_at <= ?
      ORDER BY fires_at ASC
      LIMIT ?
    `).all(now, limit);
    return rows.map(_decode);
  } catch {
    return [];
  }
}

export function markFired(db, id, result = null) {
  if (!db || !id) return { ok: false, reason: "invalid_args" };
  try {
    const r = db.prepare(`
      UPDATE scheduled_consequences
      SET fired_at = unixepoch(), fire_result = ?
      WHERE id = ? AND fired_at IS NULL
    `).run(result ? JSON.stringify(result) : null, id);
    return { ok: true, updated: r.changes };
  } catch (err) {
    return { ok: false, reason: "persist_failed", message: err?.message };
  }
}

/** Pending or fired rows targeting a specific entity. Newest first. */
export function listForTarget(db, kind, id, limit = 50) {
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT id, kind, fires_at, source_kind, source_id,
             target_kind, target_id, world_id, payload_json, fired_at, fire_result, created_at
      FROM scheduled_consequences
      WHERE target_kind = ? AND target_id = ?
      ORDER BY fires_at DESC
      LIMIT ?
    `).all(kind, id, limit);
    return rows.map(_decode);
  } catch {
    return [];
  }
}

/** Pending or fired rows triggered by a specific source. */
export function listForSource(db, kind, id, limit = 50) {
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT id, kind, fires_at, source_kind, source_id,
             target_kind, target_id, world_id, payload_json, fired_at, fire_result, created_at
      FROM scheduled_consequences
      WHERE source_kind = ? AND source_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(kind, id, limit);
    return rows.map(_decode);
  } catch {
    return [];
  }
}

/**
 * Cancel a pending consequence (e.g. player completes a redemption arc
 * before the cult would have formed). No-op on already-fired rows.
 */
export function cancel(db, id, reason = "cancelled") {
  if (!db || !id) return { ok: false };
  try {
    const r = db.prepare(`
      UPDATE scheduled_consequences
      SET fired_at = unixepoch(), fire_result = ?
      WHERE id = ? AND fired_at IS NULL
    `).run(JSON.stringify({ cancelled: true, reason }), id);
    return { ok: true, cancelled: r.changes > 0 };
  } catch (err) {
    return { ok: false, reason: "persist_failed", message: err?.message };
  }
}

function _decode(r) {
  let payload = null;
  if (r.payload_json) { try { payload = JSON.parse(r.payload_json); } catch { /* leave null */ } }
  let result = null;
  if (r.fire_result) { try { result = JSON.parse(r.fire_result); } catch { /* leave null */ } }
  return {
    id: r.id,
    kind: r.kind,
    firesAt: r.fires_at,
    source: r.source_kind ? { kind: r.source_kind, id: r.source_id } : null,
    target: r.target_kind ? { kind: r.target_kind, id: r.target_id } : null,
    worldId: r.world_id ?? null,
    payload,
    firedAt: r.fired_at ?? null,
    result,
    createdAt: r.created_at,
  };
}

export const _internal = { MAX_HORIZON_S };
