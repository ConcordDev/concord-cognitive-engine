// server/tests/depth/representation-sufficiency-bench.test.js

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
import { seedBenchDtuCorpus } from "../../lib/runtime/cognitive-savings-ledger.js";
import {
  evaluateRepresentationOutput,
  runRepresentationTrial,
  runRepresentationSufficiencyBench,
  runProbeBench,
  buildMissionContext,
  classifyTrialFailure,
  buildReproducibilityManifest,
  REPRESENTATION_CONDITIONS,
  COGNITIVE_PROBES,
  EVALUATOR_CAVEAT,
  DEFAULT_CONDITIONS,
  SPEC_ID,
} from "../../lib/runtime/representation-sufficiency-bench.js";
import { buildStatisticalReport } from "../../lib/runtime/dhtp-rs-statistics.js";
import { PHASE1_BASELINE } from "../../lib/runtime/dhtp-rs-spec.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [
    upMission, upPhases, upTier, upDila, upV2, upExec, upCausal,
    upDhtp, upCognitive, upSavings, upBilling, upCompilerV2,
  ]) {
    up(db);
  }
  seedBenchDtuCorpus(db, { count: 50 });
  return db;
}

const mockChat = (() => {
  let n = 0;
  return async ({ messages }) => {
    n += 1;
    const sys = messages?.[0]?.content || "";
    const isDhtp = sys.includes("@DHTP2") || (sys.length < 2000 && !sys.includes("TRUNCATED") && !sys.includes("RANDOM"));
    const isRandom = sys.includes("RANDOM_SAMPLE");
    const isTrunc = sys.includes("TRUNCATED");
    let text = "No schema provided in raw";
    if (isDhtp) text = "Fleet organ health analysis via DHTP shows stable cognitive delta. Structured observation with confidence.";
    else if (isRandom) text = "Some organ data from random sample. Partial health info.";
    else if (isTrunc) text = "Truncated raw context. organ health unclear.";
    return {
      ok: true,
      text,
      tokensIn: sys.length > 5000 ? 15000 : isDhtp ? 250 : 200,
      tokensOut: 80,
      usage: { prompt_tokens: sys.length > 5000 ? 15000 : isDhtp ? 250 : 200, completion_tokens: 80 },
    };
  };
})();

describe("representation-sufficiency-bench", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("defines four primary conditions plus ablation variants", () => {
    const core = ["raw_corpus", "dhtp_packet", "matched_budget_raw", "random_budget_raw"];
    for (const id of core) assert.ok(REPRESENTATION_CONDITIONS[id]);
    assert.equal(DEFAULT_CONDITIONS.length, 4);
    assert.ok(REPRESENTATION_CONDITIONS.dhtp_full.pathId === "D");
    assert.ok(REPRESENTATION_CONDITIONS.selection_only.pathId === "B");
    assert.ok(REPRESENTATION_CONDITIONS.structure_only.pathId === "C");
  });

  it("defines six cognitive probes with distinct rubrics", () => {
    assert.equal(Object.keys(COGNITIVE_PROBES).length, 6);
    assert.notEqual(
      COGNITIVE_PROBES.contradiction_detection.rubric.taskKeywords[0],
      COGNITIVE_PROBES.planning.rubric.taskKeywords[0],
    );
  });

  it("documents evaluator caveat — blind but not independent", () => {
    assert.equal(EVALUATOR_CAVEAT.blind, true);
    assert.equal(EVALUATOR_CAVEAT.independent, false);
  });

  it("evaluator scores useful output higher than raw failure", () => {
    const good = evaluateRepresentationOutput({
      responseText: "Fleet organ health analysis via DHTP cognitive delta shows stable operational parameters.",
    });
    const bad = evaluateRepresentationOutput({ responseText: "No schema provided in raw" });
    assert.ok(good.composite > bad.composite);
  });

  it("buildMissionContext varies by probe", () => {
    const fleet = buildMissionContext("fleet_health", 0);
    const plan = buildMissionContext("planning", 0);
    assert.notEqual(fleet.mission.goal, plan.mission.goal);
    assert.ok(plan.step.args.text.includes("@ACTION plan"));
  });

  it("DHTP compiles smaller than raw for each probe", async () => {
    for (const probeId of ["fleet_health", "decision", "anomaly_detection"]) {
      const dhtp = await runRepresentationTrial({
        db, conditionId: "dhtp_packet", probeId, trialIndex: 0, apiKey: "k", callProvider: mockChat,
      });
      const raw = await runRepresentationTrial({
        db, conditionId: "raw_corpus", probeId, trialIndex: 0, apiKey: "k", callProvider: mockChat,
      });
      assert.ok(dhtp.compile.promptChars < raw.compile.promptChars, probeId);
    }
  });

  it("DHTP beats truncated and random controls in aggregate", async () => {
    const bench = await runRepresentationSufficiencyBench({
      db,
      trials: 3,
      conditions: ["dhtp_packet", "matched_budget_raw", "random_budget_raw", "raw_corpus"],
      probes: ["fleet_health"],
      apiKey: "test-key",
      callProvider: mockChat,
    });

    assert.equal(bench.ok, true);
    const agg = bench.overall.aggregates;
    assert.ok(agg.dhtp_packet.avgComposite > agg.raw_corpus.avgComposite);
    assert.ok(agg.dhtp_packet.avgComposite > agg.matched_budget_raw.avgComposite);
    assert.ok(agg.dhtp_packet.avgComposite > agg.random_budget_raw.avgComposite);
    assert.ok(bench.headline.dhtpVsRandomBudget.selectionBeatsRandom);
  });

  it("multi-probe bench returns per-probe results", async () => {
    const bench = await runProbeBench({
      db,
      probeId: "contradiction_detection",
      trials: 2,
      conditions: ["dhtp_packet", "raw_corpus"],
      apiKey: "k",
      callProvider: mockChat,
    });
    assert.equal(bench.probeId, "contradiction_detection");
    assert.ok(bench.aggregates.dhtp_packet);
  });

  it("classifies API failures and schema failures", () => {
    const apiFail = classifyTrialFailure({
      ok: true,
      live: { apiFailure: true, error: "429" },
      evaluation: { composite: 0 },
    });
    assert.equal(apiFail.category, "api_failure");

    const schemaFail = classifyTrialFailure({
      ok: true,
      live: { ok: true, preview: "No schema provided" },
      evaluation: { composite: 0.1, dimensions: { schemaAdherence: 0 }, empty: false },
    });
    assert.equal(schemaFail.category, "schema_failure");
  });

  it("builds reproducibility manifest with spec id", () => {
    const m = buildReproducibilityManifest({
      runId: "rsb_test",
      trials: 30,
      conditions: DEFAULT_CONDITIONS,
      probes: ["fleet_health"],
    });
    assert.equal(m.specId, SPEC_ID);
    assert.ok(m.systemPromptHash);
    assert.ok(m.taskPromptHash);
  });

  it("computes paired statistics from bench runs", async () => {
    const bench = await runRepresentationSufficiencyBench({
      db,
      trials: 2,
      conditions: ["dhtp_packet", "matched_budget_raw"],
      probes: ["fleet_health"],
      apiKey: "k",
      callProvider: mockChat,
    });
    assert.ok(bench.statistics);
    assert.ok(bench.manifest);
    assert.ok(bench.statistics.paired.dhtp_packet_minus_matched_budget_raw);
  });

  it("pins phase 1 baseline deltas from spec", () => {
    assert.equal(PHASE1_BASELINE.trials, 30);
    assert.ok(PHASE1_BASELINE.pairedDeltas.dhtp_minus_matched > 0.04);
  });
});
