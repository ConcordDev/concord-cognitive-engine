// server/lib/party-combat.js
//
// Phase CC1 REWORK — fluid party combat (REAL-TIME, NOT TURN-BASED).
//
// Concordia combat is always fluid. Party combat layers a
// real-time-with-pause command queue (FF7 Remake / BG3 RTwP shape).
// Mechanics:
//
//   1. Combat ticks in wall-clock ms. Each combatant has
//      `next_action_at_ms` — when their cooldown elapses, they can
//      take their next action.
//   2. Player issues an ability via `queueAction` — fires when the
//      combatant is off cooldown.
//   3. Player can drop the world `time_scale` to 0 (pause), 0.2
//      (slow-mo), or 1.0 (real-time). Combat resolutions consume
//      wall-clock time scaled by this.
//   4. `resolveTick(sessionId, nowMs)` is called by the heartbeat or
//      per-request. It walks combatants whose cooldown has elapsed,
//      fires queued actions, applies damage, checks end conditions.
//
// No initiative roll, no AP. The same `_validateDamageCap` semantics
// apply — DAMAGE_CAP_HARD = 500.

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_COOLDOWN_MS = 1200;        // base ability cooldown
const DAMAGE_CAP_HARD = 500;
const MAX_PARTY_SIZE = 4;
const VALID_ACTION_KINDS = new Set(["attack", "move", "ability", "wait"]);

function _now() { return Date.now(); }

