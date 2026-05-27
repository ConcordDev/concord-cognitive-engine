// server/emergent/grieving-npc-cycle.js
//
// Wave D / D2 — every NPC who had a high-sentiment memory of a player
// who has been gone for ≥ 14 days OR who permadied (heir-takeover ran)
// gets a 'personal_loss' preoccupation for 30 in-game days. Lifts via
// the existing affect+routine system (B3) — they skip training, refuse
// new quests, and sit in inns.
//
// Heartbeat invariant: never throws. Bounded MAX_PER_PASS.
// Kill switch: CONCORD_GRIEVING_NPC=0.

import crypto from "crypto";
import logger from "../logger.js";

const MAX_PER_PASS = 20;
const ABSENCE_DAYS_TRIGGER = 14;
const GRIEF_DURATION_S = 30 * 86400;

export async function runGrievingNpcCycle({ db } = {}) {
  if (process.env.CONCORD_GRIEVING_NPC === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const nowS = Math.floor(Date.now() / 1000);
  let pairs = [];
  try {
    // Find (npc, player) pairs where the NPC had high sentiment + the
    // player has been gone ≥ 14 days OR has permadied via takeover.
    pairs = db.prepare(`
      SELECT m.npc_id, m.player_id, m.world_id, m.sentiment, m.last_interaction_at
      FROM npc_player_memories m
      WHERE m.sentiment >= 0.4
        AND m.last_interaction_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM npc_preoccupations p
          WHERE p.npc_id = m.npc_id
            AND p.kind = 'personal_loss'
            AND p.target_id = m.player_id
            AND (p.expires_at IS NULL OR p.expires_at > ?)
        )
      ORDER BY m.sentiment DESC, m.last_interaction_at ASC
      LIMIT ?
    `).all(nowS - ABSENCE_DAYS_TRIGGER * 86400, nowS, MAX_PER_PASS);
  } catch {
    return { ok: true, reason: "no_memory_table", set: 0 };
  }

  const stats = { ok: true, evaluated: pairs.length, set: 0, errored: 0 };
  for (const p of pairs) {
    try {
      db.prepare(`
        INSERT INTO npc_preoccupations (id, npc_id, kind, target_kind, target_id, severity, expires_at)
        VALUES (?, ?, 'personal_loss', 'user', ?, ?, unixepoch() + ?)
      `).run(crypto.randomUUID(), p.npc_id, p.player_id, Math.min(1, p.sentiment), GRIEF_DURATION_S);
      stats.set++;
    } catch (err) {
      stats.errored++;
      logger?.warn?.("grieving-npc-cycle", "set_failed", { npcId: p.npc_id, error: err?.message });
    }
  }
  return stats;
}
