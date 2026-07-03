// server/lib/dtu-confidence.js
//
// Persistent, revisable DTU confidence layer (migration 354 `dtu_confidence`).
//
// Concord's existing `confidence` fields (e.g. on causal edges, evidence
// entries) are one-time creation-time snapshots — nothing ever revises them
// as later evidence comes in. This module is a SEPARATE, additive belief
// score per DTU that moves in response to three REAL event sources:
//
//   1. Citation registration succeeding (server.js, dtu.create's citation-
//      lineage block) — a small positive nudge on the CITED (parent) DTU.
//   2. Drift-monitor detecting an UNEXPLAINED contradiction (server/emergent/
//      drift-monitor.js#detectContradictionCausalContext, the "no causal
//      edge" branch) — a small negative nudge on BOTH DTUs in the pair.
//   3. Time — a lazy read-time decay blend toward the honest-neutral 0.5,
//      using the exact same exponential shape as server/emergent/
//      forgetting-engine.js#retentionScore's `ageDecay` term (90-day
//      half-life constant), replicated here rather than imported because
//      retentionScore needs a full `dtu` + `STATE` object (child-count,
//      lineage, tier, emotional-bonus, etc.) that doesn't apply to a bare
//      confidence row — only the decay CONSTANT is shared, not the function.
//
// CONSTITUTIONAL BOUNDARY: this file must NEVER import from
// server/economy/**, touch `royalty_lineage`, touch `dtu_citations`, or
// influence any marketplace-fee constant. See CLAUDE.md's constitutionally-
// protected-files list. Citation registration is observed from its CALLER
// in server.js (the `result?.ok` branch), never from inside the economy
// module itself.
//
// ── Simplification, documented up front (per the honest-by-construction
// rule) ──────────────────────────────────────────────────────────────────
// `updateConfidence` is NOT a Kalman filter and NOT a proper Bayesian
// posterior update (no prior/likelihood distributions, no variance
// tracking). It's a cheap, defensible heuristic that behaves DIRECTIONALLY
// like one: each new piece of evidence moves the score by `delta`, but the
// move shrinks as `1 / (evidenceCount + 1)` — so a DTU with 20 pieces of
// accumulated evidence is much harder to swing than a brand-new one. That
// "more evidence = more stable belief" property is the only thing borrowed
// from real Bayesian updating; there's no matrix math and no claim of
// statistical rigor beyond that.
//
// ── Honest-unknown vs. confirmed-neutral ───────────────────────────────────
// A DTU with NO row in `dtu_confidence` yet returns `{ known: false,
// score: 0.5, evidenceCount: 0 }` — the score value is a placeholder, not a
// belief. A DTU that has genuinely accumulated evidence and settled back
// near 0.5 (e.g. one positive and one negative nudge cancelling out) returns
// `{ known: true, score: ~0.5, evidenceCount: 2 }` — a REAL confirmed-
// neutral reading. Callers must branch on `known`, never infer confidence
// from `score` alone.

import logger from "../logger.js";

// Same numeric constant as server/emergent/forgetting-engine.js:102
// (`Math.exp(-age / (90 * 86400000))`, labelled a "90-day half-life" in that
// file's own comment). Replicated here per this unit's instructions rather
// than imported, since retentionScore's signature requires a full dtu+STATE
// graph traversal this module has no use for.
const CONFIDENCE_DECAY_MS = 90 * 86400000;

