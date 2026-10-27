// A string where a handler reads a collection used to throw, and the catch
// relabeled it as invalid_input with no field. The refusal is now the field
// check. Omitted collections stay empty. Does not boot server.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerAgriculture from "../domains/agriculture.js";
import registerAccounting from "../domains/accounting.js";
import registerFood from "../domains/food.js";
import registerCode from "../domains/code.js";
import registerGraph from "../domains/graph.js";
import registerTemporal from "../domains/temporal.js";
import registerAgents from "../domains/agents.js";
import registerMath from "../domains/math.js";
import registerDtus from "../domains/dtus.js";
import registerEducation from "../domains/education.js";
import registerHealthcare from "../domains/healthcare.js";
import registerImport from "../domains/importdomain.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
for (const reg of [
  registerAgriculture, registerAccounting, registerFood, registerCode, registerGraph,
  registerTemporal, registerAgents, registerMath, registerDtus, registerEducation,
  registerHealthcare, registerImport,
]) reg(register);

const ctx = { actor: { userId: "wave9" }, userId: "wave9" };
function call(key, data = {}) {
  const fn = ACTIONS.get(key);
  assert.equal(typeof fn, "function", key);
  return fn(ctx, { id: "a", data, meta: {} }, data);
}

describe("wave9 list input — named field, not a catch relabel", () => {
  const cases = [
    ["agriculture.rotationPlan", "fields", { fields: "north" }],
    ["agriculture.rotationPlan", "rotationRules", { rotationRules: "corn" }],
    ["accounting.budgetVariance", "budget", { budget: "rent" }],
    ["food.costPlate", "menuItems", { menuItems: "soup" }],
    ["code.dependencyAudit", "dependencies", { dependencies: "left-pad" }],
    ["graph.pathFind", "edges", { edges: "a-b", from: "a", to: "b" }],
    ["temporal.changepoints", "values", { values: "1,2,3,4,5,6,7,8,9" }],
    ["agents.routeTask", "agents", { agents: "ada", task: "file" }],
    ["math.polynomialAnalysis", "coefficients", { coefficients: "1,0,-1" }],
    ["dtus.citationGraph", "dtus", { dtus: "dtu_1" }],
    ["education.gradeCalculation", "students", { students: "ada" }],
    ["healthcare.protocolMatch", "conditions", { conditions: "E11.9" }],
    ["import.mapFields", "sourceFields", { sourceFields: "name", targetFields: ["title"] }],
  ];

  for (const [key, field, data] of cases) {
    it(`${key} refuses a non-array ${field}`, () => {
      const r = call(key, data);
      assert.equal(r.ok, false, key);
      assert.equal(r.error, "invalid_input", key);
      assert.equal(r.field, field, key);
      assert.equal(r.reason, "expected_array", key);
      assert.equal(JSON.stringify(r).includes("is not a function"), false, key);
    });
  }

  it("omitted collections are still empty, not a refusal", () => {
    const plan = call("agriculture.rotationPlan", {});
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.result.fields, []);
    const audit = call("code.dependencyAudit", {});
    assert.equal(audit.ok, true);
    assert.deepEqual(audit.result.dependencies, []);
    const poly = call("math.polynomialAnalysis", { coefficients: [1, 0, -1] });
    assert.equal(poly.ok, true);
    assert.equal(poly.result.degree, 2);
  });

  it("math.polynomialAnalysis refuses a non-array evaluateAt and still defaults when omitted", () => {
    const bad = call("math.polynomialAnalysis", { coefficients: [1, -1], evaluateAt: "2026-01-01" });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "evaluateAt");
    const ok = call("math.polynomialAnalysis", { coefficients: [1, -1] });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.result.evaluations.map((e) => e.x), [0, 1, -1]);
  });

  it("a real rotation field still produces a suggestion", () => {
    const r = call("agriculture.rotationPlan", {
      fields: [{ fieldId: "f1", name: "North", history: [{ year: 2025, season: "summer", crop: "corn" }] }],
      rotationRules: [{ previousCrop: "corn", recommendedNext: ["soybean"], avoid: ["corn"] }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.fields[0].lastCrop, "corn");
    assert.deepEqual(r.result.fields[0].suggestedNext, ["soybean"]);
  });

  it("dtus.duplicateDetection names tags when siblings is a real list", () => {
    const r = call("dtus.duplicateDetection", { siblings: [{ title: "other", tags: ["a"] }], tags: "alpha" });
    assert.equal(r.ok, false);
    assert.equal(r.field, "tags");
    assert.equal(r.reason, "expected_array");
  });

  it("healthcare.protocolMatch refuses a non-array protocols list and an empty chart still matches nothing", () => {
    const bad = call("healthcare.protocolMatch", { conditions: ["E11.9"], protocols: "ada" });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "protocols");
    const empty = call("healthcare.protocolMatch", {});
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.result.matched, []);
  });

  it("import.mapFields still asks for both lists when they are omitted", () => {
    const r = call("import.mapFields", {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.mappings, []);
  });
});
