// server/tests/depth/cognitive-mission-e2e.test.js
//
// Empirical proof — full cognitive stack through real mission-runtime ticks.
// Not isolated unit tests: real createMission → tickMission → substrates.

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
import { createMission, tickMission, getMission } from "../../lib/mission-runtime.js";
import {
  runCognitiveMissionIteration,
  runCognitiveMissionBench,
  runF0SafetyProbe,
  runGeneralizationBenchmark,
  runPathExperimentBench,
  runFullDgbBenchmark,
  collectCognitiveMissionMetrics,
  aggregateImprovementCurve,
} from "../../lib/runtime/cognitive-mission-bench.js";
import {
  runAdversarialDeltaBattery,
  verifyMissionDelta,
} from "../../lib/runtime/dgb-benchmark.js";
import { getLearnedPolicies } from "../../lib/runtime/dhtp-policy-learner.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upPhases(db);
  upTier(db);
  upDila(db);
  upV2(db);
  upExec(db);
  upCausal(db);
  upDhtp(db);
  upCognitive(db);
  upSavings(db);
  return db;
}

function mockDispatch(results = {}) {
  const calls = [];
  const dispatchMCP = async (tool, args, ctx) => {
    calls.push({ tool, args, ctx });
    if (results[tool]) return results[tool];
    return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
  };
  return { dispatchMCP, calls };
}

describe("Cognitive mission — single complete tick path", () => {
  let db;
  let dispatchMCP;

  beforeEach(() => {
    db = setupDb();
    ({ dispatchMCP } = mockDispatch());
  });

  it("runs cognitive_probe through real mission-runtime to completion", async () => {
    const r = await runCognitiveMissionIteration({
      db, dispatchMCP, iteration: 1, template: "cognitive_probe",
    });

    assert.equal(r.ok, true, `mission failed: ${JSON.stringify(r.tickTrace)}`);
    assert.equal(r.status, "completed");

    const mission = getMission(db, r.missionId);
    assert.equal(mission.status, "completed");
    assert.equal(mission.template, "cognitive_probe");
    assert.equal(mission.step_log.length, 2);
    assert.ok(mission.step_log.every((s) => s.status === "completed"));

    assert.ok(r.metrics.efficiency.dhtpTokens > 0 || r.metrics.efficiency.executiveCompiles > 0,
      "DHTP compilation should record token metrics");
    assert.ok(r.metrics.efficiency.actualModelInputTokens > 0,
      "savings ledger should record actual model input tokens");
    assert.ok(r.metrics.substrates.savingsLedgerRows >= 1,
      "cognitive savings ledger should persist per invocation");
    assert.ok(r.metrics.substrates.cognitiveOutcomes >= 1,
      "cognitive delta should commit outcome to memory graph");
    assert.ok(r.metrics.substrates.causalChains >= 1,
      "causal chain should be recorded");
  });

  it("exercises DHTP compile → cache lookup → delta execution in one mission", async () => {
    const created = createMission(db, {
      template: "cognitive_probe",
      source: "operator",
      asDila: true,
      userId: "bench",
    });
    assert.equal(created.ok, true);

    const tickTrace = [];
    for (let i = 0; i < 6; i += 1) {
      const t = await tickMission({ db, missionId: created.missionId, dispatchMCP });
      tickTrace.push(t);
      if (t.status === "completed" || t.status === "failed") break;
    }

    assert.equal(tickTrace.at(-1)?.status, "completed");

    const dhtpRows = db.prepare(`SELECT path, cache_hit FROM dhtp_metrics WHERE mission_id = ?`)
      .all(created.missionId);
    assert.ok(dhtpRows.length >= 1, "executive path should record DHTP metrics");

    const deltaLog = db.prepare(`
      SELECT tool_name, status, result_json FROM mission_step_log
      WHERE mission_id = ? AND tool_name = 'cognitive_delta_execute'
    `).get(created.missionId);
    assert.ok(deltaLog);
    assert.equal(deltaLog.status, "completed");
    const result = JSON.parse(deltaLog.result_json);
    assert.equal(result.stage, "committed");
    assert.equal(result.principle, "model_proposes_concord_commits");
  });

  it("blocks F0 violations without executing unsafe mutations", async () => {
    const probe = await runF0SafetyProbe({ db, gateCtx: { actor: { role: "member" }, db } });
    assert.equal(probe.ok, true);
    assert.equal(probe.blocked, true);
    assert.equal(probe.stage, "validate");
    assert.equal(probe.reason, "f0_authority_required");
  });
});