function tableExists(db, table) {
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
  } catch {
    return false;
  }
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Read a DTU's current confidence, honest-unknown when no row exists yet.
 *
 * Applies a lazy time-decay blend toward 0.5 at read time — the stored
 * `score` is blended toward honest-neutral proportional to
 * `Math.exp(-age / CONFIDENCE_DECAY_MS)` (same shape/constant as
 * forgetting-engine's ageDecay), so a confidence value nobody has revisited
 * in a long time naturally drifts back toward "we don't really know" rather
 * than staying artificially pinned at a stale extreme forever. The DB row
 * itself is NOT rewritten by a read — this is presentation-layer decay only,
 * same "lazy at read time" pattern the unit spec asked for instead of a
 * dedicated sweep heartbeat.
 *
 * Never throws — a missing table, missing row, or missing db all degrade to
 * the honest-unknown shape.
 *
 * @param {object} db
 * @param {string} dtuId
 * @returns {{dtuId:string, score:number, evidenceCount:number, known:boolean, lastUpdated:number|null}}
 */
export function getConfidence(db, dtuId) {
  const unknown = { dtuId: String(dtuId || ""), score: 0.5, evidenceCount: 0, known: false, lastUpdated: null };
  if (!db || !dtuId) return unknown;
  try {
    if (!tableExists(db, "dtu_confidence")) return unknown;
    const row = db.prepare("SELECT * FROM dtu_confidence WHERE dtu_id = ?").get(String(dtuId));
    if (!row) return unknown;

    const now = Date.now();
    const age = Math.max(0, now - (row.last_updated || now));
    const ageDecay = Math.exp(-age / CONFIDENCE_DECAY_MS);
    // Blend: at age=0, ageDecay=1 -> score unchanged. As age grows,
    // ageDecay -> 0 and the reading blends fully toward 0.5.
    const blended = clamp01(0.5 + (row.score - 0.5) * ageDecay);

    return {
      dtuId: String(dtuId),
      score: blended,
      evidenceCount: row.evidence_count || 0,
      known: true,
      lastUpdated: row.last_updated,
    };
  } catch (e) {
    logger.debug("dtu-confidence", "get_confidence_failed", { dtuId, error: e?.message });
    return unknown;
  }
}

/**
 * Nudge a DTU's confidence by `delta`, with diminishing influence as
 * evidence accumulates. See the module header for why this is a documented
 * simplification, not a real Bayesian posterior update.
 *
 * Creates the row (score 0.5, evidenceCount 0) if none exists yet, then
 * applies:
 *
 *   newScore = clamp(oldScore + delta * (1 / (evidenceCount + 1)), 0, 1)
 *
 * i.e. the FIRST piece of evidence moves the score by the full `delta`, the
 * second by half, the third by a third, and so on — a crude but real
 * "more evidence = more stable belief" property.
 *
 * Best-effort by design: every call site in this codebase wraps this in its
 * own try/catch (never blocking the citation cascade or the drift scan), but
 * this function itself also never throws — it returns `null` on failure so
 * a caller that forgets the wrapper still degrades safely.
 *
 * @param {object} db
 * @param {string} dtuId
 * @param {number} delta   — signed nudge, e.g. +0.05 for a positive signal.
 * @param {string} [reason] — logging only, not persisted to a new table.
 * @returns {{dtuId:string, score:number, evidenceCount:number}|null}
 */
export function updateConfidence(db, dtuId, delta, reason) {
  if (!db || !dtuId || !Number.isFinite(delta)) return null;
  try {
    if (!tableExists(db, "dtu_confidence")) return null;
    const id = String(dtuId);
    const now = Date.now();

    db.prepare(
      `INSERT OR IGNORE INTO dtu_confidence (dtu_id, score, evidence_count, last_updated)
       VALUES (?, 0.5, 0, ?)`,
    ).run(id, now);

    const row = db.prepare("SELECT * FROM dtu_confidence WHERE dtu_id = ?").get(id);
    const evidenceCount = row.evidence_count || 0;
    const influence = 1 / (evidenceCount + 1);
    const newScore = clamp01(row.score + delta * influence);

    db.prepare(
      `UPDATE dtu_confidence SET score = ?, evidence_count = evidence_count + 1, last_updated = ? WHERE dtu_id = ?`,
    ).run(newScore, now, id);

    logger.debug("dtu-confidence", "update_confidence", { dtuId: id, delta, reason, newScore, evidenceCount: evidenceCount + 1 });

    return { dtuId: id, score: newScore, evidenceCount: evidenceCount + 1 };
  } catch (e) {
    logger.debug("dtu-confidence", "update_confidence_failed", { dtuId, delta, reason, error: e?.message });
    return null;
  }
}
