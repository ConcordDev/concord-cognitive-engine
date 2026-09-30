// server/tests/depth/dila-raw-blind-benchmark.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upCausal } from "../../migrations/429_dila_tier2_brain.js";
import { up as upDhtp } from "../../migrations/435_dhtp_metrics.js";
import { up as upCognitive } from "../../migrations/436_dhtp_cognitive.js";
import { up as upSavings } from "../../migrations/437_cognitive_savings_ledger.js";
import { up as upBilling } from "../../migrations/438_provider_billing_telemetry.js";
import { up as upCompilerV2 } from "../../migrations/439_cognitive_compiler_v2.js";
import { up as upCognitiveSchema } from "../../migrations/440_dtu_cognitive_schema.js";
import { seedBenchDtuCorpus } from "../../lib/runtime/cognitive-savings-ledger.js";
import {
  getBlindPathConfig,
  BLIND_BENCHMARK_PATHS,
} from "../../lib/runtime/cognitive-economics.js";
import {
  captureMissionOutput,
  gatherObjectiveVerification,
  evaluateBlindSubmission,
  compareBlindEvaluations,
} from "../../lib/runtime/blind-evaluator.js";
import {
  runBlindPathWorkload,
  runDilaRawBlindBenchmark,
  runBlindSweWorkload,
  runBlindCounterfactualBattery,
  BLIND_WORKLOADS,
} from "../../lib/runtime/dila-raw-blind-benchmark.js";
import {
  recordProviderBilling,
  seedBilledTelemetryFromLedger,
  aggregateBilledTelemetry,
} from "../../lib/runtime/provider-billing.js";
import { runCounterfactualContextTest } from "../../lib/runtime/counterfactual-context.js";
import { classifyRepresentationTier, REPRESENTATION_TIERS } from "../../lib/runtime/dhtp-cognitive-compiler.js";
import {
  buildSegmentedClaims,
  assessPublishability,
  projectMonthlySavings,
  confidenceInterval95,
  computeCostPerVerifiedSuccess,
  buildCommercialThreeWay,
} from "../../lib/runtime/claim-methodology.js";
import {
  buildPathFunnelFromMetrics,
  diagnoseLayerAttribution,
} from "../../lib/runtime/information-path-analysis.js";
import { runCognitiveMissionIteration } from "../../lib/runtime/cognitive-mission-bench.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [upMission, upPhases, upTier, upDila, upV2, upExec, upCausal, upDhtp, upCognitive, upSavings, upBilling, upCompilerV2, upCognitiveSchema]) {
    up(db);
  }
  seedBenchDtuCorpus(db, { count: 50 });
  return db;
}

async function mockDispatch(tool) {
  return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
}

describe("Blind benchmark paths", () => {
  it("defines five isolation paths A–E", () => {
    assert.equal(Object.keys(BLIND_BENCHMARK_PATHS).length, 5);
    assert.equal(getBlindPathConfig("A").label, "raw_llm");
    assert.equal(getBlindPathConfig("B").label, "raw_plus_dtu");
    assert.equal(getBlindPathConfig("C").label, "raw_plus_dhtp");
    assert.equal(getBlindPathConfig("D").label, "dtu_dhtp");
    assert.equal(getBlindPathConfig("E").label, "full_dila");
  });

  it("path B uses DTU without DHTP", () => {
    const b = getBlindPathConfig("B");
    assert.equal(b.compile.skipDhtp, true);
    assert.equal(b.compile.useRawJson, false);
  });

  it("path C uses DHTP without DTU filter", () => {
    const c = getBlindPathConfig("C");
    assert.equal(c.compile.skipDhtp, false);
    assert.equal(c.compile.skipDtuFilter, true);
  });
});

