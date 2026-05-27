// server/lib/npc-player-memory.js
//
// Wave A / A2 — per-(NPC, player) memory + interaction log + summary
// compiler interface. Three readers consume this:
//   - narrative-bridge.js injects compact summary + days-since-last-seen
//     into NPC dialogue prompts (Wave A wires; Wave B/D/E surface)
//   - bestiary-style RememberedByPanel (Wave D) lists which NPCs miss you
//   - gossip propagation (Wave B) seeds NPC-to-NPC conversations with
//     memories at lower confidence
//
// API:
//   recordInteraction(db, {npcId, playerId, worldId, kind, payload, sentimentDelta?})
//   recordSighting(db, {npcId, playerId, worldId}) — cheap, bumps sightings only
//   getMemory(db, npcId, playerId)
//   listForPlayer(db, playerId, {worldId?, limit?})
//   listHighSentimentForWorld(db, worldId, sentimentMin)
//   daysSinceLastSeen(memory, nowS?)  — pure
//   pruneStaleInteractions(db, olderThanDays = 90)

const SENTIMENT_BOUND = 1.0;
const INTERACTION_PAYLOAD_MAX = 1024;
const SUMMARY_PAYLOAD_MAX = 4096;
const INTERACTIONS_KIND = new Set([
  "spoke", "answered_question", "gift", "fought",
  "helped", "witnessed_atrocity", "sighting",
]);

export function recordInteraction(db, opts) {
  if (!db) return { ok: false, reason: "no_db" };
  const { npcId, playerId, worldId, kind, payload = null, sentimentDelta = 0 } = opts || {};
  if (!npcId || !playerId || !worldId || !kind) return { ok: false, reason: "missing_args" };
  if (!INTERACTIONS_KIND.has(kind)) return { ok: false, reason: "invalid_kind" };

  let payloadJson = null;
  if (payload != null) {
    try {
      const s = JSON.stringify(payload);
      payloadJson = s.length > INTERACTION_PAYLOAD_MAX
        ? JSON.stringify({ _truncated: true, _len: s.length })
        : s;
    } catch { payloadJson = JSON.stringify({ _unserialisable: true }); }
  }

  const sd = Math.max(-SENTIMENT_BOUND, Math.min(SENTIMENT_BOUND, Number(sentimentDelta) || 0));
  const isInteraction = kind !== "sighting" ? 1 : 0;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO npc_player_interactions (npc_id, player_id, world_id, kind, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(npcId, playerId, worldId, kind, payloadJson);

    db.prepare(`
      INSERT INTO npc_player_memories
        (npc_id, player_id, world_id, sentiment, sightings, interactions, first_met_at, last_interaction_at)
      VALUES (?, ?, ?, ?, 1, ?, unixepoch(), unixepoch())
      ON CONFLICT(npc_id, player_id) DO UPDATE SET
        sentiment           = MAX(-1.0, MIN(1.0, npc_player_memories.sentiment + ?)),
        sightings           = npc_player_memories.sightings + 1,
        interactions        = npc_player_memories.interactions + ?,
        world_id            = excluded.world_id,
        last_interaction_at = unixepoch()
    `).run(npcId, playerId, worldId, sd, isInteraction, sd, isInteraction);
  });
  try { tx(); }
  catch (err) { return { ok: false, reason: "persist_failed", message: err?.message }; }
  return { ok: true };
}

/** Cheap proximity ping. Doesn't write the interaction log. */
export function recordSighting(db, { npcId, playerId, worldId }) {
  return recordInteraction(db, { npcId, playerId, worldId, kind: "sighting" });
}

export function getMemory(db, npcId, playerId) {
  if (!db || !npcId || !playerId) return null;
  try {
    const row = db.prepare(`
      SELECT * FROM npc_player_memories WHERE npc_id = ? AND player_id = ?
    `).get(npcId, playerId);
    if (!row) return null;
    return _decode(row);
  } catch { return null; }
}

export function listForPlayer(db, playerId, { worldId = null, limit = 100 } = {}) {
  if (!db || !playerId) return [];
  try {
    const params = [playerId];
    let where = "player_id = ?";
    if (worldId) { where += " AND world_id = ?"; params.push(worldId); }
    params.push(limit);
    const rows = db.prepare(`
      SELECT * FROM npc_player_memories
      WHERE ${where}
      ORDER BY last_interaction_at DESC
      LIMIT ?
    `).all(...params);
    return rows.map(_decode);
  } catch { return []; }
}

/** Used by Wave D's grief cycle — who genuinely cared about this player? */
export function listHighSentimentForWorld(db, worldId, sentimentMin = 0.4) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT * FROM npc_player_memories
      WHERE world_id = ? AND sentiment >= ?
      ORDER BY sentiment DESC, last_interaction_at DESC
      LIMIT 500
    `).all(worldId, sentimentMin).map(_decode);
  } catch { return []; }
}

/** Pure helper. Memory rows aren't dated in days; this converts. */
export function daysSinceLastSeen(memory, nowS = Math.floor(Date.now() / 1000)) {
  if (!memory?.lastInteractionAt) return null;
  return Math.max(0, Math.floor((nowS - memory.lastInteractionAt) / 86400));
}

/** Called by the heartbeat to keep the interaction table bounded. */
export function pruneStaleInteractions(db, olderThanDays = 90) {
  if (!db) return { ok: false };
  try {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    const r = db.prepare(`DELETE FROM npc_player_interactions WHERE created_at < ?`).run(cutoff);
    return { ok: true, deleted: r.changes };
  } catch (err) {
    return { ok: false, reason: "prune_failed", message: err?.message };
  }
}

/**
 * Fetch the raw interaction log for a single pair. Used by the memory
 * compiler to feed the subconscious brain. Newest first.
 */
export function recentInteractions(db, npcId, playerId, limit = 40) {
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT id, kind, payload_json, created_at
      FROM npc_player_interactions
      WHERE npc_id = ? AND player_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(npcId, playerId, limit);
    return rows.map((r) => ({
      ...r,
      payload: _tryJSON(r.payload_json),
    }));
  } catch { return []; }
}

/**
 * Write a compiled summary into the memory row. Validated +
 * length-capped. Returns ok/false.
 */
export function persistSummary(db, npcId, playerId, summary) {
  if (!db || !npcId || !playerId || summary == null) return { ok: false, reason: "missing_args" };
  let summaryJson = null;
  try {
    summaryJson = JSON.stringify(summary);
    if (summaryJson.length > SUMMARY_PAYLOAD_MAX) {
      summaryJson = JSON.stringify({ _truncated: true, _len: summaryJson.length });
    }
  } catch { return { ok: false, reason: "unserialisable" }; }
  try {
    const r = db.prepare(`
      UPDATE npc_player_memories
      SET summary_json = ?, last_summary_compiled_at = unixepoch()
      WHERE npc_id = ? AND player_id = ?
    `).run(summaryJson, npcId, playerId);
    return { ok: true, updated: r.changes };
  } catch (err) {
    return { ok: false, reason: "persist_failed", message: err?.message };
  }
}

function _decode(r) {
  return {
    npcId: r.npc_id,
    playerId: r.player_id,
    worldId: r.world_id,
    summary: _tryJSON(r.summary_json),
    sentiment: r.sentiment ?? 0,
    sightings: r.sightings ?? 0,
    interactions: r.interactions ?? 0,
    firstMetAt: r.first_met_at,
    lastInteractionAt: r.last_interaction_at,
    lastSummaryCompiledAt: r.last_summary_compiled_at ?? null,
  };
}

function _tryJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

export const _internal = { INTERACTIONS_KIND, SENTIMENT_BOUND };
