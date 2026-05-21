// Contract tests for server/domains/cri.js — crisis macros plus the
// 2026 data-quality-loop parity macros (trend, score-rules, remediation,
// alerts, root-cause, side-by-side compare). Pattern mirrors
// travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCriActions from "../domains/cri.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`cri.${name}`);
  if (!fn) throw new Error(`cri.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerCriActions(register); });

beforeEach(() => {
  // Fresh per-user state for every test — exercises the STATE-backed path.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function dtu(id, creti) { return { id, title: `DTU ${id}`, creti }; }
const HIGH = { coherence: 0.9, relevance: 0.9, evidence: 0.85, timeliness: 0.8, integration: 0.9 };
const LOW = { coherence: 0.3, relevance: 0.35, evidence: 0.2, timeliness: 0.25, integration: 0.3 };

describe("cri.severityAssessment (crisis core)", () => {
  it("scores and classifies a crisis", () => {
    const r = call("severityAssessment", ctxA, { data: { crisis: { scope: 5, impact: 5, urgency: 5, controllability: 1 } } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.severityLevel, "critical");
    assert.ok(r.result.severityScore >= 80);
  });
});

describe("cri.responseTimeline (crisis core)", () => {
  it("computes a critical path", () => {
    const r = call("responseTimeline", ctxA, { data: { responseSteps: [
      { name: "triage", durationMinutes: 10 },
      { name: "contain", durationMinutes: 30, dependencies: ["triage"] },
    ] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDurationMinutes, 40);
    assert.ok(r.result.criticalPath.includes("contain"));
  });
});

describe("cri.stakeholderImpact (crisis core)", () => {
  it("tiers communication priority", () => {
    const r = call("stakeholderImpact", ctxA, { data: { stakeholders: [
      { name: "regulator", type: "regulatory", influence: 5, dependence: 4 },
      { name: "staff", type: "internal", influence: 2, dependence: 2 },
    ] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.metrics.totalStakeholders, 2);
  });
});

describe("cri.scoreRules-get / scoreRules-set (configurable rules)", () => {
  it("returns defaults before any customization", () => {
    const r = call("scoreRules-get", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.isCustom, false);
    assert.deepEqual(r.result.dimensions.length, 5);
  });

  it("persists custom weights + thresholds", () => {
    const set = call("scoreRules-set", ctxA, {}, { weights: { evidence: 0.5 }, thresholds: { healthy: 0.8 } });
    assert.equal(set.ok, true);
    assert.equal(set.result.isCustom, true);
    assert.equal(set.result.weights.evidence, 0.5);
    const get = call("scoreRules-get", ctxA, {}, {});
    assert.equal(get.result.isCustom, true);
    assert.equal(get.result.thresholds.healthy, 0.8);
  });

  it("rejects invalid weights and disordered thresholds", () => {
    assert.equal(call("scoreRules-set", ctxA, {}, { weights: { evidence: 2 } }).ok, false);
    assert.equal(call("scoreRules-set", ctxA, {}, { thresholds: { critical: 0.9, warning: 0.5, healthy: 0.7 } }).ok, false);
  });

  it("resets to defaults", () => {
    call("scoreRules-set", ctxA, {}, { weights: { evidence: 0.5 } });
    const reset = call("scoreRules-set", ctxA, {}, { reset: true });
    assert.equal(reset.ok, true);
    assert.equal(reset.result.isCustom, false);
  });
});

describe("cri.trend-snapshot / trend-history (quality trend over time)", () => {
  it("records snapshots and reports direction", () => {
    const s1 = call("trend-snapshot", ctxA, {}, { dtus: [dtu("a", LOW), dtu("b", LOW)] });
    assert.equal(s1.ok, true);
    assert.equal(s1.result.snapshotCount, 1);
    const s2 = call("trend-snapshot", ctxA, {}, { dtus: [dtu("a", HIGH), dtu("b", HIGH)] });
    assert.equal(s2.result.snapshotCount, 2);
    const hist = call("trend-history", ctxA, {}, { limit: 60 });
    assert.equal(hist.ok, true);
    assert.equal(hist.result.points, 2);
    assert.equal(hist.result.direction, "improving");
    assert.ok(hist.result.delta > 0);
  });

  it("rejects non-array dtus", () => {
    assert.equal(call("trend-snapshot", ctxA, {}, { dtus: "nope" }).ok, false);
  });
});

describe("cri.alerts (quality-regression alerting)", () => {
  it("raises an alert when a DTU regresses past threshold", () => {
    call("trend-snapshot", ctxA, {}, { dtus: [dtu("x", HIGH)] });
    const drop = call("trend-snapshot", ctxA, {}, { dtus: [dtu("x", LOW)] });
    assert.equal(drop.result.regressionsDetected, 1);
    const list = call("alerts", ctxA, {}, { op: "list" });
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.unacknowledged, 1);
    const id = list.result.alerts[0].id;
    const ack = call("alerts", ctxA, {}, { op: "ack", id });
    assert.equal(ack.ok, true);
    assert.equal(ack.result.acknowledged, 1);
    const cleared = call("alerts", ctxA, {}, { op: "clear" });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.result.cleared, 1);
  });
});

describe("cri.rootCause (root-cause linkage)", () => {
  it("identifies the weakest dimension with fixes", () => {
    const r = call("rootCause", ctxA, {}, { dtu: dtu("p", { ...HIGH, evidence: 0.1 }) });
    assert.equal(r.ok, true);
    assert.equal(r.result.primaryCause, "evidence");
    assert.ok(r.result.recommendedFixes.length > 0);
    assert.ok(Array.isArray(r.result.breakdown));
  });

  it("rejects a DTU without CRETI scores", () => {
    assert.equal(call("rootCause", ctxA, {}, { dtu: { id: "q" } }).ok, false);
  });
});

describe("cri.compare (side-by-side comparison)", () => {
  it("compares two DTU quality profiles", () => {
    const r = call("compare", ctxA, {}, { dtuA: dtu("a", HIGH), dtuB: dtu("b", LOW) });
    assert.equal(r.ok, true);
    assert.equal(r.result.overallWinner, "a");
    assert.equal(r.result.dimensions.length, 5);
    assert.ok(r.result.biggestGap);
  });

  it("rejects comparing a DTU to itself", () => {
    assert.equal(call("compare", ctxA, {}, { dtuA: dtu("a", HIGH), dtuB: dtu("a", HIGH) }).ok, false);
  });
});

describe("cri.bulkRemediate (batch flag / queue / clear)", () => {
  it("flags, lists, and clears low-quality DTUs", () => {
    const flag = call("bulkRemediate", ctxA, {}, { op: "flag", dtus: [dtu("a", LOW), dtu("b", LOW)], status: "queued", note: "needs work" });
    assert.equal(flag.ok, true);
    assert.equal(flag.result.flagged.length, 2);
    const list = call("bulkRemediate", ctxA, {}, { op: "list" });
    assert.equal(list.result.counts.queued, 2);
    const cleared = call("bulkRemediate", ctxA, {}, { op: "clear", ids: ["a"] });
    assert.equal(cleared.result.cleared, 1);
    assert.equal(cleared.result.remaining, 1);
  });

  it("rejects flag with no dtus and unknown ops", () => {
    assert.equal(call("bulkRemediate", ctxA, {}, { op: "flag", dtus: [] }).ok, false);
    assert.equal(call("bulkRemediate", ctxA, {}, { op: "bogus" }).ok, false);
  });
});

describe("cri per-user isolation", () => {
  it("does not leak flags across users", () => {
    call("bulkRemediate", ctxA, {}, { op: "flag", dtus: [dtu("a", LOW)] });
    const other = { actor: { userId: "user_b" }, userId: "user_b" };
    const list = call("bulkRemediate", other, {}, { op: "list" });
    assert.equal(list.result.counts.total, 0);
  });
});
