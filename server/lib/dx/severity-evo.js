// server/lib/dx/severity-evo.js
//
// Per-codebase severity evolution for the DX Platform Phase A2.
//
// Plugin user accepts a fix → that detector's weight ticks UP slightly
// (more confident the finding mattered).
// Plugin user rejects a fix → weight ticks DOWN slightly (the rule is
// noisy in this codebase).
// Ignore → small downward drift (treated as a soft reject).
//
// Invariants (CLAUDE.md):
//   - weight is clamped to [WEIGHT_FLOOR, WEIGHT_CEILING] = [0.1, 3.0].
//     A detector can NEVER be zeroed via weighting — there's always at
//     least 10% of its base severity.
//   - require ≥ MIN_SAMPLES = 20 total decisions before adjusting.
//     Below the threshold, weight stays at 1.0 (default).
//   - reset on detector-version bump: when the row's detector_version
//     differs from the codebase's current version, the weight resets to
//     1.0 and the counters zero out.

const ACCEPT_FACTOR = 1.05;
const REJECT_FACTOR = 0.85;
const IGNORE_FACTOR = 0.97;
const WEIGHT_FLOOR = 0.1;
const WEIGHT_CEILING = 3.0;
const MIN_SAMPLES = 20;
const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const SEVERITY_FROM_RANK = ["info", "low", "medium", "high", "critical"];

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/**
 * Record a fix decision for a finding. Updates `repair_history` (if
 * `repairId` known) and bumps the (codebase, detector, rule) weight
 * counters. Returns the new weight + counts.
 *
 * @param {object} db
 * @param {object} args — { codebaseId, repairId?, detectorId, ruleId, decision, detectorVersion? }
 * @returns {{ok: boolean, weight?: number, samples?: number, reason?: string}}
 */