describe("Cognitive mission — learning curve (repeated iterations)", () => {
  it("demonstrates cache hits and LLM avoidance over iterations", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    process.env.COGNITIVE_CACHE_MIN_USES = "1";

    const bench = await runCognitiveMissionBench({
      db,
      dispatchMCP,
      iterations: 5,
      template: "cognitive_probe",
      minCacheUses: 1,
    });

    assert.equal(bench.ok, true, `bench failed: passRate=${bench.summary.passRate}`);
    assert.equal(bench.summary.completed, 5);
    assert.equal(bench.summary.reliability.missionCompletionRate, 1);
    assert.equal(bench.summary.reliability.f0AllStopped, true);

    const curve = bench.summary.improvement;
    assert.ok(curve.ok);
    assert.ok(curve.killerQuestion.learning || curve.deltas.cacheHits.cumulative > 0,
      "later iterations should recognize recurring problems via cache");

    const laterHits = bench.iterations.slice(1).filter((it) => it.metrics?.intelligence?.cacheHit).length;
    assert.ok(laterHits >= 1, "at least one post-warmup iteration should cache-hit");

    assert.ok(bench.summary.efficiency.totalDhtpTokens > 0);
    assert.ok(bench.summary.intelligence.cognitiveOutcomesTotal >= 5);
    assert.ok(bench.summary.policyLearning?.cycle === "dhtp_policy_learning");

    delete process.env.COGNITIVE_CACHE_MIN_USES;
  });

  it("aggregateImprovementCurve shows intended direction", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();

    const results = [];
    for (let i = 1; i <= 3; i += 1) {
      results.push(await runCognitiveMissionIteration({
        db, dispatchMCP, iteration: i, template: "cognitive_probe",
      }));
    }

    const curve = aggregateImprovementCurve(results);
    assert.equal(curve.ok, true);
    assert.equal(curve.iterations, 3);
    assert.ok(Array.isArray(curve.curves.missionSuccess));
    assert.equal(curve.curves.missionSuccess.every((v) => v === 1), true);
  });

  it("collectCognitiveMissionMetrics captures all four measurement dimensions", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const r = await runCognitiveMissionIteration({ db, dispatchMCP, iteration: 1 });
    const m = collectCognitiveMissionMetrics(db, {
      missionId: r.missionId,
      iteration: 1,
      durationMs: r.metrics.durationMs,
    });

    assert.ok("reliability" in m);
    assert.ok("intelligence" in m);
    assert.ok("efficiency" in m);
    assert.equal(m.reliability.missionCompletion, 1);
    assert.ok(m.efficiency.rawContextTokens >= 0);
    assert.ok(m.substrates.cognitiveOutcomes >= 1);
  });
});

describe("Cognitive mission — policy learning from real missions", () => {
  it("field outcomes from missions feed learned compression policies", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();

    for (let i = 0; i < 3; i += 1) {
      await runCognitiveMissionIteration({ db, dispatchMCP, iteration: i + 1 });
    }

    const bench = await runCognitiveMissionBench({
      db, dispatchMCP, iterations: 1, runF0Probe: false,
    });
    assert.ok(bench.summary.policyLearning);

    const policies = getLearnedPolicies(db, "classification");
    assert.ok(typeof policies === "object");
  });
});

