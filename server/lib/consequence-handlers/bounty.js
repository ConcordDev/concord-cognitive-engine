// server/lib/consequence-handlers/bounty.js
//
// Wave C / C1 — fires the bounty_posted step of the mass_atrocity
// cascade. Creates a kill-quest carried by hostile-faction NPCs near
// the victim's last location.
//
// On minimal builds without the quest table, falls through gracefully.

import crypto from "crypto";

const BOUNTY_REWARD_BASE = 500;

export default async function handleBounty(db, consequence) {
  if (!db || !consequence) return { ok: false, reason: "missing_args" };
  const p = consequence.payload || {};
  const worldId = consequence.worldId;
  if (!worldId || !p.actorUserId) return { ok: true, reason: "missing_ids" };

  // Find a hostile-faction NPC near the kill location to carry the bounty.
  let bountyGiverId = null;
  try {
    const candidate = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ?
        AND COALESCE(is_dead, 0) = 0
        AND archetype IN ('guard', 'bounty_hunter', 'sheriff', 'magistrate', 'enforcer')
      ORDER BY RANDOM() LIMIT 1
    `).get(worldId);
    bountyGiverId = candidate?.id || null;
  } catch { /* ok */ }

  // Spawn the kill-quest in the existing world_quests table.
  let questId = null;
  try {
    questId = `q_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO world_quests
        (id, world_id, giver_npc_id, title, description, status, reward, created_at)
      VALUES (?, ?, ?, ?, ?, 'available', ?, unixepoch())
    `).run(
      questId, worldId, bountyGiverId,
      `Bounty: ${p.meta?.name || p.actorUserId}`,
      `An atrocity was committed at (${Math.round(p.location?.x ?? 0)}, ${Math.round(p.location?.z ?? 0)}). The murderer ${p.meta?.name || 'an unknown party'} must answer for it. Bring them to justice — alive or dead.`,
      JSON.stringify({
        type: "kill_player",
        target_user_id: p.actorUserId,
        sparks: BOUNTY_REWARD_BASE,
      }),
    );
  } catch { questId = null; /* world_quests optional */ }

  try {
    globalThis._concordRealtimeEmit?.("world:bounty-posted", {
      worldId, questId, giverId: bountyGiverId, targetUserId: p.actorUserId,
      sparksReward: BOUNTY_REWARD_BASE,
    });
  } catch { /* ok */ }

  return { ok: true, questId, bountyGiverId };
}
