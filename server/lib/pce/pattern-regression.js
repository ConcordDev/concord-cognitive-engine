// server/lib/pce/pattern-regression.js
//
// Regression gate — block pattern promotion if baseline cases break.

import crypto from "node:crypto";
import { findBenchCase } from "./bench-registry.js";
import { runConcordBenchCase } from "./concord-bench.js";

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
 * Record passing cases as regression baselines (ratchet — only grows).
 */
export function updateRegressionBaselines(db, { suite, results } = {}) {
  if (!db || !tablesReady(db, "pce_regression_baselines")) {
    return { ok: false, reason: "migration_required" };
  }
  let added = 0;
  let updated = 0;
  // Prepared statements hoisted out of the loop (was re-preparing each iter).
  const selStmt = db.prepare(`SELECT case_id FROM pce_regression_baselines WHERE case_id = ?`);
  const updStmt = db.prepare(`
    UPDATE pce_regression_baselines
    SET last_passed_at = ?, pass_count = pass_count + 1, suite = ?
    WHERE case_id = ?
  `);
  const insStmt = db.prepare(`
    INSERT INTO pce_regression_baselines (case_id, suite, status, last_passed_at, pass_count)
    VALUES (?, ?, 'baseline', ?, 1)
  `);
  for (const r of results || []) {
    if (!r.ok || !r.caseId) continue;
    if (selStmt.get(r.caseId)) {
      updStmt.run(nowSec(), suite || r.suite || "concord_core", r.caseId);
      updated += 1;
    } else {
      insStmt.run(r.caseId, suite || r.suite || "concord_core", nowSec());
      added += 1;
    }
  }
  return { ok: true, added, updated, total: (results || []).filter((r) => r.ok).length };
}

export function listRegressionBaselines(db) {
  if (!db || !tablesReady(db, "pce_regression_baselines")) return [];
  return db.prepare(`
    SELECT case_id, suite, status, last_passed_at, pass_count
    FROM pce_regression_baselines WHERE status = 'baseline'
    ORDER BY suite, case_id
  `).all();
}

/**
 * Run all regression baseline cases — must all pass before promotion.
 */
export async function runRegressionGate(db, { concordRoot, caseIds } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const baselines = caseIds?.length
    ? caseIds.map((id) => ({ case_id: id }))
    : listRegressionBaselines(db);

  if (!baselines.length) {
    return { ok: true, reason: "no_baselines_yet", passed: 0, failed: 0, results: [] };
  }

  const results = [];
  for (const row of baselines) {
    const caseId = row.case_id || row;
    const spec = findBenchCase(caseId);
    if (!spec) {
      results.push({ ok: false, caseId, reason: "case_not_found" });
      continue;
    }
    const r = await runConcordBenchCase(db, caseId, { concordRoot });
    results.push({ ...r, suite: spec.suite });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const failures = results.filter((r) => !r.ok);

  return {
    ok: failed === 0,
    passed,
    failed,
    total: results.length,
    failures: failures.map((f) => ({ caseId: f.caseId, failureClass: f.failureClass, reason: f.result?.reason })),
    results,
  };
}

export function recordPatternValidation(db, { patternId, status, regression, blockedReason, result }) {
  if (!db || !tablesReady(db, "pce_pattern_validations")) return null;
  const id = `pv_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO pce_pattern_validations
      (id, pattern_id, status, regression_pass, regression_fail, blocked_reason, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    patternId,
    status,
    regression?.passed || 0,
    regression?.failed || 0,
    blockedReason || null,
    JSON.stringify(result || {}),
  );
  return id;
}
