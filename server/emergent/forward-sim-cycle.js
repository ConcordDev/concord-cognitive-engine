// server/emergent/forward-sim-cycle.js
//
// Layer 10 heartbeat: subconscious forward-sim anticipation.
//
// Frequency: every 100 ticks (~25 minutes). Each pass:
//   1. Sweeps expired non-realised predictions (GC).
//   2. Discovers offline candidates with recent activity in the last 24h.
//   3. For each candidate, calls tryPredictForUser() which throttles by
//      MIN_PASS_INTERVAL_S (default 4h) and skips subjects that already
//      have an active prediction.
//
// LLM enhancement opt-in via CONCORD_FORWARD_SIM_LLM=true. Off by default.

import logger from "../logger.js";
import { tryPredictForUser, sweepExpiredPredictions } from "../lib/embodied/forward-sim.js";

const ACTIVITY_WINDOW_S = 24 * 3600;

export async function runForwardSimCycle({ db, state: _state, tickCount: _tickCount } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const swept = sweepExpiredPredictions(db);
  const since = Math.floor(Date.now() / 1000) - ACTIVITY_WINDOW_S;

  let candidates;
  try {
    candidates = db.prepare(`
      SELECT DISTINCT user_id FROM (
        SELECT attacker_id AS user_id FROM damage_events
          WHERE attacker_type = 'player' AND occurred_at >= @since
        UNION
        SELECT user_id FROM player_inventory   WHERE acquired_at >= @since
        UNION
        SELECT user_id FROM pain_signals       WHERE recorded_at >= @since
      )
      WHERE user_id IS NOT NULL
        AND user_id NOT IN (
          SELECT user_id FROM world_visits WHERE departed_at IS NULL
        )
    `).all({ since });
  } catch (err) {
    return { ok: false, reason: "candidate_query_failed", error: err?.message, swept };
  }
  if (!candidates || candidates.length === 0) {
    return { ok: true, candidates: 0, predictions: 0, swept };
  }

  let totalPredictions = 0;
  let cooldown = 0;
  let noSubjects = 0;
  for (const c of candidates) {
    try {
      const r = await tryPredictForUser(db, c.user_id);
      if (r.ok) totalPredictions += Number(r.predictions || 0);
      else if (r.reason === 'cooldown') cooldown++;
      if (r.reason === 'no_subjects') noSubjects++;
    } catch (err) {
      try { logger.warn("forward-sim-cycle", "user_failed", { user: c.user_id, error: err?.message }); } catch { /* ignore */ }
    }
  }

  return {
    ok: true,
    candidates: candidates.length,
    predictions: totalPredictions,
    cooldown, noSubjects, swept,
  };
}
