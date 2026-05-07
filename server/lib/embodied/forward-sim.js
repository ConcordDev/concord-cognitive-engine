// server/lib/embodied/forward-sim.js
//
// Layer 10: subconscious forward-sim — anticipation engine.
//
// While the player is offline, the engine generates speculative predictions
// about three subject classes:
//   1. Active quests — what the next plausible objective resolution looks
//      like, given recent objective progress.
//   2. Recently-met NPCs — how the NPC will react when the player returns,
//      given their last interaction's mood/opinion.
//   3. Active factions — whether faction war / faction-event state is
//      drifting in a way that will surprise the player on return.
//
// Each prediction lands as a forward_predictions row + (optionally) a
// `prediction` kind DTU. Confidence is a 0..1 scalar — deterministic
// rules ship with mid-band confidence (0.4–0.7); LLM-enhanced predictions
// get the LLM's stated confidence (clamped) or 0.5 if it doesn't return one.
//
// LLM enhancement is opt-in via CONCORD_FORWARD_SIM_LLM=true. Off by default.
//
// All work is wrapped in try/catch — a single subject's failure must not
// stop the cycle for other subjects.

import crypto from "node:crypto";
import logger from "../../logger.js";

export const PREDICTION_TTL_S = Number(process.env.CONCORD_PREDICTION_TTL_S) || 48 * 3600;
export const MAX_PREDICTIONS_PER_PASS = Number(process.env.CONCORD_PREDICTIONS_PER_PASS) || 3;
export const MIN_PASS_INTERVAL_S = Number(process.env.CONCORD_PREDICTION_INTERVAL_S) || 4 * 3600;

/**
 * Generate predictions for a user. Returns the inserted rows. Idempotent
 * within MIN_PASS_INTERVAL_S; same subject is not re-predicted while a
 * non-realised prediction is still active.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {object} [opts]
 */
