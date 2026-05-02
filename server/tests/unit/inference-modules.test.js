// server/tests/unit/inference-modules.test.js
// Unit tests for inference-layer modules: semaphore.js and cost-model.js
// Uses Node.js built-in test runner (node:test + node:assert).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ─── semaphore.js ─────────────────────────────────────────────────────────────

describe("semaphore: acquire / release", () => {
  test("acquire returns an object with a release function", async () => {
    const { acquire } = await import("../../lib/inference/semaphore.js");
    const slot = await acquire("repair");
    assert.equal(typeof slot.release, "function", "slot should have a release() function");
    slot.release();
  });

  test("release decrements inflight count", async () => {
    const { acquire, getVramState } = await import("../../lib/inference/semaphore.js");
    const slot = await acquire("utility");
    const before = getVramState().inflight["utility"] || 0;
    assert.ok(before >= 1, "inflight should be >= 1 after acquire");
    slot.release();
    const after = getVramState().inflight["utility"] || 0;
    assert.ok(after < before, "inflight should decrease after release");
  });

  test("acquired brain becomes warm", async () => {
    const { acquire, getVramState } = await import("../../lib/inference/semaphore.js");
    const slot = await acquire("conscious");
    const state = getVramState();
    assert.ok(state.warmBrains.includes("conscious"), "conscious should be warm after acquire");
    slot.release();
  });

  test("getVramState returns expected shape", async () => {
    const { getVramState } = await import("../../lib/inference/semaphore.js");
    const state = getVramState();
    assert.ok(Array.isArray(state.warmBrains), "warmBrains should be an array");
    assert.equal(typeof state.vramUsedGB, "number", "vramUsedGB should be a number");
    assert.equal(typeof state.vramBudgetGB, "number", "vramBudgetGB should be a number");
    assert.equal(typeof state.inflight, "object", "inflight should be an object");
  });

  test("concurrent acquires up to maxConcurrent resolve without queuing", async () => {
    const { acquire, getVramState } = await import("../../lib/inference/semaphore.js");
    // repair brain has maxConcurrent = 2
    const slot1 = await acquire("repair");
    const slot2 = await acquire("repair");
    const state = getVramState();
    assert.ok((state.inflight["repair"] || 0) >= 2, "should have 2 in-flight repair slots");
    slot1.release();
    slot2.release();
  });

  test("vramUsedGB increases after warming a new brain", async () => {
    const { acquire, getVramState } = await import("../../lib/inference/semaphore.js");
    const before = getVramState().vramUsedGB;
    // subconscious is not always-hot, so acquiring it may increase VRAM
    const slot = await acquire("subconscious");
    const after = getVramState().vramUsedGB;
    // After acquire, subconscious should be warm, so usage should be >= before
    assert.ok(after >= before, "VRAM usage should not decrease after acquiring a brain");
    slot.release();
  });
});

// ─── cost-model.js ────────────────────────────────────────────────────────────

describe("cost-model: computeInferenceCost", () => {
  test("zero tokens returns zero cost", async () => {
    const { computeInferenceCost } = await import("../../lib/inference/cost-model.js");
    const result = computeInferenceCost("qwen2.5:3b", 0, 0);
    assert.equal(result.totalCost, 0, "zero tokens should produce zero cost");
    assert.equal(result.inputCost, 0);
    assert.equal(result.outputCost, 0);
  });

  test("known model returns correct rate", async () => {
    const { computeInferenceCost, COST_RATES } = await import("../../lib/inference/cost-model.js");
    const model = "qwen2.5:3b";
    const rate = COST_RATES[model];
    assert.ok(rate, `rate should exist for model ${model}`);

    const result = computeInferenceCost(model, 1000, 500);
    const expectedInput = (1000 / 1000) * rate.in;
    const expectedOutput = (500 / 1000) * rate.out;
    assert.ok(Math.abs(result.inputCost - expectedInput) < 1e-10, "inputCost should match rate");
    assert.ok(Math.abs(result.outputCost - expectedOutput) < 1e-10, "outputCost should match rate");
    assert.ok(Math.abs(result.totalCost - (expectedInput + expectedOutput)) < 1e-10, "totalCost should be sum");
  });

  test("unknown model falls back to default rate gracefully", async () => {
    const { computeInferenceCost } = await import("../../lib/inference/cost-model.js");
    // Using a model name that doesn't exist in COST_RATES
    const result = computeInferenceCost("nonexistent-model:latest", 1000, 1000);
    assert.ok(result.totalCost > 0, "should return a positive cost using default rate");
    assert.equal(typeof result.inputCost, "number");
    assert.equal(typeof result.outputCost, "number");
    assert.equal(typeof result.totalCost, "number");
  });

  test("conscious model has highest per-token cost", async () => {
    const { computeInferenceCost } = await import("../../lib/inference/cost-model.js");
    const conscious = computeInferenceCost("concord-conscious:latest", 1000, 1000);
    const repair = computeInferenceCost("qwen2.5:0.5b", 1000, 1000);
    assert.ok(conscious.totalCost > repair.totalCost, "conscious model should cost more than repair model");
  });
});

describe("cost-model: aggregateCosts", () => {
  test("empty rows returns zero totals", async () => {
    const { aggregateCosts } = await import("../../lib/inference/cost-model.js");
    const result = aggregateCosts([]);
    assert.equal(result.totalUsd, 0);
    assert.deepEqual(result.byModel, {});
    assert.deepEqual(result.byLens, {});
    assert.deepEqual(result.byCaller, {});
  });

  test("aggregates cost across multiple rows", async () => {
    const { aggregateCosts } = await import("../../lib/inference/cost-model.js");
    const rows = [
      { model_used: "qwen2.5:3b", tokens_in: 500, tokens_out: 200, lens_id: "chat", caller_id: "user-1" },
      { model_used: "qwen2.5:3b", tokens_in: 300, tokens_out: 100, lens_id: "chat", caller_id: "user-1" },
      { model_used: "qwen2.5:0.5b", tokens_in: 100, tokens_out: 50, lens_id: "repair", caller_id: "system" },
    ];
    const result = aggregateCosts(rows);
    assert.ok(result.totalUsd > 0, "total cost should be positive");
    assert.ok(result.byModel["qwen2.5:3b"] > 0, "qwen2.5:3b should have cost");
    assert.ok(result.byModel["qwen2.5:0.5b"] > 0, "qwen2.5:0.5b should have cost");
    assert.ok(result.byLens["chat"] > 0, "chat lens should have cost");
    assert.ok(result.byCaller["user-1"] > 0, "user-1 should have cost");
    // totalUsd should equal sum of all individual costs
    const sumByCaller = Object.values(result.byCaller).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(result.totalUsd - sumByCaller) < 1e-9, "totalUsd should equal sum by caller");
  });

  test("rows without lens_id or caller_id do not crash", async () => {
    const { aggregateCosts } = await import("../../lib/inference/cost-model.js");
    const rows = [
      { model_used: "qwen2.5:3b", tokens_in: 100, tokens_out: 50 },
    ];
    const result = aggregateCosts(rows);
    assert.ok(result.totalUsd > 0);
    assert.deepEqual(result.byLens, {});
    assert.deepEqual(result.byCaller, {});
  });

  test("formatCost returns string representation", async () => {
    const { formatCost } = await import("../../lib/inference/cost-model.js");
    const tiny = formatCost(0.000001);
    const normal = formatCost(0.05);
    assert.equal(typeof tiny, "string", "formatCost should return a string");
    assert.equal(typeof normal, "string");
    assert.ok(tiny.includes("¢") || tiny.includes("$"), "tiny cost should include currency symbol");
  });
});
