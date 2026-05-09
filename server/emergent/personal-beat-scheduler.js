// server/emergent/personal-beat-scheduler.js
//
// Phase 3 — surface forward-sim predictions to players as in-world beats.
//
// Every 60 ticks (~15 min). For each ONLINE user:
//   1. Skip if they have an open uncompleted beat.
//   2. Pull their highest-confidence active forward-prediction.
//   3. Score by confidence × novelty (days since last beat of same subject_kind).
//   4. Insert a player_beats row + emit `beat:offered` socket event.
//
// Realisation hooks live in callers (quest completion, NPC dialogue,
// faction reputation), not here. This module only schedules + GCs.
//
// Returns { ok, scheduled, expired, reason? } never throws.

import crypto from "node:crypto";
import logger from "../logger.js";

const SCHEDULER_FREQ_TICKS = 60;
const BEAT_TTL_MS = 24 * 60 * 60 * 1000;  // 24h before beat expires
const MAX_BEATS_PER_PASS = 50;

export async function runPersonalBeatScheduler({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_PERSONAL_BEATS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let scheduled = 0;
  let expired = 0;

  try {
    // 1. Expire stale open beats.
    const ttlCutoff = Math.floor((Date.now() - BEAT_TTL_MS) / 1000);
    try {
      const r = db.prepare(`
        UPDATE player_beats
        SET completed_at = unixepoch(), outcome = 'expired'
        WHERE completed_at IS NULL AND surfaced_at < ?
      `).run(ttlCutoff);
      expired = r.changes || 0;
    } catch { /* table may not exist on minimal builds */ }

    // 2. Discover online users — those with a recent world_visits row that
    //    has no departed_at (still in-world). Bound to MAX_BEATS_PER_PASS.
    let onlineUsers = [];
    try {
      onlineUsers = db.prepare(`
        SELECT DISTINCT user_id, world_id FROM world_visits
        WHERE departed_at IS NULL
        ORDER BY entered_at DESC
        LIMIT ?
      `).all(MAX_BEATS_PER_PASS);
    } catch {
      // world_visits absent — try a fallback against player_world_metrics
      try {
        onlineUsers = db.prepare(`
          SELECT user_id, world_id FROM player_world_metrics
          WHERE updated_at > unixepoch() - 1800
          LIMIT ?
        `).all(MAX_BEATS_PER_PASS);
      } catch { return { ok: true, scheduled: 0, expired, reason: "no_online_table" }; }
    }

    if (onlineUsers.length === 0) return { ok: true, scheduled: 0, expired };

    const fwd = await import("../lib/embodied/forward-sim.js").catch(() => null);
    if (!fwd?.getActivePredictions) return { ok: true, scheduled: 0, expired, reason: "no_forward_sim" };

    for (const u of onlineUsers) {
      try {
        // Skip if user already has an open beat.
        const open = db.prepare(`
          SELECT id FROM player_beats WHERE user_id = ? AND completed_at IS NULL LIMIT 1
        `).get(u.user_id);
        if (open) continue;

        const predictions = fwd.getActivePredictions(db, u.user_id, 5);
        if (!predictions || predictions.length === 0) continue;

        // Score by confidence × novelty. Novelty = 1 + log10(days_since_last_beat_of_kind).
        const lastBeat = db.prepare(`
          SELECT MAX(surfaced_at) AS last_at FROM player_beats
          WHERE user_id = ? AND prediction_id IN (
            SELECT id FROM forward_predictions WHERE user_id = ? AND subject_kind = ?
          )
        `);

        let best = null;
        let bestScore = -Infinity;
        for (const p of predictions) {
          let novelty = 2.0;
          try {
            const r = lastBeat.get(u.user_id, u.user_id, p.subject_kind);
            if (r?.last_at) {
              const days = Math.max(0.5, (Date.now() / 1000 - r.last_at) / 86400);
              novelty = 1 + Math.log10(days);
            }
          } catch { /* novelty defaults */ }
          const score = (Number(p.confidence) || 0.5) * novelty;
          if (score > bestScore) { bestScore = score; best = p; }
        }
        if (!best) continue;

        const beatId = crypto.randomUUID();
        const prose = String(best.anticipated || "").slice(0, 480);
        try {
          db.prepare(`
            INSERT INTO player_beats (id, user_id, world_id, prediction_id, prose, surfaced_at)
            VALUES (?, ?, ?, ?, ?, unixepoch())
          `).run(beatId, u.user_id, u.world_id || best.world_id || "concordia-hub", best.id, prose);
          scheduled++;

          // Emit socket if available — consumer is the goddess HUD widget.
          try {
            if (globalThis?.__CONCORD_REALTIME__?.io) {
              globalThis.__CONCORD_REALTIME__.io.to(`user:${u.user_id}`).emit("beat:offered", {
                id: beatId,
                userId: u.user_id,
                worldId: u.world_id,
                predictionId: best.id,
                subjectKind: best.subject_kind,
                prose,
                ts: Date.now(),
              });
            }
          } catch { /* socket emit best-effort */ }
        } catch (err) {
          try { logger.debug?.("personal-beat-scheduler", "insert_failed", { user: u.user_id, error: err?.message }); }
          catch { /* ignore */ }
        }
      } catch (err) {
        try { logger.debug?.("personal-beat-scheduler", "user_failed", { user: u.user_id, error: err?.message }); }
        catch { /* ignore */ }
      }
    }

    return { ok: true, scheduled, expired };
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: err?.message };
  }
}

