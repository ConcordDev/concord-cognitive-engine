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
import { updateConfidence } from "../dtu-confidence.js";

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
           confidence, composer, composed_at, expires_at, prediction_dtu_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, userId, s.worldId ?? null, s.kind, s.id,
        prediction.anticipated, prediction.confidence,
        prediction.composer || 'deterministic',
        now, now + PREDICTION_TTL_S,
        // LC1 — honest-by-construction: NULL unless _gatherSubjects found a
        // genuine, already-wired subject→DTU schema reference (see that
        // function's header comment for the per-kind audit). Never fabricated.
        s.dtuId ?? null,
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

    // LC1 — close the DTU-confidence loop. This is the FIRST write path for
    // dtu_confidence that isn't citation-registration or drift-monitor: a
    // confirmed/violated prediction is real-world evidence about the DTU it
    // was genuinely tied to at composition time.
    //
    // Fires ONLY when both hold:
    //   (a) the prediction carries a non-null prediction_dtu_id — written by
    //       _gatherSubjects only when a real, already-wired subject→DTU
    //       schema link exists (never fabricated; see that function's
    //       header comment for the per-subject-kind audit).
    //   (b) the outcome unambiguously reads as 'realised' or 'rejected'.
    // Every other case (outcome === 'expired', an 'ignored' beat, or an
    // arbitrary payload with no `.outcome` string such as the direct-caller
    // shape `{ matched: true, note: '...' }`) is an intentional no-op — a
    // TTL lapse or an unlabelled payload is not evidence either way, and we
    // never guess intent from an ambiguous shape.
    try {
      const label = typeof outcome === 'string'
        ? outcome
        : (outcome && typeof outcome === 'object' && typeof outcome.outcome === 'string')
          ? outcome.outcome
          : null;
      if (label === 'realised' || label === 'rejected') {
        const predRow = db.prepare(`SELECT prediction_dtu_id FROM forward_predictions WHERE id = ?`).get(predictionId);
        if (predRow?.prediction_dtu_id) {
          updateConfidence(
            db,
            predRow.prediction_dtu_id,
            label === 'realised' ? 0.05 : -0.05,
            label === 'realised' ? 'prediction_verified' : 'prediction_violated',
          );
        }
      }
    } catch { /* confidence update is best-effort; never blocks realisation */ }

    // Phase F3.1 — surface prediction realisation to the player.
    try {
      const emitFn = globalThis._concordRealtimeEmit;
      if (typeof emitFn === "function") {
        const row = db.prepare(`SELECT user_id, subject_kind, subject_id FROM forward_predictions WHERE id = ?`).get(predictionId);
        emitFn("prediction:realised", {
          predictionId,
          userId: row?.user_id,
          subjectKind: row?.subject_kind,
          subjectId: row?.subject_id,
          outcome,
        });
      }
    } catch { /* emit failure never affects the call */ }
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

// ── LC1 — subject → DTU resolution (honest-by-construction) ────────────────
//
// `prediction_dtu_id` (migration 116) exists so a confirmed/violated
// prediction can nudge `dtu_confidence` — but it must ONLY ever carry a
// genuine, already-wired reference. Fabricating one just to have something
// to write would corrupt the confidence signal. Audited per subject kind
// (two-pass codebase search, 2026-07):
//
//   - quest: `quest_progress.quest_id` (server/migrations/315_missing_
//     tables_repair.js) has NO schema-level link to any DTU — it's an
//     opaque (user, world, quest_id) tracker. `lattice_born_quests` (the
//     drift-alert-spawned quests) also carries no dtu column, and its
//     `drift_alert_signature` is a one-way sha1 of type+severity+message+
//     day (lattice-quest-composer.js#alertSignature) — not reversible to
//     the DTU pair that triggered the drift. `server/emergent/quest-
//     engine.js`'s `content.dtuIds` field belongs to a SEPARATE in-memory
//     learning-quest system unrelated to `quest_progress`. Verdict: always
//     NULL — no genuine link exists today.
//   - npc: `world_npcs.home_dtu_id` (migration 060_npc_enhancements) IS a
//     genuine per-npc_id → dtu_id schema column, and it IS read elsewhere
//     (npc-consequences.js) — but nothing in the codebase ever WRITES it
//     yet (exhaustive grep for assignments/INSERTs found none). We still
//     read it: it's a real column, not a guess, and will correctly start
//     resolving the day something populates it. `npc_knowledge` was
//     considered and REJECTED — it's keyed by (world_id, role, dtu_id), so
//     it names knowledge shared by every NPC of a role, not a fact about
//     THIS specific npc_id; using it would misattribute.
//   - faction: no faction table or authored content file anywhere carries a
//     dtu reference. Always NULL.
function _resolveNpcDtuId(db, npcId) {
  if (!db || !npcId) return null;
  try {
    const row = db.prepare(`SELECT home_dtu_id FROM world_npcs WHERE id = ?`).get(npcId);
    return row?.home_dtu_id || null;
  } catch {
    return null;
  }
}

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
      // No genuine quest→DTU link exists in the schema — see the LC1 audit
      // comment above. Never fabricate one.
      subjects.push({ kind: 'quest', id: r.quest_id, worldId: r.world_id, dtuId: null });
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
      subjects.push({ kind: 'npc', id: r.npc_id, worldId: r.world_id, dtuId: _resolveNpcDtuId(db, r.npc_id) });
    }
  } catch { /* ignore */ }

  // Factions the player is in — schema-tolerant; defaults to none on missing.
  try {
    const rows = db.prepare(`
      SELECT DISTINCT faction_id FROM faction_members WHERE user_id = ? LIMIT 3
    `).all(userId);
    for (const r of rows) {
      // No faction→DTU link exists anywhere in the schema/content — see the
      // LC1 audit comment above. Never fabricate one.
      subjects.push({ kind: 'faction', id: r.faction_id, worldId: null, dtuId: null });
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
