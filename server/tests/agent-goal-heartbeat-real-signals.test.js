/**
 * Pinning tests for processGoalHeartbeat's real-signal progress deltas
 * (server.js, ~line 65610 "4) Progress active goals").
 *
 * Closes docs/WAVE4_INVENTORY.md's "goals" row / the simplification flagged
 * in docs/lens-specs/goals-capability-map.md ("Simulate progress based on
 * goal type... In practice, this would hook into actual DTU
 * creation/analysis events"). Before this fix, every active goal's
 * progress was gated by `Math.random() < progressChance` with a fixed
 * `progressAmount` — no relationship to what actually happened in the
 * lattice between ticks.
 *
 * These tests prove three goal types now derive their progress delta from
 * a REAL, already-tracked STATE signal, with the exact formula asserted
 * (not just "some positive delta"):
 *   - KNOWLEDGE_SYNTHESIS: net-new STATE.dtus entries since the goal's last
 *     observed tick -> delta = newDtus * 0.03 * target
 *   - PATTERN_DISCOVERY: net-new high-authority (score > 0.7) DTUs ->
 *     delta = newHighScoreDtus * 0.05 * target
 *   - CLARIFICATION: a real drop in
 *     STATE.growth.functionalDecline.contradictionLoad -> delta =
 *     max(0, lastLoad - load) * target
 * plus a CONSOLIDATION check (also converted to a real MEGA/HYPER-count
 * delta as part of the same fix) and a negative-signal check (contradiction
 * load rising yields zero progress, never negative).
 *
 * Run: node --test server/tests/agent-goal-heartbeat-real-signals.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";

let T;
registerServerCleanExit(() => T);

before(async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  if (!process.env.STATE_PATH) {
    process.env.STATE_PATH = path.join(os.tmpdir(), `concord-goal-heartbeat-state-${process.pid}-${Date.now()}.json`);
  }
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(os.tmpdir(), `concord-goal-heartbeat-${process.pid}-${Date.now()}.db`);
  }
  T = (await import("../server.js")).__TEST__;
  // processGoalHeartbeat's step 2 ("evaluate pending proposals") reads
  // STATE.queues.goalProposals directly; ensureQueues() is normally called
  // by one of the many HTTP-route/macro entry points before a tick ever
  // runs, none of which this direct-unit-test setup goes through.
  T.ensureQueues();
});

function assertClose(actual, expected, msg, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg}: expected ~${expected}, got ${actual}`);
}

/**
 * Run one goal heartbeat tick. Defensively guarantees
 * `STATE.queues.goalProposals` is a real array right before every call:
 * `ensureQueues()` only backfills the defaults when `STATE.queues` is
 * entirely absent, and only re-normalizes ALREADY-PRESENT keys to arrays
 * — it never adds a missing key to an existing `STATE.queues` object. In
 * this direct-unit-test setup (driving processGoalHeartbeat() outside any
 * HTTP-route/macro entry point that would otherwise have called
 * ensureQueues() first against a fully-defaulted object) `STATE.queues`
 * can already exist without `goalProposals` on it. This is a pre-existing
 * quirk of `ensureQueues()` unrelated to the progress-delta logic under
 * test here — worked around at the call site rather than touched, since
 * `ensureQueues` is out of scope for this change.
 */
function tick() {
  if (!T.STATE.queues || typeof T.STATE.queues !== "object") T.STATE.queues = {};
  if (!Array.isArray(T.STATE.queues.goalProposals)) T.STATE.queues.goalProposals = [];
  return T.processGoalHeartbeat({});
}

/** Create, evaluate, and activate a goal of the given type. Returns the live goal object. */
function makeActiveGoal(type, { target = 100, priority = 0.5 } = {}) {
  const prop = T.createGoalProposal({ type, title: `test-${type}-${Date.now()}-${Math.random()}`, target, priority, source: "autonomous" });
  assert.equal(prop.ok, true, `createGoalProposal failed: ${prop.error}`);
  const goal = prop.goal;

  T.ensureGoalSystem();
  T.STATE.goals.registry.set(goal.id, goal);

  const evalResult = T.evaluateGoal(goal, {});
  assert.equal(evalResult.ok, true, `evaluateGoal failed: ${evalResult.error}`);
  assert.equal(goal.state, T.GOAL_STATES.APPROVED, `expected APPROVED after evaluation, got ${goal.state} (overall=${goal.evaluation?.overall})`);

  const actResult = T.activateGoal(goal.id);
  assert.equal(actResult.ok, true, `activateGoal failed: ${actResult.error}`);
  assert.equal(goal.state, T.GOAL_STATES.ACTIVE);

  return goal;
}

function addDtu(id, extra = {}) {
  T.STATE.dtus.set(id, { id, tier: "regular", ...extra });
}

