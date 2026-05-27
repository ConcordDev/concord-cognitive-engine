// server/lib/consequence-handlers/gossip.js
//
// Wave B / B1 — propagates a player's answer to an NPC's question to
// nearby NPCs as a lower-confidence memory. The originating NPC (source)
// "gossiped" to friends within 30m of their location. Each listener gets
// a memory of the player tagged with `via_gossip: true` so downstream
// dialogue can phrase it as "I heard you said X" instead of "you told me
// X".
//
// Invoked by consequence-dispatcher-cycle.

import { recordInteraction } from "../npc-player-memory.js";

const GOSSIP_RADIUS_M = 30;
const MAX_LISTENERS = 6;
const LISTENER_SENTIMENT_DELTA = 0.03;  // smaller than direct interaction

export default async function handleGossip(db, consequence) {
  if (!db || !consequence) return { ok: false, reason: "missing_args" };
  const sourceNpcId = consequence.source?.id;
  const playerId = consequence.target?.id;
  const worldId = consequence.worldId;
  const payload = consequence.payload || {};
  if (!sourceNpcId || !playerId || !worldId) {
    return { ok: false, reason: "missing_ids" };
  }

  // Find listeners — same world, alive, NOT the source, within GOSSIP_RADIUS_M.
  let listeners = [];
  try {
    const src = db.prepare(`SELECT x, z FROM world_npcs WHERE id = ?`).get(sourceNpcId);
    if (!src || src.x == null || src.z == null) return { ok: true, listeners: 0, reason: "no_source_position" };
    listeners = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ?
        AND id != ?
        AND COALESCE(is_dead, 0) = 0
        AND ((x - ?) * (x - ?) + (z - ?) * (z - ?)) <= (? * ?)
      LIMIT ?
    `).all(worldId, sourceNpcId, src.x, src.x, src.z, src.z, GOSSIP_RADIUS_M, GOSSIP_RADIUS_M, MAX_LISTENERS);
  } catch (err) {
    return { ok: false, reason: "query_failed", message: err?.message };
  }

  let propagated = 0;
  for (const lst of listeners) {
    try {
      recordInteraction(db, {
        npcId: lst.id, playerId, worldId,
        kind: "spoke",
        payload: {
          via_gossip: true,
          gossipSource: sourceNpcId,
          topic: payload.topic ?? null,
          body: typeof payload.body === "string" ? payload.body.slice(0, 200) : null,
        },
        sentimentDelta: LISTENER_SENTIMENT_DELTA,
      });
      propagated++;
    } catch { /* skip individual failures */ }
  }

  return { ok: true, listeners: propagated, sourceNpcId, playerId };
}
