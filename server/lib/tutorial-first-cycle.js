/**
 * First-Cycle tutorial helper.
 *
 * The First Cycle is the eight-quest cook → eat → fight → commune →
 * befriend → sneak → kingdom_visit → play onboarding journey defined in
 * content/quests/onboarding.json. This module derives the player's current
 * phase from System B — the SQL-backed quest state machine in
 * server/lib/quests/quest-engine.js (`player_quests` / `quest_objectives` /
 * `player_quest_progress`) — so the /api/tutorial/first-cycle route AND the
 * E2E test share the same logic.
 *
 * The phase advances as each quest's `player_quests.status` reaches
 * 'completed' or 'rewarded'; the response payload mirrors what the
 * FirstWinWizard reads to render prompts and voice lines.
 *
 * History note (2026-07): this used to read a `quest_progress` (singular)
 * table that had zero production writers anywhere in the codebase — every
 * real player was stuck reporting currentPhase:"cook" forever regardless of
 * what they did. See docs/QUESTS_ENGINE_INVESTIGATION.md Finding 4. Fixed
 * by (a) content-seeder.js now bridging authored quests into System B's
 * `world_quests`/`quest_objectives`/`quest_rewards` at seed time, (b)
 * `/api/quests/accept` writing a real `player_quests` row, (c) this module
 * reading that real state instead of the dead table. The `quest_progress`
 * table itself is left in place (no migration here) — it now has zero
 * readers AND zero writers and can be dropped in a future cleanup
 * migration.
 */

import { getActiveQuests, getCompletedQuests, getQuestProgress } from "./quests/quest-engine.js";

export const FIRST_CYCLE_QUEST_IDS = Object.freeze([
  "first_cycle_cook",
  "first_cycle_eat",
  "first_cycle_fight",
  "first_cycle_commune",
  // Pre-playtest sprint additions — Phase F. The earlier 4-beat cycle
  // is preserved exactly; new beats append. Tier-3 E2E test fixture
  // updated in lockstep.
  "first_cycle_befriend",
  "first_cycle_sneak",
  "first_cycle_kingdom_visit",
  "first_cycle_play",
]);

export const FIRST_CYCLE_PHASE_BY_QUEST = Object.freeze({
  first_cycle_cook:           "cook",
  first_cycle_eat:            "eat",
  first_cycle_fight:          "fight",
  first_cycle_commune:        "commune",
  first_cycle_befriend:       "befriend",
  first_cycle_sneak:          "sneak",
  first_cycle_kingdom_visit:  "kingdom_visit",
  first_cycle_play:           "play",
});

const DONE_STATUSES = new Set(["complete", "completed", "rewarded"]);

/**
 * Compute the player's current first-cycle progress from System B.
 *
 * @param {object} opts
 * @param {object} opts.db        better-sqlite3 instance
 * @param {string} opts.userId
 * @param {string} opts.worldId
 * @returns {{
 *   ok: true,
 *   tutorial: 'first_cycle',
 *   currentPhase: 'cook'|'eat'|'fight'|'commune'|'befriend'|'sneak'|'kingdom_visit'|'play'|'complete',
 *   complete: boolean,
 *   phases: Array<{questId, phase, status, complete, progress}>
 * }}
 */
export function deriveFirstCycleProgress({ db, userId, worldId }) {
  const phases = [];
  let currentPhase = "cook";
  let allComplete = true;

  // Pull the player's quest-state rows once (System B's `player_quests`,
  // joined via getActiveQuests/getCompletedQuests) rather than re-querying
  // per phase — cheap in-memory lookup below.
  const statusByQuestId = new Map();
  try {
    if (db) {
      for (const q of getActiveQuests(db, userId, worldId) || []) {
        statusByQuestId.set(q.id, q.status || "active");
      }
      for (const q of getCompletedQuests(db, userId, worldId) || []) {
        statusByQuestId.set(q.id, q.status || "completed");
      }
    }
  } catch { /* quest tables may not exist on minimal builds */ }

  for (const questId of FIRST_CYCLE_QUEST_IDS) {
    let objectives = [];
    try {
      if (db) objectives = getQuestProgress(db, userId, worldId, questId) || [];
    } catch { /* quest_objectives may not exist on minimal builds */ }

    const status = statusByQuestId.get(questId) ?? "not_started";
    const isComplete = DONE_STATUSES.has(status);

    phases.push({
      questId,
      phase: FIRST_CYCLE_PHASE_BY_QUEST[questId],
      status: isComplete ? "complete" : status,
      complete: isComplete,
      progress: objectives.length ? { objectives } : null,
    });
    if (!isComplete && allComplete) {
      allComplete = false;
      currentPhase = FIRST_CYCLE_PHASE_BY_QUEST[questId];
    }
  }

  return {
    ok: true,
    tutorial: "first_cycle",
    currentPhase: allComplete ? "complete" : currentPhase,
    complete: allComplete,
    phases,
  };
}