describe("Blind evaluator — independent scoring", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("evaluateBlindSubmission does not require producer identity", async () => {
    const mission = await runCognitiveMissionIteration({
      db,
      dispatchMCP: mockDispatch,
      template: "cognitive_probe",
    });
    assert.ok(mission.ok);

    const output = captureMissionOutput(db, mission.missionId);
    const objective = gatherObjectiveVerification(db, mission.missionId, {
      verifyDelta: { requireAction: "analyze" },
      metrics: mission.metrics,
    });

    const evalResult = evaluateBlindSubmission({
      submissionId: "sub_anon_1",
      task: { template: "cognitive_probe" },
      output,
      objectiveVerification: objective,
      efficiencyMetrics: { tokens: 100, latency: 50, cost: 0.001 },
    });

    assert.ok(evalResult.ok);
    assert.equal(evalResult.submissionId, "sub_anon_1");
    assert.ok(evalResult.dimensions.correctness >= 0);
    assert.ok(evalResult.dimensions.verification >= 0);
    assert.ok(evalResult.composite >= 0 && evalResult.composite <= 1);
    assert.ok(!("pathId" in evalResult));
    assert.ok(!("producer" in evalResult));
  });

  it("compareBlindEvaluations reports dimension deltas", () => {
    const evalA = {
      ok: true,
      composite: 0.85,
      dimensions: { correctness: 0.9, verification: 0.8, quality: 0.85, generalization: 0.5, efficiency: 0.3 },
    };
    const evalB = {
      ok: true,
      composite: 0.92,
      dimensions: { correctness: 0.95, verification: 0.9, quality: 0.88, generalization: 0.7, efficiency: 0.8 },
    };

    const cmp = compareBlindEvaluations(evalA, evalB, { labelA: "raw", labelB: "dila" });
    assert.equal(cmp.winner, "dila");
    assert.ok(cmp.compositeDelta > 0);
    assert.ok(cmp.dimensionDeltas.efficiency > 0);
    assert.equal(cmp.targetMet, true);
  });
});

describe("Dila-vs-Raw blind benchmark — full suite", () => {
  it("runs A–E paths with blind quality comparison", async () => {
    const db = setupDb();
    const bench = await runDilaRawBlindBenchmark({
      db,
      dispatchMCP: mockDispatch,
      workloads: [BLIND_WORKLOADS[0]],
      minCacheUses: 1,
    });

    assert.equal(bench.pathSuites.length, 5);
    assert.equal(bench.pathQualityTable.length, 5);
    assert.ok(bench.headline.rawComposite >= 0);
    assert.ok(bench.headline.dilaComposite >= 0);
    assert.ok(bench.headline.principle.includes("independent_evaluator"));
    assert.ok(bench.dhtpIsolation.length === 5);

    const raw = bench.pathQualityTable.find((r) => r.pathId === "A");
    const dila = bench.pathQualityTable.find((r) => r.pathId === "E");
    assert.ok(raw.avgTokens >= dila.avgTokens || dila.avgTokens === 0,
      "full Dila should use fewer or equal tokens than raw");
  });

  it("captures actual mission outputs per path", async () => {
    const db = setupDb();
    const run = await runBlindPathWorkload({
      db,
      dispatchMCP: mockDispatch,
      pathId: "A",
      workload: BLIND_WORKLOADS[0],
    });

    assert.ok(run.output?.delta);
    assert.ok(run.evaluation?.outputSummary);
    assert.ok(run.objective?.gates?.length > 0);
  });
});

describe("Claim methodology — publication gates", () => {
  it("refuses publishable headline when billing is estimated", () => {
    const claims = buildSegmentedClaims({
      rawSuite: {
        runs: [{ efficiency: { tokens: 1000, cost: 0.04, latency: 3000 }, evaluation: { composite: 0.83 } }],
        aggregate: { avgTokens: 1000, avgCostUsd: 0.04, avgLatencyMs: 3000, avgComposite: 0.83, successRate: 1, humanInterventionRate: 0, regressionRate: 0 },
      },
      dilaSuite: {
        runs: [{ efficiency: { tokens: 100, cost: 0.004, latency: 2800 }, evaluation: { composite: 0.88 } }],
        aggregate: { avgTokens: 100, avgCostUsd: 0.004, avgLatencyMs: 2800, avgComposite: 0.88, successRate: 1, humanInterventionRate: 0, regressionRate: 0 },
      },
      pricing: { mode: "estimated", model: "test-model" },
      workloadCount: 3,
    });

    const pub = assessPublishability({ claims, pricing: { mode: "estimated" }, workloadCount: 3 });
    assert.equal(pub.publishable, false);
    assert.ok(pub.refusalReason.includes("real_provider_billing"));
    assert.equal(pub.status, "preliminary");
    assert.equal(claims.segments.tokenReduction.pointEstimate, 90);
  });

  it("marks publishable when all gates pass", () => {
    const claims = buildSegmentedClaims({
      rawSuite: {
        runs: [{ efficiency: { tokens: 1000, cost: 0.04, latency: 3000 }, evaluation: { composite: 0.83 } }],
        aggregate: { avgTokens: 1000, avgCostUsd: 0.04, avgLatencyMs: 3000, avgComposite: 0.83, successRate: 1, humanInterventionRate: 0, regressionRate: 0 },
      },
      dilaSuite: {
        runs: [{ efficiency: { tokens: 100, cost: 0.004, latency: 2800 }, evaluation: { composite: 0.88 } }],
        aggregate: { avgTokens: 100, avgCostUsd: 0.004, avgLatencyMs: 2800, avgComposite: 0.88, successRate: 1, humanInterventionRate: 0, regressionRate: 0 },
      },
      pricing: { mode: "billed", model: "groq-llama-3.3-70b" },
      workloadCount: 3,
    });

    const pub = assessPublishability({ claims, pricing: { mode: "billed" }, workloadCount: 3 });
    assert.equal(pub.publishable, true);
    assert.equal(pub.status, "publishable");
    assert.ok(pub.headlineClaim.statement.includes("inference cost"));
  });

  it("illustrative savings are flagged when not publishable", () => {
    const proj = projectMonthlySavings({ monthlySpendUsd: 100_000, costReductionPct: 80, publishable: false });
    assert.equal(proj.illustrative, true);
    assert.ok(proj.disclaimer.includes("ILLUSTRATIVE"));
    assert.equal(proj.projectedMonthlySavingsUsd, 80_000);
  });

  it("confidenceInterval95 computes margin from sample", () => {
    const ci = confidenceInterval95([90, 85, 95, 88, 92]);
    assert.ok(ci.margin > 0);
    assert.ok(ci.ci95Low < ci.mean);
    assert.ok(ci.ci95High > ci.mean);
  });
});

