// Contract tests for server/domains/ml.js — pure-math evaluation macros
// plus the Hugging Face hub integrations and the per-user ML substrate
// (experiments, datasets, comparison, AutoML, deployments, spaces).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMlActions from "../domains/ml.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`ml.${name}`);
  if (!fn) throw new Error(`ml.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerMlActions(register); });

beforeEach(() => {
  clearExternalFetchCache();
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ─── pure-compute evaluation macros ──────────────────────────────────────
describe("ml.modelEvaluate", () => {
  it("computes classification accuracy + per-class F1", () => {
    const r = call("modelEvaluate", ctxA, {
      data: { predictions: ["a", "b", "a", "b"], actuals: ["a", "b", "b", "b"] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "classification");
    assert.equal(r.result.samples, 4);
    assert.equal(r.result.accuracy, 75);
  });

  it("computes regression R²", () => {
    const r = call("modelEvaluate", ctxA, {
      data: { predictions: [1.1, 2.2, 3.3, 4.4], actuals: [1.1, 2.2, 3.3, 4.4] },
    }, {});
    assert.equal(r.result.type, "regression");
    assert.equal(r.result.r2, 1);
  });
});

describe("ml.featureImportance", () => {
  it("ranks numeric features by correlation", () => {
    const rows = [
      { x: 1, y: 1, t: 1 }, { x: 2, y: 5, t: 2 }, { x: 3, y: 2, t: 3 }, { x: 4, y: 9, t: 4 },
    ];
    const r = call("featureImportance", ctxA, { data: { features: rows, target: "t" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.topFeatures[0], "x");
  });
});

describe("ml.datasetProfile", () => {
  it("profiles columns and a quality score", () => {
    const r = call("datasetProfile", ctxA, {
      data: { dataset: [{ a: 1, b: "x" }, { a: 2, b: "y" }, { a: 3, b: "x" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.rows, 3);
    assert.equal(r.result.columns, 2);
  });
});

describe("ml.hyperparameterSuggest", () => {
  it("suggests neural-network architecture", () => {
    const r = call("hyperparameterSuggest", ctxA, {
      data: { model: "neural-network", task: "classification", datasetSize: 20000, features: 50 },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.suggestions.architecture);
    assert.ok(r.result.suggestions.optimizer);
  });
});

// ─── Hugging Face hub integrations ───────────────────────────────────────
describe("ml.model-hub", () => {
  it("shapes the HF model listing", async () => {
    let url = "";
    globalThis.fetch = async (u) => {
      url = u;
      return { ok: true, json: async () => ([
        { id: "openai/gpt2", pipeline_tag: "text-generation", downloads: 100, likes: 5, tags: ["pytorch"] },
      ]) };
    };
    const r = await call("model-hub", ctxA, { query: "gpt", task: "text-generation" });
    assert.equal(r.ok, true);
    assert.match(url, /huggingface\.co\/api\/models/);
    assert.equal(r.result.models[0].name, "gpt2");
    assert.equal(r.result.models[0].author, "openai");
  });

  it("surfaces network failure", async () => {
    const r = await call("model-hub", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});

describe("ml.model-card", () => {
  it("requires modelId", async () => {
    const r = await call("model-card", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("shapes a model card", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        id: "bert-base-uncased", pipeline_tag: "fill-mask", downloads: 9, likes: 1,
        tags: ["license:apache-2.0", "pytorch"], siblings: [{ rfilename: "config.json" }],
      }),
    });
    const r = await call("model-card", ctxA, { modelId: "bert-base-uncased" });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.license, "apache-2.0");
    assert.deepEqual(r.result.card.siblings, ["config.json"]);
  });
});

describe("ml.playground-infer", () => {
  it("requires modelId + input", async () => {
    assert.equal((await call("playground-infer", ctxA, {})).ok, false);
    assert.equal((await call("playground-infer", ctxA, { modelId: "m" })).ok, false);
  });

  it("runs inference and reports latency", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([{ label: "POSITIVE", score: 0.99 }]) });
    const r = await call("playground-infer", ctxA, { modelId: "distilbert", input: "great movie" });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.latencyMs, "number");
    assert.ok(Array.isArray(r.result.output));
  });
});

describe("ml.dataset-hub", () => {
  it("shapes HF dataset listing", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([{ id: "squad", downloads: 50, likes: 3, tags: ["nlp"] }]),
    });
    const r = await call("dataset-hub", ctxA, { query: "squad" });
    assert.equal(r.ok, true);
    assert.equal(r.result.datasets[0].name, "squad");
  });
});

// ─── experiment tracking ─────────────────────────────────────────────────
describe("ml experiment tracking", () => {
  it("starts, logs, finishes and lists experiments", () => {
    const start = call("experiment-start", ctxA, {}, { name: "run-1", epochs: 10 });
    assert.equal(start.ok, true);
    const id = start.result.experiment.id;

    const log = call("experiment-log", ctxA, {}, { experimentId: id, trainLoss: 0.5, valLoss: 0.6, accuracy: 0.8 });
    assert.equal(log.ok, true);
    assert.equal(log.result.experiment.metrics.length, 1);

    const fin = call("experiment-finish", ctxA, {}, { experimentId: id });
    assert.equal(fin.ok, true);
    assert.equal(fin.result.experiment.status, "completed");

    const list = call("experiment-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
  });

  it("rejects a missing name", () => {
    const r = call("experiment-start", ctxA, {}, {});
    assert.equal(r.ok, false);
  });

  it("deletes an experiment", () => {
    const start = call("experiment-start", ctxA, {}, { name: "del-me" });
    const del = call("experiment-delete", ctxA, {}, { experimentId: start.result.experiment.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.remaining, 0);
  });

  it("isolates experiments per user", () => {
    call("experiment-start", ctxA, {}, { name: "a-run" });
    const bList = call("experiment-list", ctxB, {}, {});
    assert.equal(bList.result.count, 0);
  });
});

// ─── dataset registry ────────────────────────────────────────────────────
describe("ml dataset registry", () => {
  it("registers and versions a dataset", () => {
    const v1 = call("dataset-register", ctxA, {}, { name: "ds-x", samples: 100, features: 8 });
    assert.equal(v1.ok, true);
    assert.equal(v1.result.newVersion, 1);

    const v2 = call("dataset-register", ctxA, {}, { name: "ds-x", samples: 200 });
    assert.equal(v2.result.newVersion, 2);

    const list = call("dataset-list", ctxA, {}, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.datasets[0].versions.length, 2);
  });

  it("rejects a missing name", () => {
    assert.equal(call("dataset-register", ctxA, {}, {}).ok, false);
  });
});

// ─── model comparison ────────────────────────────────────────────────────
describe("ml.model-compare", () => {
  it("ranks supplied models into a leaderboard", () => {
    const r = call("model-compare", ctxA, {}, {
      models: [
        { name: "A", accuracy: 0.9, f1: 0.88 },
        { name: "B", accuracy: 0.7, f1: 0.6 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "A");
    assert.equal(r.result.leaderboard[0].rank, 1);
  });

  it("falls back to comparing experiments", () => {
    const e1 = call("experiment-start", ctxA, {}, { name: "cmp-1" });
    call("experiment-log", ctxA, {}, { experimentId: e1.result.experiment.id, accuracy: 0.95, valLoss: 0.1 });
    const e2 = call("experiment-start", ctxA, {}, { name: "cmp-2" });
    call("experiment-log", ctxA, {}, { experimentId: e2.result.experiment.id, accuracy: 0.6, valLoss: 0.4 });
    const r = call("model-compare", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "cmp-1");
  });

  it("rejects when too few candidates", () => {
    const r = call("model-compare", ctxB, {}, { models: [{ name: "only" }] });
    assert.equal(r.ok, false);
  });
});

// ─── AutoML templates ────────────────────────────────────────────────────
describe("ml.automl-templates", () => {
  it("returns all templates by default", () => {
    const r = call("automl-templates", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 5);
  });

  it("filters by task", () => {
    const r = call("automl-templates", ctxA, {}, { task: "regression" });
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.every((t) => t.task === "regression" || t.id.includes("regression")));
  });
});

// ─── deployments ─────────────────────────────────────────────────────────
describe("ml deployments", () => {
  it("creates, scales, stops and lists deployments", () => {
    const create = call("deploy-create", ctxA, {}, { modelId: "gpt2", name: "GPT-2" });
    assert.equal(create.ok, true);
    const id = create.result.deployment.id;
    assert.ok(create.result.deployment.endpoint.startsWith("/api/ml/serve/"));

    const scale = call("deploy-scale", ctxA, {}, { deploymentId: id, replicas: 4 });
    assert.equal(scale.result.deployment.replicas, 4);

    const stop = call("deploy-stop", ctxA, {}, { deploymentId: id });
    assert.equal(stop.result.deployment.status, "inactive");

    const list = call("deploy-list", ctxA, {}, {});
    assert.equal(list.result.count, 1);
  });

  it("rejects a missing modelId", () => {
    assert.equal(call("deploy-create", ctxA, {}, {}).ok, false);
  });
});

// ─── demo spaces ─────────────────────────────────────────────────────────
describe("ml demo spaces", () => {
  it("creates, lists and deletes a space", () => {
    const create = call("space-create", ctxA, {}, { title: "Sentiment Demo", modelId: "distilbert" });
    assert.equal(create.ok, true);
    const id = create.result.space.id;

    const list = call("space-list", ctxA, {}, {});
    assert.equal(list.result.count, 1);

    const del = call("space-delete", ctxA, {}, { spaceId: id });
    assert.equal(del.ok, true);
    assert.equal(del.result.remaining, 0);
  });

  it("requires title and modelId", () => {
    assert.equal(call("space-create", ctxA, {}, { title: "x" }).ok, false);
    assert.equal(call("space-create", ctxA, {}, { modelId: "m" }).ok, false);
  });
});
