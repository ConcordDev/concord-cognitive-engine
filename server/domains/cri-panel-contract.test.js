// cri-panel-contract.test.js
// FIX-cri-004 (GB-1521 slice B6) — the Crisis panel's Timeline showed 0
// phases and Impact 0 groups: responseTimeline read steps only from an
// attached artifact and stakeholderImpact only from artifact.data, while
// the panel sends its context as run input (and its stakeholders as
// { group }). Both actions now dual-read the run input; with no custom
// steps the timeline generates the standard five-phase plan, labelled.
//
// Run: node --test server/domains/cri-panel-contract.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCriActions from "./cri.js";

const actions = new Map();
registerCriActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };
const art = (data) => ({ id: null, data, meta: {} });

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("cri-004 — panel contract", () => {
  it("timeline with panel context returns the standard 5 phases", () => {
    const r = actions.get("cri:responseTimeline")(ctx, art({ name: "Warehouse fire", eventType: "fire", severity: "high" }), { name: "Warehouse fire", eventType: "fire", severity: "high" });
    assert.equal(r.ok, true);
    assert.equal(r.result.planSource, "standard-5-phase");
    assert.equal(r.result.phases.length, 5);
    assert.equal(r.result.phases[0].phase, "Detect & triage");
    assert.ok(r.result.totalDurationHours > 0);
  });

  it("custom steps from params still compute a critical path", () => {
    const r = actions.get("cri:responseTimeline")(ctx, art({}), { responseSteps: [
      { name: "triage", durationMinutes: 10 },
      { name: "contain", durationMinutes: 30, dependencies: ["triage"] },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.planSource, "custom-steps");
    assert.equal(r.result.totalDurationMinutes, 40);
  });

  it("impact scores { group } stakeholders and returns them by group", () => {
    const r = actions.get("cri:stakeholderImpact")(ctx, art({}), { stakeholders: [{ group: "Residents" }, { group: "Insurer", type: "external" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAffected, 2);
    assert.deepEqual(r.result.stakeholders.map((g) => g.group).sort(), ["Insurer", "Residents"]);
    assert.ok(r.result.stakeholders.every((g) => g.impact && g.priority));
    assert.equal(r.result.metrics.totalStakeholders, 2);
  });

  it("severity derives factors from flat panel fields instead of defaulting", () => {
    const r = actions.get("cri:severityAssessment")(ctx, art({ scope: "global", affectedCount: 25000 }), { scope: "global", affectedCount: 25000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.factors.scope.score, 5);
    assert.equal(r.result.factors.impact.score, 5);
  });

  it("null artifact does not crash the timeline", () => {
    const r = actions.get("cri:responseTimeline")(ctx, null, { severity: "low" });
    assert.equal(r.ok, true);
    assert.equal(r.result.phases.length, 5);
  });
});
