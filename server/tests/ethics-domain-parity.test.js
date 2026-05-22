// Tier-2 contract tests for ethics lens decision-toolkit parity macros:
// multi-framework dilemma analysis, stakeholder map, decision matrix,
// bias checklist, ethics review workflow, and case library.
// Exercises every macro the DecisionToolkit UI wires; asserts ok + shape.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEthicsActions from "../domains/ethics.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ethics.${name}`);
  if (!fn) throw new Error(`ethics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerEthicsActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => {
    throw new Error("network disabled");
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("ethics — multi-framework dilemma", () => {
  it("scores options across utilitarian/deontological/virtue", () => {
    const r = call("multiFrameworkDilemma", ctxA, {
      dilemma: "Should we release a tool that helps many but harms a few?",
      options: [
        { name: "Release", description: "benefit and help many users", benefitScore: 80, harmScore: 20 },
        { name: "Withhold", description: "protect the vulnerable few", benefitScore: 30, harmScore: 10 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.options.length, 2);
    assert.ok(r.result.recommended);
    for (const o of r.result.options) {
      assert.ok("utilitarian" in o.scores);
      assert.ok("deontological" in o.scores);
      assert.ok("virtue" in o.scores);
    }
  });

  it("rejects missing dilemma", () => {
    const r = call("multiFrameworkDilemma", ctxA, { options: [{ name: "X" }] });
    assert.equal(r.ok, false);
  });

  it("listMultiFramework returns saved analyses per user", () => {
    call("multiFrameworkDilemma", ctxA, {
      dilemma: "test", options: [{ name: "A", description: "help" }],
    });
    const r = call("listMultiFramework", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.analyses.length, 1);
    assert.equal(call("listMultiFramework", ctxB).result.analyses.length, 0);
  });
});

describe("ethics — stakeholder map", () => {
  it("computes weighted impact + per-option totals", () => {
    const r = call("stakeholderMap", ctxA, {
      title: "Layoff decision",
      options: ["Lay off", "Restructure"],
      stakeholders: [
        { name: "Junior staff", group: "employees", vulnerability: 80, impacts: { "Lay off": -90, Restructure: -20 } },
        { name: "Shareholders", group: "owners", vulnerability: 0, impacts: { "Lay off": 60, Restructure: 30 } },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stakeholders.length, 2);
    assert.equal(r.result.optionTotals.length, 2);
    assert.ok(r.result.bestOption);
  });

  it("rejects empty options", () => {
    const r = call("stakeholderMap", ctxA, { stakeholders: [{ name: "X" }] });
    assert.equal(r.ok, false);
  });

  it("listStakeholderMaps returns saved maps", () => {
    call("stakeholderMap", ctxA, {
      title: "m", options: ["A"], stakeholders: [{ name: "S", impacts: { A: 10 } }],
    });
    const r = call("listStakeholderMaps", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.maps.length, 1);
  });
});

describe("ethics — decision matrix", () => {
  it("scores options against weighted criteria", () => {
    const r = call("decisionMatrix", ctxA, {
      title: "Vendor pick",
      criteria: [{ name: "Privacy", weight: 0.6 }, { name: "Cost", weight: 0.4 }],
      options: [
        { name: "Vendor A", scores: { Privacy: 9, Cost: 4 } },
        { name: "Vendor B", scores: { Privacy: 5, Cost: 9 } },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.options.length, 2);
    assert.ok(r.result.winner);
    for (const o of r.result.options) assert.ok(o.percent >= 0 && o.percent <= 100);
  });

  it("rejects missing criteria", () => {
    const r = call("decisionMatrix", ctxA, { options: [{ name: "X" }] });
    assert.equal(r.ok, false);
  });

  it("listDecisionMatrices returns saved matrices", () => {
    call("decisionMatrix", ctxA, {
      title: "m", criteria: [{ name: "C", weight: 1 }], options: [{ name: "O", scores: { C: 5 } }],
    });
    const r = call("listDecisionMatrices", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.matrices.length, 1);
  });
});

describe("ethics — bias checklist", () => {
  it("returns the canonical bias template", () => {
    const r = call("biasChecklistTemplate", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.items.length >= 10);
  });

  it("computes risk score from flagged biases", () => {
    const r = call("biasChecklist", ctxA, {
      decision: "Adopt the incumbent vendor again",
      responses: {
        sunk_cost: { flagged: true, note: "5 years of investment" },
        status_quo: { flagged: true },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.flaggedCount, 2);
    assert.ok(["low", "moderate", "high"].includes(r.result.riskLevel));
  });

  it("rejects missing decision text", () => {
    const r = call("biasChecklist", ctxA, { responses: {} });
    assert.equal(r.ok, false);
  });

  it("listBiasChecklists returns saved checklists", () => {
    call("biasChecklist", ctxA, { decision: "d", responses: {} });
    const r = call("listBiasChecklists", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.checklists.length, 1);
  });
});

describe("ethics — review workflow", () => {
  it("submits, gathers opinions, and records a verdict", () => {
    const sub = call("submitReview", ctxA, {
      title: "Data sharing", dilemma: "Should we share anonymized data with a partner?",
    });
    assert.equal(sub.ok, true);
    assert.equal(sub.result.status, "open");
    const reviewId = sub.result.id;

    const op = call("addReviewOpinion", ctxA, {
      reviewId, stance: "approve", rationale: "consented and anonymized",
    });
    assert.equal(op.ok, true);
    assert.equal(op.result.status, "deliberating");

    const verdict = call("recordVerdict", ctxA, {
      reviewId, decision: "Approved with audit", rationale: "low residual risk",
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.result.status, "decided");
    assert.ok(verdict.result.verdict);
    assert.equal(verdict.result.verdict.tally.approve, 1);
  });

  it("rejects opinion with invalid stance", () => {
    const sub = call("submitReview", ctxA, { title: "t", dilemma: "d" });
    const r = call("addReviewOpinion", ctxA, { reviewId: sub.result.id, stance: "bogus" });
    assert.equal(r.ok, false);
  });

  it("listReviews returns submitted reviews", () => {
    call("submitReview", ctxA, { title: "t", dilemma: "d" });
    const r = call("listReviews", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.reviews.length, 1);
  });
});

describe("ethics — case library", () => {
  it("archives and searches resolved cases", () => {
    const a = call("archiveCase", ctxA, {
      title: "Trolley variant",
      dilemma: "Divert harm to fewer people?",
      reasoning: "utilitarian aggregation",
      resolution: "Diverted with consent protocol",
      framework: "Utilitarian",
      tags: ["Harm", "Consent"],
    });
    assert.equal(a.ok, true);

    const search = call("searchCases", ctxA, { query: "trolley" });
    assert.equal(search.ok, true);
    assert.equal(search.result.cases.length, 1);
    assert.ok(search.result.allTags.includes("harm"));

    const byTag = call("searchCases", ctxA, { tag: "consent" });
    assert.equal(byTag.result.cases.length, 1);
  });

  it("rejects archive missing resolution", () => {
    const r = call("archiveCase", ctxA, { title: "t", dilemma: "d" });
    assert.equal(r.ok, false);
  });

  it("deleteCase removes an archived case", () => {
    const a = call("archiveCase", ctxA, {
      title: "t", dilemma: "d", resolution: "r",
    });
    const del = call("deleteCase", ctxA, { caseId: a.result.id });
    assert.equal(del.ok, true);
    assert.equal(call("searchCases", ctxA).result.cases.length, 0);
  });
});

describe("ethics — pre-existing analysis macros still parity", () => {
  it("frameworkAnalysis returns multi-framework synthesis", () => {
    const fn = ACTIONS.get("ethics.frameworkAnalysis");
    const r = fn(ctxA, {
      data: {
        action: { description: "honest and transparent disclosure", consequences: [{ impact: 5, affectedCount: 10 }] },
      },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.frameworks);
  });
});