export function recordDecision(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { codebaseId, repairId, detectorId, ruleId, decision, detectorVersion } = args || {};
  if (!codebaseId || !detectorId || !ruleId) return { ok: false, reason: "missing_args" };
  if (!["accepted", "rejected", "ignored"].includes(decision)) {
    return { ok: false, reason: "invalid_decision" };
  }

  const tx = db.transaction(() => {
    // Stamp the repair_history row if a repairId was passed.
    if (repairId) {
      try {
        db.prepare(`
          UPDATE repair_history
          SET user_decision = ?, decided_at = unixepoch(),
              codebase_id = COALESCE(codebase_id, ?),
              finding_signature = COALESCE(finding_signature, ?)
          WHERE id = ?
        `).run(decision, codebaseId, `${detectorId}:${ruleId}`, repairId);
      } catch (err) {
        // Schema mismatch (pre-mig 143) — proceed without repair_history update.
        if (!String(err.message || "").includes("user_decision")) throw err;
      }
    }

    // Upsert the per-codebase weight row.
    db.prepare(`
      INSERT INTO codebase_severity_weights
        (codebase_id, detector_id, rule_id, weight, accept_count, reject_count, ignore_count, detector_version, updated_at)
      VALUES (?, ?, ?, 1.0, 0, 0, 0, ?, unixepoch())
      ON CONFLICT(codebase_id, detector_id, rule_id) DO NOTHING
    `).run(codebaseId, detectorId, ruleId, detectorVersion || null);

    // Detector version bump → reset.
    if (detectorVersion) {
      const cur = db.prepare(`
        SELECT detector_version FROM codebase_severity_weights
        WHERE codebase_id = ? AND detector_id = ? AND rule_id = ?
      `).get(codebaseId, detectorId, ruleId);
      if (cur && cur.detector_version && cur.detector_version !== detectorVersion) {
        db.prepare(`
          UPDATE codebase_severity_weights
          SET weight = 1.0, accept_count = 0, reject_count = 0, ignore_count = 0,
              detector_version = ?, updated_at = unixepoch()
          WHERE codebase_id = ? AND detector_id = ? AND rule_id = ?
        `).run(detectorVersion, codebaseId, detectorId, ruleId);
      }
    }

    // Increment the appropriate counter.
    const col = decision === "accepted" ? "accept_count"
              : decision === "rejected" ? "reject_count"
              : "ignore_count";
    db.prepare(`
      UPDATE codebase_severity_weights
      SET ${col} = ${col} + 1, updated_at = unixepoch()
      WHERE codebase_id = ? AND detector_id = ? AND rule_id = ?
    `).run(codebaseId, detectorId, ruleId);

    // Read counters back, decide whether to adjust weight.
    const row = db.prepare(`
      SELECT weight, accept_count, reject_count, ignore_count
      FROM codebase_severity_weights
      WHERE codebase_id = ? AND detector_id = ? AND rule_id = ?
    `).get(codebaseId, detectorId, ruleId);
    const samples = (row.accept_count || 0) + (row.reject_count || 0) + (row.ignore_count || 0);
    if (samples < MIN_SAMPLES) return { weight: row.weight, samples, adjusted: false };

    const factor = decision === "accepted" ? ACCEPT_FACTOR
                 : decision === "rejected" ? REJECT_FACTOR
                 : IGNORE_FACTOR;
    const newWeight = clamp(row.weight * factor, WEIGHT_FLOOR, WEIGHT_CEILING);
    db.prepare(`
      UPDATE codebase_severity_weights
      SET weight = ?, updated_at = unixepoch()
      WHERE codebase_id = ? AND detector_id = ? AND rule_id = ?
    `).run(newWeight, codebaseId, detectorId, ruleId);
    return { weight: newWeight, samples, adjusted: true };
  });

  try {
    const result = tx();
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Read the (codebase × detector × rule) weight, defaulting to 1.0 if no
 * row exists. Used by `applyWeights` below + the dx.getCodebaseFindings
 * macro.
 */
export function getWeight(db, codebaseId, detectorId, ruleId) {
  if (!db || !codebaseId) return 1.0;
  try {
    const row = db.prepare(`
      SELECT weight FROM codebase_severity_weights
      WHERE codebase_id = ? AND detector_id = ? AND rule_id = ?
    `).get(codebaseId, detectorId, ruleId);
    return row ? row.weight : 1.0;
  } catch {
    return 1.0;
  }
}

/**
 * Apply per-codebase weights to a list of findings. Each finding's
 * effective severity = floor(rank(severity) × weight) clamped to the
 * info..critical range. Returns a new array — does NOT mutate input.
 *
 * Rules:
 *   - weight ≥ 1.5 → bump severity by one rank (e.g., low → medium).
 *   - weight ≤ 0.7 → demote severity by one rank (e.g., medium → low).
 *   - weight ≤ 0.3 → demote by two ranks (e.g., high → low).
 *   - else → unchanged.
 *
 * Decision-based, not float-multiplicative — keeps the severity enum
 * stable. Underlying weight still drifts continuously; this is just the
 * read-side projection.
 */
export function applyWeights(findings, db, codebaseId) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  if (!db || !codebaseId) return [...findings];
  return findings.map(f => {
    const detectorId = f.category || f.detectorId || f.id?.split(":")[0] || "unknown";
    const ruleId = f.id || f.rule_id || "unknown";
    const w = getWeight(db, codebaseId, detectorId, ruleId);
    const baseRank = SEVERITY_RANK[f.severity] ?? 1;
    let delta = 0;
    if (w >= 1.5) delta = +1;
    else if (w <= 0.3) delta = -2;
    else if (w <= 0.7) delta = -1;
    const adjustedRank = clamp(baseRank + delta, 0, 4);
    const adjustedSeverity = SEVERITY_FROM_RANK[adjustedRank];
    return {
      ...f,
      severity: adjustedSeverity,
      _baseSeverity: f.severity,
      _codebaseWeight: w,
    };
  });
}

/**
 * Read a snapshot of all weights for a codebase. For the plugin's
 * "tuning state" sidebar.
 */
export function listWeightsForCodebase(db, codebaseId) {
  if (!db || !codebaseId) return [];
  try {
    return db.prepare(`
      SELECT detector_id, rule_id, weight, accept_count, reject_count, ignore_count, updated_at
      FROM codebase_severity_weights
      WHERE codebase_id = ?
      ORDER BY weight ASC, updated_at DESC
    `).all(codebaseId);
  } catch {
    return [];
  }
}

export const _internals = {
  ACCEPT_FACTOR, REJECT_FACTOR, IGNORE_FACTOR,
  WEIGHT_FLOOR, WEIGHT_CEILING, MIN_SAMPLES,
};
