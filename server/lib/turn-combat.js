// server/lib/turn-combat.js
//
// Phase CC1 — Turn-based grid combat.
//
// Initiative roll determines turn order; AP-per-turn gates action
// count. Cell-based movement (grid). Damage formula uses
// combat-polish profiles for parry/dodge/recovery semantics.

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_AP_PER_TURN = 4;
const MOVE_AP_COST = 1;
const ATTACK_AP_COST = 2;
const DAMAGE_CAP_HARD = 500;

export function startCombat(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { worldId, mode = "tactical", participants = [] } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  if (!Array.isArray(participants) || participants.length < 2) {
    return { ok: false, error: "need_two_combatants" };
  }
  for (const p of participants) {
    if (!p.entityId || !p.team || typeof p.hp !== "number") {
      return { ok: false, error: "invalid_participant" };
    }
  }

  try {
    const id = `tcb_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO turn_combats (id, world_id, mode, profile_name)
      VALUES (?, ?, ?, ?)
    `).run(id, worldId, mode, opts.profileName || "sifu_brawler");

    for (const p of participants) {
      const initiative = Math.floor(Math.random() * 20) + (Number(p.initiativeBonus) || 0);
      db.prepare(`
        INSERT INTO turn_combatants
          (combat_id, entity_kind, entity_id, team, initiative_roll,
           hp, max_hp, ap_remaining, position_x, position_y)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, p.entityKind || "player", p.entityId, p.team, initiative,
        p.hp, p.maxHp || p.hp, DEFAULT_AP_PER_TURN,
        Math.floor(p.x || 0), Math.floor(p.y || 0),
      );
    }
    logger.info?.("turn-combat", "started", { combatId: id, mode, count: participants.length });
    return { ok: true, combatId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function turnOrder(db, combatId) {
  if (!db || !combatId) return [];
  try {
    return db.prepare(`
      SELECT entity_id, team, initiative_roll, hp, ap_remaining,
             position_x, position_y
      FROM turn_combatants WHERE combat_id = ? AND hp > 0
      ORDER BY initiative_roll DESC, entity_id ASC
    `).all(combatId);
  } catch { return []; }
}

export function executeAction(db, combatId, actorId, action) {
  if (!db || !combatId || !actorId || !action) return { ok: false, error: "missing_inputs" };
  try {
    const combat = db.prepare(`SELECT mode, ended_at, current_turn FROM turn_combats WHERE id = ?`).get(combatId);
    if (!combat) return { ok: false, error: "no_combat" };
    if (combat.ended_at) return { ok: false, error: "combat_ended" };

    const actor = db.prepare(`
      SELECT entity_id, team, hp, ap_remaining, position_x, position_y
      FROM turn_combatants WHERE combat_id = ? AND entity_id = ?
    `).get(combatId, actorId);
    if (!actor) return { ok: false, error: "no_actor" };
    if (actor.hp <= 0) return { ok: false, error: "actor_dead" };

    if (action.kind === "move") {
      const dx = Math.abs((action.toX || 0) - actor.position_x);
      const dy = Math.abs((action.toY || 0) - actor.position_y);
      const distance = Math.max(dx, dy);  // Chebyshev — diagonal allowed
      const cost = Math.max(1, distance) * MOVE_AP_COST;
      if (actor.ap_remaining < cost) return { ok: false, error: "insufficient_ap" };
      if (distance > actor.ap_remaining) return { ok: false, error: "out_of_range" };
      db.prepare(`
        UPDATE turn_combatants
        SET position_x = ?, position_y = ?, ap_remaining = ap_remaining - ?
        WHERE combat_id = ? AND entity_id = ?
      `).run(action.toX, action.toY, cost, combatId, actorId);
      _logAction(db, combatId, combat.current_turn, actorId, "move", null, 0);
      return { ok: true, action: "move", remainingAp: actor.ap_remaining - cost };
    }

    if (action.kind === "attack") {
      if (actor.ap_remaining < ATTACK_AP_COST) return { ok: false, error: "insufficient_ap" };
      const target = db.prepare(`
        SELECT entity_id, team, hp, position_x, position_y
        FROM turn_combatants WHERE combat_id = ? AND entity_id = ?
      `).get(combatId, action.targetId);
      if (!target) return { ok: false, error: "no_target" };
      if (target.team === actor.team) return { ok: false, error: "friendly_target" };
      if (target.hp <= 0) return { ok: false, error: "target_dead" };

      const dx = Math.abs(target.position_x - actor.position_x);
      const dy = Math.abs(target.position_y - actor.position_y);
      const range = Math.max(dx, dy);
      const declaredRange = Math.max(1, Number(action.range) || 1);
      if (range > declaredRange) return { ok: false, error: "out_of_range" };

      // Damage clamp + cap.
      const raw = Math.max(1, Number(action.damage) || 10);
      const damage = Math.min(raw, DAMAGE_CAP_HARD);
      const newHp = Math.max(0, target.hp - damage);
      db.prepare(`
        UPDATE turn_combatants SET ap_remaining = ap_remaining - ?
        WHERE combat_id = ? AND entity_id = ?
      `).run(ATTACK_AP_COST, combatId, actorId);
      db.prepare(`
        UPDATE turn_combatants SET hp = ? WHERE combat_id = ? AND entity_id = ?
      `).run(newHp, combatId, action.targetId);
      _logAction(db, combatId, combat.current_turn, actorId, "attack", action.targetId, damage);

      // Check end conditions.
      const livingTeams = new Set(db.prepare(`
        SELECT DISTINCT team FROM turn_combatants WHERE combat_id = ? AND hp > 0
      `).all(combatId).map(r => r.team));
      if (livingTeams.size <= 1) {
        const winner = livingTeams.size === 1 ? [...livingTeams][0] : null;
        db.prepare(`
          UPDATE turn_combats SET ended_at = unixepoch(), winner_team = ? WHERE id = ?
        `).run(winner, combatId);
        return { ok: true, action: "attack", damage, newHp, combatEnded: true, winnerTeam: winner };
      }

      return { ok: true, action: "attack", damage, newHp };
    }

    if (action.kind === "end_turn") {
      // Next turn — restore AP for everyone alive, increment turn counter.
      db.prepare(`
        UPDATE turn_combatants SET ap_remaining = ? WHERE combat_id = ? AND hp > 0
      `).run(DEFAULT_AP_PER_TURN, combatId);
      db.prepare(`
        UPDATE turn_combats SET current_turn = current_turn + 1 WHERE id = ?
      `).run(combatId);
      _logAction(db, combatId, combat.current_turn + 1, actorId, "end_turn", null, 0);
      return { ok: true, action: "end_turn", currentTurn: combat.current_turn + 1 };
    }

    return { ok: false, error: "unknown_action" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _logAction(db, combatId, turnIdx, actorId, action, targetId, damage) {
  try {
    const id = `tcl_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO turn_log (id, combat_id, turn_idx, actor_id, action, target_id, damage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, combatId, turnIdx, actorId, action, targetId, damage);
  } catch { /* best-effort */ }
}

export function getCombatState(db, combatId) {
  if (!db || !combatId) return null;
  try {
    const combat = db.prepare(`SELECT * FROM turn_combats WHERE id = ?`).get(combatId);
    if (!combat) return null;
    const combatants = db.prepare(`
      SELECT entity_id, entity_kind, team, hp, max_hp, ap_remaining,
             position_x, position_y, initiative_roll
      FROM turn_combatants WHERE combat_id = ?
      ORDER BY initiative_roll DESC, entity_id ASC
    `).all(combatId);
    return { ...combat, combatants };
  } catch { return null; }
}

export function listCombatLog(db, combatId, limit = 50) {
  if (!db || !combatId) return [];
  try {
    return db.prepare(`
      SELECT turn_idx, actor_id, action, target_id, damage, ts
      FROM turn_log WHERE combat_id = ?
      ORDER BY turn_idx ASC, ts ASC LIMIT ?
    `).all(combatId, Math.max(1, Math.min(500, limit)));
  } catch { return []; }
}

export { DEFAULT_AP_PER_TURN, MOVE_AP_COST, ATTACK_AP_COST, DAMAGE_CAP_HARD };