// ── Realisation API ─────────────────────────────────────────────────────────
// Other code paths call these to mark beats realised when reality matches.

/**
 * Mark beat realised. Outcome ∈ {'realised', 'rejected', 'ignored'}.
 * Bumps player metrics on positive outcomes.
 *
 * Returns { ok, beatId?, predictionId? }
 */
export async function realiseBeat(db, beatId, outcome = "realised") {
  if (!db || !beatId) return { ok: false, reason: "missing_inputs" };
  const beat = db.prepare(`SELECT * FROM player_beats WHERE id = ?`).get(beatId);
  if (!beat) return { ok: false, reason: "beat_not_found" };
  if (beat.completed_at) return { ok: false, reason: "already_completed" };

  try {
    db.prepare(`UPDATE player_beats SET completed_at = unixepoch(), outcome = ? WHERE id = ?`)
      .run(outcome, beatId);
  } catch (err) { return { ok: false, reason: "update_failed", error: err?.message }; }

  // Cascade — also realise the underlying forward_predictions row.
  if (beat.prediction_id) {
    try {
      const fwd = await import("../lib/embodied/forward-sim.js");
      fwd.realisePrediction?.(db, beat.prediction_id, { outcome, beatId });
    } catch { /* tolerant — predictions table optional */ }
  }

  // Metric shifts on realised / rejected.
  try {
    if (outcome === "realised") {
      db.prepare(`
        UPDATE player_world_metrics
        SET concordia_alignment = MIN(1.0, concordia_alignment + 0.05),
            updated_at = unixepoch()
        WHERE user_id = ? AND world_id = ?
      `).run(beat.user_id, beat.world_id);
    } else if (outcome === "rejected") {
      db.prepare(`
        UPDATE player_world_metrics
        SET refusal_debt = MIN(1.0, refusal_debt + 0.02),
            updated_at = unixepoch()
        WHERE user_id = ? AND world_id = ?
      `).run(beat.user_id, beat.world_id);
    }
  } catch { /* metrics table optional */ }

  return { ok: true, beatId, predictionId: beat.prediction_id, outcome };
}

/** Find an open beat for a user matching a predicate subject kind/id. */
export function findOpenBeatBySubject(db, userId, subjectKind, subjectId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT pb.* FROM player_beats pb
      JOIN forward_predictions fp ON fp.id = pb.prediction_id
      WHERE pb.user_id = ? AND pb.completed_at IS NULL
        AND fp.subject_kind = ? AND fp.subject_id = ?
      LIMIT 1
    `).get(userId, subjectKind, subjectId);
  } catch { return null; }
}

/** List a user's beats — read for HUD. */
export function listBeatsForUser(db, userId, limit = 20) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, user_id, world_id, prediction_id, prose,
             surfaced_at, completed_at, outcome
      FROM player_beats
      WHERE user_id = ?
      ORDER BY surfaced_at DESC
      LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}

export const _internal = {
  SCHEDULER_FREQ_TICKS,
  BEAT_TTL_MS,
  MAX_BEATS_PER_PASS,
};