describe("Information path analysis — moat equation", () => {
  it("buildPathFunnelFromMetrics tracks knowledge → inference stages", () => {
    const funnel = buildPathFunnelFromMetrics({
      efficiency: {
        rawContextTokens: 100,
        tokensAfterDtu: 10,
        dhtpTokens: 2,
        actualModelInputTokens: 1,
        llmCallsAvoidedCache: 0,
      },
    });
    assert.equal(funnel.knowledgeUnits, 100);
    assert.equal(funnel.selectedUnits, 10);
    assert.equal(funnel.transportedUnits, 2);
    assert.equal(funnel.reasonedUnits, 1);
    assert.equal(funnel.compressionRatio, 100);
  });

  it("diagnoseLayerAttribution flags quality regression per layer", () => {
    const table = [
      { pathId: "A", avgComposite: 0.94, avgTokens: 10000 },
      { pathId: "B", avgComposite: 0.83, avgTokens: 1200 },
      { pathId: "C", avgComposite: 0.84, avgTokens: 800 },
      { pathId: "D", avgComposite: 0.88, avgTokens: 700 },
      { pathId: "E", avgComposite: 0.95, avgTokens: 100 },
    ];
    const diag = diagnoseLayerAttribution(table);
    assert.ok(diag.regressions.some((r) => r.layer === "dtu_retrieval"));
    assert.equal(diag.overallAtoE.target80PctInferenceReduction, true);
    assert.equal(diag.overallAtoE.qualityParityOrBetter, true);
  });
});

describe("Commercial three-way comparison", () => {
  it("revokes efficiency credit when Dila quality below Raw", () => {
    const rawSuite = {
      runs: [{ ok: true, efficiency: { cost: 0.04, tokens: 10000 }, evaluation: { composite: 0.94 }, objective: { deltaVerified: true } }],
      aggregate: { avgComposite: 0.94, avgTokens: 10000, successRate: 1, avgCostUsd: 0.04 },
    };
    const dilaSuite = {
      runs: [{ ok: true, efficiency: { cost: 0.001, tokens: 100 }, evaluation: { composite: 0.80 }, objective: { deltaVerified: true } }],
      aggregate: { avgComposite: 0.80, avgTokens: 100, successRate: 1, avgCostUsd: 0.001 },
    };
    const result = buildCommercialThreeWay({ rawSuite, dilaSuite, pricing: { inputPer1M: 0.59, outputPer1M: 0.79 } });
    assert.equal(result.brutalRule.efficiencyCreditRevoked, true);
    assert.equal(result.primaryMetric.dilaVsRawReductionPct, null);
  });

  it("computes cost per verified success as primary metric", () => {
    const runs = [
      { ok: true, efficiency: { cost: 0.04 }, evaluation: { composite: 0.9 }, objective: { deltaVerified: true } },
      { ok: true, efficiency: { cost: 0.04 }, evaluation: { composite: 0.9 }, objective: { deltaVerified: true } },
    ];
    const cps = computeCostPerVerifiedSuccess(runs);
    assert.equal(cps.verifiedSuccesses, 2);
    assert.ok(Math.abs(cps.costPerVerifiedSuccessUsd - 0.04) < 0.001);
  });
});