export function startCombat(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { worldId, mode = "tactical", participants = [], profileName = "sifu_brawler", timeScale = 1.0 } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  if (!Array.isArray(participants) || participants.length < 2) {
    return { ok: false, error: "need_two_combatants" };
  }
  if (participants.length > MAX_PARTY_SIZE * 2) {
    return { ok: false, error: "too_many_combatants" };
  }
  for (const p of participants) {
    if (!p.entityId || !p.team || typeof p.hp !== "number") {
      return { ok: false, error: "invalid_participant" };
    }
  }

  try {
    const id = `pty_${crypto.randomBytes(6).toString("hex")}`;
    const now = _now();
    db.prepare(`
      INSERT INTO party_combat_sessions
        (id, world_id, mode, started_at_ms, profile_name, time_scale)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, worldId, mode, now, profileName, Math.max(0, Math.min(2.0, Number(timeScale) || 1.0)));

    for (const p of participants) {
      db.prepare(`
        INSERT INTO party_combatants
          (session_id, entity_kind, entity_id, team, hp, max_hp,
           next_action_at_ms, position_x, position_z, profile_name, joined_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, p.entityKind || "player", p.entityId, p.team,
        p.hp, p.maxHp || p.hp,
        now,
        Number(p.x) || 0, Number(p.z) || 0,
        p.profileName || profileName,
        now,
      );
    }
    logger.info?.("party-combat", "started", { sessionId: id, mode, count: participants.length });
    return { ok: true, sessionId: id, mode, timeScale: timeScale };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Set time scale (0 = paused, 0.2 = slow-mo, 1.0 = real-time, 2.0 = fast).
 * This is the RTwP control — pause to queue abilities tactically.
 */
export function setTimeScale(db, sessionId, scale) {
  if (!db || !sessionId) return { ok: false, error: "missing_inputs" };
  const s = Math.max(0, Math.min(2.0, Number(scale)));
  try {
    const sess = db.prepare(`SELECT ended_at_ms FROM party_combat_sessions WHERE id = ?`).get(sessionId);
    if (!sess) return { ok: false, error: "no_session" };
    if (sess.ended_at_ms) return { ok: false, error: "combat_ended" };
    db.prepare(`UPDATE party_combat_sessions SET time_scale = ? WHERE id = ?`).run(s, sessionId);
    return { ok: true, timeScale: s };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Queue an action for a combatant. Idempotent on (session, entity) —
 * the latest queue wins (player can swap their intent before it fires).
 */
export function queueAction(db, sessionId, actorId, action) {
  if (!db || !sessionId || !actorId || !action?.kind) return { ok: false, error: "missing_inputs" };
  if (!VALID_ACTION_KINDS.has(action.kind)) return { ok: false, error: "invalid_action" };
  try {
    const sess = db.prepare(`SELECT ended_at_ms FROM party_combat_sessions WHERE id = ?`).get(sessionId);
    if (!sess) return { ok: false, error: "no_session" };
    if (sess.ended_at_ms) return { ok: false, error: "combat_ended" };

    const combatant = db.prepare(`
      SELECT hp FROM party_combatants WHERE session_id = ? AND entity_id = ?
    `).get(sessionId, actorId);
    if (!combatant) return { ok: false, error: "no_combatant" };
    if (combatant.hp <= 0) return { ok: false, error: "combatant_down" };

    db.prepare(`
      INSERT INTO party_queued_actions
        (session_id, entity_id, action_kind, payload_json, queued_at_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, entity_id) DO UPDATE SET
        action_kind = excluded.action_kind,
        payload_json = excluded.payload_json,
        queued_at_ms = excluded.queued_at_ms
    `).run(sessionId, actorId, action.kind, JSON.stringify(action.payload || action), _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Resolve any queued actions whose combatant is off cooldown. Called by
 * the heartbeat per tick or per request. Real-time math: a combatant
 * acts when nowMs >= next_action_at_ms. Damage applies per profile.
 */
export function resolveTick(db, sessionId, nowMs = _now()) {
  if (!db || !sessionId) return { ok: false, error: "missing_inputs" };
  try {
    const sess = db.prepare(`
      SELECT mode, ended_at_ms, time_scale FROM party_combat_sessions WHERE id = ?
    `).get(sessionId);
    if (!sess) return { ok: false, error: "no_session" };
    if (sess.ended_at_ms) return { ok: true, ended: true };
    if (sess.time_scale === 0) return { ok: true, paused: true };

    // Find combatants who are off cooldown AND have a queued action.
    const ready = db.prepare(`
      SELECT c.entity_id, c.team, c.hp, c.position_x, c.position_z,
             c.profile_name, q.action_kind, q.payload_json
      FROM party_combatants c
      JOIN party_queued_actions q
        ON q.session_id = c.session_id AND q.entity_id = c.entity_id
      WHERE c.session_id = ?
        AND c.hp > 0
        AND c.next_action_at_ms <= ?
    `).all(sessionId, nowMs);

    const resolutions = [];
    for (const r of ready) {
      const payload = _safeParse(r.payload_json);
      const result = _applyAction(db, sessionId, r, payload, nowMs);
      resolutions.push(result);
    }

    // Check end condition.
    const livingTeams = new Set(db.prepare(`
      SELECT DISTINCT team FROM party_combatants WHERE session_id = ? AND hp > 0
    `).all(sessionId).map(r => r.team));
    if (livingTeams.size <= 1) {
      const winner = livingTeams.size === 1 ? [...livingTeams][0] : null;
      db.prepare(`
        UPDATE party_combat_sessions SET ended_at_ms = ?, winner_team = ?
        WHERE id = ?
      `).run(nowMs, winner, sessionId);
      return { ok: true, resolutions, ended: true, winnerTeam: winner };
    }

    return { ok: true, resolutions, ended: false };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _applyAction(db, sessionId, actor, payload, nowMs) {
  const cooldownMs = Math.max(200, Number(payload.cooldownMs) || DEFAULT_COOLDOWN_MS);

  // Clear the queued action — fired now.
  db.prepare(`
    DELETE FROM party_queued_actions WHERE session_id = ? AND entity_id = ?
  `).run(sessionId, actor.entity_id);

  let result = { actor: actor.entity_id, kind: payload.kind || "wait" };

  if (payload.kind === "attack" && payload.targetId) {
    const target = db.prepare(`
      SELECT hp, team, position_x, position_z
      FROM party_combatants WHERE session_id = ? AND entity_id = ?
    `).get(sessionId, payload.targetId);
    if (target && target.team !== actor.team && target.hp > 0) {
      const dx = (target.position_x - actor.position_x);
      const dz = (target.position_z - actor.position_z);
      const dist = Math.hypot(dx, dz);
      const range = Math.max(1, Number(payload.range) || 2);
      if (dist <= range) {
        const raw = Math.max(1, Number(payload.damage) || 10);
        const damage = Math.min(raw, DAMAGE_CAP_HARD);
        const newHp = Math.max(0, target.hp - damage);
        db.prepare(`
          UPDATE party_combatants SET hp = ? WHERE session_id = ? AND entity_id = ?
        `).run(newHp, sessionId, payload.targetId);
        _logAction(db, sessionId, actor.entity_id, "attack", payload.targetId, damage, nowMs);
        result = { ...result, target: payload.targetId, damage, newHp };
      } else {
        result = { ...result, error: "out_of_range" };
      }
    } else {
      result = { ...result, error: "no_valid_target" };
    }
  } else if (payload.kind === "move" && typeof payload.x === "number") {
    db.prepare(`
      UPDATE party_combatants SET position_x = ?, position_z = ?
      WHERE session_id = ? AND entity_id = ?
    `).run(payload.x, payload.z || actor.position_z, sessionId, actor.entity_id);
    _logAction(db, sessionId, actor.entity_id, "move", null, 0, nowMs);
    result = { ...result, x: payload.x, z: payload.z };
  } else if (payload.kind === "ability") {
    // Ability is a damage + effect. Apply to multiple targets if AoE.
    const targets = Array.isArray(payload.targetIds) ? payload.targetIds : [];
    const hits = [];
    const selTarget = db.prepare(`SELECT hp, team FROM party_combatants WHERE session_id = ? AND entity_id = ?`);
    const setTargetHp = db.prepare(`UPDATE party_combatants SET hp = ? WHERE session_id = ? AND entity_id = ?`);
    for (const tid of targets) {
      const t = selTarget.get(sessionId, tid);
      if (t && t.team !== actor.team && t.hp > 0) {
        const damage = Math.min(Math.max(1, Number(payload.damage) || 15), DAMAGE_CAP_HARD);
        const newHp = Math.max(0, t.hp - damage);
        setTargetHp.run(newHp, sessionId, tid);
        _logAction(db, sessionId, actor.entity_id, "ability", tid, damage, nowMs);
        hits.push({ targetId: tid, damage, newHp });
      }
    }
    result = { ...result, hits };
  } else {
    _logAction(db, sessionId, actor.entity_id, "wait", null, 0, nowMs);
  }

  // Set cooldown on the actor.
  db.prepare(`
    UPDATE party_combatants SET next_action_at_ms = ? WHERE session_id = ? AND entity_id = ?
  `).run(nowMs + cooldownMs, sessionId, actor.entity_id);

  return result;
}

function _logAction(db, sessionId, actorId, kind, targetId, damage, nowMs) {
  try {
    const id = `pal_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO party_action_log (id, session_id, actor_id, action_kind, target_id, damage, resolved_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, actorId, kind, targetId, damage, nowMs);
  } catch { /* best-effort */ }
}

function _safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export function getCombatState(db, sessionId) {
  if (!db || !sessionId) return null;
  try {
    const sess = db.prepare(`SELECT * FROM party_combat_sessions WHERE id = ?`).get(sessionId);
    if (!sess) return null;
    const combatants = db.prepare(`
      SELECT entity_id, entity_kind, team, hp, max_hp, next_action_at_ms,
             position_x, position_z, profile_name
      FROM party_combatants WHERE session_id = ?
    `).all(sessionId);
    const queued = db.prepare(`
      SELECT entity_id, action_kind, payload_json, queued_at_ms
      FROM party_queued_actions WHERE session_id = ?
    `).all(sessionId);
    return { ...sess, combatants, queued };
  } catch { return null; }
}

/**
 * Find the active combat session a player is in (if any). Returns the
 * first session where the player is a combatant and ended_at_ms IS NULL.
 */
export function findActiveSessionForPlayer(db, userId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT s.* FROM party_combat_sessions s
      JOIN party_combatants c ON c.session_id = s.id
      WHERE s.ended_at_ms IS NULL AND c.entity_id = ? AND c.entity_kind = 'player'
      ORDER BY s.started_at_ms DESC LIMIT 1
    `).get(userId) || null;
  } catch { return null; }
}

export function listActionLog(db, sessionId, limit = 100) {
  if (!db || !sessionId) return [];
  try {
    return db.prepare(`
      SELECT actor_id, action_kind, target_id, damage, resolved_at_ms
      FROM party_action_log WHERE session_id = ?
      ORDER BY resolved_at_ms ASC LIMIT ?
    `).all(sessionId, Math.max(1, Math.min(500, limit)));
  } catch { return []; }
}

export { DEFAULT_COOLDOWN_MS, DAMAGE_CAP_HARD, MAX_PARTY_SIZE, VALID_ACTION_KINDS };
