// server/lib/quests/quest-report.js
//
// Client-reported quest progress for the objective types the server cannot
// observe itself. Owner decision 2026-10-26: the client says "I reached X /
// interacted with Y / observed Z"; the server accepts it only for a quest the
// player has accepted, an objective that quest really has, in the player's
// current world, one unit per report, rate-limited. A modified client can fake
// these objectives and so claim that quest's rewards, and nothing more.
//
// `deliver` is not taken on trust: the player must hold the target item, and
// one is consumed per unit delivered.
//
// Types the server already records from its own actions (kill/defeat, gather,
// talk_to) are refused here so a client cannot skip them.

import { recordObjectiveProgress, getQuestProgress } from "./quest-engine.js";

export const CLIENT_REPORTED_TYPES = Object.freeze(new Set(["reach_location", "interact", "observe"]));
export const REPORT_COOLDOWN_MS = 1500;

const _lastReport = new Map(); // `${userId}|${questId}|${type}|${target}` → ms

export function resetQuestReportForTest() { _lastReport.clear(); }

/**
 * @param {object} db
 * @param {{ userId:string, worldId:string, questId:string, type:string, target:string,
 *           liveWorldId?:string|null, now?:number }} r
 * @returns {{ ok:boolean, error?:string, questId?:string, type?:string, target?:string,
 *             current?:number, required?:number, objectiveComplete?:boolean, questComplete?:boolean, already?:boolean }}
 */
export function reportObjective(db, { userId, worldId, questId, type, target, liveWorldId = null, now = Date.now() } = {}) {
  if (!db || !userId) return { ok: false, error: "not_authenticated" };
  type = String(type || "").trim().toLowerCase();
  target = String(target || "").trim();
  if (!worldId || !questId || !type || !target) return { ok: false, error: "worldId_questId_type_target_required" };
  if (!CLIENT_REPORTED_TYPES.has(type) && type !== "deliver") return { ok: false, error: "type_recorded_by_server", type };
  if (liveWorldId && String(liveWorldId) !== String(worldId)) return { ok: false, error: "not_in_quest_world", worldId, liveWorldId };

  const pq = db.prepare(
    "SELECT status FROM player_quests WHERE user_id = ? AND world_id = ? AND quest_id = ?",
  ).get(userId, worldId, questId);
  if (!pq || (pq.status && pq.status !== "active")) return { ok: false, error: "quest_not_active", questId };

  const obj = db.prepare(
    "SELECT id, required_count FROM quest_objectives WHERE quest_id = ? AND type = ? AND target = ?",
  ).get(questId, type, target);
  if (!obj) return { ok: false, error: "objective_not_found", questId, type, target };

  const before = progressFor(db, userId, worldId, questId, obj.id);
  if (before.completed) return { ok: true, already: true, ...summary(db, userId, worldId, questId, type, target, obj) };

  const key = `${userId}|${questId}|${type}|${target}`;
  if (now - (_lastReport.get(key) || 0) < REPORT_COOLDOWN_MS) return { ok: false, error: "rate_limited", questId };
  _lastReport.set(key, now);
  if (_lastReport.size > 20000) _lastReport.delete(_lastReport.keys().next().value);

  if (type === "deliver") {
    const delivered = db.transaction(() => {
      const held = db.prepare("SELECT quantity FROM player_inventory WHERE user_id = ? AND item_id = ?").get(userId, target);
      if (!held || !(held.quantity > 0)) return false;
      if (held.quantity > 1) {
        db.prepare("UPDATE player_inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?").run(userId, target);
      } else {
        db.prepare("DELETE FROM player_inventory WHERE user_id = ? AND item_id = ?").run(userId, target);
      }
      recordObjectiveProgress(db, userId, worldId, questId, type, target, 1);
      return true;
    })();
    if (!delivered) return { ok: false, error: "item_not_held", questId, target };
  } else {
    recordObjectiveProgress(db, userId, worldId, questId, type, target, 1);
  }
  return { ok: true, ...summary(db, userId, worldId, questId, type, target, obj) };
}

function progressFor(db, userId, worldId, questId, objectiveId) {
  const row = db.prepare(
    "SELECT current_count, completed_at FROM player_quest_progress WHERE user_id = ? AND world_id = ? AND quest_id = ? AND objective_id = ?",
  ).get(userId, worldId, questId, objectiveId);
  return { current: row?.current_count ?? 0, completed: !!row?.completed_at };
}

function summary(db, userId, worldId, questId, type, target, obj) {
  const p = progressFor(db, userId, worldId, questId, obj.id);
  const status = db.prepare(
    "SELECT status FROM player_quests WHERE user_id = ? AND world_id = ? AND quest_id = ?",
  ).get(userId, worldId, questId)?.status;
  return {
    questId, type, target,
    current: p.current,
    required: obj.required_count,
    objectiveComplete: p.completed,
    questComplete: status === "completed" || status === "rewarded",
    objectives: getQuestProgress(db, userId, worldId, questId).map((o) => ({
      type: o.type, target: o.target, current: o.current_count, required: o.required_count, done: !!o.obj_completed_at,
    })),
  };
}

export default { reportObjective, CLIENT_REPORTED_TYPES, REPORT_COOLDOWN_MS, resetQuestReportForTest };