export async function tryPredictForUser(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, reason: 'no_user' };
  const now = Number(opts.now ?? Math.floor(Date.now() / 1000));
  const minInterval = Number(opts.minInterval ?? MIN_PASS_INTERVAL_S);
  const maxPerPass = Number(opts.maxPerPass ?? MAX_PREDICTIONS_PER_PASS);

  // Throttle: skip if a prediction was composed inside the cooldown.
  let last;
  try {
    last = db.prepare(`
      SELECT composed_at FROM forward_predictions WHERE user_id = ?
       ORDER BY composed_at DESC LIMIT 1
    `).get(userId);
  } catch {
    return { ok: false, reason: 'predictions_table_missing' };
  }
  if (last && now - Number(last.composed_at) < minInterval) {
    return { ok: false, reason: 'cooldown', secondsLeft: minInterval - (now - Number(last.composed_at)) };
  }

  const subjects = _gatherSubjects(db, userId);
  if (subjects.length === 0) return { ok: true, predictions: 0, reason: 'no_subjects' };

  // Skip subjects that already have a non-realised, non-expired prediction.
  const filtered = [];
  for (const s of subjects) {
    try {
      const existing = db.prepare(`
        SELECT id FROM forward_predictions
         WHERE user_id = ? AND subject_kind = ? AND subject_id = ?
           AND realised_at IS NULL AND expires_at > ?
      `).get(userId, s.kind, s.id, now);
      if (!existing) filtered.push(s);
    } catch { /* ignore */ }
    if (filtered.length >= maxPerPass) break;
  }
  if (filtered.length === 0) return { ok: true, predictions: 0, reason: 'all_subjects_have_active_predictions' };

  const composer = opts.composer ?? (process.env.CONCORD_FORWARD_SIM_LLM === 'true' ? 'subconscious_llm' : 'deterministic');
  const inserted = [];
  for (const s of filtered) {
    try {
      let prediction = composeDeterministicPrediction(s);
      if (composer === 'subconscious_llm') {
        try {
          const enhanced = await _llmPrediction(s);
          if (enhanced) prediction = { ...prediction, ...enhanced, composer: 'subconscious_llm' };
        } catch { /* non-fatal */ }
      }
      const id = `pred_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO forward_predictions
          (id, user_id, world_id, subject_kind, subject_id, anticipated,
           confidence, composer, composed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, userId, s.worldId ?? null, s.kind, s.id,
        prediction.anticipated, prediction.confidence,
        prediction.composer || 'deterministic',
        now, now + PREDICTION_TTL_S,
      );
      inserted.push({ id, ...s, ...prediction });
    } catch (err) {
      try { logger.warn('forward-sim', 'predict_failed', { user: userId, subject: s.id, error: err?.message }); } catch { /* ignore */ }
    }
  }

  return { ok: true, predictions: inserted.length, inserted };
}

/**
 * Read-side: list active (non-realised, non-expired) predictions.
 */
export function getActivePredictions(db, userId, limit = 20) {
  if (!db || !userId) return [];
  const now = Math.floor(Date.now() / 1000);
  try {
    return db.prepare(`
      SELECT id, world_id, subject_kind, subject_id, anticipated,
             confidence, composer, composed_at, expires_at
        FROM forward_predictions
       WHERE user_id = ? AND realised_at IS NULL AND expires_at > ?
       ORDER BY composed_at DESC LIMIT ?
    `).all(userId, now, Math.max(1, Math.min(100, Number(limit))));
  } catch {
    return [];
  }
}

/**
 * Mark a prediction realised. Caller passes outcome JSON.
 */
export function realisePrediction(db, predictionId, outcome) {
  if (!db || !predictionId) return null;
  try {
    db.prepare(`
      UPDATE forward_predictions
         SET realised_at = unixepoch(),
             reality_outcome = ?
       WHERE id = ? AND realised_at IS NULL
    `).run(typeof outcome === 'string' ? outcome : JSON.stringify(outcome ?? {}), predictionId);
    return { ok: true };
  } catch {
    return null;
  }
}

/** GC sweep: archive expired non-realised predictions by stamping
 * realised_at with a sentinel and a pseudo-outcome. Bounded by the index. */
export function sweepExpiredPredictions(db) {
  if (!db) return 0;
  const now = Math.floor(Date.now() / 1000);
  try {
    const r = db.prepare(`
      UPDATE forward_predictions
         SET realised_at = ?, reality_outcome = '{"expired":true}'
       WHERE realised_at IS NULL AND expires_at <= ?
    `).run(now, now);
    return r.changes;
  } catch {
    return 0;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Internal: subject gathering + deterministic composer
// ───────────────────────────────────────────────────────────────────────────

function _gatherSubjects(db, userId) {
  const subjects = [];

  // Active quests — find quests with progress in the last 24h.
  try {
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;
    const rows = db.prepare(`
      SELECT DISTINCT quest_id, world_id FROM quest_progress
       WHERE user_id = ? AND updated_at >= ?
       LIMIT 5
    `).all(userId, since);
    for (const r of rows) {
      subjects.push({ kind: 'quest', id: r.quest_id, worldId: r.world_id });
    }
  } catch { /* table may not exist */ }

  // Recently-met NPCs — npc_relations or last damage_event target/attacker.
  try {
    const since = Math.floor(Date.now() / 1000) - 12 * 3600;
    const rows = db.prepare(`
      SELECT DISTINCT target_id AS npc_id, world_id FROM damage_events
       WHERE attacker_id = ? AND attacker_type = 'player'
         AND target_type = 'npc' AND occurred_at >= ?
       LIMIT 5
    `).all(userId, since);
    for (const r of rows) {
      subjects.push({ kind: 'npc', id: r.npc_id, worldId: r.world_id });
    }
  } catch { /* ignore */ }

  // Factions the player is in — schema-tolerant; defaults to none on missing.
  try {
    const rows = db.prepare(`
      SELECT DISTINCT faction_id FROM faction_members WHERE user_id = ? LIMIT 3
    `).all(userId);
    for (const r of rows) {
      subjects.push({ kind: 'faction', id: r.faction_id, worldId: null });
    }
  } catch { /* ignore */ }

  return subjects;
}

export function composeDeterministicPrediction(subject) {
  const { kind, id } = subject;
  // Seeded confidence varies by class — quests are most determinable,
  // factions least.
  switch (kind) {
    case 'quest':
      return {
        anticipated: `The next step on quest ${id} feels close — your subconscious has rehearsed the approach.`,
        confidence: 0.62,
        composer: 'deterministic',
      };
    case 'npc':
      return {
        anticipated: `${id} will likely greet you with the same temper they had when you parted. The body remembers what the words don't say.`,
        confidence: 0.55,
        composer: 'deterministic',
      };
    case 'faction':
      return {
        anticipated: `Faction ${id} continues without you. Whatever they're doing now will surface as news when you return.`,
        confidence: 0.42,
        composer: 'deterministic',
      };
    case 'decision':
      return {
        anticipated: `You've been turning a decision over. The shape of it isn't clearer, but your hesitation has a shape now.`,
        confidence: 0.40,
        composer: 'deterministic',
      };
    case 'self':
    default:
      return {
        anticipated: `Something unsettled is in you. Naming it would change it. Maybe that's the point.`,
        confidence: 0.35,
        composer: 'deterministic',
      };
  }
}

async function _llmPrediction(subject) {
  let chat;
  try {
    const router = await import("../brain-router.js");
    if (typeof router.callBrain === "function") {
      chat = (sys, user) => router.callBrain('subconscious', { system: sys, prompt: user });
    }
  } catch { /* router unavailable */ }
  if (!chat) return null;

  const sys = `You compose forward-sim predictions for a player who is offline. ` +
              `Output one short second-person sentence (max 30 words) describing what they ` +
              `might find or feel about the subject when they return. Grounded; do not invent ` +
              `events. Append "|conf=0.NN" with your confidence (0..1). No headers, no lists.`;
  const userMsg = `Subject: kind=${subject.kind} id=${subject.id} worldId=${subject.worldId ?? 'none'}`;

  let result;
  try {
    const timeout = new Promise((_r, reject) => {
      setTimeout(() => reject(new Error('llm_timeout')), 6000);
    });
    result = await Promise.race([chat(sys, userMsg), timeout]);
  } catch {
    return null;
  }

  const text = typeof result === 'string' ? result
             : result?.content || result?.text || result?.message?.content;
  if (typeof text !== 'string' || text.length < 10) return null;

  // Parse "...|conf=0.NN"
  const match = /\|conf=(0\.\d+|1\.0+|1)/.exec(text);
  let confidence = 0.5;
  let body = text;
  if (match) {
    confidence = Math.max(0, Math.min(1, parseFloat(match[1])));
    body = text.slice(0, match.index).trim();
  }
  return { anticipated: body.slice(0, 240), confidence };
}
