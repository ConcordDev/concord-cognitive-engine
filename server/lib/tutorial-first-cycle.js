/**
 * First-Cycle tutorial helper.
 *
 * The First Cycle is the four-quest cook → eat → fight → commune onboarding
 * journey defined in content/quests/onboarding.json. This module derives the
 * player's current phase from quest_progress / quest_objectives, so the
 * /api/tutorial/first-cycle route AND the E2E test share the same logic.
 *
 * The phase advances as each quest reaches `status='complete'` (or
 * 'completed'); the response payload mirrors what the FirstWinWizard reads
 * to render prompts and voice lines.
 */

export const FIRST_CYCLE_QUEST_IDS = Object.freeze([
  "first_cycle_cook",
  "first_cycle_eat",
  "first_cycle_fight",
  "first_cycle_commune",
]);

export const FIRST_CYCLE_PHASE_BY_QUEST = Object.freeze({
  first_cycle_cook:    "cook",
  first_cycle_eat:     "eat",
  first_cycle_fight:   "fight",
  first_cycle_commune: "commune",
});

/**
 * Compute the player's current first-cycle progress.
 *
 * @param {object} opts
 * @param {object} opts.db        better-sqlite3 instance (for fallback path)
 * @param {string} opts.userId
 * @param {string} opts.worldId
 * @param {object} [opts.questEngine]  optional quest-engine module with getQuestProgress(db, userId, worldId, questId).
 *                                     If absent or its signature does not match,
 *                                     the helper falls back to a direct DB read.
 * @returns {{
 *   ok: true,
 *   tutorial: 'first_cycle',
 *   currentPhase: 'cook'|'eat'|'fight'|'commune'|'complete',
 *   complete: boolean,
 *   phases: Array<{questId, phase, status, complete, progress}>
 * }}
 */
export function deriveFirstCycleProgress({ db, userId, worldId, questEngine = null }) {
  const phases = [];
  let currentPhase = "cook";
  let allComplete = true;

  for (const questId of FIRST_CYCLE_QUEST_IDS) {
    let progress = null;
    try {
      if (questEngine?.getQuestProgress && questEngine.getQuestProgress.length >= 4) {
        // The 4-arg signature: getQuestProgress(db, userId, worldId, questId).
        // The quest-engine.js export has a 1-arg signature, which we skip in favor
        // of the direct DB read.
        progress = questEngine.getQuestProgress(db, userId, worldId, questId);
      } else if (db) {
        const row = db.prepare(`
          SELECT status, completed_at FROM quest_progress
           WHERE user_id = ? AND world_id = ? AND quest_id = ?
        `).get(userId, worldId, questId);
        progress = row ? { status: row.status, completedAt: row.completed_at } : null;
      }
    } catch { /* quest tables may not exist on minimal builds */ }

    const status = progress?.status ?? "not_started";
    const isComplete = status === "complete" || status === "completed";
    phases.push({
      questId,
      phase: FIRST_CYCLE_PHASE_BY_QUEST[questId],
      status,
      complete: isComplete,
      progress: progress ?? null,
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
