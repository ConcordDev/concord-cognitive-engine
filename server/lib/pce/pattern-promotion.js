// server/lib/pce/pattern-promotion.js
//
// Failure signature → proposed pattern → lifecycle promotion/demotion.

import crypto from "node:crypto";
import { registerPattern, getPattern, recordPatternOutcome } from "./pattern-ir.js";

const PROMOTE_MIN_APPS = Number(process.env.PCE_PROMOTE_MIN_APPS) || 5;
const PROMOTE_MIN_SUCCESS = Number(process.env.PCE_PROMOTE_MIN_SUCCESS) || 0.8;
const DEMOTE_MAX_SUCCESS = Number(process.env.PCE_DEMOTE_MAX_SUCCESS) || 0.4;
const PROPOSE_MIN_OCCURRENCES = Number(process.env.PCE_PROPOSE_MIN_OCCURRENCES) || 3;

function tablesReady(db, table) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  } catch {
    return false;
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Top recurring failure signatures — candidates for new deterministic capabilities.
 */
export function getTopFailureSignatures(db, { limit = 10, minOccurrences = 2 } = {}) {
  if (!db || !tablesReady(db, "pce_failure_signatures")) return [];
  return db.prepare(`
    SELECT signature_hash, pattern_id, context_json, error_json, repair_json, occurrences, last_seen_at
    FROM pce_failure_signatures
    WHERE occurrences >= ?
    ORDER BY occurrences DESC, last_seen_at DESC
    LIMIT ?
  `).all(minOccurrences, limit);
}

/**
 * Map failure class from benchmark to pattern intent template.
 */
const FAILURE_TO_INTENT = Object.freeze({
  missing_pattern: "handle coding intent with deterministic transform",
  verification: "apply safe transform with verification rollback",
  transform: "apply search replace patch to module",
  assertion_failed: "fix failing behavioral test in sandbox",
});

function inferIntentFromFailure(sig) {
  let context = {};
  let error = {};
  try { context = JSON.parse(sig.context_json || "{}"); } catch { /* optional */ }
  try { error = JSON.parse(sig.error_json || "{}"); } catch { /* optional */ }

  const errStr = String(error.error || "").toLowerCase();
  if (errStr.includes("no_matching") || errStr.includes("requires_llm")) {
    return context.intent || FAILURE_TO_INTENT.missing_pattern;
  }
  if (errStr.includes("verification")) return FAILURE_TO_INTENT.verification;
  if (errStr.includes("transform")) return FAILURE_TO_INTENT.transform;
  return context.intent || FAILURE_TO_INTENT.assertion_failed;
}

/**
 * Propose a pattern from a recurring failure signature.
 */
export function proposePatternFromFailure(db, signatureHash) {
  if (!db || !tablesReady(db, "pce_failure_signatures")) {
    return { ok: false, reason: "migration_required" };
  }
  const sig = db.prepare(`
    SELECT * FROM pce_failure_signatures WHERE signature_hash = ?
  `).get(signatureHash);
  if (!sig) return { ok: false, reason: "signature_not_found" };

  const intent = inferIntentFromFailure(sig);
  const patternId = `learned.${signatureHash}`;

  const existing = getPattern(db, patternId);
  if (existing) {
    return { ok: true, patternId, status: existing.status, action: "already_exists" };
  }

  const transform = {
    primitive: "SEARCH_REPLACE",
    args: { filePath: null, search: null, replace: null },
    note: "Parameterized — fill from mission context or manual steps",
  };

  const pattern = {
    pattern_id: patternId,
    intent,
    category: "learned",
    license: "Concord-internal",
    confidence: 0.55,
    status: "testing",
    structural_shape: { transforms: [transform], learnedFrom: signatureHash },
    verification: { testPattern: "behavior" },
    provenance: { source: "failure_signature", signatureHash, occurrences: sig.occurrences },
  };

  const reg = registerPattern(db, pattern);
  if (!reg.ok) return reg;

  if (tablesReady(db, "pce_pattern_proposals")) {
    const id = `pp_${crypto.randomUUID().slice(0, 12)}`;
    db.prepare(`
      INSERT INTO pce_pattern_proposals (id, signature_hash, pattern_id, status, source_json, transform_json, occurrences)
      VALUES (?, ?, ?, 'proposed', ?, ?, ?)
      ON CONFLICT(signature_hash, pattern_id) DO UPDATE SET
        occurrences = excluded.occurrences,
        updated_at = ?
    `).run(
      id,
      signatureHash,
      patternId,
      JSON.stringify({ intent, error: sig.error_json }),
      JSON.stringify(transform),
      sig.occurrences,
      nowSec(),
    );
  }

  return { ok: true, patternId, status: "testing", intent, action: "created" };
}

/**
 * Promote patterns with strong empirical track record: proposed/testing → active.
 */
export function evaluatePatternPromotion(db, patternId) {
  if (!db || !patternId) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`
    SELECT p.status, s.applications, s.successes, s.failures
    FROM pce_patterns p
    LEFT JOIN pce_pattern_stats s ON s.pattern_id = p.pattern_id
    WHERE p.pattern_id = ?
  `).get(patternId);
  if (!row) return { ok: false, reason: "pattern_not_found" };

  const apps = row.applications || 0;
  const rate = apps > 0 ? (row.successes || 0) / apps : 0;

  if (apps < PROMOTE_MIN_APPS || rate < PROMOTE_MIN_SUCCESS) {
    return { ok: true, action: "no_change", applications: apps, successRate: rate };
  }

  if (row.status === "active") {
    return { ok: true, action: "already_active", successRate: rate };
  }

  db.prepare(`UPDATE pce_patterns SET status = 'active', updated_at = ? WHERE pattern_id = ?`)
    .run(nowSec(), patternId);

  if (tablesReady(db, "pce_pattern_proposals")) {
    db.prepare(`
      UPDATE pce_pattern_proposals SET status = 'promoted', updated_at = ? WHERE pattern_id = ?
    `).run(nowSec(), patternId);
  }

  return { ok: true, action: "promoted", patternId, successRate: rate, applications: apps };
}

