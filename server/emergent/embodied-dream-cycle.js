// server/emergent/embodied-dream-cycle.js
//
// Layer 9 heartbeat: composes dreams for offline players.
//
// This is the PLAYER-EMBODIED dream cycle (per-user, per-day, kind='dream'
// DTU written from the day's lived activity). Distinct from the existing
// system-level substrate dream cycle in `./dream-cycle.js` which runs
// the 6-phase replay/consolidate/connect/predict/heal/compose pass on
// the global DTU corpus.
//
// Frequency: every 80 ticks (~20 minutes). Each pass:
//   1. Discovers candidate users — anyone with pain_signals OR damage_events
//      OR player_inventory rows from the last WINDOW_HOURS, AND no
//      world_visits row with departed_at IS NULL (i.e. logged off).
//   2. For each candidate, calls tryComposeForUser() which throttles via
//      MIN_COMPOSE_INTERVAL_S (default 6h) and dedupes by signature.
//   3. Wraps each user in try/catch — one failure doesn't stop the pass.
//
// The dream DTU lands in dtus with kind='dream', scope='personal'. It's
// invisible to other players unless the creator promotes it. If they
// do, it joins the citation/royalty cascade like any other DTU —
// somebody who cites your dream pays you forever.
//
// LLM enhancement is opt-in via CONCORD_DREAM_LLM=true. Off by default
// so the cycle stays cheap and deterministic.

import logger from "../logger.js";
import { tryComposeForUser, WINDOW_HOURS } from "../lib/embodied/dream-engine.js";

export async function runEmbodiedDreamCycle({ db, state: _state, tickCount: _tickCount } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const since = Math.floor(Date.now() / 1000) - WINDOW_HOURS * 3600;

  // Candidate set: union of recent activity sources, minus currently-active.
  // Each subquery is wrapped in COALESCE-safe defensive logic — if a table
  // is missing on minimal builds, the union short-circuits and we still
  // cover whichever sources exist.
  let candidates;
  try {
    candidates = db.prepare(`
      SELECT DISTINCT user_id FROM (
        SELECT user_id FROM pain_signals       WHERE recorded_at >= @since
        UNION
        SELECT attacker_id AS user_id FROM damage_events
          WHERE attacker_type = 'player' AND occurred_at >= @since
        UNION
        SELECT user_id FROM player_inventory   WHERE acquired_at >= @since
        UNION
        SELECT creator_id AS user_id FROM dtus WHERE created_at >= @since AND creator_id IS NOT NULL
      )
      WHERE user_id IS NOT NULL
        AND user_id NOT IN (
          SELECT user_id FROM world_visits WHERE departed_at IS NULL
        )
    `).all({ since });
  } catch (err) {
    return { ok: false, reason: "candidate_query_failed", error: err?.message };
  }
  if (!candidates || candidates.length === 0) {
    return { ok: true, candidates: 0, composed: 0 };
  }

  let composed = 0;
  let cooldown = 0;
  let tooFew = 0;
  let dup = 0;
  for (const c of candidates) {
    try {
      const r = await tryComposeForUser(db, c.user_id);
      if (r.ok) composed++;
      else if (r.reason === 'cooldown') cooldown++;
      else if (r.reason === 'too_few_fragments') tooFew++;
      else if (r.reason === 'duplicate_signature') dup++;
    } catch (err) {
      try { logger.warn("embodied-dream-cycle", "user_failed", { user: c.user_id, error: err?.message }); } catch { /* ignore */ }
    }
  }

  return { ok: true, candidates: candidates.length, composed, cooldown, tooFew, dup };
}
