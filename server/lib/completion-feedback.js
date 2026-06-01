// server/lib/completion-feedback.js
//
// G7 — the content-continuity feedback loop. Procedural content already never
// dries up (lattice quests, world events, NPC/faction cycles all self-sustain), so
// the missing piece is the DATA loop for the user's ~2-month authored drops:
// "add authored quests based on what users have completed." This aggregates the
// completion telemetry into a "what users completed" surface + a dry-up
// early-warning (worlds where authored content is nearly exhausted → inject here).
//
// Read-only, every query table-guarded (degrades to empty on a minimal build).
// Kill-switch CONCORD_COMPLETION_FEEDBACK=0 (the macro returns disabled).

function safeAll(db, sql, ...a) { try { return db.prepare(sql).all(...a); } catch { return []; } }
function safeGet(db, sql, ...a) { try { return db.prepare(sql).get(...a); } catch { return null; } }

export function feedbackEnabled() {
  return process.env.CONCORD_COMPLETION_FEEDBACK !== "0";
}

/**
 * Per-world authored-quest status + a `nearlyExhausted` flag — the early warning
 * that a world's authored content is almost all completed and needs an injection.
 * exhaustion = completed / (available + active + completed).
 */
export function worldQuestStatus(db) {
  const rows = safeAll(db,
    `SELECT world_id, status, COUNT(*) AS n FROM world_quests GROUP BY world_id, status`);
  const byWorld = {};
  for (const r of rows) {
    const w = (byWorld[r.world_id] ||= { world_id: r.world_id, available: 0, active: 0, completed: 0, abandoned: 0 });
    if (w[r.status] != null) w[r.status] += r.n;
  }
  return Object.values(byWorld).map((w) => {
    const total = w.available + w.active + w.completed;
    const exhaustion = total > 0 ? Math.round((w.completed / total) * 100) / 100 : 0;
    return { ...w, exhaustion, nearlyExhausted: total > 0 && w.available <= 1 && exhaustion >= 0.8 };
  }).sort((a, b) => b.exhaustion - a.exhaustion);
}

/** Most-completed authored quests (what players actually finished + recency). */
export function topCompletedQuests(db, limit = 25) {
  return safeAll(db,
    `SELECT quest_id, COUNT(*) AS completions, MAX(completed_at) AS last_completed
     FROM quest_completions GROUP BY quest_id ORDER BY completions DESC LIMIT ?`, limit);
}

/** Achievement popularity — which goals players chase (informs authored hooks). */
export function achievementPopularity(db, limit = 25) {
  return safeAll(db,
    `SELECT achievement_id, COUNT(*) AS unlocks FROM player_achievements
     GROUP BY achievement_id ORDER BY unlocks DESC LIMIT ?`, limit);
}

/** Weekly-objective completion rate per objective type (which types players skip). */
export function objectiveCompletionRates(db) {
  // weekly_objectives carries progress; treat a claimed/completed row as done.
  const rows = safeAll(db,
    `SELECT objective_id,
            COUNT(*) AS issued,
            SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
     FROM weekly_objectives GROUP BY objective_id`);
  if (rows.length) {
    return rows.map((r) => ({ objective_id: r.objective_id, issued: r.issued, completed: r.completed,
      rate: r.issued ? Math.round((r.completed / r.issued) * 100) / 100 : 0 }))
      .sort((a, b) => a.rate - b.rate); // lowest completion first (the skipped types)
  }
  // schema without completed_at — fall back to issued counts only.
  return safeAll(db, `SELECT objective_id, COUNT(*) AS issued FROM weekly_objectives GROUP BY objective_id`)
    .map((r) => ({ objective_id: r.objective_id, issued: r.issued }));
}

/** The whole picture the author reads before a 2-month drop. */
export function completionSummary(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const worlds = worldQuestStatus(db);
  return {
    ok: true,
    generatedAt: Date.now(),
    totalCompletions: safeGet(db, `SELECT COUNT(*) AS n FROM quest_completions`)?.n ?? 0,
    worlds,
    nearlyExhausted: worlds.filter((w) => w.nearlyExhausted).map((w) => w.world_id),
    topCompletedQuests: topCompletedQuests(db),
    achievementPopularity: achievementPopularity(db),
    underservedObjectiveTypes: objectiveCompletionRates(db).slice(0, 10),
  };
}