/**
 * Demote patterns that consistently fail: active → testing.
 */
export function evaluatePatternDemotion(db, patternId) {
  if (!db || !patternId) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`
    SELECT p.status, s.applications, s.successes, s.failures
    FROM pce_patterns p
    LEFT JOIN pce_pattern_stats s ON s.pattern_id = p.pattern_id
    WHERE p.pattern_id = ?
  `).get(patternId);
  if (!row || row.status !== "active") {
    return { ok: true, action: "no_change" };
  }

  const apps = row.applications || 0;
  const rate = apps > 0 ? (row.successes || 0) / apps : 0;

  if (apps < PROMOTE_MIN_APPS || rate > DEMOTE_MAX_SUCCESS) {
    return { ok: true, action: "no_change", successRate: rate };
  }

  db.prepare(`UPDATE pce_patterns SET status = 'testing', updated_at = ? WHERE pattern_id = ?`)
    .run(nowSec(), patternId);

  return { ok: true, action: "demoted", patternId, successRate: rate };
}

/**
 * Propose patterns from all recurring failure signatures.
 */
export function proposePatternsFromFailures(db, { minOccurrences = PROPOSE_MIN_OCCURRENCES } = {}) {
  const sigs = getTopFailureSignatures(db, { limit: 20, minOccurrences });
  const proposals = [];
  for (const sig of sigs) {
    proposals.push(proposePatternFromFailure(db, sig.signature_hash));
  }
  return {
    ok: true,
    examined: sigs.length,
    proposals: proposals.filter((p) => p.action === "created"),
    skipped: proposals.filter((p) => p.action === "already_exists").length,
  };
}

/**
 * Run full pattern lifecycle pass on all patterns with stats.
 * Promotion is regression-gated via learning pipeline.
 */
export async function runPatternLifecyclePass(db, { concordRoot } = {}) {
  if (!db || !tablesReady(db, "pce_patterns")) {
    return { ok: false, reason: "migration_required" };
  }

  const { promotePatternWithRegression } = await import("./learning-pipeline.js");

  const rows = db.prepare(`
    SELECT p.pattern_id, p.status, s.applications, s.successes
    FROM pce_patterns p
    LEFT JOIN pce_pattern_stats s ON s.pattern_id = p.pattern_id
    WHERE s.applications > 0 OR p.status IN ('testing', 'proposed')
  `).all();

  const promoted = [];
  const blocked = [];
  const demoted = [];

  for (const row of rows) {
    const prom = await promotePatternWithRegression(db, row.pattern_id, { concordRoot });
    if (prom.action === "promoted") promoted.push(row.pattern_id);
    else if (prom.action === "blocked") blocked.push({ patternId: row.pattern_id, reason: prom.reason });
    const dem = evaluatePatternDemotion(db, row.pattern_id);
    if (dem.action === "demoted") demoted.push(row.pattern_id);
  }

  return { ok: true, examined: rows.length, promoted, blocked, demoted };
}

export { recordPatternOutcome };
