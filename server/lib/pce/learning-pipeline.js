// server/lib/pce/learning-pipeline.js
//
// failure → signature → pattern → validate → promote (with regression gate)

import crypto from "node:crypto";
import {
  proposePatternFromFailure,
  getTopFailureSignatures,
  evaluatePatternDemotion,
} from "./pattern-promotion.js";
import {
  runRegressionGate,
  recordPatternValidation,
  updateRegressionBaselines,
} from "./pattern-regression.js";
import { fillGapsFromProvenPatterns } from "./concord-bench-patterns.js";
import { classifySolutionPath, recordDeterministicOutcome } from "./deterministic-coverage.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_learning_events'`).get();
  } catch {
    return false;
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function recordLearningEvent(db, {
  caseId, signatureHash, patternId, stage, failureClass,
  deterministic, llmRequired, meta,
} = {}) {
  if (!db || !tablesReady(db)) return null;
  const id = `ple_${crypto.randomUUID().slice(0, 12)}`;
  try {
    db.prepare(`
      INSERT INTO pce_learning_events
        (id, case_id, signature_hash, pattern_id, stage, failure_class, deterministic, llm_required, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      caseId || null,
      signatureHash || null,
      patternId || null,
      stage,
      failureClass || null,
      deterministic ? 1 : 0,
      llmRequired ? 1 : 0,
      meta ? JSON.stringify(meta) : null,
    );
    return id;
  } catch {
    return null;
  }
}

/**
 * Process a benchmark failure through the full learning pipeline.
 */
export async function processFailureLearning(db, {
  caseId, failureClass, result, intent, concordRoot,
} = {}) {
  recordLearningEvent(db, {
    caseId, stage: "failure", failureClass,
    meta: { intent, reason: result?.reason },
  });

  const gapFill = fillGapsFromProvenPatterns(db, [{ caseId, failureClass }]);

  let proposal = null;
  if (failureClass === "missing_pattern" || result?.reason === "requires_llm") {
    const sigs = getTopFailureSignatures(db, { limit: 1, minOccurrences: 1 });
    if (sigs[0]) {
      proposal = proposePatternFromFailure(db, sigs[0].signature_hash);
      recordLearningEvent(db, {
        caseId,
        signatureHash: sigs[0].signature_hash,
        patternId: proposal.patternId,
        stage: proposal.action === "created" ? "proposed" : "signature",
        failureClass,
      });
    }
  }

  return { ok: true, caseId, failureClass, gapFill, proposal };
}

/**
 * Promote pattern only after regression gate passes — prevents bad learning.
 */
export async function promotePatternWithRegression(db, patternId, { concordRoot } = {}) {
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
  const PROMOTE_MIN_APPS = Number(process.env.PCE_PROMOTE_MIN_APPS) || 5;
  const PROMOTE_MIN_SUCCESS = Number(process.env.PCE_PROMOTE_MIN_SUCCESS) || 0.8;

  if (apps < PROMOTE_MIN_APPS || rate < PROMOTE_MIN_SUCCESS) {
    return { ok: true, action: "no_change", applications: apps, successRate: rate };
  }

  if (row.status === "active") {
    return { ok: true, action: "already_active", successRate: rate };
  }

  const regression = await runRegressionGate(db, { concordRoot });
  if (!regression.ok) {
    recordPatternValidation(db, {
      patternId,
      status: "blocked",
      regression,
      blockedReason: "regression_failed",
      result: { failures: regression.failures },
    });
    recordLearningEvent(db, {
      patternId, stage: "rejected", meta: { reason: "regression_failed", failures: regression.failures },
    });
    return {
      ok: false,
      action: "blocked",
      reason: "regression_failed",
      patternId,
      regression,
    };
  }

  db.prepare(`UPDATE pce_patterns SET status = 'active', updated_at = ? WHERE pattern_id = ?`)
    .run(nowSec(), patternId);

  recordPatternValidation(db, {
    patternId, status: "passed", regression, result: { successRate: rate },
  });
  recordLearningEvent(db, { patternId, stage: "promoted", meta: { successRate: rate, regressionPassed: regression.passed } });

  return { ok: true, action: "promoted", patternId, successRate: rate, regression };
}

/**
 * Full learning pass after benchmark run.
 */
export async function runLearningPipeline(db, {
  benchResults, concordRoot, suite,
} = {}) {
  const gaps = (benchResults || []).filter((r) => !r.ok);
  const learned = [];

  for (const gap of gaps) {
    const r = await processFailureLearning(db, {
      caseId: gap.caseId,
      failureClass: gap.failureClass,
      result: gap.result,
      concordRoot,
    });
    learned.push(r);
  }

  updateRegressionBaselines(db, { suite, results: benchResults });

  const candidates = db.prepare(`
    SELECT p.pattern_id FROM pce_patterns p
    LEFT JOIN pce_pattern_stats s ON s.pattern_id = p.pattern_id
    WHERE p.status IN ('testing', 'proposed') AND (s.applications IS NULL OR s.applications >= 1)
  `).all();

  const promoted = [];
  const blocked = [];
  const demoted = [];

  for (const { pattern_id: pid } of candidates) {
    const prom = await promotePatternWithRegression(db, pid, { concordRoot });
    if (prom.action === "promoted") promoted.push(pid);
    else if (prom.action === "blocked") blocked.push({ patternId: pid, reason: prom.reason });
  }

  const activeRows = db.prepare(`SELECT pattern_id FROM pce_patterns WHERE status = 'active'`).all();
  for (const { pattern_id: pid } of activeRows) {
    const dem = evaluatePatternDemotion(db, pid);
    if (dem.action === "demoted") {
      demoted.push(pid);
      recordLearningEvent(db, { patternId: pid, stage: "demoted", meta: { successRate: dem.successRate } });
    }
  }

  return {
    ok: true,
    gapsProcessed: gaps.length,
    learned,
    promoted,
    blocked,
    demoted,
  };
}

export { classifySolutionPath, recordDeterministicOutcome };
