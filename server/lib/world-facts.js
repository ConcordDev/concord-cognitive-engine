// server/lib/world-facts.js
//
// CRUD + retrieval helpers for the world_facts table (migration 102).
// World facts are TTL-bounded shared truths that NPCs and procedural
// generators read from so they don't independently invent contradictory
// claims about recent events.
//
// Lifecycle:
//   recordFact()     — anyone can write a fact (combat chronicle, world
//                       event scheduler, faction-war tick, NPC death,
//                       arrival of a major character, weather shift)
//   recentFacts()    — pulled into narrative-bridge for NPC prompts
//   factsForRole()   — narrower slice for role-specific context
//   pruneExpired()   — periodic sweep (call from heartbeat tick)

import crypto from "crypto";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24h

/**
 * @returns {{ ok: boolean, factId?: string, error?: string }}
 */
export function recordFact(db, {
  worldId,
  factKind,
  factText,
  tags = [],
  sourceUser = null,
  sourceNpc = null,
  factionId = null,
  districtId = null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
} = {}) {
  if (!db) return { ok: false, error: "db_required" };
  if (!worldId) return { ok: false, error: "worldId_required" };
  if (!factKind) return { ok: false, error: "factKind_required" };
  if (!factText) return { ok: false, error: "factText_required" };

  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS);

  try {
    // Bound tags array so a 10k-element array can't bloat the row.
    const safeTags = Array.isArray(tags) ? tags.slice(0, 32).map((t) => String(t).slice(0, 64)) : [];
    db.prepare(`
      INSERT INTO world_facts
        (id, world_id, fact_kind, fact_text, tags_json, source_user, source_npc,
         faction_id, district_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, worldId, factKind, String(factText).slice(0, 500),
      JSON.stringify(safeTags),
      sourceUser, sourceNpc, factionId, districtId, expiresAt,
    );
    return { ok: true, factId: id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Pull recent facts for a world. Most recent first.
 *
 * @returns {Array<{ id, world_id, fact_kind, fact_text, tags_json, faction_id, district_id, recorded_at }>}
 */
export function recentFacts(db, worldId, { limit = 10, factionId = null, kinds = null } = {}) {
  if (!db || !worldId) return [];
  try {
    let sql = `
      SELECT id, world_id, fact_kind, fact_text, tags_json, faction_id, district_id, recorded_at
      FROM world_facts
      WHERE world_id = ? AND expires_at > unixepoch()
    `;
    const params = [worldId];
    if (factionId) {
      sql += " AND (faction_id = ? OR faction_id IS NULL)";
      params.push(factionId);
    }
    if (Array.isArray(kinds) && kinds.length > 0) {
      sql += ` AND fact_kind IN (${kinds.map(() => "?").join(",")})`;
      params.push(...kinds);
    }
    sql += " ORDER BY recorded_at DESC LIMIT ?";
    params.push(Math.max(1, Math.min(100, Number(limit) || 10)));
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

/**
 * Slim a fact to a string suitable for inlining into an LLM prompt.
 */
export function factPromptLine(fact) {
  if (!fact) return "";
  const where = fact.district_id ? ` (${fact.district_id})` : "";
  const fac = fact.faction_id ? ` [${fact.faction_id}]` : "";
  return `• ${fact.fact_kind}: ${fact.fact_text}${where}${fac}`;
}

/**
 * Periodic sweep — delete expired facts. Call from heartbeat tick.
 * @returns {{ pruned: number }}
 */
export function pruneExpired(db) {
  if (!db) return { pruned: 0 };
  try {
    const r = db.prepare(`DELETE FROM world_facts WHERE expires_at <= unixepoch()`).run();
    return { pruned: r.changes || 0 };
  } catch {
    return { pruned: 0 };
  }
}
