// server/tests/depth/phase3-cognitive-platform.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upBilling } from "../../migrations/438_provider_billing_telemetry.js";
import { up as upCognitiveSchema } from "../../migrations/440_dtu_cognitive_schema.js";
import {
  upsertCognitiveMeta,
  getCognitiveMeta,
  linkCausalEdge,
  invalidateDtu,
  filterApplicableDtus,
  linkDtuToRepo,
  getDtuRepoLinks,
  enrichDtuOnWrite,
} from "../../lib/dtu-cognitive-schema.js";
import {
  runMemoryBenchmark,
  MEMORY_BENCHMARK_CASES,
  seedMemoryCorpus,
} from "../../lib/runtime/memory-benchmark.js";
import { compileToolUniverse } from "../../lib/runtime/tool-universe-compiler.js";
import { buildRepoContextForTask } from "../../lib/runtime/repository-world-model.js";
import {
  meterInferenceWithBilling,
  compareAbBillingPaths,
  resolveAbTestPath,
  meterCallBrainResult,
  meterBrainChatResult,
} from "../../lib/runtime/inference-billing-bridge.js";
import {
  runBlindMemoryWorkload,
  BLIND_WORKLOADS,
} from "../../lib/runtime/dila-raw-blind-benchmark.js";
import { runDtuRetrievalEval } from "../../lib/runtime/dtu-retrieval-eval.js";
import { buildCognitiveIR } from "../../lib/dhtp-cognitive-ir.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [upMission, upPhases, upTier, upDila, upV2, upBilling, upCognitiveSchema]) {
    up(db);
  }
  return db;
}

const SAMPLE_HAND_TOOLS = [
  { name: "dtu_search", description: "Search DTUs by query" },
  { name: "dhtp_compress", description: "Compress context with DHTP" },
  { name: "repo_graph_context", description: "Build repo context for coding task" },
  { name: "brain_route", description: "Route query to best brain" },
];

describe("DTU cognitive schema", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("upserts and reads causal/outcome metadata", () => {
    upsertCognitiveMeta(db, "dtu_a", {
      outcomes: [{ key: "metric", value: "cost_per_verified_success" }],
      applicability: { domains: ["bench"], tags: ["metric"] },
    });
    const meta = getCognitiveMeta(db, "dtu_a");
    assert.equal(meta.outcomes[0].value, "cost_per_verified_success");
    assert.deepEqual(meta.applicability.domains, ["bench"]);
  });

  it("links causal edges bidirectionally", () => {
    linkCausalEdge(db, "parent", "child", "caused");
    const p = getCognitiveMeta(db, "parent");
    const c = getCognitiveMeta(db, "child");
    assert.equal(p.causalChildren[0].id, "child");
    assert.equal(c.causalParents[0].id, "parent");
  });

  it("excludes invalidated DTUs from applicability filter", () => {
    upsertCognitiveMeta(db, "good", { outcomes: [{ key: "x", value: "1" }], confidence: 0.9 });
    upsertCognitiveMeta(db, "bad", { outcomes: [{ key: "x", value: "9" }], confidence: 0.1 });
    invalidateDtu(db, "bad", { reason: "contradicted" });
    const hits = filterApplicableDtus(db, ["good", "bad"], {});
    assert.equal(hits.length, 1);
    assert.equal(hits[0].dtuId, "good");
  });

  it("links DTU to repo ref", () => {
    linkDtuToRepo(db, "dtu_x", "server/lib/foo.js", "references");
    const links = getDtuRepoLinks(db, "dtu_x");
    assert.equal(links.length, 1);
    assert.equal(links[0].repoRef, "server/lib/foo.js");
  });
});

describe("LoCoMo memory benchmark", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("defines seven memory categories", () => {
    assert.equal(MEMORY_BENCHMARK_CASES.length, 7);
    const cats = new Set(MEMORY_BENCHMARK_CASES.map((c) => c.category));
    assert.ok(cats.has("factual"));
    assert.ok(cats.has("corruption"));
  });

  it("passes full memory suite on seeded corpus", () => {
    const result = runMemoryBenchmark(db);
    assert.equal(result.passed, 7);
    assert.equal(result.passRate, 1);
    assert.equal(result.ok, true);
  });

  it("seeds corpus with invalidation for contradictions", () => {
    const corpus = seedMemoryCorpus(db);
    const bad = getCognitiveMeta(db, corpus.episodes.budgetBad);
    assert.ok(bad.invalidated);
  });
});

describe("Tool universe compiler", () => {
  it("selects task-relevant tools and omits the rest", () => {
    const compiled = compileToolUniverse("compress dtu context with dhtp", {
      budget: 2,
      handTools: SAMPLE_HAND_TOOLS,
      includeReflected: false,
    });
    assert.ok(compiled.selectedCount <= 2);
    assert.ok(compiled.tools.some((t) => t.name === "dhtp_compress" || t.name === "dtu_search"));
    assert.ok(compiled.omittedCount >= 0);
  });

  it("always includes forced tools", () => {
    const compiled = compileToolUniverse("unrelated query", {
      budget: 1,
      handTools: SAMPLE_HAND_TOOLS,
      includeReflected: false,
      alwaysInclude: ["brain_route"],
    });
    assert.equal(compiled.tools[0].name, "brain_route");
  });
});

