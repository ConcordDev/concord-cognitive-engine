// params-fallback-actions.test.js
// FIX-inference-001 / FIX-metalearning-001 (GB-1521 slice B6) — same genus
// as FIX-grounding-008/009: panels send their inputs as lens/run params,
// but these handlers read only artifact.data, so the tools starved (and
// inference's unify crashed on a null artifact). Params are now the
// fallback in inference:unify and in metalearning's three analysis
// actions; an attached artifact still wins.
//
// Run: node --test server/domains/params-fallback-actions.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerInference from "./inference.js";
import registerMetalearning from "./metalearning.js";

const actions = new Map();
const reg = (d, a, fn) => actions.set(`${d}:${a}`, fn);
registerInference(reg);
registerMetalearning(reg);
const ctx = { actor: { userId: "test" }, userId: "test" };

describe("inference-001 — unify reads the desk panel's params", () => {
  it("unifies from params with a null artifact (no crash)", () => {
    const r = actions.get("inference:unify")(ctx, null, {
      term1: { functor: "parent", args: ["?x", "bob"] },
      term2: { functor: "parent", args: ["alice", "bob"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.unifiable, true);
    assert.equal(r.result.mgu["?x"], "alice");
  });
  it("missing terms still refuse in words", () => {
    const r = actions.get("inference:unify")(ctx, null, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /term1 and term2 are required/);
  });
});

describe("metalearning-001 — analysis actions read the panel's params", () => {
  it("strategySelection scores the supplied task features", () => {
    const r = actions.get("metalearning:strategySelection")(ctx, null, {
      taskFeatures: { complexity: 0.5, dimensionality: 0.5, noise: 0.3, sampleSize: 0.6, nonlinearity: 0.4 },
      landmarkTasks: [],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.method, "expected a selection method in the result");
  });
  it("performanceProfile counts the supplied assessments", () => {
    const r = actions.get("metalearning:performanceProfile")(ctx, null, {
      assessments: [{ skill: "algebra", difficulty: 0.5, score: 0.8 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAssessments, 1);
  });
  it("transferAnalysis compares the supplied domains", () => {
    const r = actions.get("metalearning:transferAnalysis")(ctx, null, {
      sourceDomain: { name: "chess", concepts: ["tactics"], skills: ["calculation"] },
      targetDomain: { name: "go", concepts: ["tactics"], skills: ["reading"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sourceDomain, "chess");
  });
});
