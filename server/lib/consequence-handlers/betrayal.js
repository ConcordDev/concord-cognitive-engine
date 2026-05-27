// server/lib/consequence-handlers/betrayal.js
//
// Wave C / C1 — handles the betrayal cascade.
//   betrayal_gossip     — broadcast a -10 opinion event in 50m radius
//                          around the betrayed NPC's last position
//   betrayal_distrust   — bump opinion -25 on the betrayed faction's
//                          remaining members
//   betrayal_blacklist  — flip faction_relations to kind='war' between
//                          the player's "player_<id>" key and the
//                          betrayed faction

import crypto from "crypto";

export default async function handleBetrayal(db, consequence) {
  if (!db || !consequence) return { ok: false, reason: "missing_args" };
  const kind = consequence.kind;
  const p = consequence.payload || {};
  switch (kind) {
    case "betrayal_gossip":     return await _gossip(db, p, consequence);
    case "betrayal_distrust":   return await _distrust(db, p, consequence);
    case "betrayal_blacklist":  return await _blacklist(db, p, consequence);
    default: return { ok: false, reason: "unknown_step", kind };
  }
}

async function _gossip(db, p, c) {
  if (!c.worldId || !p.actorUserId) return { ok: true, reason: "missing_ids" };
  let affected = 0;
  try {
    const { broadcastOpinionEvent } = await import("../npc-relations.js");
    broadcastOpinionEvent?.(db, c.worldId, p.actorUserId, "player",
      "betrayed_ally", p.location || { x: 0, z: 0 },
      { radius: 50, targetId: p.victimNpcId ?? null, context: "betrayal_gossip" });
    affected = 1; // broadcast handles per-NPC fan-out internally
  } catch (err) { return { ok: false, reason: "broadcast_failed", message: err?.message }; }
  return { ok: true, affected };
}

async function _distrust(db, p, c) {
  if (!c.worldId || !p.factionId || !p.actorUserId) return { ok: true, reason: "missing_ids" };
  let bumped = 0;
  try {
    const mates = db.prepare(`
      SELECT id FROM world_npcs WHERE world_id = ? AND faction = ? AND COALESCE(is_dead, 0) = 0 LIMIT 50
    `).all(c.worldId, p.factionId);
    const { recordOpinionEvent } = await import("../npc-opinions.js");
    for (const m of mates) {
      try {
        recordOpinionEvent?.(db, { npcId: m.id, targetKind: "user", targetId: p.actorUserId },
          -25, "betrayal_distrust");
        bumped++;
      } catch { /* ok */ }
    }
  } catch (err) { return { ok: false, reason: "query_failed", message: err?.message }; }
  return { ok: true, bumped };
}

async function _blacklist(db, p, c) {
  if (!p.factionId || !p.actorUserId) return { ok: true, reason: "missing_ids" };
  try {
    const playerKey = `player_${p.actorUserId}`;
    const [a, b] = playerKey < p.factionId ? [playerKey, p.factionId] : [p.factionId, playerKey];
    db.prepare(`
      INSERT INTO faction_relations (faction_a, faction_b, score, kind)
      VALUES (?, ?, -0.9, 'war')
      ON CONFLICT(faction_a, faction_b) DO UPDATE SET
        score = MIN(faction_relations.score, -0.9),
        kind  = 'war'
    `).run(a, b);
  } catch (err) { return { ok: false, reason: "blacklist_failed", message: err?.message }; }

  try {
    globalThis._concordRealtimeEmit?.("world:faction-blacklisted", {
      worldId: c.worldId, factionId: p.factionId, actorUserId: p.actorUserId,
    });
  } catch { /* ok */ }
  return { ok: true, factionId: p.factionId };
}