describe("Repository world model", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("builds task context without throwing on empty graph", () => {
    const ctx = buildRepoContextForTask(db, { intent: "findSymbol foo", symbol: "foo" });
    assert.equal(ctx.ok, true);
    assert.ok(Array.isArray(ctx.files));
  });
});

describe("Live inference billing bridge", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("records provider billing from inference span", () => {
    const prev = process.env.COGNITIVE_ECON_MODE;
    process.env.COGNITIVE_ECON_MODE = "billed";
    process.env.COGNITIVE_BLIND_PATH = "A";

    meterInferenceWithBilling(db, {
      inferenceId: "inf_test_1",
      spanType: "chat",
      brainUsed: "conscious",
      modelUsed: "test-model",
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 120,
    });

    const row = db.prepare(`SELECT COUNT(*) AS c FROM provider_billing_telemetry`).get();
    assert.ok(row.c > 0);
    assert.equal(resolveAbTestPath({}), "A");

    if (prev === undefined) delete process.env.COGNITIVE_ECON_MODE;
    else process.env.COGNITIVE_ECON_MODE = prev;
    delete process.env.COGNITIVE_BLIND_PATH;
  });

  it("compares A/B billing paths", () => {
    meterInferenceWithBilling(db, {
      modelUsed: "m1",
      tokensIn: 1000,
      tokensOut: 100,
      path: "A",
    });
    meterInferenceWithBilling(db, {
      modelUsed: "m1",
      tokensIn: 500,
      tokensOut: 50,
      path: "E",
    });

    const cmp = compareAbBillingPaths(db, { pathA: "A", pathB: "E", sinceHours: 1 });
    assert.equal(cmp.ok, true);
    assert.ok(cmp.pathA.invocations >= 1);
    assert.ok(cmp.pathB.invocations >= 1);
  });
});

describe("Blind benchmark memory workload", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("includes memory_locomo in blind workloads", () => {
    assert.ok(BLIND_WORKLOADS.some((w) => w.id === "memory_locomo" && w.kind === "memory"));
  });

  it("runBlindMemoryWorkload passes all cases", async () => {
    const workload = BLIND_WORKLOADS.find((w) => w.id === "memory_locomo");
    const run = await runBlindMemoryWorkload({ db, pathId: "E", workload });
    assert.equal(run.ok, true);
    assert.equal(run.memoryResult.passRate, 1);
    assert.ok(run.evaluation.composite > 0.8);
  });
});

describe("DTU retrieval eval", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("excludes stale memories from recall pack", () => {
    const result = runDtuRetrievalEval(db);
    assert.equal(result.ok, true);
    assert.equal(result.staleExcluded, true);
    assert.ok(result.packScore.staleLeaked === 0);
  });
});

describe("DTU store cognitive enrichment", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("enrichDtuOnWrite stamps applicability from tags", () => {
    enrichDtuOnWrite(db, { id: "dtu_enrich_test", tags: ["finance", "pinned"], source: "bench.seed" });
    const meta = getCognitiveMeta(db, "dtu_enrich_test");
    assert.ok(meta.applicability.tags.includes("finance"));
    assert.ok(meta.applicability.domains.includes("bench"));
  });
});

describe("Cognitive IR integration", () => {
  it("includes repo context and tool hints in IR", () => {
    const ir = buildCognitiveIR({
      mission: { id: "m1", goal: "fix auth bug in server" },
      step: { tool: "code_review" },
      route: { taskClass: "coding" },
      repoContext: { files: ["server/lib/auth.js"], symbolHits: 2 },
      toolHints: ["dtu_search", "repo_graph_context"],
    });
    assert.ok(ir.EVIDENCE.some((e) => e.startsWith("repo_files:")));
    assert.ok(ir.AVAILABLE_CAPABILITIES.includes("dtu_search"));
  });
});

describe("Billing bridge helpers", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("meterCallBrainResult records only reported Ollama tokens", () => {
    meterCallBrainResult(db, { _interactionId: "x" }, {
      brainName: "utility",
      model: "test",
      promptEvalCount: 50,
      evalCount: 25,
      latencyMs: 100,
      options: { _blindPath: "E" },
    });
    const row = db.prepare(`SELECT prompt_tokens, completion_tokens FROM provider_billing_telemetry`).get();
    assert.equal(row.prompt_tokens, 50);
    assert.equal(row.completion_tokens, 25);
  });

  it("meterBrainChatResult records provider tokens", () => {
    meterBrainChatResult(db, {
      ok: true,
      model: "groq-model",
      provider: "groq_platform",
      tokensIn: 100,
      tokensOut: 40,
    }, { slot: "utility", userId: "u1", latencyMs: 200, opts: { blindPath: "A" } });
    const count = db.prepare(`SELECT COUNT(*) AS c FROM provider_billing_telemetry`).get().c;
    assert.ok(count >= 1);
  });
});
