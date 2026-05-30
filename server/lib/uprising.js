// server/lib/uprising.js
//
// Living Society — Phase 6: a movement at threshold ERUPTS, and reaching a
// player becomes an emergent quest.
//
// When tickMovement flips a movement to `acting`, eruptUprising fires the
// uprising as a faction-strategy move (the authority now faces a rebellion =
// the engine's `war` stance, targeted at the movement) + a world event the
// feed/Chronicle reads. The ruler responds to symptoms, not a bar.
//
// spawnMovementRecruitmentQuest plants the rebellion quest when a recruitment
// courier reaches a player. All idempotent; never throws.

import crypto from "node:crypto";
import { recruit } from "./movements.js";

/**
 * A recruitment courier reaches a PLAYER: enlist them (cross-tier/cross-world)
 * AND plant the rebellion quest. This is the movement→player handoff.
 */
export function recruitPlayer(db, movementId, playerId, { playerWorldId = null, role = "soldier" } = {}) {
  const r = recruit(db, movementId, "player", playerId, { role, candidateWorldId: playerWorldId });
  if (!r.ok) return r;
  const quest = spawnMovementRecruitmentQuest(db, movementId, playerId);
  return { ok: true, members: r.members, visibility: r.visibility, quest };
}

/**
 * Erupt a movement into a rebellion. Idempotent on movement_id.
 * @returns { ok, alreadyErupted?, strategyLogId, worldEventId? }
 */
export function eruptUprising(db, movement) {
  if (!db || !movement?.id || !movement.world_id) return { ok: false, reason: "missing_inputs" };
  // Already erupted?
  try {
    const existing = db.prepare(`SELECT movement_id FROM movement_uprisings WHERE movement_id = ?`).get(movement.id);
    if (existing) return { ok: true, alreadyErupted: true };
  } catch { /* table absent → continue best-effort */ }

  const memberCount = (() => {
    try { return db.prepare(`SELECT COUNT(*) AS n FROM movement_members WHERE movement_id = ? AND left_at IS NULL`).get(movement.id)?.n ?? 0; }
    catch { return 0; }
  })();

  // 1. Faction-strategy move: the authority faces a rebellion. We record a
  //    DECLARE_REBELLION move in the (free-form `move`) strategy log and, when
  //    the target is a faction in the strategy engine, flip its stance to 'war'
  //    against the movement (the engine has no separate 'rebellion' stance; a
  //    rebellion IS war against the authority).
  const strategyLogId = `fsl_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO faction_strategy_log (id, faction_id, move, target_id, summary, payload_json, occurred_at)
      VALUES (?, ?, 'DECLARE_REBELLION', ?, ?, ?, unixepoch())
    `).run(
      strategyLogId,
      String(movement.target_id),
      movement.id,
      `An uprising of ${memberCount} erupts against ${movement.target_id}.`,
      JSON.stringify({ movement_id: movement.id, members: memberCount, grievance: movement.grievance_severity || 0 }),
    );
  } catch { /* faction_strategy_log absent on minimal builds */ }

  // If the authority is a faction with a strategy state, set it to war vs the movement.
  if (movement.target_kind === "faction") {
    try {
      db.prepare(`UPDATE faction_strategy_state SET stance = 'war', target_id = ?, updated_at = unixepoch() WHERE faction_id = ?`)
        .run(movement.id, movement.target_id);
    } catch { /* state row may not exist */ }
  }

  // 2. World event for the feed + Chronicle (best-effort; schema varies).
  let worldEventId = null;
  try {
    worldEventId = `evt_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO world_events (id, world_id, event_type, title, description, created_at)
      VALUES (?, ?, 'uprising', ?, ?, unixepoch())
    `).run(worldEventId, movement.world_id, `Uprising against ${movement.target_id}`,
      `${memberCount} have taken up the cause. The grievance has become a movement.`);
  } catch { worldEventId = null; /* world_events shape differs — skip */ }

  // 3. Record the uprising linkage (idempotent).
  try {
    db.prepare(`
      INSERT INTO movement_uprisings (movement_id, world_id, target_kind, target_id, member_count, strategy_log_id, world_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(movement_id) DO NOTHING
    `).run(movement.id, movement.world_id, movement.target_kind, movement.target_id, memberCount, strategyLogId, worldEventId);
  } catch { /* table absent */ }

  return { ok: true, strategyLogId, worldEventId, members: memberCount };
}