describe("processGoalHeartbeat — real-signal progress (not Math.random())", () => {
  it("KNOWLEDGE_SYNTHESIS: progress delta == net-new DTUs * 0.03 * target", () => {
    const goal = makeActiveGoal(T.GOAL_TYPES.KNOWLEDGE_SYNTHESIS, { target: 100 });

    // First observation establishes the baseline only — no prior tick to
    // diff against, so progress must stay exactly 0.
    tick();
    assert.equal(goal.progress.current, 0, "first tick must only establish baseline, not award progress");
    assert.equal(typeof goal.meta._lastDtuCount, "number");

    // Create 5 net-new DTUs, then tick again.
    for (let i = 0; i < 5; i++) addDtu(`ks-dtu-${goal.id}-${i}`);
    tick();

    // Hand-verified: 5 new DTUs * 0.03 * target(100) = 15.
    assertClose(goal.progress.current, 15, "KNOWLEDGE_SYNTHESIS delta must equal 5*0.03*100=15");

    // A tick with zero new DTUs must add zero further progress.
    tick();
    assertClose(goal.progress.current, 15, "no new DTUs -> no further progress");
  });

  it("KNOWLEDGE_SYNTHESIS: a larger real DTU delta produces a proportionally larger progress delta", () => {
    const goal = makeActiveGoal(T.GOAL_TYPES.KNOWLEDGE_SYNTHESIS, { target: 200 });
    tick(); // baseline
    assert.equal(goal.progress.current, 0);

    for (let i = 0; i < 12; i++) addDtu(`ks-dtu-b-${goal.id}-${i}`);
    tick();

    // Hand-verified: 12 * 0.03 * 200 = 72.
    assertClose(goal.progress.current, 72, "KNOWLEDGE_SYNTHESIS delta must equal 12*0.03*200=72");
  });

  it("PATTERN_DISCOVERY: progress delta == net-new high-authority (score>0.7) DTUs * 0.05 * target", () => {
    const goal = makeActiveGoal(T.GOAL_TYPES.PATTERN_DISCOVERY, { target: 100 });

    tick(); // baseline
    assert.equal(goal.progress.current, 0, "first tick must only establish baseline");

    // Add 3 high-score DTUs and 4 low-score DTUs. Only the high-score ones
    // should count.
    for (let i = 0; i < 3; i++) addDtu(`pd-hi-${goal.id}-${i}`, { authority: { score: 0.9 } });
    for (let i = 0; i < 4; i++) addDtu(`pd-lo-${goal.id}-${i}`, { authority: { score: 0.2 } });
    tick();

    // Hand-verified: 3 new high-score DTUs * 0.05 * target(100) = 15
    // (low-score DTUs must NOT contribute).
    assertClose(goal.progress.current, 15, "PATTERN_DISCOVERY delta must equal 3*0.05*100=15, ignoring low-score DTUs");
  });

  it("CLARIFICATION: progress delta == real drop in contradictionLoad * target", () => {
    if (!T.STATE.growth) T.STATE.growth = {};
    if (!T.STATE.growth.functionalDecline) T.STATE.growth.functionalDecline = {};
    T.STATE.growth.functionalDecline.contradictionLoad = 0.5;

    const goal = makeActiveGoal(T.GOAL_TYPES.CLARIFICATION, { target: 100 });

    tick(); // baseline @ load=0.5
    assert.equal(goal.progress.current, 0, "first tick must only establish baseline");
    assertClose(goal.meta._lastContradictionLoad, 0.5, "baseline must record the real load");

    // Contradictions get resolved: load drops from 0.5 to 0.3.
    T.STATE.growth.functionalDecline.contradictionLoad = 0.3;
    tick();

    // Hand-verified: improvement = 0.5 - 0.3 = 0.2; delta = 0.2 * target(100) = 20.
    assertClose(goal.progress.current, 20, "CLARIFICATION delta must equal (0.5-0.3)*100=20");

    // Contradiction load rising must NEVER produce negative/backward progress.
    T.STATE.growth.functionalDecline.contradictionLoad = 0.6;
    tick();
    assertClose(goal.progress.current, 20, "rising contradiction load must add zero progress, never negative");
  });

  it("CONSOLIDATION: progress delta == net-new MEGA/HYPER-tier DTUs * 0.15 * target", () => {
    const goal = makeActiveGoal(T.GOAL_TYPES.CONSOLIDATION, { target: 100 });

    tick(); // baseline
    assert.equal(goal.progress.current, 0, "first tick must only establish baseline");

    T.STATE.dtus.set(`cons-mega-${goal.id}-0`, { id: `cons-mega-${goal.id}-0`, tier: "mega" });
    T.STATE.dtus.set(`cons-mega-${goal.id}-1`, { id: `cons-mega-${goal.id}-1`, tier: "hyper" });
    tick();

    // Hand-verified: 2 new consolidated-tier DTUs * 0.15 * target(100) = 30.
    assertClose(goal.progress.current, 30, "CONSOLIDATION delta must equal 2*0.15*100=30");
  });
});
