// Contract tests for server/domains/sim.js — pure-compute simulation macros.
// Exercises the four original macros plus the eight added for AnyLogic/Vensim
// feature parity: systemDynamics, agentBased, discreteEvent, evaluateFormula,
// goalSeek, calibrate, scenarioDiff, and the persistent model store
// (saveModel / listModels / loadModel / deleteModel).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSimActions from "../domains/sim.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`sim.${name}`);
  if (!fn) throw new Error(`sim.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerSimActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { simLens: undefined };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// ─── Original macros ─────────────────────────────────────────────────────────

describe("sim.scenarioRun / parameterSweep / monteCarlo / sensitivityAnalysis", () => {
  it("scenarioRun integrates growth rules", () => {
    const r = call("scenarioRun", ctxA, {
      data: { initialState: { pop: 100 }, rules: [{ field: "pop", type: "growth", rate: 0.1 }], steps: 5 },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.stepsRun, 5);
    assert.ok(r.result.finalState.pop > 100);
  });

  it("parameterSweep produces one row per parameter value", () => {
    const r = call("parameterSweep", ctxA, {
      data: { baseState: { x: 1, y: 10 }, parameter: "x", range: { min: 0, max: 4, step: 1 },
        rules: [{ field: "y", type: "growth", rate: 0.1 }], steps: 3 },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.runsCompleted, 5);
  });

  it("monteCarlo reports percentiles", () => {
    const r = call("monteCarlo", ctxA, {
      data: { trials: 2000, variables: [{ name: "a", min: 0, max: 10 }, { name: "b", mean: 5, stddev: 1 }] },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.percentiles.p95 >= r.result.percentiles.p5);
  });

  it("sensitivityAnalysis ranks parameters", () => {
    const r = call("sensitivityAnalysis", ctxA, {
      data: { baseState: { a: 10, b: 20 }, rules: [{ field: "b", type: "growth", rate: 0.2 }], steps: 5 },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.sensitivity));
  });
});

// ─── System dynamics (stock-and-flow) ────────────────────────────────────────

describe("sim.systemDynamics", () => {
  it("integrates a stock-and-flow model with Euler", () => {
    const r = call("systemDynamics", ctxA, {}, {
      model: {
        stocks: [{ name: "tank", initial: 100 }],
        flows: [{ name: "drain", expr: "tank * 0.1", from: "tank" }],
      },
      steps: 20, dt: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "euler");
    assert.ok(r.result.finalState.tank < 100);
    assert.equal(r.result.trajectory.length, 21);
  });

  it("conserves mass between two stocks via a transfer flow", () => {
    const r = call("systemDynamics", ctxA, {}, {
      model: {
        stocks: [{ name: "A", initial: 50 }, { name: "B", initial: 0 }],
        flows: [{ name: "move", expr: "5", from: "A", to: "B" }],
      },
      steps: 5, dt: 1,
    });
    assert.equal(r.ok, true);
    const total = r.result.finalState.A + r.result.finalState.B;
    assert.equal(Math.round(total), 50);
  });

  it("detects feedback loops from flow expressions", () => {
    const r = call("systemDynamics", ctxA, {}, {
      model: {
        stocks: [{ name: "pop", initial: 10 }],
        flows: [{ name: "births", expr: "pop * 0.05", to: "pop" }],
      },
      steps: 10,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.feedbackLoops.length >= 1);
    assert.equal(r.result.feedbackLoops[0].polarity, "reinforcing");
  });

  it("returns guidance message when no stocks supplied", () => {
    const r = call("systemDynamics", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /model\.stocks/);
  });

  it("fails gracefully on bad flow expression", () => {
    const r = call("systemDynamics", ctxA, {}, {
      model: { stocks: [{ name: "x", initial: 1 }], flows: [{ name: "f", expr: "x * (", to: "x" }] },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /failed/);
  });
});

// ─── Persistent model store ──────────────────────────────────────────────────

describe("sim model store (save / list / load / delete)", () => {
  it("saves, lists, loads and deletes a model per user", () => {
    const model = { stocks: [{ name: "s", initial: 1 }], flows: [] };
    const saved = call("saveModel", ctxA, {}, { name: "My SD Model", model });
    assert.equal(saved.ok, true);
    assert.ok(saved.result.id);

    const listed = call("listModels", ctxA, {}, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.models[0].name, "My SD Model");

    const loaded = call("loadModel", ctxA, {}, { id: saved.result.id });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.result.model.stocks[0].name, "s");

    const del = call("deleteModel", ctxA, {}, { id: saved.result.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.equal(call("listModels", ctxA, {}, {}).result.count, 0);
  });

  it("updates an existing model when id is reused", () => {
    const model = { stocks: [{ name: "s", initial: 1 }], flows: [] };
    const saved = call("saveModel", ctxA, {}, { name: "v1", model });
    const updated = call("saveModel", ctxA, {}, { id: saved.result.id, name: "v2", model });
    assert.equal(updated.result.id, saved.result.id);
    assert.equal(call("listModels", ctxA, {}, {}).result.count, 1);
    assert.equal(call("loadModel", ctxA, {}, { id: saved.result.id }).result.name, "v2");
  });

  it("loadModel reports not-found for unknown id", () => {
    const r = call("loadModel", ctxA, {}, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

// ─── Agent-based modeling ────────────────────────────────────────────────────

describe("sim.agentBased", () => {
  it("runs an SIR epidemic model and tracks compartments", () => {
    const r = call("agentBased", ctxA, {}, {
      kind: "sir", population: 200, steps: 60, gridSize: 30, initialInfected: 5, seed: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "sir");
    assert.ok(r.result.peakInfected >= 5);
    assert.equal(r.result.series[0].infected, 5);
  });

  it("is deterministic for a fixed seed", () => {
    const a = call("agentBased", ctxA, {}, { kind: "sir", population: 150, steps: 40, seed: 99 });
    const b = call("agentBased", ctxA, {}, { kind: "sir", population: 150, steps: 40, seed: 99 });
    assert.deepEqual(a.result.series, b.result.series);
  });

  it("runs a Schelling segregation model", () => {
    const r = call("agentBased", ctxA, {}, { kind: "schelling", gridSize: 25, steps: 30, seed: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "schelling");
    assert.ok(r.result.series[r.result.series.length - 1].satisfaction >= r.result.series[0].satisfaction);
  });

  it("runs a predator-prey model", () => {
    const r = call("agentBased", ctxA, {}, { kind: "predator-prey", steps: 40, gridSize: 30, seed: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "predator-prey");
    assert.ok("prey" in r.result.series[0]);
  });

  it("rejects an unknown agent model kind", () => {
    const r = call("agentBased", ctxA, {}, { kind: "wat" });
    assert.equal(r.ok, false);
  });
});

// ─── Discrete-event simulation ───────────────────────────────────────────────

describe("sim.discreteEvent", () => {
  it("simulates an M/M/1 queue and reports stable metrics", () => {
    const r = call("discreteEvent", ctxA, {}, {
      arrivalRate: 0.8, serviceRate: 1.0, servers: 1, maxJobs: 4000, seed: 11,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stable, true);
    assert.ok(r.result.avgWaitTime > 0);
    assert.equal(r.result.jobsServed, 4000);
  });

  it("flags an unstable system when load exceeds capacity", () => {
    const r = call("discreteEvent", ctxA, {}, {
      arrivalRate: 2.0, serviceRate: 1.0, servers: 1, maxJobs: 1000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stable, false);
    assert.ok(r.result.trafficIntensity > 1);
  });

  it("multiple servers reduce traffic intensity", () => {
    const one = call("discreteEvent", ctxA, {}, { arrivalRate: 1.5, serviceRate: 1.0, servers: 1, maxJobs: 800 });
    const three = call("discreteEvent", ctxA, {}, { arrivalRate: 1.5, serviceRate: 1.0, servers: 3, maxJobs: 800 });
    assert.ok(three.result.trafficIntensity < one.result.trafficIntensity);
  });

  it("respects a finite queue capacity by balking jobs", () => {
    const r = call("discreteEvent", ctxA, {}, {
      arrivalRate: 3.0, serviceRate: 1.0, servers: 1, queueCapacity: 5, maxJobs: 500,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.jobsBalked > 0);
    assert.ok(r.result.maxQueueLength <= 5);
  });

  it("rejects non-positive rates", () => {
    const r = call("discreteEvent", ctxA, {}, { arrivalRate: 0, serviceRate: 1 });
    assert.equal(r.ok, false);
  });
});

// ─── Formula evaluator ───────────────────────────────────────────────────────

describe("sim.evaluateFormula", () => {
  it("evaluates arithmetic with precedence and parentheses", () => {
    const r = call("evaluateFormula", ctxA, {}, { expression: "2 + 3 * 4 - (10 / 2)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 9);
  });

  it("resolves named variables", () => {
    const r = call("evaluateFormula", ctxA, {}, {
      expression: "revenue * margin - fixedCost",
      variables: { revenue: 1000, margin: 0.3, fixedCost: 120 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 180);
  });

  it("supports the function whitelist", () => {
    const r = call("evaluateFormula", ctxA, {}, { expression: "max(3, 7) + sqrt(16) + pow(2, 3)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 19);
  });

  it("handles unary minus and exponentiation", () => {
    const r = call("evaluateFormula", ctxA, {}, { expression: "-2 ^ 2 + 10" });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 6);
  });

  it("rejects malformed expressions", () => {
    assert.equal(call("evaluateFormula", ctxA, {}, { expression: "2 + * 3" }).ok, false);
    assert.equal(call("evaluateFormula", ctxA, {}, { expression: "(1 + 2" }).ok, false);
    assert.equal(call("evaluateFormula", ctxA, {}, { expression: "missing + 1" }).ok, false);
  });
});

// ─── Goal-seek / optimization ────────────────────────────────────────────────

describe("sim.goalSeek", () => {
  it("finds a parameter value that hits a target output", () => {
    const r = call("goalSeek", ctxA, {}, {
      expression: "x * 3 + 5", parameter: "x", target: 50, min: 0, max: 100,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.converged, true);
    assert.ok(Math.abs(r.result.solution - 15) < 0.05);
  });

  it("maximizes a unimodal function via golden-section search", () => {
    const r = call("goalSeek", ctxA, {}, {
      expression: "0 - (x - 7) ^ 2 + 20", parameter: "x", objective: "maximize", min: 0, max: 20,
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.solution - 7) < 0.1);
  });

  it("minimizes a unimodal function", () => {
    const r = call("goalSeek", ctxA, {}, {
      expression: "(x - 4) ^ 2", parameter: "x", objective: "minimize", min: -10, max: 10,
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.solution - 4) < 0.1);
  });

  it("uses constants alongside the decision parameter", () => {
    const r = call("goalSeek", ctxA, {}, {
      expression: "price * units - cost", parameter: "units", target: 0,
      constants: { price: 10, cost: 500 }, min: 0, max: 1000,
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.solution - 50) < 0.1);
  });

  it("rejects missing expression or parameter", () => {
    assert.equal(call("goalSeek", ctxA, {}, { parameter: "x", target: 1 }).ok, false);
    assert.equal(call("goalSeek", ctxA, {}, { expression: "x", target: 1 }).ok, false);
  });
});

// ─── Calibration ─────────────────────────────────────────────────────────────

describe("sim.calibrate", () => {
  it("recovers a known growth rate from synthetic observations", () => {
    // Generate observed data from a model with growthRate = 0.08.
    const trueModel = {
      stocks: [{ name: "pop", initial: 100 }],
      flows: [{ name: "births", expr: "pop * growthRate", to: "pop" }],
      params: { growthRate: 0.08 },
    };
    const truth = call("systemDynamics", ctxA, {}, { model: trueModel, steps: 10, dt: 1 });
    const observed = truth.result.trajectory.map((row) => ({ t: row.t, value: row.pop }));

    const r = call("calibrate", ctxA, {}, {
      model: {
        stocks: [{ name: "pop", initial: 100 }],
        flows: [{ name: "births", expr: "pop * growthRate", to: "pop" }],
      },
      observed, fitStock: "pop",
      tunable: [{ name: "growthRate", min: 0, max: 0.3 }],
      passes: 8, dt: 1,
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.calibratedParameters.growthRate - 0.08) < 0.01);
    assert.ok(r.result.rSquared > 0.99);
  });

  it("reports SSE / RMSE / R-squared fit quality", () => {
    const r = call("calibrate", ctxA, {}, {
      model: {
        stocks: [{ name: "s", initial: 10 }],
        flows: [{ name: "f", expr: "rate", to: "s" }],
      },
      observed: [{ t: 0, value: 10 }, { t: 1, value: 12 }, { t: 2, value: 14 }, { t: 3, value: 16 }],
      fitStock: "s",
      tunable: [{ name: "rate", min: 0, max: 10 }],
    });
    assert.equal(r.ok, true);
    assert.ok("sse" in r.result && "rmse" in r.result && "rSquared" in r.result);
    assert.ok(Math.abs(r.result.calibratedParameters.rate - 2) < 0.05);
  });

  it("rejects insufficient observed data", () => {
    const r = call("calibrate", ctxA, {}, {
      model: { stocks: [{ name: "s", initial: 1 }], flows: [] },
      observed: [{ t: 0, value: 1 }], fitStock: "s",
      tunable: [{ name: "r", min: 0, max: 1 }],
    });
    assert.equal(r.ok, false);
  });
});

// ─── Scenario diff (statistical significance) ────────────────────────────────

describe("sim.scenarioDiff", () => {
  it("detects a significant difference between two samples", () => {
    const a = Array.from({ length: 60 }, (_, i) => 100 + (i % 5));
    const b = Array.from({ length: 60 }, (_, i) => 130 + (i % 5));
    const r = call("scenarioDiff", ctxA, {}, { sampleA: a, sampleB: b });
    assert.equal(r.ok, true);
    assert.equal(r.result.significant, true);
    assert.ok(r.result.pValue < 0.05);
    assert.equal(r.result.effectSize, "large");
  });

  it("reports no significant difference for overlapping samples", () => {
    const a = [10, 11, 9, 10, 12, 8, 11, 10];
    const b = [10, 9, 11, 10, 12, 9, 10, 11];
    const r = call("scenarioDiff", ctxA, {}, { sampleA: a, sampleB: b });
    assert.equal(r.ok, true);
    assert.equal(r.result.significant, false);
  });

  it("computes mean difference and percent change", () => {
    const r = call("scenarioDiff", ctxA, {}, {
      sampleA: [100, 100, 100, 100], sampleB: [110, 110, 110, 110],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.meanDifference, 10);
    assert.equal(r.result.percentChange, 10);
  });

  it("rejects samples that are too small", () => {
    const r = call("scenarioDiff", ctxA, {}, { sampleA: [1], sampleB: [2, 3] });
    assert.equal(r.ok, false);
  });
});