/**
 * Plant an emergent rebellion quest when a recruitment courier reaches a player.
 * Idempotent on (movement, player). Returns the quest linkage row.
 */
export function spawnMovementRecruitmentQuest(db, movementId, playerId) {
  if (!db || !movementId || !playerId) return { ok: false, reason: "missing_inputs" };
  let movement = null;
  try { movement = db.prepare(`SELECT * FROM movements WHERE id = ?`).get(movementId); } catch { movement = null; }
  if (!movement) return { ok: false, reason: "no_movement" };

  // Already offered?
  try {
    const existing = db.prepare(`SELECT id, quest_id FROM movement_quests WHERE movement_id = ? AND player_id = ?`).get(movementId, playerId);
    if (existing) return { ok: true, alreadyOffered: true, questId: existing.quest_id };
  } catch { /* table absent → continue */ }

  const id = `mq_${crypto.randomUUID()}`;
  const questId = `quest_uprising_${movementId.slice(-8)}_${String(playerId).slice(-6)}`;
  try {
    db.prepare(`
      INSERT INTO movement_quests (id, movement_id, world_id, player_id, quest_id, target_kind, target_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'offered')
    `).run(id, movementId, movement.world_id, playerId, questId, movement.target_kind, movement.target_id);
  } catch (e) { return { ok: false, reason: "insert_failed", error: e?.message }; }
  return { ok: true, id, questId, targetId: movement.target_id };
}

export function listPlayerMovementQuests(db, playerId, status = null) {
  try {
    return status
      ? db.prepare(`SELECT * FROM movement_quests WHERE player_id = ? AND status = ? ORDER BY created_at DESC`).all(playerId, status)
      : db.prepare(`SELECT * FROM movement_quests WHERE player_id = ? ORDER BY created_at DESC`).all(playerId);
  } catch { return []; }
}

/**
 * Active uprisings in a world, each LOCATED at the centroid of its NPC members'
 * live positions — because a crowd is where its people actually stand, not at an
 * abstract target. Returns `[{ movementId, targetKind, targetId, memberCount,
 * x, z, grievance }]`; rows whose members have no resolvable position are
 * returned with `x/z = null` so the client can skip rendering them (no fake
 * crowds). Never throws — minimal builds without the tables get `[]`.
 *
 * WS2.7: the render surface for the Living Society uprising keystone.
 */
export function listActiveUprisingsWithLocation(db, worldId) {
  if (!db || !worldId) return [];
  let rows;
  try {
    rows = db.prepare(`
      SELECT u.movement_id, u.target_kind, u.target_id, u.member_count,
             m.grievance_severity AS grievance
        FROM movement_uprisings u
        JOIN movements m ON m.id = u.movement_id
       WHERE u.world_id = ? AND m.status = 'acting'
    `).all(worldId);
  } catch { return []; }
  if (!Array.isArray(rows) || rows.length === 0) return [];

  function parseXZ(raw) {
    if (raw == null) return null;
    try {
      const o = typeof raw === "string" ? JSON.parse(raw) : raw;
      const x = Number(o?.x);
      const z = Number(o?.z);
      if (Number.isFinite(x) && Number.isFinite(z)) return { x, z };
    } catch { /* not JSON */ }
    return null;
  }

  return rows.map((r) => {
    let x = null;
    let z = null;
    try {
      const members = db.prepare(`
        SELECT n.current_location
          FROM movement_members mm
          JOIN world_npcs n ON n.id = mm.member_id
         WHERE mm.movement_id = ? AND mm.member_kind = 'npc' AND mm.left_at IS NULL
      `).all(r.movement_id);
      let sx = 0, sz = 0, n = 0;
      for (const mem of members) {
        const p = parseXZ(mem.current_location);
        if (p) { sx += p.x; sz += p.z; n += 1; }
      }
      if (n > 0) { x = sx / n; z = sz / n; }
    } catch { /* world_npcs absent / no members → null position */ }
    return {
      movementId: r.movement_id,
      targetKind: r.target_kind,
      targetId: r.target_id,
      memberCount: Number(r.member_count) || 0,
      grievance: Number(r.grievance) || 0,
      x,
      z,
    };
  });
}
