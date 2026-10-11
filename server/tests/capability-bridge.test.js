import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  autoHypothesisFromConflicts,
  getPipelineStrategyHints,
  recordPipelineOutcomeToMetaLearning,
  dedupGate,
  scanRecentDuplicates,
  runBeaconCheck,
  lensCheckScope,
  lensValidateEmpirically,
  runHeartbeatBridgeTick,
  ensureBaselineStrategies,
  getCapabilityBridgeInfo,
} from "../emergent/capability-bridge.js";

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeState(overrides = {}) {
  return {
    dtus: new Map(),
    hypothesisEngine: null,
    metaLearning: null,
    _autogenPipeline: null,
    ...overrides,
  };
}

function makeDtu(id, title, tags = [], extra = {}) {
  return {
    id,
    title,
    tags,
    core: { claims: [], definitions: [], invariants: [], examples: [] },
    scope: "local",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Hypothesis Auto-Propose from Conflicts
// ═════════════════════════════════════════════════════════════════════════════

describe("autoHypothesisFromConflicts", () => {
  it("returns empty for no conflicts", () => {
    const STATE = makeState();
    const r = autoHypothesisFromConflicts(STATE, []);
    assert.equal(r.ok, true);
    assert.equal(r.proposed.length, 0);
  });

  it("proposes hypotheses from conflict pairs", () => {
    const STATE = makeState();
    STATE.dtus.set("a", makeDtu("a", "Theory of Gravity"));
    STATE.dtus.set("b", makeDtu("b", "Anti-Gravity Claims"));
    const conflicts = [{ dtuA: "a", dtuB: "b", field: "claims", reason: "contradiction" }];
    const r = autoHypothesisFromConflicts(STATE, conflicts);
    assert.equal(r.ok, true);
    assert.equal(r.proposed.length, 1);
    assert.ok(r.proposed[0].statement.includes("Theory of Gravity"));
    assert.ok(r.proposed[0].statement.includes("Anti-Gravity Claims"));
  });

  it("initializes hypothesis engine if not present", () => {
    const STATE = makeState();
    autoHypothesisFromConflicts(STATE, [{ dtuA: "x", dtuB: "y" }]);
    assert.ok(STATE.hypothesisEngine);
    assert.ok(STATE.hypothesisEngine.hypotheses instanceof Map);
  });

  it("skips duplicate conflict pairs", () => {
    const STATE = makeState();
    STATE.dtus.set("a", makeDtu("a", "DTU A"));
    STATE.dtus.set("b", makeDtu("b", "DTU B"));
    const conflicts = [
      { dtuA: "a", dtuB: "b" },
      { dtuA: "b", dtuB: "a" }, // same pair, reversed
    ];
    const r = autoHypothesisFromConflicts(STATE, conflicts);
    assert.equal(r.proposed.length, 1);
    assert.equal(r.skipped, 1);
  });

  it("respects maxProposals", () => {
    const STATE = makeState();
    for (let i = 0; i < 10; i++) STATE.dtus.set(`d${i}`, makeDtu(`d${i}`, `DTU ${i}`));
    const conflicts = [];
    for (let i = 0; i < 8; i++) conflicts.push({ dtuA: `d${i}`, dtuB: `d${i + 1}` });
    const r = autoHypothesisFromConflicts(STATE, conflicts, { maxProposals: 2 });
    assert.equal(r.proposed.length, 2);
  });

  it("skips pairs with missing IDs", () => {
    const STATE = makeState();
    const r = autoHypothesisFromConflicts(STATE, [{ dtuA: null, dtuB: "x" }]);
    assert.equal(r.skipped, 1);
    assert.equal(r.proposed.length, 0);
  });

  it("skips already-existing hypothesis pairs", () => {
    const STATE = makeState();
    STATE.hypothesisEngine = {
      hypotheses: new Map([["h1", { relatedDtuIds: ["a", "b"] }]]),
      experiments: new Map(),
      evidence: new Map(),
      stats: { proposed: 1, supported: 0, refuted: 0, inconclusive: 0 },
      config: { minEvidenceToDecide: 3, supportThreshold: 0.7, refuteThreshold: 0.3, priorWeight: 0.3 },
    };
    STATE.dtus.set("a", makeDtu("a", "A"));
    STATE.dtus.set("b", makeDtu("b", "B"));
    const r = autoHypothesisFromConflicts(STATE, [{ dtuA: "a", dtuB: "b" }]);
    assert.equal(r.proposed.length, 0);
    assert.equal(r.skipped, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Meta-Learning Strategy Advisor
// ═════════════════════════════════════════════════════════════════════════════

describe("getPipelineStrategyHints", () => {
  it("returns no hints when meta-learning not initialized", () => {
    const STATE = makeState();
    const r = getPipelineStrategyHints(STATE);
    assert.equal(r.ok, true);
    assert.equal(r.strategy, null);
    assert.equal(r.reason, "meta_learning_not_initialized");
  });

  it("returns no hints with no strategy data", () => {
    const STATE = makeState({ metaLearning: { strategies: new Map(), performance: [], adaptations: [] } });
    const r = getPipelineStrategyHints(STATE, "autogen");
    assert.equal(r.strategy, null);
    assert.equal(r.reason, "no_strategy_data");
  });

  it("returns best strategy with tuning hints", () => {
    const strat = {
      id: "s1", name: "dream baseline", domain: "dream",
      parameters: { explorationRate: 0.35, batchSize: 5, abstractionLevel: 1, consolidationThreshold: 0.7 },
      uses: 10, avgPerformance: 0.8,
    };
    const STATE = makeState({
      metaLearning: { strategies: new Map([["s1", strat]]), performance: [], adaptations: [] },
    });
    const r = getPipelineStrategyHints(STATE, "dream");
    assert.equal(r.ok, true);
    assert.equal(r.strategy.id, "s1");
    assert.equal(r.hints.explorationRate, 0.35);
    assert.equal(r.hints.preferredIntentBias, "exploratory");
  });

  it("prefers domain-specific strategy over general", () => {
    const general = { id: "g", name: "general", domain: "general", parameters: { explorationRate: 0.1 }, uses: 20, avgPerformance: 0.5 };
    const specific = { id: "s", name: "autogen", domain: "autogen", parameters: { explorationRate: 0.2 }, uses: 5, avgPerformance: 0.9 };
    const STATE = makeState({
      metaLearning: { strategies: new Map([["g", general], ["s", specific]]), performance: [], adaptations: [] },
    });
    const r = getPipelineStrategyHints(STATE, "autogen");
    assert.equal(r.strategy.id, "s");
  });
});

describe("recordPipelineOutcomeToMetaLearning", () => {
  it("returns error when no meta-learning", () => {
    const r = recordPipelineOutcomeToMetaLearning(makeState(), "s1", true, 0.8);
    assert.equal(r.ok, false);
  });

  it("records outcome and updates average performance", () => {
    const strat = { id: "s1", domain: "autogen", uses: 2, successes: 1, failures: 1, avgPerformance: 0.5, updatedAt: "" };
    const STATE = makeState({
      metaLearning: { strategies: new Map([["s1", strat]]), performance: [], adaptations: [] },
    });
    const r = recordPipelineOutcomeToMetaLearning(STATE, "s1", true, 0.9);
    assert.equal(r.ok, true);
    assert.equal(strat.uses, 3);
    assert.equal(strat.successes, 2);
    assert.ok(r.newAvgPerformance > 0.5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Dedup Gate
// ═════════════════════════════════════════════════════════════════════════════

describe("dedupGate", () => {
  it("returns not duplicate for empty lattice", () => {
    const STATE = makeState();
    const r = dedupGate(STATE, { title: "Test", tags: ["foo"] });
    assert.equal(r.isDuplicate, false);
  });

  it("detects near-duplicate by title+tags", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "quantum mechanics fundamentals", ["physics", "quantum"]));
    const candidate = { title: "quantum mechanics fundamentals overview", tags: ["physics", "quantum"] };
    const r = dedupGate(STATE, candidate, { threshold: 0.5 });
    assert.equal(r.isDuplicate, true);
    assert.equal(r.closestMatch.id, "d1");
  });

  it("passes for clearly different candidate", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "quantum mechanics", ["physics"]));
    const candidate = { title: "cooking italian pasta recipes", tags: ["cooking", "food"] };
    const r = dedupGate(STATE, candidate);
    assert.equal(r.isDuplicate, false);
  });

  it("handles null candidate", () => {
    const r = dedupGate(makeState(), null);
    assert.equal(r.isDuplicate, false);
  });
});

describe("scanRecentDuplicates", () => {
  it("returns empty for no DTUs", () => {
    const r = scanRecentDuplicates(makeState());
    assert.equal(r.duplicatePairs.length, 0);
  });

  it("finds near-duplicate pairs among recent DTUs", () => {
    const STATE = makeState();
    STATE.dtus.set("a", makeDtu("a", "introduction to machine learning algorithms", ["ml", "intro"]));
    STATE.dtus.set("b", makeDtu("b", "introduction to machine learning basics", ["ml", "intro"]));
    STATE.dtus.set("c", makeDtu("c", "cooking pasta recipes", ["food"]));
    const r = scanRecentDuplicates(STATE, { threshold: 0.5 });
    assert.ok(r.duplicatePairs.length >= 1);
    assert.equal(r.duplicatePairs[0].dtuA, "a");
    assert.equal(r.duplicatePairs[0].dtuB, "b");
  });

  it("respects windowSize", () => {
    const STATE = makeState();
    for (let i = 0; i < 10; i++) STATE.dtus.set(`d${i}`, makeDtu(`d${i}`, `topic ${i}`, ["t"]));
    const r = scanRecentDuplicates(STATE, { windowSize: 3 });
    assert.equal(r.scanned, 3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Beacon Check
// ═════════════════════════════════════════════════════════════════════════════

describe("runBeaconCheck", () => {
  it("reports unhealthy when lattice empty", () => {
    const STATE = makeState();
    const r = runBeaconCheck(STATE);
    assert.equal(r.ok, true);
    assert.equal(r.healthy, false);
    assert.ok(r.checks.find(c => c.name === "lattice_alive" && !c.pass));
  });

  it("reports healthy when lattice has DTUs", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test"));
    const r = runBeaconCheck(STATE);
    assert.equal(r.healthy, true);
  });

  it("checks hypothesis engine throughput", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test"));
    STATE.hypothesisEngine = {
      hypotheses: new Map(),
      stats: { proposed: 10, supported: 3, refuted: 2, inconclusive: 1 },
    };
    const r = runBeaconCheck(STATE);
    const hyp = r.checks.find(c => c.name === "hypothesis_throughput");
    assert.ok(hyp);
    assert.equal(hyp.pass, true);
    assert.equal(hyp.noData, undefined);
    assert.equal(hyp.detail, "6/10 decided (60%)");
  });

  it("does not report 100% hypothesis throughput when nothing was proposed", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test"));
    STATE.hypothesisEngine = {
      hypotheses: new Map(),
      stats: { proposed: 0, supported: 0, refuted: 0, inconclusive: 0 },
    };
    const r = runBeaconCheck(STATE);
    const hyp = r.checks.find(c => c.name === "hypothesis_throughput");
    assert.ok(hyp);
    assert.equal(hyp.noData, true);
    assert.equal(hyp.detail, "no data yet");
    assert.equal(hyp.detail.includes("%"), false);
    assert.equal(r.healthy, true);
  });

  it("checks meta-learning status", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test"));
    STATE.metaLearning = { strategies: new Map([["s1", {}]]), adaptations: [{}] };
    const r = runBeaconCheck(STATE);
    const ml = r.checks.find(c => c.name === "metalearning_active");
    assert.ok(ml);
    assert.ok(ml.detail.includes("1 strategies"));
  });

  it("checks scope coverage", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test", [], { scope: "local" }));
    STATE.dtus.set("d2", makeDtu("d2", "Test 2"));
    const r = runBeaconCheck(STATE);
    const scope = r.checks.find(c => c.name === "scope_coverage");
    assert.ok(scope);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Lens Scope Enforcement
// ═════════════════════════════════════════════════════════════════════════════

describe("lensCheckScope", () => {
  it("allows local artifact from local actor", () => {
    const artifact = { meta: { scope: "local" } };
    const r = lensCheckScope(artifact, "create", { actorScope: "local" });
    assert.equal(r.allowed, true);
  });

  it("denies global artifact from local actor", () => {
    const artifact = { meta: { scope: "global" } };
    const r = lensCheckScope(artifact, "update", { actorScope: "local" });
    assert.equal(r.allowed, false);
  });

  it("allows global artifact from global actor", () => {
    const artifact = { meta: { scope: "global" } };
    const r = lensCheckScope(artifact, "update", { actorScope: "global" });
    assert.equal(r.allowed, true);
  });

  it("handles null artifact gracefully", () => {
    const r = lensCheckScope(null, "create");
    assert.equal(r.allowed, true);
  });

  it("warns when local artifact references global DTUs", () => {
    const STATE = makeState();
    STATE.dtus.set("g1", makeDtu("g1", "Global DTU", [], { scope: "global" }));
    const artifact = {
      meta: { scope: "local" },
      data: { claims: [{ dtuId: "g1" }] },
    };
    const r = lensCheckScope(artifact, "create", { actorScope: "local", STATE });
    assert.equal(r.allowed, true);
    assert.ok(r.warnings.length > 0);
    assert.ok(r.warnings[0].includes("global DTU"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Lens Empirical Validation
// ═════════════════════════════════════════════════════════════════════════════

describe("lensValidateEmpirically", () => {
  it("returns no issues for artifact with no data", () => {
    const r = lensValidateEmpirically({});
    assert.equal(r.issueCount, 0);
    assert.equal(r.reason, "no_data");
  });

  it("returns no issues for artifact with no claims", () => {
    const r = lensValidateEmpirically({ data: {} });
    assert.equal(r.issueCount, 0);
    assert.equal(r.reason, "no_claims");
  });

  it("validates a correct math claim", () => {
    const artifact = {
      title: "Math Facts",
      data: { claims: [{ id: "c1", text: "The result of 2 + 2 = 4" }] },
    };
    const r = lensValidateEmpirically(artifact);
    assert.equal(r.ok, true);
    assert.ok(r.claimsChecked >= 1);
  });

  it("validates claims with physical constants", () => {
    const artifact = {
      title: "Physics Paper",
      data: { claims: [
        { id: "c1", text: "The speed of light c = 3e8 m/s" },
        { id: "c2", text: "Planck constant h = 6.626e-34 J*s" },
      ] },
    };
    const r = lensValidateEmpirically(artifact);
    assert.equal(r.ok, true);
    assert.ok(r.claimsChecked >= 2);
    assert.ok(r.passRate >= 0);
  });

  it("handles string claims (not objects)", () => {
    const artifact = {
      title: "Simple",
      data: { claims: ["The value is 42", "Speed = 100 km/h"] },
    };
    const r = lensValidateEmpirically(artifact);
    assert.equal(r.ok, true);
    assert.ok(r.claimsChecked >= 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Enhanced Heartbeat Bridge Tick
// ═════════════════════════════════════════════════════════════════════════════

describe("runHeartbeatBridgeTick", () => {
  it("runs beacon check", async () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test"));
    const r = await runHeartbeatBridgeTick(STATE);
    assert.equal(r.ok, true);
    assert.ok(r.beacon);
    assert.ok(r.beacon.healthy);
  });

  it("runs dedup scan for lattice > 20 DTUs", async () => {
    const STATE = makeState();
    for (let i = 0; i < 25; i++) STATE.dtus.set(`d${i}`, makeDtu(`d${i}`, `DTU ${i}`));
    const r = await runHeartbeatBridgeTick(STATE);
    assert.ok(r.dedup);
    assert.ok(r.dedup.scanned > 0);
  });

  it("skips dedup for small lattice", async () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test"));
    const r = await runHeartbeatBridgeTick(STATE);
    assert.equal(r.dedup, null);
  });

  it("processes pipeline conflicts to propose hypotheses", async () => {
    const STATE = makeState();
    STATE.dtus.set("a", makeDtu("a", "Claim A"));
    STATE.dtus.set("b", makeDtu("b", "Claim B"));
    STATE._autogenPipeline = {
      _recentConflicts: [{ dtuA: "a", dtuB: "b", reason: "contradiction" }],
    };
    const r = await runHeartbeatBridgeTick(STATE);
    assert.ok(r.hypotheses);
    assert.equal(r.hypotheses.proposed.length, 1);
    // Conflicts should be cleared after processing
    assert.equal(STATE._autogenPipeline._recentConflicts.length, 0);
  });

  it("respects disabled flags", async () => {
    const STATE = makeState();
    STATE.dtus.set("d1", makeDtu("d1", "Test"));
    const r = await runHeartbeatBridgeTick(STATE, {
      beaconEnabled: false,
      dedupEnabled: false,
      hypothesisEnabled: false,
    });
    assert.equal(r.beacon, null);
    assert.equal(r.dedup, null);
    assert.equal(r.hypotheses, null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Baseline Strategy Bootstrap
// ═════════════════════════════════════════════════════════════════════════════

describe("ensureBaselineStrategies", () => {
  it("creates strategies for all pipeline domains", () => {
    const STATE = makeState();
    const r = ensureBaselineStrategies(STATE);
    assert.equal(r.ok, true);
    assert.equal(r.created.length, 4); // autogen, dream, synth, evolution
    assert.ok(STATE.metaLearning.strategies.size >= 4);
  });

  it("does not duplicate existing strategies", () => {
    const STATE = makeState();
    ensureBaselineStrategies(STATE);
    const r2 = ensureBaselineStrategies(STATE);
    assert.equal(r2.created.length, 0);
  });

  it("initializes meta-learning state if missing", () => {
    const STATE = makeState();
    delete STATE.metaLearning;
    ensureBaselineStrategies(STATE);
    assert.ok(STATE.metaLearning);
    assert.ok(STATE.metaLearning.strategies instanceof Map);
  });

  it("sets different exploration rates per domain", () => {
    const STATE = makeState();
    ensureBaselineStrategies(STATE);
    const strategies = Array.from(STATE.metaLearning.strategies.values());
    const dreamStrat = strategies.find(s => s.domain === "dream");
    const evolutionStrat = strategies.find(s => s.domain === "evolution");
    assert.ok(dreamStrat.parameters.explorationRate > evolutionStrat.parameters.explorationRate);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Capability Bridge Info
// ═════════════════════════════════════════════════════════════════════════════

describe("getCapabilityBridgeInfo", () => {
  it("returns bridge information", () => {
    const r = getCapabilityBridgeInfo();
    assert.equal(r.ok, true);
    assert.ok(r.bridges.length >= 8);
    assert.ok(r.bridges.some(b => b.name === "hypothesis_auto_propose"));
    assert.ok(r.bridges.some(b => b.name === "dedup_gate"));
    assert.ok(r.bridges.some(b => b.name === "lens_empirical"));
    assert.ok(r.bridges.some(b => b.name === "heartbeat_bridge"));
  });
});
