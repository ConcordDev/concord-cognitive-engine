// server/tests/depth/pce-concord-bench.test.js
//
// ConcordBench + empirical improvement loop behavioral tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upTier2 } from "../../migrations/429_dila_tier2_brain.js";
import { up as upWaves } from "../../migrations/430_dila_waves_abcd.js";
import { up as upPce } from "../../migrations/431_pce_substrate.js";
import { up as upMetrics } from "../../migrations/432_pce_metrics.js";
import { up as upBenchRuns } from "../../migrations/433_pce_bench_runs.js";
import { up as upLearning } from "../../migrations/434_pce_learning.js";
import {
  runConcordBench,
  runConcordBenchCase,
  concordBenchHistory,
  resolveConcordRoot,
  CONCORD_BENCH_CASES,
} from "../../lib/pce/concord-bench.js";
import { runPceImprovementCycle, analyzeBenchmarkGaps } from "../../lib/pce/pce-improvement-cycle.js";
import {
  proposePatternFromFailure,
  proposePatternsFromFailures,
  evaluatePatternPromotion,
  runPatternLifecyclePass,
} from "../../lib/pce/pattern-promotion.js";
import { runPceBenchCategory } from "../../lib/pce/pce-bench.js";
import crypto from "node:crypto";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upPhases(db);
  upTier(db);
  upDila(db);
  upV2(db);
  upExec(db);
  upTier2(db);
  upWaves(db);
  upPce(db);
  upMetrics(db);
  upBenchRuns(db);
  upLearning(db);
  return db;
}

function seedFailureSignature(db, { patternId = null, error = "no_matching_pattern", intent = "fix auth bug" } = {}) {
  const sig = JSON.stringify({ patternId, error });
  const hash = crypto.createHash("sha256").update(sig).digest("hex").slice(0, 16);
  db.prepare(`
    INSERT INTO pce_failure_signatures (signature_hash, pattern_id, context_json, error_json, occurrences, last_seen_at)
    VALUES (?, ?, ?, ?, 5, ?)
  `).run(hash, patternId, JSON.stringify({ intent }), JSON.stringify({ error }), Math.floor(Date.now() / 1000));
  return hash;
}

describe("ConcordBench — case catalog", () => {
  it("defines Concord-realistic cases across categories", () => {
    assert.ok(CONCORD_BENCH_CASES.length >= 16);
    const cats = new Set(CONCORD_BENCH_CASES.map((c) => c.category));
    assert.ok(cats.has("repository_intelligence"));
    assert.ok(cats.has("bug_repair"));
    assert.ok(cats.has("security_repair"));
  });

  it("resolveConcordRoot finds monorepo from server cwd", () => {
    const root = resolveConcordRoot();
    assert.ok(root.includes("concord-cognitive-engine") || root.length > 0);
  });
});

