// server/lib/brain-training/interaction-log.js
//
// Logs every brain call into brain_interactions. The "outcome" column
// stays 'pending' until a heartbeat resolver later determines whether
// the response proved useful (cited, fixed an error, survived
// consolidation, etc.). Useful interactions become training data.
//
// This module is deliberately fail-safe: if the DB write throws, the
// brain call still completes — logging never blocks user-facing flow.

import crypto from "crypto";

const VALID_BRAINS = new Set([
  "conscious",
  "subconscious",
  "utility",
  "repair",
  "multimodal",
  "lattice",
]);

const VALID_OUTCOMES = new Set(["pending", "positive", "negative", "neutral", "expired"]);

/**
 * Log a single brain interaction. Never throws — returns null on failure.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.brainId       — one of VALID_BRAINS
 * @param {string|null} opts.userId   — nullable for system-internal calls
 * @param {object|string} opts.prompt — the input (object will be JSON-stringified)
 * @param {object|string|null} opts.response
 * @param {string|null} opts.domain   — lens / domain that triggered the call
 * @param {number} opts.latencyMs
 * @param {number} opts.tokensIn
 * @param {number} opts.tokensOut
 * @returns {string|null} interaction id, or null on failure
 */
export function logBrainInteraction(db, opts = {}) {
  if (!db) return null;
  if (!opts.brainId || !VALID_BRAINS.has(opts.brainId)) return null;
  try {
    const id = `bi_${crypto.randomBytes(8).toString("hex")}`;
    const promptJson = typeof opts.prompt === "string" ? opts.prompt : JSON.stringify(opts.prompt ?? null);
    const responseJson = opts.response == null ? null
      : (typeof opts.response === "string" ? opts.response : JSON.stringify(opts.response));
    const promptHash = crypto.createHash("sha256").update(promptJson).digest("hex");
    db.prepare(
      `INSERT INTO brain_interactions
        (id, brain_id, user_id, prompt_hash, prompt_json, response_json,
         domain, latency_ms, tokens_in, tokens_out, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      id,
      opts.brainId,
      opts.userId ?? null,
      promptHash,
      promptJson,
      responseJson,
      opts.domain ?? null,
      Number.isFinite(opts.latencyMs) ? Math.round(opts.latencyMs) : null,
      Number.isFinite(opts.tokensIn) ? Math.round(opts.tokensIn) : null,
      Number.isFinite(opts.tokensOut) ? Math.round(opts.tokensOut) : null,
    );
    return id;
  } catch (_e) {
    return null;
  }
}

/**
 * Record the outcome of a brain interaction. Called by the resolver
 * heartbeat once an outcome can be inferred (citation appeared,
 * error stayed fixed, synthesis got promoted to MEGA, etc.).
 */
export function resolveBrainInteraction(db, interactionId, outcome, signal) {
  if (!db || !interactionId) return false;
  if (!VALID_OUTCOMES.has(outcome)) return false;
  try {
    const r = db.prepare(
      `UPDATE brain_interactions
          SET outcome = ?, outcome_signal = ?, outcome_at = unixepoch()
        WHERE id = ? AND outcome = 'pending'`,
    ).run(outcome, JSON.stringify(signal ?? null), interactionId);
    return r.changes > 0;
  } catch (_e) {
    return false;
  }
}

/**
 * Build a positive-outcome corpus for a given brain. Returns
 * (prompt, response) pairs ready for fine-tuning or in-context
 * Modelfile baking.
 *
 * @param {object} db
 * @param {string} brainId
 * @param {object} [opts]
 * @param {number} [opts.max=200]   — cap per-call (default 200 examples)
 * @param {number} [opts.minLatencyMs=0]  — exclude super-fast cached responses
 * @param {number} [opts.sinceTs]   — only interactions newer than this unixepoch
 */
export function buildPositiveCorpus(db, brainId, opts = {}) {
  if (!db || !VALID_BRAINS.has(brainId)) return [];
  const max = Math.max(1, Math.min(opts.max ?? 200, 5000));
  const minLatency = Math.max(0, opts.minLatencyMs ?? 0);
  const sinceTs = Number.isFinite(opts.sinceTs) ? opts.sinceTs : 0;

  const rows = db.prepare(
    `SELECT prompt_json, response_json, domain, tokens_in, tokens_out
       FROM brain_interactions
      WHERE brain_id = ?
        AND outcome = 'positive'
        AND train_consented = 1
        AND response_json IS NOT NULL
        AND COALESCE(latency_ms, 0) >= ?
        AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?`,
  ).all(brainId, minLatency, sinceTs, max);

  return rows.map((r) => ({
    prompt: _safeParse(r.prompt_json),
    response: _safeParse(r.response_json),
    domain: r.domain,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
  }));
}

/**
 * Per-brain corpus statistics (counts and ratios). Used by the
 * /api/brains/stats endpoint and the daily training scheduler to
 * decide whether each brain has enough corpus to retrain.
 */
export function getBrainCorpusStats(db) {
  if (!db) return { brains: [] };
  const brains = [];
  for (const brainId of VALID_BRAINS) {
    try {
      const total = db.prepare(
        `SELECT COUNT(*) AS c FROM brain_interactions WHERE brain_id = ?`,
      ).get(brainId).c;
      const positive = db.prepare(
        `SELECT COUNT(*) AS c FROM brain_interactions
          WHERE brain_id = ? AND outcome = 'positive'`,
      ).get(brainId).c;
      const consented = db.prepare(
        `SELECT COUNT(*) AS c FROM brain_interactions
          WHERE brain_id = ? AND train_consented = 1`,
      ).get(brainId).c;
      const pending = db.prepare(
        `SELECT COUNT(*) AS c FROM brain_interactions
          WHERE brain_id = ? AND outcome = 'pending'`,
      ).get(brainId).c;
      brains.push({ brainId, total, positive, consented, pending });
    } catch (_e) {
      // Migration may not have run yet on a stale DB.
    }
  }
  return { brains };
}

function _safeParse(s) {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return s; }
}

/**
 * Outcome resolver — walks pending interactions and infers an outcome
 * from observed signals. Designed to be called from a heartbeat tick
 * (~every 5-15 minutes) so resolution happens within hours of the call.
 *
 * Resolution heuristics (conservative defaults; refine over time):
 *   - 'positive' if the same user made another brain call within 30 min
 *     of this one (engagement signal: they kept using the platform).
 *   - 'expired' if the row is older than 7 days and still pending
 *     (no signal collected in time).
 *   - Otherwise: leave pending (more time may produce a signal).
 *
 * Future signal sources (not wired here yet — placeholders for upgrade):
 *   - Citation: a DTU created near the response time was later cited
 *   - Repair: the error in the prompt context didn't recur within 24h
 *   - Synthesis: subconscious output was promoted to MEGA
 *   - User-thumbed: explicit user feedback (👍/👎) on the response
 *
 * @param {object} db
 * @param {object} [opts]
 * @param {number} [opts.batchSize=200] — max rows to walk per call
 * @param {number} [opts.engagementWindowSec=1800] — 30min default
 * @param {number} [opts.expireAfterSec=604800] — 7 days default
 * @returns {{ scanned: number, positive: number, expired: number, stillPending: number }}
 */
export function resolvePendingOutcomes(db, opts = {}) {
  if (!db) return { scanned: 0, positive: 0, expired: 0, stillPending: 0 };
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 5000));
  const engageSec = Math.max(60, opts.engagementWindowSec ?? 1800);
  const expireSec = Math.max(3600, opts.expireAfterSec ?? 7 * 86400);
  const now = Math.floor(Date.now() / 1000);

  let positive = 0;
  let expired = 0;
  let stillPending = 0;
  let scanned = 0;

  // Pull oldest pending rows first (give them more time to accumulate signal,
  // and ensures resolver progresses through the backlog rather than getting
  // stuck on a hot tail).
  const rows = db.prepare(
    `SELECT id, brain_id, user_id, created_at
       FROM brain_interactions
      WHERE outcome = 'pending'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).all(batchSize);

  const followUpStmt = db.prepare(
    `SELECT 1 FROM brain_interactions
      WHERE user_id = ?
        AND created_at > ?
        AND created_at <= ?
        AND id != ?
      LIMIT 1`,
  );

  for (const r of rows) {
    scanned++;
    const ageSec = now - r.created_at;
    if (ageSec >= expireSec) {
      const ok = resolveBrainInteraction(db, r.id, "expired", { reason: "age_exceeded", ageSec });
      if (ok) expired++;
      continue;
    }
    // Engagement check: only meaningful when we can attribute follow-ups
    // to the same user. System-internal calls (user_id null) can't be
    // engagement-resolved this way — leave them pending until expire.
    if (r.user_id) {
      const followUpEnd = r.created_at + engageSec;
      // Don't resolve as positive until the engagement window has fully
      // elapsed — otherwise we resolve on a "yes they made one quick call"
      // signal that may not actually mean satisfaction.
      if (now < followUpEnd) { stillPending++; continue; }
      const followUp = followUpStmt.get(r.user_id, r.created_at, followUpEnd, r.id);
      if (followUp) {
        const ok = resolveBrainInteraction(db, r.id, "positive", { reason: "engagement_followup", windowSec: engageSec });
        if (ok) positive++;
      } else {
        stillPending++;
      }
    } else {
      stillPending++;
    }
  }

  return { scanned, positive, expired, stillPending };
}

export const _internal = { VALID_BRAINS, VALID_OUTCOMES };
