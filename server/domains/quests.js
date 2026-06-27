// server/domains/quests.js
//
// Macro surface for the quest state machine. Thin delegations to the real
// engine in server/lib/quests/quest-engine.js — NO duplicated logic. These
// expose the read/compute/lifecycle paths the /lenses/quests lens (and the
// world lens HUD) need:
//
//   accept → active → record objective progress → completion → claim reward
//
// All macros are pure delegations; the engine owns the SQL + the
// "rewards claimed exactly once" invariant (player_quests.rewarded_at gate).

import {
  getActiveQuests,
  getQuestProgress,
  recordObjectiveProgress,
  checkQuestCompletion,
  claimQuestRewards,
  addQuestObjectives,
  addQuestRewards,
} from "../lib/quests/quest-engine.js";

const DEFAULT_WORLD = "concordia-hub";

function ctxUser(ctx, input) {
  return input.userId || ctx?.actor?.userId || ctx?.actor?.id || null;
}
function ctxWorld(ctx, input) {
  return input.worldId || ctx?.worldId || ctx?.actor?.worldId || DEFAULT_WORLD;
}

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before any DB
// write — a fail-OPEN that lets a poisoned `count` clamp through to ok:true is
// the defect. An absent field is fine (defaults to 1). Returns null when clean,
// or the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

export default function registerQuestsMacros(register) {
  /**
   * quests.active — list a player's active quests (objectives + rewards merged).
   * input: { userId?, worldId? }  → { ok, quests }
   */
  register("quests", "active", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctxUser(ctx, input);
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = ctxWorld(ctx, input);
    const quests = getActiveQuests(db, userId, worldId);
    return { ok: true, quests };
  }, { note: "list a player's active quests with objectives + rewards" });

  /**
   * quests.mine — lens-shaped active-quest list. Reshapes engine rows into the
   * { id, title, description, status, objectives[{title,progress,target,complete}],
   *   reward } shape /lenses/quests renders, so the lens is one call.
   * input: { userId?, worldId? }  → { ok, quests }
   */
  register("quests", "mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctxUser(ctx, input);
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = ctxWorld(ctx, input);

    const rows = getActiveQuests(db, userId, worldId);
    const quests = rows.map((q) => {
      const progress = getQuestProgress(db, userId, worldId, q.id);
      const byObjId = new Map(progress.map((p) => [p.id, p]));
      const objectives = (q.objectives || []).map((o) => {
        const p = byObjId.get(o.id) || {};
        const cur = Number(p.current_count || 0);
        const target = Number(o.required_count || 1);
        return {
          id: o.id,
          title: o.description || `${o.type} ${o.target}`,
          description: o.description || undefined,
          progress: cur,
          target,
          complete: !!p.obj_completed_at || cur >= target,
        };
      });
      let reward = {};
      try {
        if (q.reward_json) reward = JSON.parse(q.reward_json);
      } catch { reward = {}; }
      if ((q.rewards || []).length) {
        // Prefer the structured quest_rewards rows when present.
        const cc = q.rewards
          .filter((r) => r.reward_type === "gold" || r.reward_type === "xp")
          .reduce((s, r) => s + Number(r.amount || 0), 0);
        if (cc > 0) reward.cc = cc;
        const titleRow = q.rewards.find((r) => r.reward_type === "skill_unlock" && r.reward_key);
        if (titleRow) reward.title = reward.title || titleRow.reward_key;
      }
      return {
        id: q.id,
        title: q.title || q.id,
        description: q.description || undefined,
        status: q.status || "active",
        objectives,
        reward,
      };
    });
    return { ok: true, quests };
  }, { note: "lens-shaped active quest list for /lenses/quests" });

  /**
   * quests.progress — objective rows for a quest with merged player progress.
   * input: { questId, userId?, worldId? }  → { ok, objectives }
   */
  register("quests", "progress", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctxUser(ctx, input);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.questId) return { ok: false, reason: "no_quest_id" };
    const worldId = ctxWorld(ctx, input);
    return { ok: true, objectives: getQuestProgress(db, userId, worldId, input.questId) };
  }, { note: "objective progress for one quest" });

  /**
   * quests.recordProgress — add progress toward matching objectives. Monotonic
   * + capped at required_count by the engine; auto-completes the quest when the
   * last objective lands.
   * input: { type, target, questId?, count?, userId?, worldId? }  → { ok }
   */
  register("quests", "recordProgress", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctxUser(ctx, input);
    if (!userId) return { ok: false, reason: "no_user" };
    const badNum = badNumericField(input, ["count"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    if (!input.type || !input.target) return { ok: false, reason: "missing_objective_key" };
    const worldId = ctxWorld(ctx, input);
    const count = Math.max(1, Math.floor(Number(input.count) || 1));
    recordObjectiveProgress(db, userId, worldId, input.questId || null, input.type, input.target, count);
    return { ok: true };
  }, { note: "record objective progress (monotonic, capped, auto-completes)" });

  /**
   * quests.checkCompletion — recompute whether a quest is fully done.
   * input: { questId, userId?, worldId? }  → { ok, completed }
   */
  register("quests", "checkCompletion", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctxUser(ctx, input);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.questId) return { ok: false, reason: "no_quest_id" };
    const worldId = ctxWorld(ctx, input);
    return { ok: true, completed: checkQuestCompletion(db, userId, worldId, input.questId) };
  }, { note: "recompute quest completion state" });

  /**
   * quests.claimRewards — grant a completed quest's rewards exactly once.
   * Engine gates on player_quests.rewarded_at so re-claim returns ok:false.
   * input: { questId, userId?, worldId? }  → { ok, rewards } | { ok:false, error }
   */
  register("quests", "claimRewards", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctxUser(ctx, input);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.questId) return { ok: false, reason: "no_quest_id" };
    const worldId = ctxWorld(ctx, input);
    return claimQuestRewards(db, userId, worldId, input.questId);
  }, { note: "claim a completed quest's rewards (idempotent — once only)" });

  /**
   * quests.addObjectives — author structured objectives onto a quest (used by
   * the world/quest builder + lattice composer). Authoring path; not public.
   * input: { questId, objectives:[{type,target,requiredCount?,description?}] }
   */
  register("quests", "addObjectives", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.questId || !Array.isArray(input.objectives)) {
      return { ok: false, reason: "missing_inputs" };
    }
    addQuestObjectives(db, input.questId, input.objectives);
    return { ok: true, count: input.objectives.length };
  }, { note: "attach objectives to a quest (authoring)" });

  /**
   * quests.addRewards — author reward definitions onto a quest.
   * input: { questId, rewards:[{rewardType, rewardKey?, amount?}] }
   */
  register("quests", "addRewards", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.questId || !Array.isArray(input.rewards)) {
      return { ok: false, reason: "missing_inputs" };
    }
    addQuestRewards(db, input.questId, input.rewards);
    return { ok: true, count: input.rewards.length };
  }, { note: "attach reward definitions to a quest (authoring)" });
}