describe("ConcordBench — read-only against real tree", () => {
  it("indexes real Concord server tree", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_repo_index");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("builds repo brain on real Concord tree", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_repo_brain");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("matches migration pattern from Concord corpus", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_pattern_migration_match");
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});

describe("ConcordBench — sandboxed PCE cases", () => {
  it("PCE fixes bug in sandbox", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_pce_bug_fix");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("rejects secret injection", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_secret_reject");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("rolls back on verification failure", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_rollback_on_fail");
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});

describe("ConcordBench — full suite", () => {
  it("runConcordBench executes all cases and records history", async () => {
    const db = setupDb();
    const bench = await runConcordBench(db);
    assert.ok(bench.total >= 16);
    assert.ok(bench.passRate >= 0.85, `passRate ${bench.passRate}: ${JSON.stringify(bench.gaps)}`);
    const hist = concordBenchHistory(db, { sinceDays: 1 });
    assert.equal(hist.ok, true);
    assert.ok(hist.total >= bench.total);
  });
});

describe("PCEBench — real category implementations", () => {
  it("security_repair runs secret scan gate", async () => {
    const db = setupDb();
    const r = await runPceBenchCategory(db, "security_repair");
    assert.equal(r.ok, true);
  });

  it("test_generation creates depth test file", async () => {
    const db = setupDb();
    const r = await runPceBenchCategory(db, "test_generation");
    assert.equal(r.ok, true);
  });

  it("api_change adds export", async () => {
    const db = setupDb();
    const r = await runPceBenchCategory(db, "api_change");
    assert.equal(r.ok, true);
  });
});

describe("Pattern promotion — failure to capability", () => {
  it("proposes pattern from recurring failure signature", () => {
    const db = setupDb();
    const hash = seedFailureSignature(db, { error: "no_matching_pattern", intent: "add migration column" });
    const p = proposePatternFromFailure(db, hash);
    assert.equal(p.ok, true);
    assert.equal(p.action, "created");
    assert.match(p.patternId, /^learned\./);
  });

  it("promotes pattern when success rate qualifies", () => {
    const db = setupDb();
    const hash = seedFailureSignature(db);
    const p = proposePatternFromFailure(db, hash);
    const pid = p.patternId;
    db.prepare(`
      UPDATE pce_pattern_stats SET applications = 10, successes = 9, failures = 1 WHERE pattern_id = ?
    `).run(pid);
    db.prepare(`UPDATE pce_patterns SET status = 'testing' WHERE pattern_id = ?`).run(pid);
    const prom = evaluatePatternPromotion(db, pid);
    assert.equal(prom.action, "promoted");
  });

  it("proposePatternsFromFailures batches recurring signatures", () => {
    const db = setupDb();
    seedFailureSignature(db, { error: "verification_failed" });
    seedFailureSignature(db, { error: "transform_failed", intent: "patch module" });
    const batch = proposePatternsFromFailures(db);
    assert.ok(batch.examined >= 2);
    assert.ok(batch.proposals.length >= 1);
  });
});

describe("ConcordBench — extended cases", () => {
  it("rejects fake progress via honesty gate", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_honesty_reject");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("authors migration in sandbox", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_migration_authoring");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("indexes repo graph edges on real tree", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_repo_graph_edges");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("verifies Dila empirical macros are wired", async () => {
    const db = setupDb();
    const r = await runConcordBenchCase(db, "concord_dila_surface_wired");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("seeds proven bench patterns into pattern IR", async () => {
    const db = setupDb();
    const { seedConcordCorpus } = await import("../../lib/pce/concord-corpus.js");
    const { seedProvenBenchPatterns } = await import("../../lib/pce/concord-bench-patterns.js");
    seedConcordCorpus(db);
    const r = seedProvenBenchPatterns(db, { onlyMissing: false });
    assert.ok(r.count >= 5);
    const row = db.prepare(`SELECT COUNT(*) AS c FROM pce_patterns WHERE pattern_id LIKE 'concord.%'`).get();
    assert.ok(row.c >= 9, `expected >=9 concord patterns, got ${row.c}`);
  });
});

describe("ConcordBench report", () => {
  it("buildConcordBenchReport returns grade and recommendations", async () => {
    const db = setupDb();
    await runConcordBench(db);
    const { buildConcordBenchReport } = await import("../../lib/pce/concord-bench-report.js");
    const report = buildConcordBenchReport(db, { sinceDays: 1 });
    assert.equal(report.ok, true);
    assert.ok(["excellent", "good", "needs_work", "critical", "unknown"].includes(report.grade));
    assert.ok(Array.isArray(report.recommendations));
  });
});

describe("Honesty verification gate", () => {
  it("gateHonestyScan rejects setInterval fake progress", async () => {
    const { gateHonestyScan } = await import("../../lib/pce/verification-pipeline.js");
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = join(tmpdir(), `honesty-${Date.now()}`);
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "bad.js"), "setInterval(() => {}, 100);\n");
    const r = gateHonestyScan(["lib/bad.js"], dir);
    assert.equal(r.ok, false);
    assert.equal(r.hardReject, true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Mission template — pce_excellence_cycle", () => {
  it("pce_excellence_cycle template wires excellence + lifecycle tools", async () => {
    const { MISSION_TEMPLATES } = await import("../../lib/mission-templates.js");
    const tpl = MISSION_TEMPLATES.pce_excellence_cycle;
    const tools = (tpl?.steps || []).map((s) => s.tool);
    assert.ok(tools.includes("pce_excellence_run"));
    assert.ok(tools.includes("pattern_lifecycle_run"));
  });
});

describe("PCE improvement cycle — ouroboros loop", () => {
  it("runPceImprovementCycle benchmarks and analyzes gaps", async () => {
    const db = setupDb();
    const cycle = await runPceImprovementCycle({ db });
    assert.equal(cycle.cycle, "pce_improvement");
    assert.ok(cycle.concordBench.total >= 40);
    assert.ok(cycle.concordBench.passRate >= 0.75);
    assert.ok(cycle.gapAnalysis || cycle.learning);
    assert.ok(Array.isArray(cycle.nextActions));
  });

  it("analyzeBenchmarkGaps maps failures to actions", () => {
    const gaps = analyzeBenchmarkGaps({
      gaps: [{ caseId: "x", failureClass: "missing_pattern" }],
      failureClasses: { missing_pattern: 2 },
      passRate: 0.9,
    });
    assert.equal(gaps.gapCount, 1);
    assert.equal(gaps.priorities[0].action, "add_deterministic_pattern");
  });
});

describe("Bench registry — engineering + adversarial suites", () => {
  it("catalog includes core, engineering, and adversarial cases", async () => {
    const { listBenchSuites, ALL_BENCH_CASE_COUNT } = await import("../../lib/pce/bench-registry.js");
    const suites = listBenchSuites();
    assert.equal(suites.length, 3);
    assert.ok(ALL_BENCH_CASE_COUNT >= 40, `expected >=40 cases, got ${ALL_BENCH_CASE_COUNT}`);
  });

  it("engineering suite validates real Concord surfaces", async () => {
    const db = setupDb();
    const { runBenchSuite } = await import("../../lib/pce/concord-bench.js");
    const r = await runBenchSuite(db, "concord_engineering");
    assert.ok(r.total >= 15);
    assert.ok(r.passRate >= 0.85, `engineering passRate ${r.passRate}: ${JSON.stringify(r.gaps)}`);
  });

  it("adversarial suite stresses verification and rollback", async () => {
    const db = setupDb();
    const { runBenchSuite } = await import("../../lib/pce/concord-bench.js");
    const r = await runBenchSuite(db, "concord_adversarial");
    assert.ok(r.total >= 8);
    assert.ok(r.passRate >= 0.8, `adversarial passRate ${r.passRate}: ${JSON.stringify(r.gaps)}`);
  });
});

describe("Regression gate — bad learning prevention", () => {
  it("updateRegressionBaselines ratchets passing cases", async () => {
    const db = setupDb();
    const { updateRegressionBaselines, listRegressionBaselines } = await import("../../lib/pce/pattern-regression.js");
    const r = updateRegressionBaselines(db, {
      suite: "concord_core",
      results: [{ ok: true, caseId: "concord_repo_index" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.added, 1);
    const baselines = listRegressionBaselines(db);
    assert.ok(baselines.some((b) => b.case_id === "concord_repo_index"));
  });

  it("promotePatternWithRegression blocks when regression fails", async () => {
    const db = setupDb();
    const { promotePatternWithRegression } = await import("../../lib/pce/learning-pipeline.js");
    const hash = seedFailureSignature(db);
    const p = proposePatternFromFailure(db, hash);
    db.prepare(`UPDATE pce_pattern_stats SET applications = 10, successes = 9, failures = 1 WHERE pattern_id = ?`).run(p.patternId);
    db.prepare(`UPDATE pce_patterns SET status = 'testing' WHERE pattern_id = ?`).run(p.patternId);
    db.prepare(`INSERT INTO pce_regression_baselines (case_id, suite, status) VALUES ('nonexistent_case_xyz', 'concord_core', 'baseline')`).run();
    const prom = await promotePatternWithRegression(db, p.patternId);
    assert.equal(prom.action, "blocked");
    assert.equal(prom.reason, "regression_failed");
  });
});

describe("Dangerous SQL gate", () => {
  it("gateDangerousSql rejects DROP TABLE in migrations", async () => {
    const { gateDangerousSql } = await import("../../lib/pce/verification-pipeline.js");
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = join(tmpdir(), `sql-gate-${Date.now()}`);
    mkdirSync(join(dir, "server", "migrations"), { recursive: true });
    writeFileSync(join(dir, "server", "migrations", "999_evil.js"), `export function up(db) { db.exec("DROP TABLE users;"); }\n`);
    const r = gateDangerousSql(["server/migrations/999_evil.js"], dir);
    assert.equal(r.ok, false);
    assert.equal(r.hardReject, true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("PCE excellence cycle", () => {
  it("runPceExcellenceCycle runs all suites and records history", async () => {
    const db = setupDb();
    const { runPceExcellenceCycle, excellenceRunHistory } = await import("../../lib/pce/pce-excellence-runner.js");
    const cycle = await runPceExcellenceCycle({ db });
    assert.equal(cycle.cycle, "pce_excellence");
    assert.ok(cycle.total >= 40);
    assert.ok(cycle.passRate >= 0.75, `passRate ${cycle.passRate}`);
    const hist = excellenceRunHistory(db);
    assert.equal(hist.ok, true);
    assert.ok(hist.runs.length >= 1);
  });
});
