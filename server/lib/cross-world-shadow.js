// server/lib/cross-world-shadow.js
//
// Wave E / E1 — single-instance simulation of an asymmetric-multiplayer
// shadow peer. Every ~30min the heartbeat picks 1-3 notable local-world
// events (high-severity world_legends rows) and writes them to a
// per-instance "shadow peer" queue. The cross-world-pulse-cycle then
// drains that queue and spawns echo quests so the player sees evidence
// that other worlds exist.
//
// When CONCORD_FEDERATION_TOKEN is set, the same heartbeat is the
// source for real federation broadcasts — same emit shape, real peer.

import crypto from "crypto";

const MAX_PER_SAMPLE = 3;
const SEVERITY_FLOOR = 6;   // only "notable" legends seed echoes
const LOOKBACK_S = 24 * 3600;  // sample from last 24h

/**
 * Pick recent notable legends across all worlds + record each as a
 * shadow_peer outbound event. Returns the list of recorded ids.
 */
export function sampleNotableEvents(db, { worldIds = null } = {}) {
  if (!db) return { ok: false, reason: "no_db", recorded: 0 };
  let legends = [];
  try {
    const args = [Math.floor(Date.now() / 1000) - LOOKBACK_S, SEVERITY_FLOOR, MAX_PER_SAMPLE];
    let where = "composed_at >= ? AND severity >= ?";
    if (Array.isArray(worldIds) && worldIds.length > 0) {
      where += ` AND world_id IN (${worldIds.map(() => "?").join(",")})`;
      args.splice(2, 0, ...worldIds);
    }
    legends = db.prepare(`
      SELECT id, world_id, subject_kind, subject_id, title, body, sentiment, severity, composed_at
      FROM world_legends
      WHERE ${where}
      ORDER BY severity DESC, composed_at DESC
      LIMIT ?
    `).all(...args);
  } catch { return { ok: true, reason: "no_legends_table", recorded: 0 }; }
  if (legends.length === 0) return { ok: true, recorded: 0 };

  // Lazy table create — single-instance test installs don't need a
  // separate migration. Wave E1 ships the migration too (211) but the
  // CREATE IF NOT EXISTS makes it safe.
  _ensureTable(db);

  const ids = [];
  for (const l of legends) {
    try {
      const id = `shadow_${crypto.randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT OR IGNORE INTO cross_world_shadow_queue
          (id, source_world, kind, entity_kind, entity_id, detail_json)
        VALUES (?, ?, 'legend_echo', ?, ?, ?)
      `).run(id, l.world_id, l.subject_kind, l.subject_id, JSON.stringify({
        legendId: l.id,
        title: l.title,
        body: l.body,
        sentiment: l.sentiment,
        severity: l.severity,
      }));
      ids.push(id);
    } catch { /* skip */ }
  }
  return { ok: true, recorded: ids.length, ids };
}

function _ensureTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cross_world_shadow_queue (
        id            TEXT PRIMARY KEY,
        source_world  TEXT NOT NULL,
        target_world  TEXT NOT NULL DEFAULT '__shadow_peer',
        kind          TEXT NOT NULL,
        entity_kind   TEXT, entity_id TEXT,
        detail_json   TEXT,
        consumed_at   INTEGER,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_cwsq_consumed
        ON cross_world_shadow_queue(consumed_at, created_at);
    `);
  } catch { /* idempotent */ }
}

/**
 * Drain the shadow queue. Returns rows that haven't yet been consumed.
 * Caller marks each consumed via markConsumed.
 */
export function drainShadowQueue(db, { limit = 10 } = {}) {
  if (!db) return [];
  _ensureTable(db);
  try {
    const rows = db.prepare(`
      SELECT id, source_world, kind, entity_kind, entity_id, detail_json,
             consumed_at, created_at
      FROM cross_world_shadow_queue
      WHERE consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    return rows.map((r) => ({ ...r, detail: _tryJSON(r.detail_json) }));
  } catch { return []; }
}

export function markConsumed(db, id) {
  if (!db || !id) return { ok: false };
  try {
    db.prepare(`UPDATE cross_world_shadow_queue SET consumed_at = unixepoch() WHERE id = ?`).run(id);
    return { ok: true };
  } catch { return { ok: false }; }
}

function _tryJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
