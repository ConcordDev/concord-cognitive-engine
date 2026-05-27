// server/lib/consequence-handlers/royal-kill.js
//
// Wave C / C1 — handles the royal_kill cascade chain.
//
// Three steps:
//   royal_kill_radicalize — nearby faction NPCs get a 'personal_loss'
//     preoccupation + opinion delta -20 against the killer
//   royal_kill_form_cult  — synthesises a new faction-relation row
//     ("avengers") + recruits the most-radicalised NPCs as members
//   royal_kill_attack     — spawns a war_campaigns row targeting the
//     player's nearest land claim (or the player if no claim) and
//     emits world:army-march so the player gets a warning
//
// Each step is exception-safe and falls through when its supporting
// tables are absent on minimal builds.

import crypto from "crypto";

export default async function handleRoyalKill(db, consequence) {
  if (!db || !consequence) return { ok: false, reason: "missing_args" };
  const kind = consequence.kind;
  const p = consequence.payload || {};
  switch (kind) {
    case "royal_kill_radicalize": return await _radicalize(db, p, consequence);
    case "royal_kill_form_cult":  return await _formCult(db, p, consequence);
    case "royal_kill_attack":     return await _attack(db, p, consequence);
    default: return { ok: false, reason: "unknown_step", kind };
  }
}

async function _radicalize(db, p, c) {
  if (!p.factionId) return { ok: true, reason: "no_faction" };
  const worldId = c.worldId;
  const actorUserId = p.actorUserId;
  let radicalisedCount = 0;
  try {
    const matesQ = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ? AND faction = ? AND COALESCE(is_dead, 0) = 0
      LIMIT 20
    `);
    const mates = matesQ.all(worldId, p.factionId);

    for (const mate of mates) {
      // Bump opinion against the killer.
      try {
        const { recordOpinionEvent } = await import("../npc-opinions.js");
        recordOpinionEvent?.(db, { npcId: mate.id, targetKind: "user", targetId: actorUserId },
          -20, "royal_killer");
      } catch { /* ok */ }
      // Set preoccupation to personal_loss.
      try {
        db.prepare(`
          INSERT INTO npc_preoccupations (id, npc_id, kind, target_kind, target_id, severity, expires_at)
          VALUES (?, ?, 'personal_loss', 'user', ?, 0.9, unixepoch() + ?)
        `).run(crypto.randomUUID(), mate.id, actorUserId, 30 * 86400);
      } catch { /* preoccupations table optional */ }
      radicalisedCount++;
    }
  } catch (err) {
    return { ok: false, reason: "query_failed", message: err?.message };
  }
  // Realtime so any "While You Were Away" panel logs it.
  try {
    globalThis._concordRealtimeEmit?.("world:cult-radicalisation", {
      worldId, factionId: p.factionId, radicalised: radicalisedCount,
      victim: p.victimNpcId, actorUserId,
    });
  } catch { /* ok */ }
  return { ok: true, radicalised: radicalisedCount };
}

async function _formCult(db, p, c) {
  const worldId = c.worldId;
  if (!worldId) return { ok: true, reason: "no_world" };

  // Synthesize a cult faction id derived from the original faction.
  const cultId = `cult_${(p.factionId || "rogue").slice(0, 12)}_${crypto.randomBytes(3).toString("hex")}`;
  let memberCount = 0;
  try {
    // Recruit the top-3 most-radicalised NPCs from that faction.
    const recruits = db.prepare(`
      SELECT n.id FROM world_npcs n
      LEFT JOIN npc_preoccupations p ON p.npc_id = n.id
      WHERE n.world_id = ? AND n.faction = ?
        AND COALESCE(n.is_dead, 0) = 0
        AND p.kind = 'personal_loss'
      ORDER BY p.severity DESC LIMIT 3
    `).all(worldId, p.factionId);

    for (const r of recruits) {
      try {
        db.prepare(`UPDATE world_npcs SET faction = ? WHERE id = ?`).run(cultId, r.id);
        memberCount++;
      } catch { /* ok */ }
    }

    // Try to register the new faction-relation row so it's visible to
    // faction-strategy. The faction_relations PK is (a, b) with
    // a < b CHECK constraint per CLAUDE.md.
    try {
      const player = p.actorUserId;
      const [a, b] = cultId < `player_${player}` ? [cultId, `player_${player}`] : [`player_${player}`, cultId];
      db.prepare(`
        INSERT OR IGNORE INTO faction_relations (faction_a, faction_b, score, kind)
        VALUES (?, ?, -1.0, 'war')
      `).run(a, b);
    } catch { /* faction_relations optional */ }
  } catch (err) {
    return { ok: false, reason: "query_failed", message: err?.message };
  }

  try {
    globalThis._concordRealtimeEmit?.("world:cult-formed", {
      worldId, cultId, memberCount,
      victim: p.victimNpcId, actorUserId: p.actorUserId,
    });
  } catch { /* ok */ }

  return { ok: true, cultId, memberCount };
}

async function _attack(db, p, c) {
  const worldId = c.worldId;
  const actorUserId = p.actorUserId;
  if (!worldId || !actorUserId) return { ok: true, reason: "missing_target" };

  // Find the cult faction id. The form_cult step wrote a faction_relations
  // row of kind 'war' between cult_* and player_<id>. Look that up.
  let cultId = null;
  try {
    const playerKey = `player_${actorUserId}`;
    const row = db.prepare(`
      SELECT faction_a, faction_b FROM faction_relations
      WHERE kind = 'war' AND (faction_a = ? OR faction_b = ?)
      ORDER BY rowid DESC LIMIT 1
    `).get(playerKey, playerKey);
    if (row) {
      cultId = row.faction_a === playerKey ? row.faction_b : row.faction_a;
    }
  } catch { /* relations optional */ }
  if (!cultId) cultId = `cult_${crypto.randomBytes(3).toString("hex")}`;

  // Find player's nearest land claim as the target. Else aim at the
  // last-known player position.
  let target = null;
  try {
    const claim = db.prepare(`
      SELECT id, anchor_x, anchor_z FROM land_claims
      WHERE owner_user_id = ? AND status = 'active'
      ORDER BY rowid DESC LIMIT 1
    `).get(actorUserId);
    if (claim) target = { kind: "claim", id: claim.id, x: claim.anchor_x, z: claim.anchor_z };
  } catch { /* land_claims optional */ }
  if (!target) target = { kind: "player", id: actorUserId, x: p.location?.x ?? 0, z: p.location?.z ?? 0 };

  // Spawn a war_campaigns row. The war-skirmish-cycle heartbeat will
  // advance it. The march itself is visible via world:army-march
  // (Wave 5) which the heartbeat emits per advance.
  let campaignId = null;
  try {
    campaignId = `wc_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO war_campaigns (id, world_id, aggressor_id, defender_id, state,
        attacker_troops, defender_troops, next_skirmish_at, created_at)
      VALUES (?, ?, ?, ?, 'marching', 8, 3, unixepoch() + 60, unixepoch())
    `).run(campaignId, worldId, cultId, target.id);
  } catch { /* war_campaigns optional */ }

  // Warning emit so the player sees it coming.
  try {
    globalThis._concordRealtimeEmit?.("world:cult-attack", {
      worldId, cultId, target, campaignId,
      actorUserId, victim: p.victimNpcId,
    });
  } catch { /* ok */ }

  return { ok: true, cultId, campaignId, target };
}
