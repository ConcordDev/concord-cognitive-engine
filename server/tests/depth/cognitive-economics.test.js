// server/tests/depth/cognitive-economics.test.js

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
import { seedBenchDtuCorpus } from "../../lib/runtime/cognitive-savings-ledger.js";
import {
  estimateInvocationCost,
  comparePathEconomics,
  getEconomicPathConfig,
} from "../../lib/runtime/cognitive-economics.js";
import {
  runEconomicCompileProbe,
  runCognitiveEconomicsBench,
} from "../../lib/runtime/cognitive-economics-bench.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [upMission, upPhases, upTier, upDila, upV2, upExec, upCausal, upDhtp, upCognitive, upSavings]) {
    up(db);
  }
  seedBenchDtuCorpus(db, { count: 50 });
  return db;
}

async function mockDispatch(tool) {
  return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
}

describe("Cognitive economics — cost model", () => {
  it("estimateInvocationCost returns zero for cache hits", () => {
    const cost = estimateInvocationCost({
      inputTokens: 500,
      cacheHit: true,
      pricing: { inputPer1M: 1, outputPer1M: 1, defaultOutputTokens: 100 },
    });
    assert.equal(cost.totalUsd, 0);
    assert.equal(cost.avoided, true);
  });

  it("estimateInvocationCost computes billed cost from token counts", () => {
    const cost = estimateInvocationCost({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      pricing: { inputPer1M: 0.59, outputPer1M: 0.79, defaultOutputTokens: 120 },
    });
    assert.ok(Math.abs(cost.totalUsd - (0.59 + 0.079)) < 0.001);
  });

  it("all five economic paths are defined", () => {
    for (const id of ["A", "B", "C", "D", "E"]) {
      assert.ok(getEconomicPathConfig(id), `path ${id} missing`);
    }
  });
});

describe("Cognitive economics — compile probes", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("A–E compile probes show monotonic model-input reduction", async () => {
    const probes = [];
    for (const id of ["A", "B", "C", "D", "E"]) {
      probes.push(await runEconomicCompileProbe({ db, pathId: id }));
    }
    const a = probes.find((p) => p.pathId === "A");
    const c = probes.find((p) => p.pathId === "C");
    const e = probes.find((p) => p.pathId === "E");
    assert.ok(a.pipeline.modelInput >= c.pipeline.modelInput,
      `raw (${a.pipeline.modelInput}) should be >= dtu+dhtp (${c.pipeline.modelInput})`);
    assert.ok(a.cost.totalUsd >= c.cost.totalUsd,
      "path C should cost less than or equal to raw baseline per invocation");
    assert.ok(e.pipeline.modelInput <= a.pipeline.modelInput,
      "full stack model input should not exceed raw baseline");
  });
});

describe("Cognitive economics — full multiplier bench", () => {
  it("runs A–E paths with success and cost comparison", async () => {
    const db = setupDb();
    const bench = await runCognitiveEconomicsBench({
      db,
      dispatchMCP: mockDispatch,
      iterationsPerPath: 3,
      minCacheUses: 1,
    });

    assert.equal(bench.pathResults.length, 5);
    assert.equal(bench.comparison.length, 5);
    assert.ok(bench.headline.baselineCostPerSuccessUsd > 0);
    assert.ok(bench.ok, JSON.stringify(bench.pathResults.map((r) => ({
      path: r.pathId, success: r.successRate,
    }))));

    const ranked = comparePathEconomics(bench.pathResults);
    const raw = ranked.find((r) => r.pathId === "A");
    const full = ranked.find((r) => r.pathId === "E");
    assert.ok(full.costPerSuccessfulMissionUsd <= raw.costPerSuccessfulMissionUsd,
      "full Dila path should not cost more per success than raw baseline in mock bench");
  });
});