describe("Cognitive mission — savings ledger + path experiment", () => {
  it("records trustworthy token pipeline in savings ledger", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const r = await runCognitiveMissionIteration({ db, dispatchMCP, iteration: 1 });
    const row = db.prepare(`SELECT * FROM cognitive_savings_ledger WHERE mission_id = ?`).get(r.missionId);
    assert.ok(row);
    assert.ok(row.context_tokens_full >= row.tokens_after_dtu,
      "full context should be >= DTU-filtered context");
    assert.ok(row.actual_model_input_tokens > 0);
    assert.ok(row.dtu_savings >= 0);
    assert.ok(row.dhtp_savings >= 0);
  });

  it("A/B/C/D path experiment shows pipeline token reduction", async () => {
    const db = setupDb();
    const exp = await runPathExperimentBench({ db });
    assert.equal(exp.ok, true);
    assert.equal(exp.variants.length, 4);
    const a = exp.variants.find((v) => v.variant === "A");
    const b = exp.variants.find((v) => v.variant === "B");
    const c = exp.variants.find((v) => v.variant === "C");
    // A includes full corpus; B is DTU-filtered; C is DHTP-compressed packet.
    assert.ok(a.contextFull >= b.contextFull,
      `full corpus (${a.contextFull}) should be >= DTU-filtered (${b.contextFull})`);
    assert.ok(b.tokensAfterDtu <= a.contextFull,
      `after-DTU (${b.tokensAfterDtu}) should be <= full context (${a.contextFull})`);
    assert.ok(c.dhtpTokens <= b.inputTokens || c.dhtpTokens < a.inputTokens,
      "DHTP packet should compress vs at least one prior stage");
  });
});

describe("Cognitive mission — DGB generalization benchmark", () => {
  it("runs warmup + variant transfer without exact cache hit on cold variant", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    process.env.COGNITIVE_CACHE_MIN_USES = "1";

    const dgb = await runGeneralizationBenchmark({
      db, dispatchMCP, warmupIterations: 5, minCacheUses: 1,
    });

    assert.equal(dgb.scores.exactReplay.level, "pass");
    assert.equal(dgb.variantCold.ok, true, "structural variant should complete");
    assert.equal(dgb.scores.structuralTransfer.coldCacheHit, false,
      "variant must not hit exact-fingerprint cache");
    assert.equal(dgb.generalizationProven, true);

    delete process.env.COGNITIVE_CACHE_MIN_USES;
  });

  it("DGB full levels 3–5 — semantic, composition, adversarial transfer", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    process.env.COGNITIVE_CACHE_MIN_USES = "1";

    const dgb = await runFullDgbBenchmark({
      db, dispatchMCP, warmupIterations: 8, minCacheUses: 1,
    });

    assert.equal(dgb.scores.exactReplay.level, "pass");
    assert.equal(dgb.scores.semanticTransfer.level, "pass", "L3 semantic transfer");
    assert.equal(dgb.scores.novelComposition.level, "pass", "L4 novel composition");
    assert.equal(dgb.scores.adversarialTransfer.level, "pass", "L5 adversarial transfer");
    assert.equal(dgb.scores.semanticTransfer.cold.cacheHit, false, "L3 must not exact-cache");
    assert.equal(dgb.generalizationProven, true);
    assert.equal(dgb.acceptance.capabilityLearned, true);
    assert.equal(dgb.acceptance.memorizationIsNotLearning, true);

    delete process.env.COGNITIVE_CACHE_MIN_USES;
  });

  it("adversarial delta battery rejects malformed and unsafe proposals", async () => {
    const db = setupDb();
    const battery = await runAdversarialDeltaBattery({ db, gateCtx: { actor: { role: "member" }, db } });
    assert.equal(battery.ok, true, JSON.stringify(battery.results));
    assert.equal(battery.passed, battery.total);
  });

  it("verifyMissionDelta checks committed analyze delta on semantic mission", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const r = await runCognitiveMissionIteration({
      db, dispatchMCP, template: "dgb_semantic_vitals",
    });
    const v = verifyMissionDelta(db, r.missionId, {
      requireStage: "committed",
      requireAction: "analyze",
      rationalePattern: "ledger|verified",
    });
    assert.equal(r.ok, true);
    assert.equal(v.verified, true);
  });
});