describe("Provider billing telemetry", () => {
  it("records and aggregates billed telemetry", () => {
    const db = setupDb();
    const rec = recordProviderBilling(db, {
      missionId: "m_test",
      path: "E",
      promptTokens: 1000,
      completionTokens: 120,
      billingSource: "provider",
    });
    assert.ok(rec.ok);
    const agg = aggregateBilledTelemetry(db, { missionId: "m_test" });
    assert.equal(agg.invocations, 1);
    assert.ok(agg.totalUsd > 0);
  });
});

describe("DHTP cognitive compiler tiers", () => {
  it("classifies secrets as FORBIDDEN", () => {
    const result = classifyRepresentationTier("CONTEXT", { api_key: "sk-test123456789012345678" }, { importance: 0.9 });
    assert.equal(result.tier, REPRESENTATION_TIERS.FORBIDDEN);
  });

  it("promotes counterfactual compression when quality holds", () => {
    const ir = {
      MISSION: "probe",
      OBJECTIVE: "analyze substrate",
      REQUEST: "execute",
      CONSTRAINTS: "no deploy",
      RELEVANT_MEMORY: ["dtu_1", "dtu_2"],
      HYPOTHESES: "cache may help",
      UNCERTAINTY: "low",
    };
    const policy = {
      MISSION: { compressionLevel: "full", decisionImpact: 0.95, importance: 0.95, freshness: 1 },
      OBJECTIVE: { compressionLevel: "full", decisionImpact: 0.9, importance: 0.9, freshness: 1 },
      REQUEST: { compressionLevel: "compact", decisionImpact: 0.5, importance: 0.5, freshness: 1 },
      CONSTRAINTS: { compressionLevel: "full", decisionImpact: 1, importance: 1, freshness: 1 },
      RELEVANT_MEMORY: { compressionLevel: "hash", decisionImpact: 0.3, importance: 0.4, freshness: 0.8 },
      HYPOTHESES: { compressionLevel: "predictive", decisionImpact: 0.4, importance: 0.4, freshness: 0.7 },
      UNCERTAINTY: { compressionLevel: "compact", decisionImpact: 0.3, importance: 0.3, freshness: 0.5 },
    };
    const cf = runCounterfactualContextTest({ ir, policy });
    assert.ok(cf.ok);
    assert.ok(cf.compressed.forbiddenSuppressed >= 0);
    assert.ok(typeof cf.promoted === "boolean");
    assert.ok(cf.qualityDelta >= -cf.qualityTolerance);
  });
});

describe("SWE mini harness blind workload", () => {
  it("runs swe cases with objective verification scoring", async () => {
    const db = setupDb();
    const sweWorkload = BLIND_WORKLOADS.find((w) => w.id === "swe_mini");
    const run = await runBlindSweWorkload({ db, pathId: "E", workload: sweWorkload });
    assert.equal(run.workloadId, "swe_mini");
    assert.ok(run.evaluation?.dimensions?.verification >= 0);
    assert.ok(run.sweResult?.total >= 3);
  });
});

describe("Counterfactual context battery", () => {
  it("runs counterfactual promotion gate on sample mission", async () => {
    const db = setupDb();
    const cf = await runBlindCounterfactualBattery({
      db,
      dispatchMCP: mockDispatch,
      pathId: "E",
      persist: true,
    });
    assert.ok(cf.battery?.overall);
    assert.ok(cf.battery.summary.fields > 0);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM dhtp_counterfactual_tests").get();
    assert.ok(rows.n > 0);
  });
});

describe("Billed mode blind benchmark", () => {
  it("uses ledger-derived billing when COGNITIVE_ECON_MODE=billed", async () => {
    const db = setupDb();
    const prev = process.env.COGNITIVE_ECON_MODE;
    process.env.COGNITIVE_ECON_MODE = "billed";
    try {
      const run = await runBlindPathWorkload({
        db,
        dispatchMCP: mockDispatch,
        pathId: "E",
        workload: BLIND_WORKLOADS[0],
      });
      assert.ok(run.ok);
      const seeded = seedBilledTelemetryFromLedger(db, { missionId: run.missionId, path: "E" });
      assert.ok(seeded.ok || run.efficiency?.billingMode === "billed");
    } finally {
      if (prev === undefined) delete process.env.COGNITIVE_ECON_MODE;
      else process.env.COGNITIVE_ECON_MODE = prev;
    }
  });
});
