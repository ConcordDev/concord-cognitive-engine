// tests/depth/legacy-behavior.test.js — REAL behavioral tests for the
// legacy domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs + CRUD round-trips + validation.
// Every lensRun("legacy", "<macro>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
//
// NB: lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("legacy — analysis calc contracts (exact computed values)", () => {
  it("technicalDebt: high-complexity, low-coverage, stale module scores critical with exact breakdown", async () => {
    const r = await lensRun("legacy", "technicalDebt", {
      data: {
        modules: [{
          name: "billing.cob",
          linesOfCode: 2000,
          cyclomaticComplexity: 30,      // (30-10)*1.5 = 30 → capped at 30
          dependencyCount: 0,
          dependencyAgeYears: 0,
          testCoverage: 0,               // (100-0)*0.25 = 25 → coverage debt 25
          duplicateRatio: 0,
          lastModifiedDaysAgo: 400,      // > 365 → staleDebt 10
        }],
      },
    });
    assert.equal(r.ok, true);
    const m = r.result.modules[0];
    // complexity 30 + coverage 25 + deps 0 + dup 0 + stale 10 = 65
    assert.equal(m.debtScore, 65);
    assert.equal(m.debtLevel, "critical");
    assert.equal(m.debtBreakdown.complexity, 30);
    assert.equal(m.debtBreakdown.coverage, 25);
    assert.equal(m.debtBreakdown.staleness, 10);
    assert.equal(m.remediationHours, 130); // 65 * 2
    assert.equal(r.result.summary.criticalModules, 1);
    assert.equal(r.result.summary.totalModules, 1);
  });

  it("technicalDebt: a clean module scores low debt; modules sort by debt descending", async () => {
    const r = await lensRun("legacy", "technicalDebt", {
      data: {
        modules: [
          { name: "clean.js", linesOfCode: 100, cyclomaticComplexity: 3, testCoverage: 95, lastModifiedDaysAgo: 10 },
          { name: "rotten.cob", linesOfCode: 3000, cyclomaticComplexity: 40, testCoverage: 0, lastModifiedDaysAgo: 500 },
        ],
      },
    });
    assert.equal(r.ok, true);
    // sorted by debt descending → rotten first
    assert.equal(r.result.modules[0].name, "rotten.cob");
    assert.equal(r.result.modules[1].name, "clean.js");
    assert.equal(r.result.modules[1].debtLevel, "low");
    assert.equal(r.result.summary.totalModules, 2);
    assert.equal(r.result.topDebtSources[0].name, "rotten.cob");
  });

  it("technicalDebt: empty module list returns a message, not an error", async () => {
    const r = await lensRun("legacy", "technicalDebt", { data: { modules: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No modules to analyze.");
  });

  it("migrationReadiness: a leaf module with a portable store is 'ready'; coupling is loose", async () => {
    const r = await lensRun("legacy", "migrationReadiness", {
      data: {
        system: {
          modules: [
            { name: "api", dependencies: [], apis: [{ endpoint: "/health", consumers: 1 }], dataStores: [{ type: "postgres", sizeGb: 1 }] },
            { name: "worker", dependencies: ["redis"], apis: [], dataStores: [{ type: "json", sizeGb: 0 }] },
          ],
        },
      },
    });
    assert.equal(r.ok, true);
    const api = r.result.moduleReadiness.find((m) => m.module === "api");
    // depScore 25 (no deps), apiScore 25-0.5 = 24.5, dataScore 100*0.25=25, sizeScore 25-0.5=24.5 → 99
    assert.equal(api.readinessScore, 99);
    assert.equal(api.readinessLevel, "ready");
    // redis is external (not a module name) → counted external
    const worker = r.result.moduleReadiness.find((m) => m.module === "worker");
    assert.deepEqual(worker.externalDependencies, ["redis"]);
    // no internal deps anywhere → couplingScore 0 → loosely_coupled
    assert.equal(r.result.coupling.score, 0);
    assert.equal(r.result.coupling.level, "loosely_coupled");
    assert.equal(r.result.summary.totalModules, 2);
    assert.equal(r.result.summary.externalDependencyCount, 1);
  });

  it("migrationReadiness: internal dependency raises coupling and orders migration leaves-first", async () => {
    const r = await lensRun("legacy", "migrationReadiness", {
      data: {
        system: {
          modules: [
            { name: "a", dependencies: ["b"] }, // a depends on internal b
            { name: "b", dependencies: [] },
          ],
        },
      },
    });
    assert.equal(r.ok, true);
    // 1 internal dep / (2*1=2 max) = 50% → couplingScore 50, level moderately_coupled (>20, not >50)
    assert.equal(r.result.coupling.score, 50);
    assert.equal(r.result.coupling.level, "moderately_coupled");
    // migration order: b (0 internal deps) before a (1 internal dep)
    assert.equal(r.result.migrationOrder[0].module, "b");
    assert.equal(r.result.migrationOrder[1].module, "a");
  });

  it("migrationReadiness: empty system returns a message", async () => {
    const r = await lensRun("legacy", "migrationReadiness", { data: { system: { modules: [] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No system modules defined.");
  });

  it("riskMap: single-holder critical component with increasing failures scores high", async () => {
    const r = await lensRun("legacy", "riskMap", {
      data: {
        components: [{
          name: "payments",
          criticality: 5,
          knowledgeHolders: ["alice"],     // busFactor 1 → busFactorRisk 4
          failures: [
            { date: "2026-01-01", severity: 4 },
            { date: "2026-06-01", severity: 5 }, // second half heavier
            { date: "2026-06-05", severity: 5 },
          ],
        }],
      },
    });
    assert.equal(r.ok, true);
    const c = r.result.components[0];
    assert.equal(c.criticality.label, "critical");
    assert.equal(c.busFactor.holders, 1);
    assert.equal(c.busFactor.warning, "Single point of knowledge failure");
    assert.equal(c.busFactor.riskScore, 4);
    // criticality 30 + busFactor (4/5)*25=20 + failures(3*2=6 + increasing 10=16) + severity ((4+5+5)/3=4.67 → (4.67/5)*20=18.68)
    assert.equal(c.riskBreakdown.criticality, 30);
    assert.equal(c.riskBreakdown.busFactor, 20);
    assert.equal(c.failures.total, 3);
    assert.equal(c.failures.trend, "increasing");
    assert.equal(r.result.summary.singleHolderCount, 1);
    assert.equal(r.result.summary.increasingFailureCount, 1);
    // alice is a key person risk
    assert.equal(r.result.keyPersonRisks[0].person, "alice");
    assert.equal(r.result.keyPersonRisks[0].componentCount, 1);
  });

  it("riskMap: a well-staffed low-criticality component with no failures is low risk", async () => {
    const r = await lensRun("legacy", "riskMap", {
      data: {
        components: [{
          name: "docs-site",
          criticality: 1,
          knowledgeHolders: ["a", "b", "c", "d", "e"], // busFactorRisk 1
          failures: [],
        }],
      },
    });
    assert.equal(r.ok, true);
    const c = r.result.components[0];
    // criticality (1/5)*30=6 + busFactor (1/5)*25=5 + failures 0 + severity 0 = 11
    assert.equal(c.riskScore, 11);
    assert.equal(c.riskLevel, "low");
    assert.equal(c.busFactor.warning, null);
    assert.equal(c.failures.mtbfDays, null);
  });

  it("riskMap: empty components returns a message", async () => {
    const r = await lensRun("legacy", "riskMap", { data: { components: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No components to assess.");
  });
});

describe("legacy — scan + derived analysis (exact metrics)", () => {
  it("scanCodebase: derives language, LOC (comments excluded), complexity, deps, todos", async () => {
    const r = await lensRun("legacy", "scanCodebase", {
      params: {
        name: "demo",
        files: [
          {
            path: "src/a.js",
            content: [
              "// header comment",
              "import { x } from './b';",
              "function f(n) {",
              "  if (n > 0) { return 1; }", // one branch → +1
              "  return 0;",
              "}",
              "// TODO: refactor",
            ].join("\n"),
          },
          {
            path: "src/b.js",
            content: "export const x = 1;\n",
          },
        ],
      },
    });
    assert.equal(r.ok, true);
    const a = r.result.files.find((f) => f.path === "src/a.js");
    assert.equal(a.language, "JavaScript");
    // non-comment, non-blank lines: import, function f, if-line, return 0, } = 5
    assert.equal(a.linesOfCode, 5);
    assert.equal(a.cyclomaticComplexity, 2); // 1 branch (if) + 1
    assert.deepEqual(a.dependencies, ["./b"]);
    assert.equal(a.dependencyCount, 1);
    assert.equal(a.todoCount, 1);
    assert.equal(a.isTest, false);
    assert.equal(r.result.codebase.summary.fileCount, 2);
    assert.equal(r.result.codebase.languages[0].language, "JavaScript");
  });

  it("scanCodebase: COBOL file is flagged a legacy language; test files counted separately", async () => {
    const r = await lensRun("legacy", "scanCodebase", {
      params: {
        name: "mainframe",
        files: [
          { path: "payroll.cob", content: "       PERFORM UNTIL DONE\n       MOVE A TO B\n" },
          { path: "payroll.test.js", content: "const z = 1;\n" },
        ],
      },
    });
    assert.equal(r.ok, true);
    const cob = r.result.files.find((f) => f.path === "payroll.cob");
    assert.equal(cob.language, "COBOL");
    assert.equal(cob.isLegacyLanguage, true);
    const t = r.result.files.find((f) => f.path === "payroll.test.js");
    assert.equal(t.isTest, true);
    assert.equal(t.language, "JavaScript");
    assert.equal(r.result.codebase.summary.legacyLanguageFiles, 1);
    assert.equal(r.result.codebase.summary.testFiles, 1);
    assert.equal(r.result.codebase.summary.productionFiles, 1);
  });

  it("scanCodebase: no files supplied is rejected", async () => {
    const r = await lensRun("legacy", "scanCodebase", { params: { name: "empty", files: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /no files supplied/);
  });

  it("dependencyGraph: resolves import edges, computes fan-in/out, detects a cycle", async () => {
    const r = await lensRun("legacy", "dependencyGraph", {
      params: {
        files: [
          { path: "a.js", content: "import './b';\n" },
          { path: "b.js", content: "import './a';\n" }, // a↔b cycle
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.nodeCount, 2);
    assert.equal(r.result.summary.edgeCount, 2);
    assert.equal(r.result.summary.cycleCount, 1);
    assert.equal(r.result.summary.filesInCycles, 2);
    assert.equal(r.result.cycles[0].size, 2);
    const aNode = r.result.nodes.find((n) => n.path === "a.js");
    assert.equal(aNode.fanIn, 1);
    assert.equal(aNode.fanOut, 1);
    assert.equal(aNode.inCycle, true);
  });

  it("dependencyGraph: no files supplied is rejected", async () => {
    const r = await lensRun("legacy", "dependencyGraph", { params: { files: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /no codebase or files supplied/);
  });

  it("hotspotRanking: a high-churn high-complexity file outranks a quiet simple one", async () => {
    const r = await lensRun("legacy", "hotspotRanking", {
      params: {
        files: [
          { path: "hot.js", content: "if(a){}\nif(b){}\nif(c){}\n", churn: 100 },
          { path: "cold.js", content: "const x = 1;\n", churn: 1 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.fileCount, 2);
    // hot.js (churn 100, cx 4) is the geometric max → index 100
    assert.equal(r.result.hotspots[0].path, "hot.js");
    assert.equal(r.result.hotspots[0].hotspotIndex, 100);
    assert.ok(r.result.hotspots[0].hotspotIndex > r.result.hotspots[1].hotspotIndex);
  });

  it("migrationRoadmap: leaf modules are phase 1; effort uses the supplied rates", async () => {
    const r = await lensRun("legacy", "migrationRoadmap", {
      params: {
        hoursPerKloc: 40,
        hoursPerComplexity: 1.5,
        files: [
          { path: "leaf.js", content: "const x = 1;\n" },                 // no deps → depth 0
          { path: "root.js", content: "import './leaf';\nif(a){}\n" },   // depends on leaf → depth 1
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.phases[0].phase, 1);
    assert.equal(r.result.phases[0].dependencyDepth, 0);
    // leaf is a phase-1 member (depth 0)
    assert.ok(r.result.phases[0].modules.some((m) => m.path === "leaf.js"));
    // root is in a later phase (depth 1)
    const rootPhase = r.result.phases.find((p) => p.modules.some((m) => m.path === "root.js"));
    assert.equal(rootPhase.dependencyDepth, 1);
    assert.equal(r.result.summary.assumptions.hoursPerKloc, 40);
    assert.ok(r.result.summary.totalEffortHours > 0);
  });

  it("modernizationROI: low-value low-usage module is recommended for retirement", async () => {
    const r = await lensRun("legacy", "modernizationROI", {
      params: {
        blendedRate: 100,
        modules: [
          { name: "deadweight", linesOfCode: 1000, debtScore: 20, businessValue: 1, usageFrequency: 1 },
          { name: "crownjewel", linesOfCode: 2000, debtScore: 70, businessValue: 5, usageFrequency: 5 },
        ],
      },
    });
    assert.equal(r.ok, true);
    const dead = r.result.modules.find((m) => m.name === "deadweight");
    assert.equal(dead.recommendation, "retire");
    const jewel = r.result.modules.find((m) => m.name === "crownjewel");
    assert.equal(jewel.recommendation, "rewrite"); // debt>=60 && businessValue>=4
    assert.equal(r.result.summary.recommendations.retire, 1);
    assert.equal(r.result.summary.recommendations.rewrite, 1);
    assert.equal(r.result.summary.blendedRate, 100);
  });

  it("modernizationROI: moderate-debt worth-keeping module is recommended for refactor; no modules rejected", async () => {
    const r = await lensRun("legacy", "modernizationROI", {
      params: { modules: [{ name: "mid", linesOfCode: 800, debtScore: 40, businessValue: 3, usageFrequency: 3 }] },
    });
    assert.equal(r.result.modules[0].recommendation, "refactor");
    const bad = await lensRun("legacy", "modernizationROI", { params: { modules: [] } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no modules supplied/);
  });

  it("cloudReadiness: a 12-factor component is lift-and-shift; a stateful one re-architect", async () => {
    const r = await lensRun("legacy", "cloudReadiness", {
      params: {
        components: [
          { name: "clean-svc", statefulFilesystem: false, hardcodedConfig: false, secretsInCode: false,
            scalesHorizontally: true, healthCheckEndpoint: true, logsToStdout: true, sessionAffinity: false, externalProcessDeps: [] },
          { name: "monolith", statefulFilesystem: true, hardcodedConfig: true, secretsInCode: true,
            scalesHorizontally: false, healthCheckEndpoint: false, logsToStdout: false, sessionAffinity: true, externalProcessDeps: ["cron"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    const clean = r.result.components.find((c) => c.name === "clean-svc");
    assert.equal(clean.readinessScore, 100);
    assert.equal(clean.readinessLevel, "lift-and-shift");
    assert.equal(clean.containerizable, true);
    const mono = r.result.components.find((c) => c.name === "monolith");
    assert.equal(mono.readinessScore, 0);
    assert.equal(mono.readinessLevel, "re-architect");
    assert.ok(mono.blockers.includes("statelessProcess"));
    assert.equal(r.result.summary.liftAndShiftReady, 1);
    assert.equal(r.result.summary.needsReArchitecture, 1);
  });

  it("cloudReadiness: no components is rejected", async () => {
    const r = await lensRun("legacy", "cloudReadiness", { params: { components: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /no components supplied/);
  });
});

describe("legacy — codebase CRUD + snapshot trend (shared ctx round-trips)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legacy-crud"); });

  it("scanCodebase → listCodebases → getCodebase → deleteCodebase round-trips", async () => {
    const scan = await lensRun("legacy", "scanCodebase", {
      params: { name: "roundtrip", files: [{ path: "x.js", content: "const a=1;\n" }] },
    }, ctx);
    assert.equal(scan.ok, true);
    const id = scan.result.codebase.id;

    const list = await lensRun("legacy", "listCodebases", {}, ctx);
    assert.ok(list.result.codebases.some((c) => c.id === id && c.name === "roundtrip"));
    assert.ok(list.result.count >= 1);

    const got = await lensRun("legacy", "getCodebase", { params: { id } }, ctx);
    assert.equal(got.result.codebase.id, id);
    assert.equal(got.result.codebase.files.length, 1); // full record has per-file metrics

    const del = await lensRun("legacy", "deleteCodebase", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const after = await lensRun("legacy", "getCodebase", { params: { id } }, ctx);
    assert.equal(after.result.ok, false);
    assert.match(after.result.error, /codebase not found/);
  });

  it("getCodebase / deleteCodebase: a missing id is rejected", async () => {
    const got = await lensRun("legacy", "getCodebase", { params: { id: "nope_cb" } }, ctx);
    assert.equal(got.result.ok, false);
    assert.match(got.result.error, /codebase not found/);
    const del = await lensRun("legacy", "deleteCodebase", { params: { id: "nope_cb" } }, ctx);
    assert.equal(del.result.ok, false);
    assert.match(del.result.error, /codebase not found/);
  });

  it("dependencyGraph + migrationRoadmap can read a persisted codebase by id", async () => {
    const scan = await lensRun("legacy", "scanCodebase", {
      params: { name: "byid", files: [
        { path: "a.js", content: "import './b';\n" },
        { path: "b.js", content: "const x=1;\n" },
      ] },
    }, ctx);
    const codebaseId = scan.result.codebase.id;
    const graph = await lensRun("legacy", "dependencyGraph", { params: { codebaseId } }, ctx);
    assert.equal(graph.ok, true);
    assert.equal(graph.result.summary.nodeCount, 2);
    const road = await lensRun("legacy", "migrationRoadmap", { params: { codebaseId } }, ctx);
    assert.equal(road.ok, true);
    assert.equal(road.result.codebase, "byid");

    // unknown codebaseId is rejected
    const bad = await lensRun("legacy", "dependencyGraph", { params: { codebaseId: "nope_cb" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /codebase not found/);
  });

  it("recordDebtSnapshot → debtTrend computes a rising slope + projection", async () => {
    const snapCtx = await depthCtx("legacy-trend");
    await lensRun("legacy", "recordDebtSnapshot", { params: { label: "2026-01-01", totalDebt: 100, moduleCount: 10 } }, snapCtx);
    await lensRun("legacy", "recordDebtSnapshot", { params: { label: "2026-02-01", totalDebt: 110, moduleCount: 10 } }, snapCtx);
    const last = await lensRun("legacy", "recordDebtSnapshot", { params: { label: "2026-03-01", totalDebt: 120, moduleCount: 10 } }, snapCtx);
    assert.equal(last.result.totalSnapshots, 3);

    const trend = await lensRun("legacy", "debtTrend", {}, snapCtx);
    assert.equal(trend.result.snapshots.length, 3);
    // perfectly linear +10 per snapshot → slope 10
    assert.equal(trend.result.trend.slopePerSnapshot, 10);
    assert.equal(trend.result.trend.direction, "increasing");
    assert.equal(trend.result.trend.firstDebt, 100);
    assert.equal(trend.result.trend.latestDebt, 120);
    assert.equal(trend.result.trend.netChange, 20);
    assert.equal(trend.result.trend.pctChange, 20); // (120-100)/100*100
    assert.equal(trend.result.trend.projectedNextDebt, 130); // next index
  });

  it("recordDebtSnapshot: missing totalDebt is rejected; debtTrend with no history returns a message", async () => {
    const bad = await lensRun("legacy", "recordDebtSnapshot", { params: { label: "x" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /totalDebt is required/);

    const emptyCtx = await depthCtx("legacy-trend-empty");
    const trend = await lensRun("legacy", "debtTrend", {}, emptyCtx);
    assert.equal(trend.ok, true);
    assert.deepEqual(trend.result.snapshots, []);
    assert.match(trend.result.message, /No debt snapshots recorded yet/);
  });
});
