// server/lib/pce/concord-bench.js
//
// ConcordBench — empirical benchmark suite against the real Concord tree + sandboxes.

import crypto from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CONCORD_BENCH_CASES,
  CONCORD_BENCH_CATEGORIES,
  resolveConcordRoot,
} from "./concord-bench-cases.js";
import { findBenchCase, BENCH_SUITES } from "./bench-registry.js";
import { recordPceMetric } from "./pce-metrics.js";
import { seedConcordCorpus } from "./concord-corpus.js";
import { classifySolutionPath, recordDeterministicOutcome } from "./deterministic-coverage.js";

function sandboxDir(prefix) {
  return join(tmpdir(), `concord-bench-${prefix}-${Date.now()}`);
}

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_bench_runs'`).get();
  } catch {
    return false;
  }
}

function runId() {
  return `pbr_${crypto.randomUUID().slice(0, 12)}`;
}

function persistBenchRun(db, { suite, caseId, status, deterministic, durationMs, failureClass, result }) {
  if (!db || !tablesReady(db)) return null;
  const id = runId();
  try {
    db.prepare(`
      INSERT INTO pce_bench_runs (id, suite, case_id, status, deterministic, duration_ms, failure_class, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      suite,
      caseId,
      status,
      deterministic ? 1 : 0,
      durationMs ?? null,
      failureClass || null,
      JSON.stringify(result || {}),
    );
    return id;
  } catch {
    return null;
  }
}

function classifyFailure(result) {
  if (!result) return "unknown";
  const reason = result.reason || result.result?.reason;
  if (reason === "requires_llm" || reason === "no_matching_pattern") return "missing_pattern";
  if (reason === "verification_failed") return "verification";
  if (reason === "transform_failed") return "transform";
  if (reason === "concord_tree_missing") return "environment";
  return reason || "assertion_failed";
}

/**
 * Run a single benchmark case (any suite).
 */
export async function runConcordBenchCase(db, caseId, { concordRoot, sandbox, suite: suiteOverride } = {}) {
  const found = findBenchCase(caseId);
  const spec = found || CONCORD_BENCH_CASES.find((c) => c.id === caseId);
  if (!spec) return { ok: false, reason: "unknown_case", caseId };

  const suite = suiteOverride || found?.suite || "concord_core";
  const started = Date.now();
  const root = concordRoot || resolveConcordRoot();
  const sb = sandbox || (spec.readOnly ? root : sandboxDir(caseId.slice(0, 20)));

  try {
    seedConcordCorpus(db);
    const result = await spec.run({ db, concordRoot: root, sandbox: sb });
    const ok = result?.ok !== false;
    const durationMs = Date.now() - started;
    const failureClass = ok ? null : classifyFailure(result);
    const pathInfo = classifySolutionPath(result);

    persistBenchRun(db, {
      suite,
      caseId,
      status: ok ? "passed" : "failed",
      deterministic: pathInfo.llmRequired === false,
      durationMs,
      failureClass,
      result: { ...result, category: spec.category, description: spec.description },
    });

    recordDeterministicOutcome(db, {
      category: `bench_${suite}_${spec.category}`,
      result,
      durationMs,
      caseId,
    });

    return {
      ok,
      caseId,
      suite,
      category: spec.category,
      description: spec.description,
      readOnly: spec.readOnly,
      adversarial: spec.adversarial || false,
      failureClass,
      durationMs,
      deterministic: pathInfo.llmRequired === false,
      llmRequired: pathInfo.llmRequired,
      result,
    };
  } catch (e) {
    const durationMs = Date.now() - started;
    persistBenchRun(db, {
      suite,
      caseId,
      status: "error",
      deterministic: false,
      durationMs,
      failureClass: "exception",
      result: { error: e?.message || String(e) },
    });
    return { ok: false, caseId, suite, reason: "exception", error: e?.message, durationMs };
  } finally {
    if (!spec.readOnly && sb && sb.includes("concord-bench-")) {
      try { rmSync(sb, { recursive: true, force: true }); } catch { /* optional */ }
    }
  }
}

/**
 * Run a single benchmark suite by id.
 */
export async function runBenchSuite(db, suiteId, { concordRoot, caseIds, categories } = {}) {
  const suiteDef = BENCH_SUITES[suiteId];
  if (!suiteDef) return { ok: false, reason: "unknown_suite", suiteId };

  let cases = suiteDef.cases;
  if (caseIds?.length) cases = cases.filter((c) => caseIds.includes(c.id));
  else if (categories?.length) cases = cases.filter((c) => categories.includes(c.category));

  const root = concordRoot || resolveConcordRoot();
  const results = [];

  for (const spec of cases) {
    const r = await runConcordBenchCase(db, spec.id, { concordRoot: root, suite: suiteId });
    results.push(r);
  }

  const passed = results.filter((r) => r.ok).length;
  const failures = results.filter((r) => !r.ok);
  const byCategory = {};
  for (const r of results) {
    const cat = r.category || "unknown";
    if (!byCategory[cat]) byCategory[cat] = { passed: 0, failed: 0, cases: [] };
    if (r.ok) byCategory[cat].passed += 1;
    else byCategory[cat].failed += 1;
    byCategory[cat].cases.push(r.caseId);
  }

  return {
    ok: passed === results.length,
    suite: suiteId,
    label: suiteDef.label,
    concordRoot: root,
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 0,
    byCategory,
    gaps: failures.map((f) => ({
      caseId: f.caseId,
      category: f.category,
      failureClass: f.failureClass,
      reason: f.result?.reason || f.reason,
    })),
    results,
  };
}

/**
 * Run ConcordBench — defaults to core suite; pass suites[] for multi-suite runs.
 */
export async function runConcordBench(db, { caseIds, categories, concordRoot, suites } = {}) {
  if (suites?.length) {
    const allResults = [];
    const suiteResults = {};
    for (const suiteId of suites) {
      const r = await runBenchSuite(db, suiteId, { concordRoot, caseIds, categories });
      suiteResults[suiteId] = r;
      allResults.push(...(r.results || []));
    }
    const passed = allResults.filter((r) => r.ok).length;
    return {
      ok: passed === allResults.length,
      suite: "multi",
      suites: suiteResults,
      concordRoot: concordRoot || resolveConcordRoot(),
      total: allResults.length,
      passed,
      failed: allResults.length - passed,
      passRate: allResults.length ? passed / allResults.length : 0,
      gaps: allResults.filter((r) => !r.ok).map((f) => ({
        caseId: f.caseId,
        suite: f.suite,
        category: f.category,
        failureClass: f.failureClass,
        reason: f.result?.reason || f.reason,
      })),
      results: allResults,
    };
  }

  return runBenchSuite(db, "concord_core", { concordRoot, caseIds, categories });
}

/**
 * Summarize recent ConcordBench runs from DB.
 */
export function concordBenchHistory(db, { sinceDays = 7, limit = 100, suite } = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const rows = suite
    ? db.prepare(`
        SELECT * FROM pce_bench_runs
        WHERE suite = ? AND created_at >= ?
        ORDER BY created_at DESC LIMIT ?
      `).all(suite, since, limit)
    : db.prepare(`
        SELECT * FROM pce_bench_runs
        WHERE created_at >= ?
        ORDER BY created_at DESC LIMIT ?
      `).all(since, limit);

  const total = rows.length;
  const passed = rows.filter((r) => r.status === "passed").length;
  const byFailure = {};
  for (const r of rows.filter((x) => x.status !== "passed")) {
    const fc = r.failure_class || "unknown";
    byFailure[fc] = (byFailure[fc] || 0) + 1;
  }

  return {
    ok: true,
    windowDays: sinceDays,
    total,
    passed,
    failed: total - passed,
    passRate: total ? passed / total : null,
    topFailureClasses: Object.entries(byFailure)
      .sort((a, b) => b[1] - a[1])
      .map(([klass, count]) => ({ klass, count })),
    recent: rows.slice(0, 20).map((r) => ({
      caseId: r.case_id,
      suite: r.suite,
      status: r.status,
      failureClass: r.failure_class,
      durationMs: r.duration_ms,
      at: r.created_at,
    })),
  };
}

export { CONCORD_BENCH_CASES, CONCORD_BENCH_CATEGORIES, resolveConcordRoot };
